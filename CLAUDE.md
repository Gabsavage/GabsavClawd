# GabsavClawd — CLAUDE.md

Autonomous meme token scout and concept generator for pump.fun on Solana.

## Project overview

The system continuously monitors trending topics and on-chain activity, generates meme token concepts via Claude, and sends them to a Telegram chat for human review. A human approves, skips, or modifies each concept before any token is launched.

## Tech stack

- **Runtime:** Node.js ESM (`"type": "module"`)
- **Database:** SQLite via `better-sqlite3` (`src/database/data/pumpfun.db`, gitignored)
- **Dependencies:** `better-sqlite3`, `ws`, `express` (dashboard, currently unused in main loop)
- **No build step.** No TypeScript. No transpilation.

## Commands

```bash
npm start        # production — loads .env via Node --env-file
npm run dev      # dev — same + --watch for hot reload
```

`.env` is loaded by Node's built-in `--env-file` flag — no `dotenv` package.

## Required environment variables

| Variable | Used by |
|---|---|
| `ANTHROPIC_API_KEY` | `conceptGenerator.js` — Claude API calls |
| `PERPLEXITY_API_KEY` | `perplexityScout.js` — Flux 1 news scan |
| `XAI_API_KEY` | `grokScout.js` — Flux 3 CT scan + CT context enrichment |
| `TELEGRAM_BOT_TOKEN` | `telegramBot.js` |
| `TELEGRAM_CHAT_ID` | `telegramBot.js` — destination chat |

## Source tree

```
src/
├── index.js                   # Entry point. Orchestrates all cycles and timers.
├── bot/
│   ├── telegramBot.js         # Long-poll Telegram bot. Interactive concept review.
│   └── hotTopics.json         # Persisted "hot" angles (created at runtime, gitignored).
├── creative/
│   └── conceptGenerator.js    # Claude API. Generates concepts for Flux 1/2/3.
├── database/
│   ├── db.js                  # SQLite schema, migrations, all query helpers.
│   └── data/                  # DB file lives here (gitignored).
└── scout/
    ├── dexScreenerScout.js    # DexScreener REST API. Volume/price enrichment.
    ├── grokScout.js           # xAI Grok API. CT trend scan + per-signal meme enrichment (Flux 1) + per-token narrative (Flux 2).
    ├── perplexityScout.js     # Perplexity API. Mainstream/social news scan.
    └── webSocketScout.js      # PumpPortal WebSocket. Real-time token + migration feed.
```

## Architecture: three generation pipelines

### Flux 1 — World -> Crypto
- **Trigger:** immediate start, then every 30 min
- **Scout:** Perplexity (`sonar` model) scans mainstream/social media for trending topics with `signal_strength >= 5` and `spread != single_source`. Weighted toward viral internet moments (Reddit, TikTok) equally with mainstream news.
- **Enrichment:** `analyzeNewsMemePotential(signal)` (Grok) — per-signal structured CT analysis: `meme_angle`, `ct_reaction`, `key_character_or_moment`, `visual_potential`, `trending_words`. Returns `null` if CT is silent.
- **Generator:** `generateFromSignal()` — 2-step Claude prompt: state the meme angle first, then name the token. Falls back to `what_happened`/`absurdity_angle` reasoning when Grok returns null.
- **Dedup:** skips topics already generated in the last 6 hours

### Flux 2 — Crypto -> Crypto
- **Trigger:** immediate start, then every 60 min
- **Scout:** `getTopMovers(10)` — top 10 tokens by `volume_usd_h1` from DexScreener-enriched data
- **Enrichment:** `analyzeTokenNarrative(token)` (Grok) — per-token structured CT analysis: `why_pumping`, `ct_reaction`, `meme_angle`, `vibe`. Returns `null` if CT is silent.
- **Generator:** `generateVariants()` — 2-step Claude prompt: state the underlying energy first, then create a new token from a different angle. Up to 3 concepts per cycle, deduplicated by theme.
- **Dedup:** skips if a variant for that ticker was already generated in the last 2 hours

### Flux 3 — CT Trend
- **Trigger:** immediate start, then every 45 min
- **Scout:** `scanCryptoTwitter()` (Grok) — finds 3-5 rising memes/narratives on CT
- **Enrichment:** `getTopMovers(5)` (DexScreener) — top 5 pumping tokens injected as market context into the generator prompt ("what degens are buying right now")
- **Generator:** `generateFromCTTrend()` — 2-step Claude prompt: state the specific hook/energy from the CT trend first, then create the token (same pattern as Flux 1/2). Up to 3 concepts per cycle. `source_migrations` is set to top mover tickers.
- **Dedup:** `hasRecentConceptByKeywords()` — SQL `LIKE` match on `source_signal` using trend keywords (handles dynamic trend names that change between cycles)

### DexScreener refresh (background)
- **Trigger:** immediate start, then every 15 min
- Fetches volume + price data for all PumpPortal tokens from the last 24h not updated in 15 min
- Batches up to 30 mint addresses per API call with 500ms delay between batches
- Writes to `tokens` table and `token_volume_history` for momentum tracking

### PumpPortal WebSocket (always-on)
- Connects to `wss://pumpportal.fun/api/data`
- Subscribes to `subscribeNewToken` and `subscribeMigration`
- Filters: ignores new tokens with market cap < 300 SOL
- Auto-reconnects on disconnect (5s delay)
- Detects theme (`animal`, `politics`, `celebrity`, `crypto`, `religion`, `internet`) and format (`send`, `what-the`, `inu`, `coin`, `classic`) from token name/description

## Database schema

**`tokens`** — pump.fun tokens ingested from PumpPortal, enriched by DexScreener
- Key fields: `name`, `ticker`, `mint`, `theme`, `format`, `keywords`, `migrated`, `source`, `volume_sol`, `volume_usd_h1`, `price_change_h1`, `last_dex_update`
- Unique constraint: `(name, ticker)`

**`signals`** — trending topics from Perplexity (Flux 1)
- Key fields: `title`, `source`, `score`, `signal_strength`, `spread`, `velocity`, `shelf_life`, `absurdity_angle`, `used`

**`concepts`** — generated token concepts
- Key fields: `name`, `ticker`, `flux`, `telegram_status` (`pending` / `approved` / `rejected` / `hot`), `source_signal`, `feedback_notes`

**`token_volume_history`** — time-series snapshots for momentum calculation
- Used by `getTokenMomentum()` to classify tokens as `pumping` / `dumping` / `stable`

## Telegram bot

Long-poll loop in `telegramBot.js`. Each concept card has four inline buttons:

| Button | Effect |
|---|---|
| Launch | Adds concept to `pendingLaunches` in-memory array, marks DB status `approved` |
| Modify | Opens free-text reply flow; modified concept goes to `pendingLaunches` |
| Skip | Marks DB status `rejected` |
| Keep angle | Marks DB status `hot`, appends to `src/bot/hotTopics.json` |

Commands: `/status`, `/pending`, `/help`

`pendingLaunches` is in-memory only — printed to console on graceful shutdown (SIGINT/SIGTERM). No automated on-chain launch; human copy-pastes to pump.fun manually.

## Concept generation details

**Model:** `claude-sonnet-4-6`, `max_tokens: 512`

**Concurrency:** 3 parallel Claude API calls (`CONCURRENCY = 3` in `conceptGenerator.js`)

**Retry:** up to 3 attempts on HTTP 529 (overloaded), 10s delay between retries

**Per-concept DB insert:** every generated concept is inserted into `concepts` before being sent to Telegram. Telegram status starts as `pending`.

**CT context enrichment:**
- **Flux 1:** `analyzeNewsMemePotential(signal)` — structured Grok analysis per Sonar signal. Returns `{ meme_angle, ct_reaction, key_character_or_moment, visual_potential, trending_words }` or `null`.
- **Flux 2:** `analyzeTokenNarrative(token)` — structured Grok analysis per pumping token. Returns `{ why_pumping, ct_reaction, meme_angle, vibe }` or `null`.
- Both functions follow the same error-handling pattern: API key guard → HTTP error → JSON parse guard → outer catch. All return `null` on any failure.

## Key design decisions

- **No dotenv.** Env loading is done manually in `index.js:loadEnv()` via `fs.readFileSync`.
- **No external HTTP framework for the bot.** Telegram uses raw `fetch` with long-polling.
- **SQLite migrations are inline.** `db.js` runs `ALTER TABLE` statements in try/catch on startup — no migration files.
- **All three Flux pipelines are active.** Flux 1 runs every 30 min (immediate start), Flux 2 every 60 min, Flux 3 every 45 min.
- **No automated token launch.** `pendingLaunches` is a manual queue — the bot operator launches tokens by hand.
