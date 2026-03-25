# Design: Fix JSON Parsing in conceptGenerator.js

**Date:** 2026-03-25
**Status:** Approved

## Problem

`callClaude()` crashes with `Unexpected token '*', "**STEP 1 —"... is not valid JSON` when the model outputs its STEP 1 reasoning as Markdown prose before the JSON object.

**Root cause:** Three of the four generator prompts (`generateFromSignal`, `generateVariants`, `generateFromCTTrend`) contain a two-step reasoning instruction:

```
STEP 1 — BEFORE YOU NAME ANYTHING: In one sentence, state the meme angle.
STEP 2 — CREATE THE TOKEN from that meme angle.
...
Return JSON only: { ... }
```

The model sometimes emits `**STEP 1 —` Markdown headers before the JSON. The existing cleanup in `callClaude()` (lines 150–151) only strips code fences (` ```json ``` `), not prose Markdown.

**`generateCrossover` is not affected:** It is the only generator without a STEP 1/STEP 2 structure — its prompt goes directly to `Return JSON only:`. No prompt change is needed there.

**Constraint:** The STEP 1 reasoning instruction is kept — it improves output quality by forcing the model to articulate the meme angle before naming.

---

## Solution: Option C — Prompt fix + defensive parsing + better logs

### 1. Prompt changes (3 locations)

In each of the three affected generator functions, replace the closing `Return JSON only:` block to explicitly embed the STEP 1 reasoning inside a `"reasoning"` field:

**Before (in `generateFromSignal`, `generateVariants`, `generateFromCTTrend`):**
```
Return JSON only:
{
  "name": string,
  "ticker": string,
  ...
  "flux": "N"
}
```

**After:**
```
Return JSON only — put your STEP 1 reasoning in the "reasoning" field:
{
  "reasoning": string (your meme angle from STEP 1, one sentence),
  "name": string,
  "ticker": string,
  ...
  "flux": "N"
}
```

Affected functions and approximate locations (note: line numbers shift after the `callClaude()` patch in step 2):
- `generateFromSignal` — end of the `prompt` template literal (around line 229)
- `generateVariants` — end of the `prompt` template literal (around line 316)
- `generateFromCTTrend` — end of the `prompt` template literal (the `Return JSON only:` block at ~line 439, closing `}` at ~line 447)

**`reasoning` field is safe downstream:**
- `insertConcept` in `db.js` uses explicit positional SQL args — it reads only `concept.signal_id`, `concept.name`, `concept.ticker`, etc. (verified at db.js:204–219). A `reasoning` key on the concept object is silently ignored and never stored.
- The Telegram send path spreads the concept object into a message template that references only named fields — `reasoning` is never rendered.

### 2. Defensive parsing in `callClaude()` (lines 150–151)

**Before:**
```js
const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
const concept = JSON.parse(clean);
```

**After:**
```js
// Strip markdown code fences
const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

// Extract JSON object — fallback if model still outputs prose around it
const match = stripped.match(/\{[\s\S]*\}/);
if (!match) throw new Error(`[callClaude] No JSON object found in response:\n${text.slice(0, 300)}`);

// Parse — log raw response on failure
let concept;
try {
  concept = JSON.parse(match[0]);
} catch (err) {
  throw new Error(`[callClaude] JSON.parse failed: ${err.message}\nRaw response:\n${text.slice(0, 500)}`);
}
```

**Regex note:** `/\{[\s\S]*\}/` is greedy — it matches from the first `{` to the *last* `}` in the string. This is correct when the model returns a single JSON object (which all prompts explicitly request). If the model were to return two JSON objects or stray braces in its reasoning, the regex could produce a malformed string. In practice this is extremely unlikely given the explicit `Return JSON only` instruction, but the error path logs the raw response so any such failure is immediately diagnosable.

**Line number note:** This patch replaces 2 lines with ~10 lines. All line numbers below the insertion point in `callClaude()` shift accordingly. Any subsequent spec referencing `conceptGenerator.js` line numbers should re-read the file after this patch lands.

---

## What does NOT change

- The STEP 1 / STEP 2 structure in all three prompts — preserved as-is
- `generateCrossover` — no changes (no STEP 1/STEP 2 structure, not affected)
- DB schema — `reasoning` field is never inserted (verified)
- Telegram output — `reasoning` field is never sent
- Retry logic, concurrency, or any other `callClaude()` behavior
