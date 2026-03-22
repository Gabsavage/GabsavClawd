# Flux 3 Refonte — Design Spec

**Date:** 2026-03-22
**Status:** Approved
**Goal:** Align Flux 3 (CT Trend) with the quality standard established for Flux 1 and Flux 2 — market signal, structured prompt, clean audit trail.

---

## Problem Statement

Flux 3 (`generateFromCTTrend`) has three linked problems:

1. **Wrong inspiration source.** The function tries to find pump.fun tokens via `searchSimilarTokens(keywords)` + a keyword-vs-ticker fallback. When neither finds matches, `source_migrations` shows `"CT trend"` — a meaningless placeholder. The real problem is structural: `searchSimilarTokens` finds *historically* similar tokens by theme, not tokens *currently pumping*. There are always tokens pumping on pump.fun (accessible via `getTopMovers`) — they were just never wired into Flux 3.

2. **Mixed responsibilities.** The existing similar tokens block does two different jobs (inspire Claude + blacklist names) with no separation. This makes the prompt confusing and the blacklist ineffective.

3. **Underpowered prompt.** The current prompt has no STEP 1 / STEP 2 chain-of-thought, no good/bad example, and weaker rules than Flux 1/2. Grok already returns the CT meme angle natively — the gap is in how Claude is told to use it.

---

## Out of Scope

- `scanCryptoTwitter()` in `grokScout.js` — no changes. The scan already returns structured CT data (`trend`, `what_ct_says`, `vibe`, `meme_potential`, `keywords`). Adding a second per-trend Grok enrichment call would be redundant since the source IS already Grok/CT.
- Dedup logic (`hasRecentConceptByKeywords`) — keep as-is, observe in production.
- All other pipelines (Flux 1, Flux 2, index.js, Telegram bot).

---

## Approach

Single file change: rewrite `generateFromCTTrend()` in `src/creative/conceptGenerator.js`.

Three changes inside the function:

1. **Add `getTopMovers(5)` as market signal** — replace the `pumpfunTickers` fallback entirely. Import `getTopMovers` from `dexScreenerScout`. Call it inside `generateFromCTTrend`, same pattern as `searchSimilarTokens`.

2. **Split the two roles cleanly** — `getTopMovers(5)` → market signal block for Claude. `searchSimilarTokens(keywords)` → blacklist only. Two separate labeled sections in the prompt.

3. **Rewrite the Claude prompt** — STEP 1 / STEP 2 structure, concrete good/bad example, stronger rules, same standard as Flux 1/2.

---

## Section 1 — Data Preparation

Inside `generateFromCTTrend(trend)`:

```js
const movers = getTopMovers(5);
const similar = searchSimilarTokens(trend.keywords || []);
```

**`movers` → market signal block:**
```
WHAT'S PUMPING ON PUMP.FUN RIGHT NOW (market context — what degens are buying):
  - "Trump Inu" ($TINU) | $42,000/h vol | theme: politics
  - "Pepe Classic" ($PEPEC) | $18,000/h vol | theme: internet
  ...
```
If `movers` is empty (DexScreener hasn't run yet): `"  (no data yet — DexScreener refresh pending)"`.

**`similar` → blacklist block:**
```
TOKENS THAT ALREADY EXIST ON THIS THEME (DO NOT COPY THESE NAMES):
  - "Cope Token" ($COPE)
  - "We're Back" ($BACK)
  ...
```
If `similar` is empty: omit the block entirely (no need to say "none").

**`source_migrations` → audit field:**
```js
const moverTickers = movers.length > 0
  ? movers.map(m => `$${m.ticker}`).join(', ')
  : null;
// ...
return { ...concept, flux: '3', source_signal: trend.trend, source_migrations: moverTickers };
```
`null` when no movers (not the string `'CT trend'`). Cleaner than a meaningless placeholder.

---

## Section 2 — Claude Prompt

Full replacement of the existing prompt:

```
CT TREND: ${trend.trend}
WHAT CT IS SAYING: ${trend.what_ct_says}
VIBE: ${trend.vibe}
MEME POTENTIAL: ${trend.meme_potential}

${moversBlock}

${blacklistBlock}

STEP 1 — BEFORE YOU NAME ANYTHING: In one sentence, what is the specific hook
from this CT trend that would make a degen APE IN immediately?
Not the trend name — the exact joke, energy, or moment CT is reacting to.
Consider what's pumping right now — is there an angle that bridges the CT wave
with what the market is already buying?

STEP 2 — CREATE THE TOKEN from that hook.

EXAMPLE of good vs bad:
- CT trend: "we're so back" wave sweeping CT, full degen optimism
- BAD token: "We're So Back" ($BACK) — too literal, CT already has 10 of these
- GOOD token: "Cope Harder" ($COPE) — the ironic counter-energy CT actually memes

RULES:
- Use the EXACT slang from WHAT CT IS SAYING — degens search these exact words
- If CT has a specific joke or nickname, BUILD ON THAT, don't abstract it
- The token must be funny ON ITS OWN without knowing the CT context
- TICKER: real word or recognizable name, not an abbreviation

Return JSON only:
{
  "name": string (max 32 chars),
  "ticker": string (max 10 chars, real word, not abbreviation),
  "description": string (1 sentence, shitpost energy),
  "narrative": string (1 sentence, why degens buy this),
  "image_prompt": string (visual for pump.fun thumbnail),
  "flux": "3"
}
```

---

## File Changed

| File | Change |
|---|---|
| `src/creative/conceptGenerator.js` | Add `getTopMovers` import from dexScreenerScout; rewrite `generateFromCTTrend()` |

---

## Data Flow After This Change

```
runFlux3Cycle() [every 45 min, immediate start]
  │
  └─ scanCryptoTwitter()          → 3-5 CT trends
       │
       └─ generateConcepts([], [], trends)
            │
            └─ for each trend (up to 3, keyword dedup):
                 │
                 └─ generateFromCTTrend(trend)
                      │
                      ├─ getTopMovers(5)              [DB — market signal]
                      │    → top 5 tokens by volume_usd_h1
                      │
                      ├─ searchSimilarTokens(keywords) [DB — blacklist]
                      │    → thematically related tokens
                      │
                      └─ callClaude(prompt)  [STEP 1: hook | STEP 2: token]
                           → { name, ticker, description, narrative,
                               image_prompt, flux: "3" }
                           source_migrations: top mover tickers (for audit)
```
