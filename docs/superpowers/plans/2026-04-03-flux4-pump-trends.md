# Flux 4 — Pump.fun Trends + Flux 1/2 Enrichments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Flux 4 (a new pipeline that reads on-chain pump_trends and generates token concepts) plus enrich Flux 1 and Flux 2 prompts with on-chain trend context.

**Architecture:** Four existing files are modified — no new files created. `db.js` gains 3 read-only functions on the shared `pump_trends` table. `grokScout.js` gains `analyzePumpTrend` using the `/v1/responses` + `x_search` endpoint. `conceptGenerator.js` gains `generateFromPumpTrend` and enrichment hooks in `generateFromSignal` / `generateVariants` / `generateConcepts`. `index.js` gains `runFlux4Cycle` wired at 45-min intervals.

**Tech Stack:** Node.js ESM, `@libsql/client` (Turso), xAI Grok API (`/v1/responses`), Anthropic Claude API (`claude-sonnet-4-6`), raw `fetch`.

---

## File Map

| File | What changes |
|---|---|
| `src/database/db.js` | Add `getActiveTrends`, `getTrendForKeyword`, `getTrendsForToken` |
| `src/scout/grokScout.js` | Add `analyzePumpTrend(trend)` |
| `src/creative/conceptGenerator.js` | Add `generateFromPumpTrend`; enrich `generateFromSignal` (Flux 1 TREND ALERT); enrich `generateVariants` (Flux 2 wave); add 4th param + Flux 4 loop in `generateConcepts` |
| `src/index.js` | Add `runFlux4Cycle`, import `getActiveTrends`, wire into `main()` |

---

## Task 1: db.js — 3 read functions for pump_trends

**Files:** Modify `src/database/db.js`

The `pump_trends` table is owned by token-screener and already exists in the shared Turso DB. Do NOT add a `CREATE TABLE` for it. Just add read functions.

Schema reference (do not create — read-only):
```
pump_trends: id, trend_type, keyword, display_name, token_count,
             hot_level_sum, smart_degen_sum, strength_score,
             active INTEGER (1=active, 0=expired), detected_at,
             expires_at, tokens_json, parent_keywords
```

- [ ] **Step 1: Add the 3 functions at the end of `src/database/db.js`, before the `export default db` line**

```js
export async function getActiveTrends(limit = 3) {
  const { rows } = await db.execute({
    sql: `SELECT keyword, display_name, trend_type, strength_score,
                 token_count, tokens_json, detected_at, expires_at
          FROM pump_trends
          WHERE active = 1
          ORDER BY strength_score DESC
          LIMIT ?`,
    args: [limit],
  });
  return rows;
}

export async function getTrendForKeyword(keyword) {
  const { rows } = await db.execute({
    sql: `SELECT keyword, display_name, trend_type, strength_score,
                 token_count, tokens_json
          FROM pump_trends
          WHERE active = 1 AND LOWER(keyword) = LOWER(?)
          LIMIT 1`,
    args: [keyword],
  });
  return rows[0] ?? null;
}

export async function getTrendsForToken(mint) {
  const { rows } = await db.execute({
    sql: `SELECT keyword, display_name, trend_type, strength_score, token_count, tokens_json
          FROM pump_trends
          WHERE active = 1 AND tokens_json LIKE ?
          ORDER BY strength_score DESC
          LIMIT 1`,
    args: [`%${mint}%`],
  });
  return rows[0] ?? null;
}
```

Place these three functions between `getApprovedConcepts` and `export default db`.

- [ ] **Step 2: Smoke test — verify `getActiveTrends` reaches Turso and returns rows (requires .env)**

```bash
node --env-file=.env -e "
import('./src/database/db.js').then(async m => {
  const rows = await m.getActiveTrends(3);
  console.log('getActiveTrends:', JSON.stringify(rows, null, 2));
  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
"
```

Expected: array of 0–3 rows (may be empty if pump_trends has no active rows right now — that's fine). No crash = pass.

- [ ] **Step 3: Commit**

```bash
git add src/database/db.js
git commit -m "feat(db): add getActiveTrends, getTrendForKeyword, getTrendsForToken read functions"
```

---

## Task 2: grokScout.js — `analyzePumpTrend(trend)`

**Files:** Modify `src/scout/grokScout.js`

This function uses `GROK_RESPONSES_URL` (`/v1/responses`) with the `x_search` tool — identical endpoint to `analyzeNewsMemePotential`. Do NOT use `GROK_API_URL` (`/v1/chat/completions`) — that endpoint does not perform real X searches.

The function accepts a trend row from `pump_trends` and returns the same shape as `analyzeNewsMemePotential`:
```
{ meme_angle, ct_reaction, key_character_or_moment, visual_potential, trending_words[] }
```
or `null` on any failure / CT silent.

- [ ] **Step 1: Add `analyzePumpTrend` to `src/scout/grokScout.js`, after `analyzeNewsMemePotential` and before the standalone test block at the bottom**

```js
export async function analyzePumpTrend(trend) {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    console.warn('[GrokScout] XAI_API_KEY not set — skipping pump trend analysis.');
    return null;
  }

  const today = new Date().toISOString().split('T')[0];
  const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().split('T')[0];

  let sampleTokens = [];
  try {
    const parsed = JSON.parse(trend.tokens_json || '[]');
    sampleTokens = Array.isArray(parsed) ? parsed.slice(0, 3) : [];
  } catch { /* ignore */ }

  const samplesText = sampleTokens.length > 0
    ? sampleTokens.map(t => `"${t.name || t}" ($${t.ticker || '?'})`).join(', ')
    : 'none';

  try {
    const res = await fetch(GROK_RESPONSES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'grok-4-1-fast-non-reasoning',
        include: ['no_inline_citations'],
        tools: [{ type: 'x_search', from_date: twoDaysAgo, to_date: today }],
        input: [
          {
            role: 'system',
            content: 'You are a Crypto Twitter analyst. Search X/Twitter to find out how the crypto community is reacting to on-chain pump.fun trends. Report raw CT energy, slang, memes, and the specific angle degens are taking. Always respond in English with valid JSON only, no markdown.',
          },
          {
            role: 'user',
            content: `Today is ${today}. This keyword is trending on pump.fun right now: "${trend.keyword}"
Display name: ${trend.display_name || trend.keyword}
Trend type: ${trend.trend_type}
${trend.token_count} tokens have been created around this keyword on pump.fun.
Sample tokens in this wave: ${samplesText}

Search X/Twitter and CT. Is the crypto community talking about this keyword? What angle are they taking? What's the meme?

Return JSON:
{
  "meme_angle": string (the specific angle CT is exploiting — the joke/meme/absurd take, not the keyword itself),
  "ct_reaction": string (2-3 sentences — what people are actually posting, use their exact slang),
  "key_character_or_moment": string (the EXACT proper noun or moment CT is latching onto — never vague),
  "visual_potential": string (1 sentence — what would work as a pump.fun thumbnail),
  "trending_words": string[] (3-5 exact words/phrases CT is using)
}

If CT is completely silent on this keyword, return: {"ct_silent": true}`,
          },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[GrokScout] analyzePumpTrend error ${res.status}: ${text}`);
      return null;
    }

    const data = await res.json();
    const msgOutput = data.output?.find(o => o.type === 'message');
    const raw = msgOutput?.content?.[0]?.text ?? '';
    const content = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

    let result;
    try {
      result = JSON.parse(content);
    } catch {
      console.error('[GrokScout] analyzePumpTrend JSON parse failed. Raw:', content.slice(0, 300));
      return null;
    }

    if (result.ct_silent) {
      console.log(`[GrokScout] CT silent on pump trend "${trend.keyword}"`);
      return null;
    }

    console.log(`[GrokScout] Pump trend CT angle for "${trend.keyword}": ${result.meme_angle?.slice(0, 80)}...`);
    return result;

  } catch (err) {
    console.error('[GrokScout] analyzePumpTrend failed:', err.message);
    return null;
  }
}
```

- [ ] **Step 2: Smoke test with a synthetic trend (requires XAI_API_KEY in .env)**

```bash
node --env-file=.env -e "
import('./src/scout/grokScout.js').then(async m => {
  const fakeTrend = { keyword: 'PEPE', display_name: 'Pepe wave', trend_type: 'keyword', token_count: 12, strength_score: 75, tokens_json: '[]' };
  const result = await m.analyzePumpTrend(fakeTrend);
  console.log('analyzePumpTrend result:', JSON.stringify(result, null, 2));
  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
"
```

Expected: either a valid `{ meme_angle, ct_reaction, ... }` object or `null` (if CT silent or API error). No crash = pass.

- [ ] **Step 3: Commit**

```bash
git add src/scout/grokScout.js
git commit -m "feat(grokScout): add analyzePumpTrend using /v1/responses + x_search"
```

---

## Task 3: conceptGenerator.js — `generateFromPumpTrend(trend)`

**Files:** Modify `src/creative/conceptGenerator.js`

- [ ] **Step 1: Add imports — extend the existing import lines at the top of the file**

Current line 1:
```js
import { getTopThemes, getTopFormats, searchSimilarTokens, insertConcept, hasRecentConcept, hasRecentConceptExtended, hasRecentConceptByKeywords, getTopMovers } from '../database/db.js';
```
Replace with:
```js
import { getTopThemes, getTopFormats, searchSimilarTokens, insertConcept, hasRecentConcept, hasRecentConceptExtended, hasRecentConceptByKeywords, getTopMovers, getTrendForKeyword, getTrendsForToken } from '../database/db.js';
```

Current line 2:
```js
import { analyzeTokenNarrative, analyzeNewsMemePotential } from '../scout/grokScout.js';
```
Replace with:
```js
import { analyzeTokenNarrative, analyzeNewsMemePotential, analyzePumpTrend } from '../scout/grokScout.js';
```

- [ ] **Step 2: Add `generateFromPumpTrend` function — insert after `generateFromCTTrend` (around line 500) and before the `// MAIN EXPORT` comment**

```js
// ---------------------------------------------------------------------------
// FLUX 4 — Pump.fun Trends
// ---------------------------------------------------------------------------

async function generateFromPumpTrend(trend) {
  if (!trend) return null;

  const memeContext = await analyzePumpTrend(trend);
  const similar = await searchSimilarTokens([trend.keyword]);

  let sampleTokens = [];
  try {
    const parsed = JSON.parse(trend.tokens_json || '[]');
    sampleTokens = Array.isArray(parsed) ? parsed.slice(0, 3) : [];
  } catch { /* ignore */ }

  const samplesBlock = sampleTokens.length > 0
    ? sampleTokens.map(t => `  - "${t.name || t}" ($${t.ticker || '?'})`).join('\n')
    : '  (none)';

  const blacklistLines = [
    ...sampleTokens.map(t => `  - "${t.name || t}" ($${t.ticker || '?'})`),
    ...similar.map(t => `  - "${t.name}" ($${t.ticker})`),
  ];
  const blacklistBlock = blacklistLines.length > 0
    ? 'TOKENS THAT ALREADY EXIST (DO NOT REUSE ANY OF THESE NAMES):\n' + blacklistLines.join('\n')
    : '';

  let memeContextBlock;
  if (memeContext) {
    memeContextBlock = `THE REAL MEME ANGLE (what CT actually cares about):
${memeContext.meme_angle}

WHAT CT IS SAYING RIGHT NOW:
${memeContext.ct_reaction}

THE CHARACTER/MOMENT degens will latch onto:
${memeContext.key_character_or_moment}

VISUAL POTENTIAL: ${memeContext.visual_potential}

TRENDING WORDS (use these in the name/ticker if possible):
${(memeContext.trending_words || []).join(', ')}`;
  } else {
    memeContextBlock = `CT IS SILENT ON THIS KEYWORD.
Reason from the on-chain wave itself: ${trend.token_count} tokens exist around "${trend.keyword}".
What energy or joke drives degens to create this many tokens around this keyword?`;
  }

  const prompt = `ON-CHAIN TREND: ${trend.display_name || trend.keyword}
KEYWORD: ${trend.keyword}
TREND TYPE: ${trend.trend_type}
TOKENS ON-CHAIN: ${trend.token_count} tokens created around this keyword
STRENGTH SCORE: ${trend.strength_score}
SAMPLE TOKENS IN THIS WAVE:
${samplesBlock}

${memeContextBlock}

${blacklistBlock}

STEP 1 — BEFORE YOU NAME ANYTHING: In one sentence, what is the on-chain energy driving this wave?
Not the keyword itself — why are degens minting ${trend.token_count} tokens around "${trend.keyword}" right now?

STEP 2 — CREATE A TOKEN that rides or subverts that wave. Do NOT just repeat the keyword.
Find the specific angle — the irony, the dark humor, the unexpected take.

Return JSON only — put your STEP 1 reasoning in the "reasoning" field:
{
  "reasoning": string (your energy read from STEP 1, one sentence),
  "name": string (max 32 chars),
  "ticker": string,
  "description": string (1 sentence, shitpost energy),
  "narrative": string (1 sentence, why degens buy this),
  "image_prompt": string (visual for pump.fun thumbnail),
  "flux": "4"
}`;

  const concept = await callClaude(prompt);
  return concept ? { ...concept, flux: '4', source_signal: trend.keyword } : null;
}
```

- [ ] **Step 3: Add `generateFromPumpTrend` to the named exports at the bottom of the file**

Current last line before `export default`:
```js
export { generateFromSignal, generateVariants, generateCrossover, generateFromCTTrend };
```
Replace with:
```js
export { generateFromSignal, generateVariants, generateCrossover, generateFromCTTrend, generateFromPumpTrend };
```

- [ ] **Step 4: Smoke test `generateFromPumpTrend` with a synthetic trend**

```bash
node --env-file=.env -e "
import('./src/creative/conceptGenerator.js').then(async m => {
  const fakeTrend = { keyword: 'DOGE', display_name: 'Doge wave', trend_type: 'keyword', token_count: 8, strength_score: 60, tokens_json: '[]', mint: null };
  const result = await m.generateFromPumpTrend(fakeTrend);
  console.log('generateFromPumpTrend result:', JSON.stringify(result, null, 2));
  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
"
```

Expected: a concept object with `flux: '4'`, `source_signal: 'DOGE'`, `name`, `ticker` fields present. No crash = pass.

- [ ] **Step 5: Commit**

```bash
git add src/creative/conceptGenerator.js
git commit -m "feat(flux4): add generateFromPumpTrend generator"
```

---

## Task 4: conceptGenerator.js — Flux 1 TREND ALERT enrichment

**Files:** Modify `src/creative/conceptGenerator.js`

This modifies `generateFromSignal` (Flux 1) only. Two changes: (1) add keyword→trend first-match lookup, (2) update the CT-silent fallback to reference the TREND ALERT when present.

- [ ] **Step 1: Add the first-match trend lookup in `generateFromSignal` — insert after the `analyzeNewsMemePotential` call (line ~194) and before the `memeContextBlock` construction**

Find this block (around line 194–202):
```js
  const memeContext = await analyzeNewsMemePotential(signal);

  const category = signal.category
```

Insert between `analyzeNewsMemePotential` call and `const category`:
```js
  const memeContext = await analyzeNewsMemePotential(signal);

  // Flux 1 enrichment: first-match TREND ALERT from on-chain pump_trends
  let trendAlertBlock = '';
  for (const kw of (signal.keywords || [])) {
    const onchainTrend = await getTrendForKeyword(kw);
    if (onchainTrend) {
      trendAlertBlock = `\nTREND ALERT — THIS THEME IS ALREADY HOT ON-CHAIN:\n` +
        `${onchainTrend.token_count} tokens minted around "${onchainTrend.keyword}" | strength: ${onchainTrend.strength_score}\n` +
        `→ If your token contains this exact keyword, degens searching pump.fun will find it.\n`;
      break;
    }
  }

  const category = signal.category
```

- [ ] **Step 2: Update the CT-silent fallback to reference the TREND ALERT when present**

Find the `else` branch in `memeContextBlock` construction (around line 218–221):
```js
  } else {
    memeContextBlock = `CT IS SILENT ON THIS TOPIC.
Reason from the most absurd or shareable fact: "${signal.what_happened || signal.absurdity_angle || signal.summary}"
What single word or moment from this story would a degen immediately understand?`;
  }
```

Replace with:
```js
  } else {
    memeContextBlock = trendAlertBlock
      ? `CT IS SILENT ON THIS TOPIC.\nBut this theme is already hot on-chain (see TREND ALERT above).\nReason from the most absurd or shareable fact: "${signal.what_happened || signal.absurdity_angle || signal.summary}"`
      : `CT IS SILENT ON THIS TOPIC.\nReason from the most absurd or shareable fact: "${signal.what_happened || signal.absurdity_angle || signal.summary}"\nWhat single word or moment from this story would a degen immediately understand?`;
  }
```

- [ ] **Step 3: Inject `trendAlertBlock` into the prompt — find the prompt template in `generateFromSignal` and locate the `${entitiesBlock}` line**

Find this sequence in the prompt string (around line 252–254):
```js
${kymBlock}
${entitiesBlock}
TICKER FIRST RULE — choose the ticker in this priority order:
```

Replace with:
```js
${kymBlock}
${entitiesBlock}${trendAlertBlock}
TICKER FIRST RULE — choose the ticker in this priority order:
```

The `trendAlertBlock` already has a leading `\n` when non-empty, so it naturally separates from `entitiesBlock`. When empty string, nothing changes.

- [ ] **Step 4: Smoke test — run a Flux 1 signal through a keyword that may match a trend**

```bash
node --env-file=.env -e "
import('./src/creative/conceptGenerator.js').then(async m => {
  const fakeSignal = {
    topic: 'PEPE becomes official mascot',
    summary: 'A major brand adopts PEPE as official mascot in viral campaign',
    what_happened: 'Brand dropped 1M PEPE tokens in Times Square',
    absurdity_angle: 'Corporate frog energy',
    keywords: ['PEPE', 'mascot', 'frog'],
    signal_strength: 8,
    spread: 'viral',
    category: 'internet',
    reasoning: '{}'
  };
  const result = await m.generateFromSignal(fakeSignal);
  console.log('Flux 1 result:', JSON.stringify(result, null, 2));
  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
"
```

Expected: concept object with `flux: '1'`. Check console for `[GrokScout]` and `[conceptGenerator]` logs showing the enrichment path taken. No crash = pass.

- [ ] **Step 5: Commit**

```bash
git add src/creative/conceptGenerator.js
git commit -m "feat(flux1): inject TREND ALERT from pump_trends into generateFromSignal"
```

---

## Task 5: conceptGenerator.js — Flux 2 wave enrichment

**Files:** Modify `src/creative/conceptGenerator.js`

This modifies `generateVariants` (Flux 2) only. Adds `getTrendsForToken` lookup and conditional `narrativeBlock` logic.

- [ ] **Step 1: Add the wave trend lookup in `generateVariants` — insert after `analyzeTokenNarrative` call (around line 320)**

Find:
```js
  // Structured CT narrative — replaces generic getTwitterContext
  const narrative = await analyzeTokenNarrative(migration);

  // Build the narrative block for the prompt
  let narrativeBlock;
```

Replace with:
```js
  // Structured CT narrative — replaces generic getTwitterContext
  const narrative = await analyzeTokenNarrative(migration);

  // Flux 2 enrichment: on-chain wave context for this token
  const waveTrend = migration.mint ? await getTrendsForToken(migration.mint) : null;

  // Build the narrative block for the prompt
  let narrativeBlock;
```

- [ ] **Step 2: Replace the `narrativeBlock` conditional with the 4-case version**

Find the existing 2-case narrativeBlock construction (lines ~323–336):
```js
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
```

Replace with:
```js
  let narrativeBlock;
  if (narrative && waveTrend) {
    // CT found + wave found: keep CT context, append wave
    narrativeBlock = `WHY IT'S PUMPING: ${narrative.why_pumping}

WHAT CT IS SAYING:
${narrative.ct_reaction}

MEME ANGLE CT IS WORKING WITH: ${narrative.meme_angle}

VIBE: ${narrative.vibe}

WAVE CONTEXT (broader on-chain trend):
${waveTrend.token_count} tokens around "${waveTrend.keyword}" | score: ${waveTrend.strength_score}
This isn't isolated — it's a wave. Your token should fit the wave or counter it from an unexpected angle.`;
  } else if (!narrative && waveTrend) {
    // CT silent + wave found: wave IS the narrative
    let waveSamples = [];
    try {
      const parsed = JSON.parse(waveTrend.tokens_json || '[]');
      waveSamples = Array.isArray(parsed) ? parsed.slice(0, 3) : [];
    } catch { /* ignore */ }
    const waveSamplesText = waveSamples.length > 0
      ? waveSamples.map(t => `"${t.name || t}" ($${t.ticker || '?'})`).join(', ')
      : 'none';
    narrativeBlock = `ON-CHAIN WAVE DETECTED — THIS TOKEN IS PART OF A TREND:
Keyword: ${waveTrend.keyword} | ${waveTrend.token_count} tokens | score: ${waveTrend.strength_score}
Sample tokens in the wave: ${waveSamplesText}
CT is silent on this specific token, but ${waveTrend.token_count} tokens exist around this keyword.
What energy drives degens to mint this many tokens? Build from that wave.`;
  } else if (narrative) {
    // CT found, no wave: original behavior
    narrativeBlock = `WHY IT'S PUMPING: ${narrative.why_pumping}

WHAT CT IS SAYING:
${narrative.ct_reaction}

MEME ANGLE CT IS WORKING WITH: ${narrative.meme_angle}

VIBE: ${narrative.vibe}`;
  } else {
    // CT silent, no wave: original behavior
    narrativeBlock = `CT IS SILENT ON THIS TOKEN.
Study the name "${migration.name}" and its theme (${migration.theme || 'unknown'}). Make your best guess at the underlying energy or story. What event, meme, or feeling could explain why degens are aping in? Build on THAT energy.`;
  }
```

- [ ] **Step 3: Smoke test `generateVariants` with a mover that has a mint**

```bash
node --env-file=.env -e "
import('./src/creative/conceptGenerator.js').then(async m => {
  const fakeMover = {
    name: 'Pepe Classic',
    ticker: 'PEPEC',
    mint: 'somenonexistentmint123',
    theme: 'meme',
    volume_usd_h1: 5000,
    price_change_h1: 45
  };
  const result = await m.generateVariants([fakeMover]);
  console.log('Flux 2 result:', JSON.stringify(result, null, 2));
  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
"
```

Expected: concept object with `flux: '2'`. The wave lookup will return null for a fake mint — verifying the fallback path works. No crash = pass.

- [ ] **Step 4: Commit**

```bash
git add src/creative/conceptGenerator.js
git commit -m "feat(flux2): inject on-chain wave context into generateVariants (conditional narrativeBlock)"
```

---

## Task 6: conceptGenerator.js — `generateConcepts` 4th param + Flux 4 dedup loop

**Files:** Modify `src/creative/conceptGenerator.js`

- [ ] **Step 1: Add 4th param to `generateConcepts` signature**

Find (around line 506):
```js
async function generateConcepts(signals = [], migrations = [], ctTrends = []) {
```
Replace with:
```js
async function generateConcepts(signals = [], migrations = [], ctTrends = [], pumpTrends = []) {
```

- [ ] **Step 2: Add Flux 4 dedup loop — insert after the Flux 3 loop (after the `ctTrends.slice(0, 3)` loop, before `const concepts = await runWithConcurrency`)**

Find (around line 547):
```js
  const concepts = await runWithConcurrency(tasks, CONCURRENCY);
```

Insert before it:
```js
  // Flux 4: up to 3 concepts from pump.fun on-chain trends
  for (const trend of pumpTrends.slice(0, 3)) {
    if (await hasRecentConceptByKeywords([trend.keyword])) {
      console.log(`[flux4] ⏭ Skip "${trend.keyword}" — recent concept found by keyword`);
      continue;
    }
    tasks.push(() => generateFromPumpTrend(trend));
  }

  const concepts = await runWithConcurrency(tasks, CONCURRENCY);
```

- [ ] **Step 3: Verify Flux 3 loop is directly above the new Flux 4 loop**

After your edit, the order in `generateConcepts` should be:
1. Flux 1 loop (`diverseSignals.slice(0, 3)`)
2. Flux 2 loop (`diverseMigrations.slice(0, 3)`)
3. Flux 3 loop (`ctTrends.slice(0, 3)`)
4. **Flux 4 loop** (`pumpTrends.slice(0, 3)`) ← new
5. `runWithConcurrency`

- [ ] **Step 4: Smoke test `generateConcepts` with only pumpTrends populated**

```bash
node --env-file=.env -e "
import('./src/creative/conceptGenerator.js').then(async m => {
  const fakeTrends = [
    { keyword: 'WOJAK', display_name: 'Wojak wave', trend_type: 'keyword', token_count: 5, strength_score: 55, tokens_json: '[]' }
  ];
  const concepts = await m.default([], [], [], fakeTrends);
  console.log('generateConcepts Flux 4 result:', JSON.stringify(concepts, null, 2));
  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
"
```

Expected: array with 0 or 1 concepts. If dedup fires (WOJAK generated recently), array is `[]` and a skip log appears. Otherwise 1 concept with `flux: '4'`. No crash = pass.

- [ ] **Step 5: Commit**

```bash
git add src/creative/conceptGenerator.js
git commit -m "feat(flux4): add pumpTrends param and Flux 4 dedup loop in generateConcepts"
```

---

## Task 7: index.js — `runFlux4Cycle` + wiring

**Files:** Modify `src/index.js`

- [ ] **Step 1: Add `getActiveTrends` to the db import at the top of `src/index.js`**

Find (line 5):
```js
import { initDb, getTopMovers } from './database/db.js';
```
Replace with:
```js
import { initDb, getTopMovers, getActiveTrends } from './database/db.js';
```

- [ ] **Step 2: Add `FLUX4_INTERVAL_MS` constant and `runFlux4Cycle` function — insert after `runFlux3Cycle` (after line ~220) and before the `// Main` comment**

```js
// ---------------------------------------------------------------------------
// FLUX 4 CYCLE — runs every 45 minutes
// ---------------------------------------------------------------------------

const FLUX4_INTERVAL_MS = 45 * 60 * 1000;

async function runFlux4Cycle() {
  const entry = logEntry('flux4');
  console.log(`\n${'─'.repeat(50)}`);
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
    console.log(`[flux4] ${concepts.length} concept(s) generated`);

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

- [ ] **Step 3: Wire `runFlux4Cycle` into `main()` — add after the Flux 3 immediate start and interval**

Find in `main()` (around line 237–241):
```js
  runFlux3Cycle().catch((err) => console.error(`[flux3] Unhandled error: ${err.message}`));

  setInterval(() => runPerplexityCycle().catch(...), PERPLEXITY_INTERVAL_MS);
  setInterval(() => runFlux2Cycle().catch(...), FLUX2_INTERVAL_MS);
  setInterval(() => runFlux3Cycle().catch(...), FLUX3_INTERVAL_MS);

  console.log('[main] Flux 1 cycle: every 30 min, immediate start');
  console.log('[main] Flux 2 cycle: every 60 min, immediate start');
  console.log('[main] Flux 3 cycle: every 45 min, immediate start');
```

Replace with:
```js
  runFlux3Cycle().catch((err) => console.error(`[flux3] Unhandled error: ${err.message}`));
  runFlux4Cycle().catch((err) => console.error(`[flux4] Unhandled error: ${err.message}`));

  setInterval(() => runPerplexityCycle().catch((err) => console.error(`[perplexity] Unhandled error: ${err.message}`)), PERPLEXITY_INTERVAL_MS);
  setInterval(() => runFlux2Cycle().catch((err) => console.error(`[flux2] Unhandled error: ${err.message}`)), FLUX2_INTERVAL_MS);
  setInterval(() => runFlux3Cycle().catch((err) => console.error(`[flux3] Unhandled error: ${err.message}`)), FLUX3_INTERVAL_MS);
  setInterval(() => runFlux4Cycle().catch((err) => console.error(`[flux4] Unhandled error: ${err.message}`)), FLUX4_INTERVAL_MS);

  console.log('[main] Flux 1 cycle: every 30 min, immediate start');
  console.log('[main] Flux 2 cycle: every 60 min, immediate start');
  console.log('[main] Flux 3 cycle: every 45 min, immediate start');
  console.log('[main] Flux 4 cycle: every 45 min, immediate start');
```

- [ ] **Step 4: Full smoke test — start the app and verify Flux 4 fires without crashing**

```bash
node --env-file=.env src/index.js
```

Watch the console for:
- `[flux4] Pump trends scan starting at ...`
- Either `[flux4] No active pump trends — skipping` (if DB empty) or `[flux4] N trend(s) found`
- No `[flux4] Cycle error:` lines
- App stays running (Telegram bot starts, other cycles fire normally)

Stop with Ctrl+C after ~10 seconds once you see the Flux 4 log line. No crash = pass.

- [ ] **Step 5: Commit**

```bash
git add src/index.js
git commit -m "feat(flux4): add runFlux4Cycle and wire into main() — Flux 4 every 45min"
```

---

## Self-Review Checklist

- **Spec coverage:**
  - ✅ Flux 4 pipeline (Task 3 + 6 + 7)
  - ✅ `analyzePumpTrend` using `/v1/responses` + `x_search` (Task 2)
  - ✅ `getActiveTrends`, `getTrendForKeyword`, `getTrendsForToken` (Task 1)
  - ✅ Flux 1 TREND ALERT first-match (Task 4)
  - ✅ CT silent fallback references TREND ALERT when non-empty (Task 4)
  - ✅ Flux 2 conditional wave: CT silent → wave as narrative (Task 5)
  - ✅ Flux 2 conditional wave: CT found → wave as additive WAVE CONTEXT (Task 5)
  - ✅ `generateConcepts` 4th param + `hasRecentConceptByKeywords([trend.keyword])` dedup (Task 6)
  - ✅ `runFlux4Cycle` + 45-min interval (Task 7)
  - ✅ `generateFromPumpTrend` exported (Task 3)

- **Type consistency:**
  - `analyzePumpTrend` imported in Task 3 Step 1, defined in Task 2 ✅
  - `getTrendForKeyword` / `getTrendsForToken` imported in Task 3 Step 1, defined in Task 1 ✅
  - `getActiveTrends` imported in Task 7 Step 1, defined in Task 1 ✅
  - `generateFromPumpTrend` referenced in Task 6 dedup loop, defined in Task 3 ✅
  - `pumpTrends` param added in Task 6 Step 1, used in `runFlux4Cycle` Task 7 ✅

- **No placeholders:** all steps contain complete code ✅
