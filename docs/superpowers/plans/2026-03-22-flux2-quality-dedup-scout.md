# Flux 2 Quality + Dedup + Scout Coherence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Flux 2 concept quality by replacing the generic CT context call with a structured token narrative analysis, fix Flux 3 dedup to use keyword matching instead of exact string, and clean up dead code across scouts.

**Architecture:** Add `analyzeTokenNarrative()` to grokScout.js that returns structured `{why_pumping, ct_reaction, meme_angle, vibe}` for each pumping token — mirroring the structured output Flux 3 already uses. Inject these fields into the Flux 2 Claude prompt with explicit reasoning instructions and concrete examples. Fix Flux 3 dedup by adding a keyword-based DB query in db.js and using it in conceptGenerator.js.

**Tech Stack:** Node.js ESM, better-sqlite3, xAI Grok API (grok-4-1-fast-non-reasoning), Anthropic Claude API (claude-sonnet-4-6), Telegram Bot API

---

## File Map

| File | Change |
|---|---|
| `src/scout/grokScout.js` | Add `analyzeTokenNarrative(token)` export |
| `src/creative/conceptGenerator.js` | Update `generateVariants()` to use `analyzeTokenNarrative`, improve Flux 2 prompt, fix Flux 3 dedup slice |
| `src/database/db.js` | Add `hasRecentConceptByKeywords(keywords, hours)` export |
| `src/index.js` | Remove dead imports (`getRecentTokens`, `getLatestSignals`) — keep `getRecentMigrations` |
| `src/scout/webSocketScout.js` | No changes needed |
| `src/scout/perplexityScout.js` | Fix standalone test log threshold inconsistency |
| `src/scout/dexScreenerScout.js` | No changes needed |

---

## Task 1: Add `analyzeTokenNarrative()` to grokScout.js

**Files:**
- Modify: `src/scout/grokScout.js`

This replaces the generic `getTwitterContext()` call for Flux 2 with a focused, structured Grok query that asks specifically WHY a pumping token is pumping and what CT is saying about it. Returns structured JSON like Flux 3's `scanCryptoTwitter()`, or `null` if CT is silent.

- [ ] **Step 1: Add `analyzeTokenNarrative` function**

Open `src/scout/grokScout.js` and add this function after the existing `getTwitterContext` function (around line 56, before `scanCryptoTwitter`):

```js
export async function analyzeTokenNarrative(token) {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    console.warn('[GrokScout] XAI_API_KEY not set — skipping token narrative analysis.');
    return null;
  }

  const today = new Date().toISOString().split('T')[0];

  try {
    const res = await fetch(GROK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'grok-4-1-fast-non-reasoning',
        messages: [
          {
            role: 'system',
            content: 'You are a Crypto Twitter analyst. Search X/Twitter and pump.fun community chatter to understand WHY specific tokens are pumping. Report raw CT energy, slang, and memes. Always respond in English with valid JSON only, no markdown.',
          },
          {
            role: 'user',
            content: `Today is ${today}. This token is pumping on pump.fun right now: "${token.name}" ($${token.ticker}) — +${token.price_change_h1 || 0}% in the last hour, $${token.volume_usd_h1 || 0} volume.

Search X/Twitter and CT. Find WHY it's pumping and what CT is saying.

Return JSON:
{
  "why_pumping": string (1-2 sentences — the real event, meme, or narrative driving the pump, or "pure hype / no clear reason"),
  "ct_reaction": string (2-3 sentences — what people are actually posting, use their exact slang),
  "meme_angle": string (1 sentence — the specific visual or concept CT is turning into a meme),
  "vibe": "bullish" | "ironic" | "chaotic" | "mocking" | "hyping"
}

If CT is completely silent on this token (not mentioned anywhere), return: {"ct_silent": true}`,
          },
        ],
      }),
    });

    if (!res.ok) {
      console.error(`[GrokScout] analyzeTokenNarrative error ${res.status}`);
      return null;
    }

    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content ?? '';
    const content = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const result = JSON.parse(content);

    if (result.ct_silent) {
      console.log(`[GrokScout] CT silent on "${token.name}" ($${token.ticker})`);
      return null;
    }

    console.log(`[GrokScout] Narrative for "${token.name}": ${result.why_pumping?.slice(0, 80)}...`);
    return result;

  } catch (err) {
    console.error('[GrokScout] analyzeTokenNarrative failed:', err.message);
    return null;
  }
}
```

- [ ] **Step 2: Verify the export is present**

Run: `node --input-type=module <<'EOF'
import { analyzeTokenNarrative } from './src/scout/grokScout.js';
console.log(typeof analyzeTokenNarrative);
EOF`

Expected output: `function`

- [ ] **Step 3: Commit**

```bash
git add src/scout/grokScout.js
git commit -m "feat: add analyzeTokenNarrative() to grokScout for structured Flux 2 CT context"
```

---

## Task 2: Rewrite `generateVariants()` to use structured narrative

**Files:**
- Modify: `src/creative/conceptGenerator.js`

Replace the current `getTwitterContext()` call in `generateVariants()` with `analyzeTokenNarrative()`. Rebuild the Flux 2 Claude prompt to inject the structured fields explicitly, add a reasoning-first instruction, and include a concrete example (Hello World → $CRASH).

- [ ] **Step 1: Update the imports at the top of conceptGenerator.js**

In `src/creative/conceptGenerator.js`:

**Line 2** — remove the unused webSocketScout import entirely:
```js
import { getRecentTokens } from '../scout/webSocketScout.js';
```
Delete this line. `getRecentTokens` is never called anywhere in this file.

**Line 3** — add `analyzeTokenNarrative` to the existing grokScout import (keep `getTwitterContext` — it is still used by `generateFromSignal()` for Flux 1 at line 178):
```js
import { getTwitterContext, scanCryptoTwitter } from '../scout/grokScout.js';
```
to:
```js
import { getTwitterContext, analyzeTokenNarrative, scanCryptoTwitter } from '../scout/grokScout.js';
```

- [ ] **Step 2: Rewrite `generateVariants()` (lines 222–289)**

Replace the entire `generateVariants` function with:

```js
async function generateVariants(movers) {
  if (!movers || movers.length === 0) return [];

  const validMovers = movers.filter(m => m.name && m.ticker);
  if (validMovers.length === 0) return [];

  // One token per call (called with single-item arrays from generateConcepts)
  const migration = validMovers[0];

  const migrationKeywords = validMovers.flatMap(m => {
    const name = (m.name || '').toLowerCase().split(/\s+/);
    const ticker = (m.ticker || '').toLowerCase();
    return [...name, ticker].filter(Boolean);
  });
  const existingTokens = searchSimilarTokens(migrationKeywords);
  const existingList = existingTokens.length > 0
    ? '\n\nTOKENS THAT ALREADY EXIST (DO NOT REUSE ANY OF THESE NAMES):\n' +
      existingTokens.map(t => `  - "${t.name}" ($${t.ticker})`).join('\n')
    : '';

  // Structured CT narrative — replaces generic getTwitterContext
  const narrative = await analyzeTokenNarrative(migration);

  // Build the narrative block for the prompt
  let narrativeBlock;
  if (narrative) {
    narrativeBlock = `WHY IT'S PUMPING: ${narrative.why_pumping}

WHAT CT IS SAYING:
${narrative.ct_reaction}

MEME ANGLE CT IS WORKING WITH: ${narrative.meme_angle}

VIBE: ${narrative.vibe}`;
  } else {
    narrativeBlock = `CT IS SILENT ON THIS TOKEN.
Study the name "${migration.name}" and its theme (${migration.theme || 'unknown'}). Make your best guess at the underlying energy or story. What event, meme, or feeling could explain why degens are aping in? Build on THAT energy.`;
  }

  const migrationLine = `"${migration.name}" ($${migration.ticker}) | vol $${migration.volume_usd_h1 || 0}/h | +${migration.price_change_h1 || 0}% | theme: ${migration.theme || 'unknown'}`;

  const prompt = `This token is pumping HARD on pump.fun right now:

${migrationLine}

${narrativeBlock}${existingList}

STEP 1 — BEFORE YOU NAME ANYTHING: In one sentence, state the real energy or story behind this pump. Not the token name — the underlying reason a degen would ape in.

STEP 2 — CREATE A NEW TOKEN that rides that same energy from a completely different angle. Do NOT riff on the token's name. Find what made it pump, then express that with something totally fresh.

CONCRETE EXAMPLE of how to think:
- Token pumping: "Hello World" — WHY: pump.fun's site showed a "Hello World" error when it went down. Degens made a token about the crash.
- Good new token: "Goodbye World" ($CRASH) — rides the site-going-down energy from the opposite angle. NOT "Hello Again" or "World Error" — different angle, same story.
- Bad new token: "Dev Error" ($RUGGED) — $RUGGED is a generic crypto term with no real connection to the story. The ticker must be as specific as the name.

RULES:
- The TICKER must be as specific and funny as the NAME — no generic crypto words ($RUGGED, $APE, $MOON, $GG) unless they are genuinely the best fit for THIS specific story.
- Ticker must be a real word or recognizable name that makes someone smirk independently of reading the full name.
- Follow proven pump.fun patterns: Iconic Word | Absurd Mashup | Shitpost Phrase | Meme Creature.
- Description: 1 sentence, shitpost energy.
- Narrative: 1 sentence, why a degen buys this.

QUALITY CHECK before returning:
1. Could someone who has never heard of crypto laugh at this? If no, try again.
2. Is the ticker a generic crypto word with no specific tie to THIS story? If yes, find something more specific.
3. Does the ticker add a new angle or punchline beyond the name? If it just repeats the name's main word, that's lazy.

Return JSON only:
{
  "name": string,
  "ticker": string,
  "description": string,
  "narrative": string,
  "image_prompt": string,
  "flux": "2"
}`;

  const concept = await callClaude(prompt);
  return { ...concept, flux: '2', source_migrations: validMovers.map((t) => t.ticker).join(', ') };
}
```

- [ ] **Step 3: Verify the module still imports cleanly**

```bash
node --input-type=module <<'EOF'
import generateConcepts from './src/creative/conceptGenerator.js';
console.log(typeof generateConcepts);
EOF
```

Expected: `function`

- [ ] **Step 4: Commit**

```bash
git add src/creative/conceptGenerator.js
git commit -m "feat: rewrite generateVariants() with structured Grok narrative + stronger Flux 2 prompt"
```

---

## Task 3: Add keyword-based dedup + fix Flux 3 slice

**Files:**
- Modify: `src/database/db.js`
- Modify: `src/creative/conceptGenerator.js`

The current `hasRecentConceptExtended(trend.trend)` does an exact string match on `source_signal`. Since Grok generates `trend.trend` dynamically each run ("We're So Back", "CT Rotation Season"), two runs describing the same trend will have different strings and never dedup. Fix: check if any keyword from the trend already appears in a recent `source_signal`.

Also increase `ctTrends.slice(0, 2)` to `slice(0, 3)` for more Flux 3 diversity.

- [ ] **Step 1: Add `hasRecentConceptByKeywords` to db.js**

In `src/database/db.js`, after the `hasRecentConceptExtended` function (around line 263), add:

```js
export function hasRecentConceptByKeywords(keywords, hours = 6) {
  if (!keywords || keywords.length === 0) return false;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const conditions = keywords.map(() => 'source_signal LIKE ?').join(' OR ');
  const params = [...keywords.map(k => `%${k.toLowerCase()}%`), since];
  const row = db
    .prepare(`SELECT id FROM concepts WHERE (${conditions}) AND created_at >= ? LIMIT 1`)
    .get(...params);
  return !!row;
}
```

- [ ] **Step 2: Update the import in conceptGenerator.js**

In `src/creative/conceptGenerator.js`, line 1, add `hasRecentConceptByKeywords` to the db import:

```js
import db, { getTopThemes, getTopFormats, searchSimilarTokens, insertConcept, hasRecentConcept, hasRecentConceptExtended, hasRecentConceptByKeywords } from '../database/db.js';
```

- [ ] **Step 3: Replace Flux 3 dedup block in `generateConcepts()`**

Find the Flux 3 section in `generateConcepts()` (around line 458):

```js
// Flux 3: up to 2 concepts from CT trends (Grok-sourced)
for (const trend of ctTrends.slice(0, 2)) {
  if (hasRecentConceptExtended(trend.trend)) {
    console.log(`[conceptGenerator] Flux 3: skipping "${trend.trend}" — already generated recently`);
    continue;
  }
  tasks.push(() => generateFromCTTrend(trend));
}
```

Replace with:

```js
// Flux 3: up to 3 concepts from CT trends (Grok-sourced)
for (const trend of ctTrends.slice(0, 3)) {
  const trendKeywords = trend.keywords?.length ? trend.keywords : [trend.trend];
  if (hasRecentConceptByKeywords(trendKeywords)) {
    console.log(`[conceptGenerator] Flux 3: skipping "${trend.trend}" — keywords already covered recently`);
    continue;
  }
  tasks.push(() => generateFromCTTrend(trend));
}
```

- [ ] **Step 4: Verify db.js still loads**

```bash
node --input-type=module <<'EOF'
import { hasRecentConceptByKeywords } from './src/database/db.js';
console.log(typeof hasRecentConceptByKeywords);
EOF
```

Expected: `function`

- [ ] **Step 5: Commit**

```bash
git add src/database/db.js src/creative/conceptGenerator.js
git commit -m "fix: keyword-based Flux 3 dedup + increase CT trend slice to 3"
```

---

## Task 4: Clean up dead imports and scout inconsistencies

**Files:**
- Modify: `src/index.js`
- Modify: `src/scout/perplexityScout.js`

Two imports in `index.js` are never used in any active cycle: `getRecentTokens` (webSocketScout) and `getLatestSignals` (perplexityScout). `getRecentMigrations` is used inside `runPerplexityCycle()` (line 130) which is disabled but not deleted — keep it to avoid a ReferenceError if Flux 1 is re-enabled.

Also: `perplexityScout.js` standalone test logs `signal_strength >= 5` but the actual filter is `>= 6` — misleading when running the standalone script.

- [ ] **Step 1: Remove dead imports from index.js**

In `src/index.js`, lines 5–6, change:

```js
import { startWebSocket, getRecentTokens, getRecentMigrations } from './scout/webSocketScout.js';
import { runPerplexityScan, getLatestSignals } from './scout/perplexityScout.js';
```

to:

```js
import { startWebSocket, getRecentMigrations } from './scout/webSocketScout.js';
import { runPerplexityScan } from './scout/perplexityScout.js';
```

Note: `getLatestSignals` is not called anywhere in `index.js`. `getRecentMigrations` is kept because it is referenced inside `runPerplexityCycle()` at line 130 (disabled but not deleted).

- [ ] **Step 2: Fix standalone test log in perplexityScout.js**

In `src/scout/perplexityScout.js`, in the standalone test block at the bottom (around line 152), change:

```js
console.log(`[Perplexity] No signals found (signal_strength >= 5) or scan skipped.`);
```
and
```js
console.log(`[Perplexity] ${signals.length} signal(s) with signal_strength >= 5:\n`);
```

to:

```js
console.log(`[Perplexity] No signals found (signal_strength >= 6) or scan skipped.`);
```
and:
```js
console.log(`[Perplexity] ${signals.length} signal(s) with signal_strength >= 6:\n`);
```

- [ ] **Step 3: Verify index.js still starts without import errors**

```bash
node --input-type=module --eval "import('./src/index.js').catch(e => { console.error(e.message); process.exit(1); })" 2>&1 | head -5
```

Expected: bot start logs (no import errors). Kill with Ctrl+C after a few seconds, or just check first line says `[env]` or `[main]`.

- [ ] **Step 4: Commit**

```bash
git add src/index.js src/scout/perplexityScout.js
git commit -m "chore: remove dead imports, fix perplexity standalone log threshold"
```

---

## Smoke Test

After all tasks are complete, do a manual integration check:

- [ ] Run `npm start` — confirm no import errors on startup
- [ ] Wait for the first DexScreener refresh log: `[DexScreener] Refreshing N tokens...` — confirms DexScreener pipeline is alive
- [ ] Wait for Flux 2 cycle log: `[flux2] N top mover(s) found` — then `[GrokScout] Narrative for "..."` — confirms `analyzeTokenNarrative` is being called
- [ ] Check the Telegram message for the next Flux 2 concept — verify the ticker feels specific to the story, not generic crypto slang
- [ ] Wait for Flux 3 cycle log: `[GrokScout] CT scan: N trend(s)` — then check concepts are not skipped spuriously

---

## Notes

- `getRecentMigrations` is kept in the `index.js` import — it is used inside `runPerplexityCycle()` (Flux 1, currently disabled). `getLatestSignals` is not used anywhere in the active codebase but remains exported from its source file.
- `analyzeTokenNarrative` adds one Grok API call per Flux 2 concept (currently max 3 per cycle). Cost is marginal.
- The `analyzeTokenNarrative` function returns `null` when CT is silent — `generateVariants` handles this gracefully with a fallback instruction block.
- Flux 3 slice increase from 2 → 3 means up to 3 Claude calls per Flux 3 cycle instead of 2. All 3 run with concurrency 3, so no latency increase.
