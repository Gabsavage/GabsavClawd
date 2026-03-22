# Flux 3 Refonte Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `generateFromCTTrend()` to use `getTopMovers(5)` as market signal, separate from the blacklist, and add a 2-step Claude prompt matching the quality standard of Flux 1/2.

**Architecture:** Single function change inside `src/creative/conceptGenerator.js` — add one import (`getTopMovers` from dexScreenerScout), remove the broken `pumpfunTickers` fallback block, split `similar` tokens (blacklist only) from `movers` (market signal), rewrite the Claude prompt with STEP 1/STEP 2 structure.

**Tech Stack:** Node.js ESM, SQLite via better-sqlite3, Anthropic Claude (claude-sonnet-4-6), DexScreener data already in DB via `getTopMovers`.

---

## File Map

| File | Change |
|---|---|
| `src/creative/conceptGenerator.js` | Add `getTopMovers` import; rewrite `generateFromCTTrend()` (lines 407-461) |

---

## Task 1: Rewrite `generateFromCTTrend()` with market signal + structured prompt

**Files:**
- Modify: `src/creative/conceptGenerator.js:1-2` (imports)
- Modify: `src/creative/conceptGenerator.js:407-461` (`generateFromCTTrend` function)

### Background for the implementer

`generateFromCTTrend(trend)` receives a CT trend object from Grok:
```js
{
  trend: string,       // e.g. "we're so back"
  what_ct_says: string,// what CT is actually posting
  vibe: string,        // "bullish" | "bearish" | "chaotic" | "ironic" | "angry"
  meme_potential: string,
  keywords: string[]
}
```

The current function has a broken `pumpfunTickers` fallback that tries to match keywords against ticker names and frequently returns nothing → `source_migrations: 'CT trend'`. This entire block is being removed and replaced with `getTopMovers(5)`.

`getTopMovers` is already used by Flux 2 in `index.js` and exported from `src/scout/dexScreenerScout.js`. It queries the DB for the 5 most-traded tokens by `volume_usd_h1` in the last 24h with DexScreener data. Returns objects with: `name`, `ticker`, `mint`, `theme`, `volume_usd_h1`, `volume_usd_h24`, `price_change_h1`, `price_change_h24`, `buys_h24`, `sells_h24`, `price_usd`.

`searchSimilarTokens(keywords)` (already imported from db.js) stays — it becomes the blacklist only.

- [ ] **Step 1: Read the current file — imports and the function**

  Read `src/creative/conceptGenerator.js` lines 1-3 (imports) and lines 407-461 (`generateFromCTTrend`).

  Confirm:
  - Line 1: `import db, { getTopThemes, getTopFormats, searchSimilarTokens, ... } from '../database/db.js';`
  - Line 2: `import { analyzeTokenNarrative, analyzeNewsMemePotential } from '../scout/grokScout.js';`
  - `getTopMovers` is NOT currently imported in this file
  - Line 407: `async function generateFromCTTrend(trend) {`
  - Line 461: closing `}` of the function

- [ ] **Step 2: Add `getTopMovers` import**

  Add a new import line after line 2:
  ```js
  import { getTopMovers } from '../scout/dexScreenerScout.js';
  ```

- [ ] **Step 3: Replace the entire `generateFromCTTrend` function**

  Replace everything from `async function generateFromCTTrend(trend) {` through its closing `}` (lines 407-461) with:

  ```js
  async function generateFromCTTrend(trend) {
    if (!trend) return [];

    const movers = getTopMovers(5);
    const similar = searchSimilarTokens(trend.keywords || []);

    const moversBlock = movers.length > 0
      ? 'WHAT\'S PUMPING ON PUMP.FUN RIGHT NOW (market context — what degens are buying):\n' +
        movers.map(m => `  - "${m.name}" ($${m.ticker}) | $${m.volume_usd_h1?.toFixed(0) || 0}/h vol | theme: ${m.theme || 'unknown'}`).join('\n')
      : 'WHAT\'S PUMPING ON PUMP.FUN RIGHT NOW:\n  (no data yet — DexScreener refresh pending)';

    const blacklistBlock = similar.length > 0
      ? 'TOKENS THAT ALREADY EXIST ON THIS THEME (DO NOT COPY THESE NAMES):\n' +
        similar.map(t => `  - "${t.name}" ($${t.ticker})`).join('\n')
      : '';

    const prompt = `CT TREND: ${trend.trend}
WHAT CT IS SAYING: ${trend.what_ct_says}
VIBE: ${trend.vibe}
MEME POTENTIAL: ${trend.meme_potential}

${moversBlock}${blacklistBlock ? '\n\n' + blacklistBlock : ''}

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
}`;

    const concept = await callClaude(prompt);
    const moverTickers = movers.length > 0 ? movers.map(m => `$${m.ticker}`).join(', ') : null;
    return concept ? { ...concept, flux: '3', source_signal: trend.trend, source_migrations: moverTickers } : null;
  }
  ```

  **Important — template literal indentation:** The prompt content (everything between the backticks after `const prompt = \``) must start at column 0, not indented. This is the established pattern in the file (see original lines 433-457). The `const prompt = \`` assignment is indented, but the string content is not.

- [ ] **Step 4: Syntax check**

  Run: `node --check src/creative/conceptGenerator.js`
  Expected: no output (no errors). If errors appear, fix them before continuing.

- [ ] **Step 5: Verify the new import resolves**

  Run: `node -e "import('./src/scout/dexScreenerScout.js').then(m => console.log('getTopMovers:', typeof m.getTopMovers))"`
  Expected: `getTopMovers: function`

  (The full `import('./src/creative/conceptGenerator.js')` will fail due to the better-sqlite3 native module not being available in bare shell — this is expected and not an error in the code.)

- [ ] **Step 6: Spot-check the return shape**

  The return value must be:
  ```js
  { ...concept, flux: '3', source_signal: trend.trend, source_migrations: moverTickers }
  ```
  Where `moverTickers` is either a comma-separated string of `$TICKER` values, or `null` (not the string `'CT trend'`).

  Verify by reading the last 3 lines of the new function. Confirm `source_migrations: moverTickers` and NOT `source_migrations: moverTickers || 'CT trend'`.

- [ ] **Step 7: Commit**

  ```bash
  git add src/creative/conceptGenerator.js
  git commit -m "feat(flux3): add getTopMovers market signal + rewrite generateFromCTTrend prompt"
  ```
