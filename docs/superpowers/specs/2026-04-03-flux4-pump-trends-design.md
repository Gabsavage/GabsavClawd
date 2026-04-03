# Flux 4 — Pump.fun Trends + Flux 1/2 Enrichments

**Date:** 2026-04-03
**Status:** Approved

---

## Overview

Three additions to GabsavClawd that integrate on-chain pump_trends data (written by token-screener into shared Turso DB) into the concept generation pipeline:

1. **Flux 4** — new pipeline "Pump.fun Trends": reads top on-chain trends and generates token concepts riding active waves
2. **Flux 1 enrichment** — injects a TREND ALERT into existing news signals when a keyword matches an active on-chain trend
3. **Flux 2 enrichment** — enriches token narratives with wave context when the pumping token is part of a broader on-chain trend

No new files. All changes in 4 existing files.

---

## Files Changed

| File | Changes |
|---|---|
| `src/database/db.js` | +3 read functions on `pump_trends` |
| `src/scout/grokScout.js` | +`analyzePumpTrend(trend)` |
| `src/creative/conceptGenerator.js` | +`generateFromPumpTrend(trend)` + Flux 1/2 enrichments + 4th param in `generateConcepts()` |
| `src/index.js` | +`runFlux4Cycle()` + `setInterval` |

---

## Data Flow

### Flux 4
```
runFlux4Cycle()
  → db.getActiveTrends(3)
  → generateConcepts([], [], [], trends)
    → generateFromPumpTrend(trend) per trend
      → grokScout.analyzePumpTrend(trend)   — real X search via /v1/responses
      → db.searchSimilarTokens([keyword])   — blacklist
      → parse trend.tokens_json             — sample tokens (blacklist + style)
      → callClaude(prompt)
      → return { ...concept, flux: '4', source_signal: trend.keyword }
```

### Flux 1 enrichment (first-match)
```
generateFromSignal(signal)
  → (existing) analyzeNewsMemePotential()
  → for kw of signal.keywords: getTrendForKeyword(kw) → break on first match
  → if match: inject TREND ALERT block into prompt (between existingTokensBlock and TICKER FIRST RULE)
  → CT silent fallback references TREND ALERT if trendAlertBlock non-empty
```

### Flux 2 enrichment (conditional)
```
generateVariants(movers)
  → (existing) analyzeTokenNarrative()
  → getTrendsForToken(migration.mint)
  → if !narrative && trend: trend replaces narrativeBlock
  → if narrative && trend: trend appended as WAVE CONTEXT
  → if !trend: unchanged
```

---

## Section 1: `db.js` — 3 Read Functions

No `CREATE TABLE` — `pump_trends` is managed by token-screener, already present in Turso.

### Schema reference (pump_trends)
```
id, trend_type, keyword, display_name, token_count, hot_level_sum,
smart_degen_sum, strength_score, active, detected_at, expires_at,
tokens_json, parent_keywords
```

### `getActiveTrends(limit = 3)`
```sql
SELECT keyword, display_name, trend_type, strength_score,
       token_count, tokens_json, detected_at, expires_at
FROM pump_trends
WHERE active = 1
ORDER BY strength_score DESC
LIMIT ?
```

### `getTrendForKeyword(keyword)`
```sql
SELECT keyword, display_name, trend_type, strength_score,
       token_count, tokens_json
FROM pump_trends
WHERE active = 1 AND LOWER(keyword) = LOWER(?)
LIMIT 1
```
Returns `rows[0] ?? null`.

### `getTrendsForToken(mint)`
```sql
SELECT keyword, display_name, trend_type, strength_score, token_count, tokens_json
FROM pump_trends
WHERE active = 1 AND tokens_json LIKE ?
ORDER BY strength_score DESC
LIMIT 1
```
Args: `['%' + mint + '%']`. Returns `rows[0] ?? null`.

Note: `tokens_json` LIKE match works when token-screener stores mints as strings in a JSON array. Adjust if schema differs.

---

## Section 2: `grokScout.js` — `analyzePumpTrend(trend)`

**Endpoint:** `GROK_RESPONSES_URL` (`/v1/responses`) + `tools: [{ type: 'x_search', from_date, to_date }]`
(Same as `analyzeNewsMemePotential` — confirmed via xAI docs: real X search requires `/v1/responses`, not `/v1/chat/completions`)

**Output shape** (identical to `analyzeNewsMemePotential`):
```json
{
  "meme_angle": "string",
  "ct_reaction": "string",
  "key_character_or_moment": "string",
  "visual_potential": "string",
  "trending_words": ["string"]
}
```
Returns `null` on any failure (API key guard → HTTP error → JSON parse guard → outer catch).

**Prompt:** Grok receives keyword, display_name, trend_type, token_count, strength_score, and 3 sample tokens parsed from `tokens_json` (try/catch, fallback `[]`). Asked to search X and return CT angle on this on-chain wave.

**ct_silent check:** if Grok returns `{ ct_silent: true }`, function returns `null`.

**Export:** added to named exports of `grokScout.js`.

---

## Section 3: `conceptGenerator.js`

### 3a. `generateFromPumpTrend(trend)`

1. `analyzePumpTrend(trend)` → `memeContext`
2. `searchSimilarTokens([trend.keyword])` → `similar` (blacklist)
3. Parse `trend.tokens_json` → `sampleTokens[]` (top 3, try/catch fallback `[]`)
4. Build prompt (2-step pattern)
5. `callClaude(prompt)` → concept
6. Return `{ ...concept, flux: '4', source_signal: trend.keyword }`

**Prompt structure:**
```
ON-CHAIN TREND: <display_name || keyword>
KEYWORD: <keyword>
TREND TYPE: <trend_type>
TOKENS ON-CHAIN: <token_count> tokens created around this keyword
STRENGTH SCORE: <strength_score>
SAMPLE TOKENS IN THIS WAVE: [name ($TICKER), ...]

<memeContextBlock or fallback>

BLACKLIST (DO NOT REUSE NAMES): <searchSimilarTokens + sampleTokens>

STEP 1 — In one sentence, what is the on-chain energy driving this wave?
STEP 2 — CREATE A TOKEN that rides or subverts that wave.
```

**memeContextBlock (CT found):** same structure as Flux 1 (THE REAL MEME ANGLE / WHAT CT IS SAYING / THE CHARACTER/MOMENT / VISUAL POTENTIAL / TRENDING WORDS)

**Fallback (memeContext null):**
```
CT IS SILENT ON THIS KEYWORD.
Reason from the on-chain wave itself: <token_count> tokens exist around "<keyword>".
What energy or joke drives degens to create this many tokens around this keyword?
```

**Return flux:** `'4'`

### 3b. Flux 1 TREND ALERT (first-match)

In `generateFromSignal`, after `analyzeNewsMemePotential`, before building the final prompt:

```js
let trendAlertBlock = '';
for (const kw of (signal.keywords || [])) {
  const trend = await getTrendForKeyword(kw);
  if (trend) {
    trendAlertBlock = `\nTREND ALERT — THIS THEME IS ALREADY HOT ON-CHAIN:\n` +
      `${trend.token_count} tokens minted around "${trend.keyword}" | strength: ${trend.strength_score}\n` +
      `→ If your token contains this exact keyword, degens searching pump.fun will find it.\n`;
    break;
  }
}
```

Injected between `existingTokensBlock` and `TICKER FIRST RULE`.

**CT silent fallback updated** — when `!memeContext && trendAlertBlock`:
```
CT IS SILENT ON THIS TOPIC.
But this theme is already hot on-chain (see TREND ALERT above).
Reason from the most absurd or shareable fact: "<signal.what_happened || signal.absurdity_angle>"
```

### 3c. Flux 2 conditional enrichment

In `generateVariants`, after `analyzeTokenNarrative`:

```js
const waveTrend = migration.mint ? await getTrendsForToken(migration.mint) : null;
```

**Case 1 — `!narrative && waveTrend`:** wave replaces narrativeBlock:
```
ON-CHAIN WAVE DETECTED — THIS TOKEN IS PART OF A TREND:
Keyword: <keyword> | <token_count> tokens | score: <strength_score>
Sample: [name ($TICKER), ...]
CT is silent on this specific token, but <token_count> tokens exist around this keyword.
What energy drives degens to mint this many tokens? Build from that wave.
```

**Case 2 — `narrative && waveTrend`:** append WAVE CONTEXT after narrativeBlock:
```
WAVE CONTEXT (broader on-chain trend):
<token_count> tokens around "<keyword>" | score: <strength_score>
This isn't isolated — it's a wave. Your token should fit the wave or counter it from an unexpected angle.
```

**Case 3 — no trend:** unchanged.

### 3d. `generateConcepts()` signature + Flux 4 loop

```js
async function generateConcepts(signals = [], migrations = [], ctTrends = [], pumpTrends = [])
```

Flux 4 dedup loop (same pattern as Flux 3):
```js
for (const trend of pumpTrends.slice(0, 3)) {
  if (await hasRecentConceptByKeywords([trend.keyword])) {
    console.log(`[flux4] ⏭ Skip "${trend.keyword}" — recent concept found`);
    continue;
  }
  tasks.push(() => generateFromPumpTrend(trend));
}
```

`generateFromPumpTrend` added to named exports.

---

## Section 4: `index.js`

### Imports
`getActiveTrends` imported from `./database/db.js`.

### `runFlux4Cycle()`

```js
const FLUX4_INTERVAL_MS = 45 * 60 * 1000;

async function runFlux4Cycle() {
  const entry = logEntry('flux4');
  console.log(`[flux4] Pump trends scan starting at ${entry.startedAt}`);
  try {
    const trends = await getActiveTrends(3);
    entry.signalCount = trends.length;
    if (trends.length === 0) {
      console.log('[flux4] No active pump trends — skipping');
      finishEntry(entry, { conceptCount: 0 });
      return;
    }
    console.log(`[flux4] ${trends.length} trend(s) found`);
    const concepts = await generateConcepts([], [], [], trends);
    entry.conceptCount = concepts.length;
    const sent = await broadcastConcepts(concepts);
    console.log(`[flux4] ${sent}/${concepts.length} concept(s) sent to Telegram`);
    finishEntry(entry, { conceptCount: concepts.length });
  } catch (err) {
    entry.status = 'error';
    finishEntry(entry);
    console.error(`[flux4] Cycle error: ${err.message}`);
  }
}
```

### `main()` additions
```js
runFlux4Cycle().catch(err => console.error(`[flux4] Unhandled error: ${err.message}`));
setInterval(() => runFlux4Cycle().catch(...), FLUX4_INTERVAL_MS);
console.log('[main] Flux 4 cycle: every 45 min, immediate start');
```

---

## Error Handling

All new DB functions follow the existing pattern: return `null` / `[]` on failure (Turso errors surface as thrown exceptions caught by the calling generator's outer try/catch).

`analyzePumpTrend` follows the same 4-layer guard as `analyzeNewsMemePotential`:
1. API key guard → `return null`
2. HTTP error check → log + `return null`
3. JSON parse guard → log + `return null`
4. Outer catch → log + `return null`

---

## Deduplication Summary

| Flux | Dedup function | Window |
|---|---|---|
| Flux 1 | `hasRecentConceptExtended(signal.topic)` | 6h |
| Flux 2 | `hasRecentConcept(migration.ticker)` | 2h |
| Flux 3 | `hasRecentConceptByKeywords(trend.keywords)` | 6h |
| Flux 4 | `hasRecentConceptByKeywords([trend.keyword])` | 6h |

---

## Out of Scope

- No `CREATE TABLE pump_trends` in GabsavClawd — table owned by token-screener
- No write operations on `pump_trends`
- No dashboard updates for Flux 4
- No changes to Telegram bot card format (Flux 4 concepts use same `sendConcept` flow)
