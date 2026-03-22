# Flux 1 Refonte — Design Spec

**Date:** 2026-03-22
**Status:** Approved
**Goal:** Fix Flux 1 concept quality and geopolitical bias before re-enabling the pipeline.

---

## Problem Statement

Flux 1 (World → Crypto) is currently disabled. Two linked problems prevent re-enabling it:

1. **Output quality:** Sonnet generates tokens that read like news headlines rather than meme tokens. It converts the factual topic literally instead of finding the absurdist meme angle CT would actually trade on.

2. **Geopolitical bias:** 80%+ of generated concepts in the last active cycles were about Iran/Israel/geopolitics. The root cause is structural:
   - The `signal_strength >= 6` filter favors topics with "widespread" coverage — wars always have high scores and wide spread.
   - Sonar (Perplexity) is trained on text-heavy news sources and structurally underrepresents viral internet moments, TikTok trends, and Reddit absurdity.
   - `getTwitterContext()` returns freeform text — Sonnet gets unstructured CT context and falls back to generic patterns when it's vague.

---

## Approach: A + C

- **Approach A:** Add `analyzeNewsMemePotential(signal)` in grokScout.js — structured Grok enrichment per Sonar signal, replacing the generic `getTwitterContext` call. Rewrite `generateFromSignal()` to use the structured output.
- **Approach C:** Retouche légère du prompt Sonar (SYSTEM_MESSAGE + USER_MESSAGE) to weight viral internet moments more explicitly + lower signal threshold from `>= 6` to `>= 5`.

---

## Section 1 — Sourcing (perplexityScout.js)

### Filter change

Lower `signal_strength >= 6` to `>= 5`. This widens the window to include niche viral moments that have strong meme potential but not necessarily broad press coverage. The `spread` filter (`'widespread' || 'few_sources'`) remains intact — `single_source` signals are still excluded.

### Prompt changes

**SYSTEM_MESSAGE:** Add an explicit rule weighting viral internet moments equally to mainstream news:
> "A viral Reddit thread or absurd TikTok moment with strong engagement counts AS MUCH as a Reuters wire — do not under-score it because it comes from a single platform. Short-lived absurd moments are VALUABLE. Report them."

**USER_MESSAGE:** Add a concrete example for the `internet` category to calibrate Sonar's scoring:
> "For the 'internet' category: viral Reddit posts, TikTok trends, absurd celebrity moments, animal videos with millions of views, meme formats gaining traction — these qualify even with 'few_sources' spread if they have high social velocity."

---

## Section 2 — Grok Enrichment (grokScout.js)

### New function: `analyzeNewsMemePotential(signal)`

Exported async function, symmetric to `analyzeTokenNarrative(token)` added for Flux 2.

**Input:** A Sonar signal object `{ topic, summary, what_happened, keywords }`

**Grok query:** "This topic is in the news right now. Is CT talking about it? What angle are they taking? Is there already a meme emerging?"

**Returns:**
```js
{
  meme_angle: string,              // the specific angle CT is exploiting — NOT the headline
  ct_reaction: string,             // what CT is actually posting, in their slang
  key_character_or_moment: string, // the person/moment/thing degens would latch onto
  visual_potential: string,        // what would work as a pump.fun thumbnail
  trending_words: string[]         // exact words/phrases CT uses for this topic
}
```

Returns `null` if CT is completely silent on the topic.

**Model:** `grok-4-1-fast-non-reasoning` — same as all existing functions in grokScout.js.

**Error handling:** Same pattern as `analyzeTokenNarrative`:
- Guard on `XAI_API_KEY` → return `null` with `console.warn`
- `res.text()` on non-OK HTTP → `console.error` with body
- Inline `try/catch` around `JSON.parse` → logs raw content on failure, returns `null`
- Outer `catch` → `console.error`, returns `null`

### Null handling

When `analyzeNewsMemePotential` returns `null`, `generateFromSignal` still processes the signal but uses a fallback block: Claude is instructed to reason from `what_happened` (Sonar's most shareable fact) alone, without CT context.

---

## Section 3 — Concept Generation (conceptGenerator.js)

### Import changes

- Remove `getTwitterContext` from the grokScout import in `conceptGenerator.js` **only if** `generateFromSignal` is the last caller. Verify at implementation time — `generateFromSignal` currently calls `getTwitterContext`; after this change it will call `analyzeNewsMemePotential` instead.
- Add `analyzeNewsMemePotential` to the grokScout import.

### Rewrite `generateFromSignal(signal)`

Replace `getTwitterContext(grokQuery)` with `analyzeNewsMemePotential(signal)`.

Build a `memeContextBlock` with two branches:

**When enrichment is available:**
```
THE REAL MEME ANGLE (what CT actually cares about, not the headline):
${memeContext.meme_angle}

WHAT CT IS SAYING RIGHT NOW:
${memeContext.ct_reaction}

THE CHARACTER/MOMENT degens will latch onto:
${memeContext.key_character_or_moment}

VISUAL POTENTIAL: ${memeContext.visual_potential}

TRENDING WORDS (use these in the name/ticker if possible):
${memeContext.trending_words.join(', ')}
```

**When CT is silent (`null`):**
```
CT IS SILENT ON THIS TOPIC.
Reason from the most absurd or shareable fact: "${signal.what_happened || signal.summary}"
What single word or moment from this story would a degen immediately understand?
```

### New prompt structure for Claude

The Claude prompt is restructured with two explicit steps (same pattern as Flux 2's `generateVariants`):

```
NEWS SIGNAL: ${signal.topic}
WHAT HAPPENED: ${signal.summary}
MOST ABSURD/SHAREABLE FACT: ${signal.what_happened}

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
```

---

## Section 4 — Re-enabling Flux 1 (index.js)

### `runPerplexityCycle()` changes

- Remove `getRecentMigrations(24)` from the cycle — it was passed to `generateConcepts(signals, migrations)` as the second argument but is no longer relevant to the refactored Flux 1 pipeline. Change to `generateConcepts(signals, [])`.
- Remove the `getRecentMigrations` import from `index.js` (it was kept specifically for this cycle; with the cycle removed its purpose disappears too). **Only do this if no other active cycle uses it.**

### Re-enable in `main()`

Uncomment the two Flux 1 blocks currently commented out with `// TEMP: disabled`:

```js
await runPerplexityCycle();
setInterval(() => {
  runPerplexityCycle().catch((err) =>
    console.error(`[perplexity] Unhandled error: ${err.message}`)
  );
}, PERPLEXITY_INTERVAL_MS);
```

Update the startup log line from `'[main] Flux 1: DISABLED (TEMP)'` to `'[main] Flux 1 cycle: every 30 min, immediate start'`.

---

## Data Flow Summary

The Grok enrichment call (`analyzeNewsMemePotential`) and the DB lookup (`searchSimilarTokens`) stay **inside** `generateFromSignal`, consistent with how `analyzeTokenNarrative` and `searchSimilarTokens` are called inside `generateVariants` for Flux 2. `generateConcepts` just passes the signal object.

```
runPerplexityCycle() [every 30 min]
  │
  ├─ runPerplexityScan()          → signals (signal_strength >= 5, spread != single_source)
  │    Sonar: "what's happening in the world right now"
  │
  └─ generateConcepts(signals, [])
       │
       └─ for each signal (up to 3, deduplicated by category):
            │
            └─ generateFromSignal(signal)   [internal: Grok + DB + Claude]
                 │
                 ├─ analyzeNewsMemePotential(signal)   [Grok — inside generateFromSignal]
                 │    → { meme_angle, ct_reaction, key_character_or_moment,
                 │        visual_potential, trending_words } | null
                 │
                 ├─ searchSimilarTokens(signal.keywords) [DB — inside generateFromSignal]
                 │
                 └─ callClaude(prompt)  [structured prompt with meme context]
                      → { name, ticker, description, narrative, image_prompt, flux: "1" }
```

---

## Files Changed

| File | Change |
|---|---|
| `src/scout/perplexityScout.js` | Lower filter threshold `>= 5`, retouche SYSTEM_MESSAGE + USER_MESSAGE, update standalone test log strings (`>= 5`) |
| `src/scout/grokScout.js` | Add `analyzeNewsMemePotential(signal)` export |
| `src/creative/conceptGenerator.js` | Rewrite `generateFromSignal()`, update grokScout import |
| `src/index.js` | Re-enable Flux 1, remove `getRecentMigrations` if unused, update log line |

---

## Out of Scope

- Adding a second independent Grok "internet culture" broad scan (Approach B) — deferred until A+C results are evaluated
- Changes to Flux 2 or Flux 3 pipelines
- Changes to the Telegram bot or DB schema
- Restoring or modifying Flux 1 offsets in `main()`
