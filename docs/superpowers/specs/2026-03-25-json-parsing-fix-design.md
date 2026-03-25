# Design: Fix JSON Parsing in conceptGenerator.js

**Date:** 2026-03-25
**Status:** Approved

## Problem

`callClaude()` crashes with `Unexpected token '*', "**STEP 1 —"... is not valid JSON` when the model outputs its STEP 1 reasoning as Markdown prose before the JSON object.

**Root cause:** All three generator prompts (`generateFromSignal`, `generateVariants`, `generateFromCTTrend`) contain a two-step reasoning instruction:

```
STEP 1 — BEFORE YOU NAME ANYTHING: In one sentence, state the meme angle.
STEP 2 — CREATE THE TOKEN from that meme angle.
...
Return JSON only: { ... }
```

The model sometimes emits `**STEP 1 —` Markdown headers before the JSON. The existing cleanup in `callClaude()` (lines 150–151) only strips code fences (` ```json ``` `), not prose Markdown.

**Constraint:** The STEP 1 reasoning instruction is kept — it improves output quality by forcing the model to articulate the meme angle before naming.

---

## Solution: Option C — Prompt fix + defensive parsing + better logs

### 1. Prompt changes (3 locations)

In each generator function, replace the closing `Return JSON only:` block to explicitly embed the STEP 1 reasoning inside a `"reasoning"` field:

**Before (all three prompts):**
```
Return JSON only:
{
  "name": string,
  "ticker": string,
  ...
  "flux": "N"
}
```

**After (all three prompts):**
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

Affected locations:
- `generateFromSignal` — end of prompt (around line 229)
- `generateVariants` — end of prompt (around line 316)
- `generateFromCTTrend` — end of prompt (around line 439)

The `reasoning` field is ignored by all downstream code (DB insert, Telegram send). It never reaches the database or the user.

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

The `{[\s\S]*}` regex matches from the first `{` to the last `}` — correct for a single top-level JSON object. Both error paths include the raw model response for observability.

---

## Trade-offs

| | Prompt fix alone | Defensive parsing alone | Both (chosen) |
|---|---|---|---|
| Fixes root cause | Yes (mostly) | No | Yes |
| Handles edge cases | No | Yes (mostly) | Yes |
| Debuggable on failure | No | Partial | Yes |
| Code complexity | Low | Low | Low |

---

## What does NOT change

- The STEP 1 / STEP 2 structure in all prompts — preserved as-is
- DB schema — `reasoning` field is never inserted
- Telegram output — `reasoning` field is never sent
- Retry logic, concurrency, or any other `callClaude()` behavior
