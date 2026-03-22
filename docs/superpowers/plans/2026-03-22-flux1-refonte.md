# Flux 1 Refonte Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Flux 1 (World → Crypto) concept quality and geopolitical bias, then re-enable the pipeline.

**Architecture:** Four targeted file edits — lower Sonar filter threshold and retouche prompts to surface viral internet signals; add `analyzeNewsMemePotential(signal)` to grokScout for structured CT enrichment per Sonar signal; rewrite `generateFromSignal()` in conceptGenerator to use the structured enrichment and a 2-step Claude prompt; re-enable the Flux 1 cycle in index.js and clean up the `getRecentMigrations` dependency it no longer needs.

**Tech Stack:** Node.js ESM, Perplexity sonar API, xAI Grok (grok-4-1-fast-non-reasoning), Anthropic Claude (claude-sonnet-4-6), SQLite via better-sqlite3.

---

## File Map

| File | Change |
|---|---|
| `src/scout/perplexityScout.js` | Lower filter `>= 6` → `>= 5`; retouche SYSTEM_MESSAGE + USER_MESSAGE; update standalone test log strings |
| `src/scout/grokScout.js` | Add exported `analyzeNewsMemePotential(signal)` |
| `src/creative/conceptGenerator.js` | Rewrite `generateFromSignal()`; update grokScout import |
| `src/index.js` | Re-enable Flux 1 blocks; remove `getRecentMigrations` from cycle + import; update startup log |

---

## Task 1: Lower Sonar threshold and retouche prompts

**Files:**
- Modify: `src/scout/perplexityScout.js:6-30` (SYSTEM_MESSAGE)
- Modify: `src/scout/perplexityScout.js:32-56` (USER_MESSAGE)
- Modify: `src/scout/perplexityScout.js:105` (filter line)
- Modify: `src/scout/perplexityScout.js:151,153` (standalone test log strings)

- [ ] **Step 1: Open the file and identify the exact lines to change**

  Read `src/scout/perplexityScout.js`. Confirm:
  - Line 105 filter: `t.signal_strength >= 6`
  - Line 151 log: `'[Perplexity] No signals found (signal_strength >= 6) or scan skipped.'`
  - Line 153 log: `\`[Perplexity] ${signals.length} signal(s) with signal_strength >= 6:\n\``

- [ ] **Step 2: Lower the filter threshold**

  In line 105, change `>= 6` to `>= 5`:
  ```js
  const signals = topics.filter(t => t.signal_strength >= 5 && (t.spread === 'widespread' || t.spread === 'few_sources') && (t.category !== 'sports' || t.signal_strength >= 9));
  ```

- [ ] **Step 3: Update standalone test log strings**

  Line 151:
  ```js
  console.log('[Perplexity] No signals found (signal_strength >= 5) or scan skipped.');
  ```
  Line 153:
  ```js
  console.log(`[Perplexity] ${signals.length} signal(s) with signal_strength >= 5:\n`);
  ```

- [ ] **Step 4: Retouche SYSTEM_MESSAGE — add viral internet weighting rule**

  In `SYSTEM_MESSAGE`, after the `'SOURCES YOU MONITOR:\\n' + ...` block and before `'PRIORITY ORDER...'`, add this rule as a new paragraph (insert between the sources block and priority order):

  The current SYSTEM_MESSAGE ends the sources block with `'- Crypto media: CoinDesk, The Block, Decrypt — ONLY for major drama (hacks, rug pulls, regulatory bombs), NOT price action\\n\\n'`. Append immediately after that line, before `'PRIORITY ORDER...'`:

  ```
  'VIRAL INTERNET RULE: A viral Reddit thread or absurd TikTok moment with strong engagement counts AS MUCH as a Reuters wire — do not under-score it because it comes from a single platform. Short-lived absurd moments are VALUABLE. Report them.\\n\\n' +
  ```

- [ ] **Step 5: Retouche USER_MESSAGE — add internet category example**

  In `USER_MESSAGE`, find the `'SCORING:\\n'` section (the block starting with `'SCORING:\\n'`). Insert a new paragraph immediately before the `'SCORING:\\n'` line:

  ```
  'For the \'internet\' category: viral Reddit posts, TikTok trends, absurd celebrity moments, animal videos with millions of views, meme formats gaining traction — these qualify even with \'few_sources\' spread if they have high social velocity.\\n\\n' +
  ```

- [ ] **Step 6: Syntax check**

  Run: `node --check src/scout/perplexityScout.js`
  Expected: no output (no errors)

- [ ] **Step 7: Smoke-run the standalone test**

  Run: `node src/scout/perplexityScout.js`
  Expected: `[Perplexity] Running standalone scan...` followed by results logged with `signal_strength >= 5` in the output strings. No crashes.

- [ ] **Step 8: Commit**

  ```bash
  git add src/scout/perplexityScout.js
  git commit -m "feat(flux1): lower Sonar threshold to >= 5 and weight viral internet signals"
  ```

---

## Task 2: Add `analyzeNewsMemePotential(signal)` to grokScout

**Files:**
- Modify: `src/scout/grokScout.js` (add new exported function before the standalone test block)

- [ ] **Step 1: Read the file to understand the structure**

  Read `src/scout/grokScout.js`. The file has three exported functions: `getTwitterContext`, `analyzeTokenNarrative`, `scanCryptoTwitter`. The standalone test block starts at line 210. New function goes between `scanCryptoTwitter` (ends ~line 207) and the standalone test block (line 210).

- [ ] **Step 2: Add `analyzeNewsMemePotential` before the standalone test block**

  Insert the following function between the closing `}` of `scanCryptoTwitter` and the `// Standalone test` comment:

  ```js
  export async function analyzeNewsMemePotential(signal) {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) {
      console.warn('[GrokScout] XAI_API_KEY not set — skipping news meme potential analysis.');
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
              content: 'You are a Crypto Twitter analyst. Search X/Twitter to find out if and how the crypto community is reacting to real-world news topics. Report raw CT energy, slang, memes, and the specific angle degens are taking. Always respond in English with valid JSON only, no markdown.',
            },
            {
              role: 'user',
              content: `Today is ${today}. This topic is in the news right now: "${signal.topic}"

What happened: ${signal.summary}

Search X/Twitter and CT. Is the crypto community talking about this? What angle are they taking? Is there already a meme emerging?

Return JSON:
{
  "meme_angle": string (the specific angle CT is exploiting — NOT the headline, the joke/meme/absurd take),
  "ct_reaction": string (2-3 sentences — what people are actually posting, use their exact slang),
  "key_character_or_moment": string (the person/moment/thing degens would latch onto),
  "visual_potential": string (1 sentence — what would work as a pump.fun thumbnail),
  "trending_words": string[] (3-5 exact words or phrases CT is using for this topic)
}

If CT is completely silent on this topic (not mentioned at all), return: {"ct_silent": true}`,
            },
          ],
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        console.error(`[GrokScout] analyzeNewsMemePotential error ${res.status}: ${text}`);
        return null;
      }

      const data = await res.json();
      const raw = data.choices?.[0]?.message?.content ?? '';
      const content = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      let result;
      try {
        result = JSON.parse(content);
      } catch {
        console.error('[GrokScout] analyzeNewsMemePotential JSON parse failed. Raw:', content.slice(0, 300));
        return null;
      }

      if (result.ct_silent) {
        console.log(`[GrokScout] CT silent on news topic "${signal.topic}"`);
        return null;
      }

      console.log(`[GrokScout] Meme potential for "${signal.topic}": ${result.meme_angle?.slice(0, 80)}...`);
      return result;

    } catch (err) {
      console.error('[GrokScout] analyzeNewsMemePotential failed:', err.message);
      return null;
    }
  }
  ```

- [ ] **Step 3: Syntax check**

  Run: `node --check src/scout/grokScout.js`
  Expected: no output (no errors)

- [ ] **Step 4: Verify export is accessible**

  Run: `node -e "import('./src/scout/grokScout.js').then(m => console.log(Object.keys(m)))"`
  Expected output includes: `analyzeNewsMemePotential`

- [ ] **Step 5: Commit**

  ```bash
  git add src/scout/grokScout.js
  git commit -m "feat(flux1): add analyzeNewsMemePotential to grokScout"
  ```

---

## Task 3: Rewrite `generateFromSignal()` in conceptGenerator

**Files:**
- Modify: `src/creative/conceptGenerator.js:2` (import line)
- Modify: `src/creative/conceptGenerator.js:157-215` (generateFromSignal function)

- [ ] **Step 1: Read the file to confirm current state**

  Read `src/creative/conceptGenerator.js` lines 1-10 and 157-215. Confirm:
  - Line 2 imports `{ getTwitterContext, analyzeTokenNarrative }` from grokScout
  - `getTwitterContext` is called only at line 177 inside `generateFromSignal`
  - `analyzeTokenNarrative` is called at line 241 inside `generateVariants` — do NOT remove it

- [ ] **Step 2: Update the grokScout import on line 2**

  Change line 2 from:
  ```js
  import { getTwitterContext, analyzeTokenNarrative } from '../scout/grokScout.js';
  ```
  To:
  ```js
  import { analyzeTokenNarrative, analyzeNewsMemePotential } from '../scout/grokScout.js';
  ```

- [ ] **Step 3: Rewrite `generateFromSignal(signal)`**

  Replace the entire `generateFromSignal` function (lines 157-215) with:

  ```js
  async function generateFromSignal(signal) {
    const themes = getTopThemes(5);
    const formats = getTopFormats(5);
    const similar = searchSimilarTokens(signal.keywords || []);
    const proven  = similar.filter(t => (t.volume_sol ?? 0) > 500);

    const topThemes  = themes.map((t) => t.theme);
    const topFormats = formats.map((f) => f.format);

    const provenSlice = proven.length > 0 ? proven.slice(0, 3) : similar.slice(0, 3);
    const similarTokensBlock = provenSlice.length > 0
      ? provenSlice
          .map((t) => `  - "${t.name}" ($${t.ticker}) | ${t.volume_sol?.toFixed(0) ?? 0} SOL volume | theme: ${t.theme || 'unknown'}`)
          .join('\n')
      : '  (none found)';
    const blacklistBlock = similar.length > 0
      ? similar.map(t => `  - "${t.name}" ($${t.ticker})`).join('\n')
      : '  (none)';

    const memeContext = await analyzeNewsMemePotential(signal);

    let memeContextBlock;
    if (memeContext) {
      memeContextBlock = `THE REAL MEME ANGLE (what CT actually cares about, not the headline):
  ${memeContext.meme_angle}

  WHAT CT IS SAYING RIGHT NOW:
  ${memeContext.ct_reaction}

  THE CHARACTER/MOMENT degens will latch onto:
  ${memeContext.key_character_or_moment}

  VISUAL POTENTIAL: ${memeContext.visual_potential}

  TRENDING WORDS (use these in the name/ticker if possible):
  ${memeContext.trending_words.join(', ')}`;
    } else {
      memeContextBlock = `CT IS SILENT ON THIS TOPIC.
  Reason from the most absurd or shareable fact: "${signal.what_happened || signal.summary}"
  What single word or moment from this story would a degen immediately understand?`;
    }

    const existingTokensBlock = `TOKENS THAT ALREADY EXIST (DO NOT COPY THESE NAMES — use their style as inspiration only):
  ${similarTokensBlock}

  TOKENS THAT ALREADY EXIST (DO NOT REUSE ANY OF THESE NAMES):
  ${blacklistBlock}

  TOP PERFORMING THEMES RIGHT NOW: ${topThemes.join(', ')}
  TOP PERFORMING FORMATS RIGHT NOW: ${topFormats.join(', ')}`;

    const prompt = `NEWS SIGNAL: ${signal.topic}
  WHAT HAPPENED: ${signal.summary}
  MOST ABSURD/SHAREABLE FACT: ${signal.what_happened || signal.absurdity_angle || 'none'}

  ${memeContextBlock}

  ${existingTokensBlock}

  STEP 1 — BEFORE YOU NAME ANYTHING: In one sentence, state the meme angle.
  Not the news headline — the specific angle that would make a degen laugh or FOMO.

  STEP 2 — CREATE THE TOKEN from that meme angle.

  EXAMPLE of good vs bad:
  - Signal: "Iran launches missile strike on Israel"
  - BAD token: "Iran Strike" ($MISSILE) — this is a news headline, not a meme
  - GOOD token: "Free Fireworks" ($BOOM) — CT's dark humor angle, funny without geopolitics context

  RULES:
  - The TICKER must relate to the meme angle, not the geopolitical event
  - Use TRENDING WORDS from CT if provided — degens search the exact trending word
  - If CT has a specific nickname or joke for this topic, BUILD ON THAT
  - No generic geo-political tickers ($WAR, $NUKE, $IRAN) unless CT is literally using that word as a meme

  Return JSON only:
  {
    "name": string,
    "ticker": string,
    "description": string (1 sentence, shitpost energy),
    "narrative": string (1 sentence, why degens buy this),
    "image_prompt": string (visual for pump.fun thumbnail),
    "flux": "1"
  }`;

    const concept = await callClaude(prompt);
    return {
      ...concept,
      flux: '1',
      source_signal: signal.topic,
      sources: signal.sources ?? null,
      source_date: signal.source_date ?? null,
      ...(proven.length > 0 && { source_similar: proven.slice(0, 3).map(t => t.ticker).join(', ') }),
    };
  }
  ```

- [ ] **Step 4: Syntax check**

  Run: `node --check src/creative/conceptGenerator.js`
  Expected: no output (no errors)

- [ ] **Step 5: Verify imports resolve**

  Run: `node -e "import('./src/creative/conceptGenerator.js').then(() => console.log('OK')).catch(e => console.error(e.message))"`
  Expected: `OK`

- [ ] **Step 6: Commit**

  ```bash
  git add src/creative/conceptGenerator.js
  git commit -m "feat(flux1): rewrite generateFromSignal with structured Grok enrichment and 2-step prompt"
  ```

---

## Task 4: Re-enable Flux 1 in index.js

**Files:**
- Modify: `src/index.js:5` (import line — remove `getRecentMigrations`)
- Modify: `src/index.js:123-148` (`runPerplexityCycle` function body)
- Modify: `src/index.js:238-244` (commented-out Flux 1 blocks in `main()`)
- Modify: `src/index.js:275` (startup log line)

- [ ] **Step 1: Read the file to confirm current state**

  Read `src/index.js`. Confirm:
  - Line 5: `import { startWebSocket, getRecentMigrations } from './scout/webSocketScout.js';`
  - Line 130: `const migrations = getRecentMigrations(24);` inside `runPerplexityCycle`
  - Line 133: `${migrations.length} migration(s)` in the log
  - Line 135: `const concepts = await generateConcepts(signals, migrations);`
  - Lines 239-244: the two commented-out Flux 1 blocks
  - Line 275: `console.log('[main] Flux 1: DISABLED (TEMP)');`
  - Verify `getRecentMigrations` is NOT used outside `runPerplexityCycle` — check `runFlux2Cycle` uses `getTopMovers`, not `getRecentMigrations`. Safe to remove.

- [ ] **Step 2: Remove `getRecentMigrations` from the webSocketScout import**

  Change line 5 from:
  ```js
  import { startWebSocket, getRecentMigrations } from './scout/webSocketScout.js';
  ```
  To:
  ```js
  import { startWebSocket } from './scout/webSocketScout.js';
  ```

- [ ] **Step 3: Update `runPerplexityCycle` — remove migrations, pass `[]`**

  Current body of `runPerplexityCycle` (lines 128-148):
  ```js
  const signals = await runPerplexityScan();
  const migrations = getRecentMigrations(24);

  entry.signalCount = signals.length;
  console.log(`[perplexity] ${signals.length} signal(s), ${migrations.length} migration(s)`);

  const concepts = await generateConcepts(signals, migrations);
  ```

  Replace with:
  ```js
  const signals = await runPerplexityScan();

  entry.signalCount = signals.length;
  console.log(`[perplexity] ${signals.length} signal(s)`);

  const concepts = await generateConcepts(signals, []);
  ```

- [ ] **Step 4: Uncomment the two Flux 1 blocks in `main()`**

  Replace the commented-out block (lines 238-244):
  ```js
  // TEMP: disabled — Flux 1 / Perplexity cycle disabled for testing
  // await runPerplexityCycle();
  // setInterval(() => {
  //   runPerplexityCycle().catch((err) =>
  //     console.error(`[perplexity] Unhandled error: ${err.message}`)
  //   );
  // }, PERPLEXITY_INTERVAL_MS);
  ```

  With:
  ```js
  await runPerplexityCycle();
  setInterval(() => {
    runPerplexityCycle().catch((err) =>
      console.error(`[perplexity] Unhandled error: ${err.message}`)
    );
  }, PERPLEXITY_INTERVAL_MS);
  ```

- [ ] **Step 5: Update the startup log line**

  Change line 275 from:
  ```js
  console.log('[main] Flux 1: DISABLED (TEMP)');
  ```
  To:
  ```js
  console.log('[main] Flux 1 cycle: every 30 min, immediate start');
  ```

- [ ] **Step 6: Syntax check**

  Run: `node --check src/index.js`
  Expected: no output (no errors)

- [ ] **Step 7: Full import resolution check**

  Run: `node -e "import('./src/index.js')" 2>&1 | head -5`
  Expected: first lines are the normal startup logs (env loaded, bot starting, etc.) — no import/parse errors. Use Ctrl+C or the process will run; for a non-interactive check, run:
  ```bash
  node --input-type=module <<'EOF'
  import { createRequire } from 'module';
  // just verify no top-level import errors
  console.log('imports OK');
  EOF
  ```
  Or simply run `node --check src/index.js` (already done in step 6) — that is sufficient for import syntax.

- [ ] **Step 8: Commit**

  ```bash
  git add src/index.js
  git commit -m "feat(flux1): re-enable Flux 1 cycle, remove getRecentMigrations dependency"
  ```

---

## Data Flow After This Change

```
runPerplexityCycle() [every 30 min, immediate start]
  │
  ├─ runPerplexityScan()          → signals (signal_strength >= 5, spread != single_source)
  │    Sonar: "what's happening in the world right now"
  │    Now weighted toward viral internet moments
  │
  └─ generateConcepts(signals, [])
       │
       └─ for each signal (up to 3, deduplicated by category):
            │
            └─ generateFromSignal(signal)   [internal: Grok + DB + Claude]
                 │
                 ├─ analyzeNewsMemePotential(signal)   [Grok]
                 │    → { meme_angle, ct_reaction, key_character_or_moment,
                 │        visual_potential, trending_words } | null
                 │
                 ├─ searchSimilarTokens(signal.keywords) [DB]
                 │
                 └─ callClaude(prompt)  [STEP 1: meme angle | STEP 2: create token]
                      → { name, ticker, description, narrative, image_prompt, flux: "1" }
```
