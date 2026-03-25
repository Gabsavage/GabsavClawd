# JSON Parsing Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `callClaude()` crashing with `Unexpected token '*'` when the model outputs STEP 1 reasoning as Markdown prose before the JSON object.

**Architecture:** Two-pronged fix in a single file — embed STEP 1 reasoning into a `"reasoning"` JSON field (prompt fix, 3 locations) so the model stops outputting prose, and add defensive JSON extraction + structured error logging in `callClaude()` as a safety net (parse fix, 1 location).

**Tech Stack:** Node.js ESM (no build step, no test framework — tests are plain `node` scripts)

**Spec:** `docs/superpowers/specs/2026-03-25-json-parsing-fix-design.md`

---

## File Map

| File | Change |
|---|---|
| `src/creative/conceptGenerator.js` | Modify `callClaude()` parse block (lines 150–151) + update `Return JSON only:` in 3 prompts |
| `test/parse-safety.js` | New — standalone Node script; goes RED on Case 2 before Task 2, then GREEN after |

No other files change. `db.js` and `telegramBot.js` are unaffected — confirmed in spec.

---

## Task 1: Write the failing test (RED phase)

**Files:**
- Create: `test/parse-safety.js`

This test uses the **current** (pre-fix) parse logic so it genuinely fails on Case 2 (the bug). Task 2 will update both the production code and the test helper to use the new logic.

- [ ] **Step 1: Create `test/parse-safety.js`**

```js
// test/parse-safety.js
// Run with: node test/parse-safety.js
//
// Before Task 2: expects Case 2 to FAIL (demonstrating the bug).
// After Task 2: update parseModelResponse() to the defensive version — all 4 pass.

// --- CURRENT parse logic (pre-fix) — replace this function in Task 2 ---
function parseModelResponse(text) {
  const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(clean);
}
// -----------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(label, fn) {
  try {
    fn();
    console.log(`  PASS  ${label}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${label}: ${err.message}`);
    failed++;
  }
}

// Case 1 — clean JSON (happy path)
assert('clean JSON parses correctly', () => {
  const input = '{"name":"Free Fireworks","ticker":"BOOM","description":"d","narrative":"n","image_prompt":"i","flux":"1"}';
  const result = parseModelResponse(input);
  if (result.name !== 'Free Fireworks') throw new Error(`name mismatch: ${result.name}`);
  if (result.ticker !== 'BOOM') throw new Error(`ticker mismatch: ${result.ticker}`);
});

// Case 2 — prose markdown before JSON (THE BUG — must FAIL before Task 2)
assert('prose markdown before JSON is handled', () => {
  const input = `**STEP 1 — BEFORE YOU NAME ANYTHING**: The meme angle is dark free-fireworks energy.\n\n**STEP 2**:\n{"name":"Free Fireworks","ticker":"BOOM","description":"d","narrative":"n","image_prompt":"i","flux":"1"}`;
  const result = parseModelResponse(input);
  if (result.name !== 'Free Fireworks') throw new Error(`name mismatch: ${result.name}`);
});

// Case 3 — code-fenced JSON (existing fence-stripping behaviour must still work)
assert('code-fenced JSON is handled', () => {
  const input = '```json\n{"name":"Free Fireworks","ticker":"BOOM","description":"d","narrative":"n","image_prompt":"i","flux":"1"}\n```';
  const result = parseModelResponse(input);
  if (result.name !== 'Free Fireworks') throw new Error(`name mismatch: ${result.name}`);
});

// Case 4 — no JSON at all (after Task 2: must throw with raw response in message)
assert('no JSON throws descriptive error', () => {
  let threw = false;
  try {
    parseModelResponse('The meme angle is dark free-fireworks energy. No JSON here.');
  } catch (err) {
    threw = true;
    // After Task 2: error message must contain '[callClaude]' prefix
    // Before Task 2: JSON.parse throws SyntaxError without the prefix — this assertion will fail
    if (!err.message.includes('[callClaude]')) throw new Error(`error message missing prefix — fix not yet applied: ${err.message}`);
  }
  if (!threw) throw new Error('expected an error but none was thrown');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run the test — confirm it is RED (Cases 2 and 4 fail)**

```bash
node test/parse-safety.js
```

Expected output:
```
  PASS  clean JSON parses correctly
  FAIL  prose markdown before JSON is handled: Unexpected token '*' ...
  PASS  code-fenced JSON is handled
  FAIL  no JSON throws descriptive error: error message missing prefix ...

2 passed, 2 failed
```

If Cases 2 and 4 do not fail, stop and investigate before continuing.

---

## Task 2: Fix `callClaude()` and go GREEN

**Files:**
- Modify: `src/creative/conceptGenerator.js` (the `callClaude()` function, lines 150–151)
- Modify: `test/parse-safety.js` (update the `parseModelResponse` helper to match the new logic)

- [ ] **Step 1: Replace the 2-line parse block in `callClaude()`**

In `src/creative/conceptGenerator.js`, find the `callClaude()` function and locate these two lines:
```js
  const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const concept = JSON.parse(clean);
```

Replace them with (the two lines immediately following — the `$`-strip and `return` — stay unchanged):
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

- [ ] **Step 2: Update the `parseModelResponse` helper in `test/parse-safety.js`**

Replace the function inside the `--- CURRENT parse logic ---` block with the new logic (same as the production code above, minus the `concept` variable name which can stay as is):

```js
function parseModelResponse(text) {
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`[callClaude] No JSON object found in response:\n${text.slice(0, 300)}`);
  let result;
  try {
    result = JSON.parse(match[0]);
  } catch (err) {
    throw new Error(`[callClaude] JSON.parse failed: ${err.message}\nRaw response:\n${text.slice(0, 500)}`);
  }
  return result;
}
```

- [ ] **Step 3: Run the test — confirm all 4 pass (GREEN)**

```bash
node test/parse-safety.js
```

Expected:
```
  PASS  clean JSON parses correctly
  PASS  prose markdown before JSON is handled
  PASS  code-fenced JSON is handled
  PASS  no JSON throws descriptive error

4 passed, 0 failed
```

- [ ] **Step 4: Commit**

```bash
git add src/creative/conceptGenerator.js test/parse-safety.js
git commit -m "fix(conceptGenerator): defensive JSON extraction in callClaude()

Replaces bare JSON.parse() with regex-based object extraction so prose
markdown from STEP 1 reasoning no longer crashes the parser. Raw response
is now logged on both extraction failure and parse failure.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

> Note: `Co-Authored-By` is house style for this project — keep it.

---

## Task 3: Update `generateFromSignal` prompt

**Files:**
- Modify: `src/creative/conceptGenerator.js` (`generateFromSignal` function, `prompt` template literal)

- [ ] **Step 1: Find and replace the `Return JSON only:` block in `generateFromSignal`**

Search for the literal text `Return JSON only:` inside the `generateFromSignal` function. There is exactly one occurrence. Replace the entire block:

```
Return JSON only:
{
  "name": string,
  "ticker": string,
  "description": string (1 sentence, shitpost energy),
  "narrative": string (1 sentence, why degens buy this),
  "image_prompt": string (visual for pump.fun thumbnail),
  "flux": "1"
}`;
```

With:

```
Return JSON only — put your STEP 1 reasoning in the "reasoning" field:
{
  "reasoning": string (your meme angle from STEP 1, one sentence),
  "name": string,
  "ticker": string,
  "description": string (1 sentence, shitpost energy),
  "narrative": string (1 sentence, why degens buy this),
  "image_prompt": string (visual for pump.fun thumbnail),
  "flux": "1"
}`;
```

(The backtick-semicolon `}\`;` at the end closes the template literal — leave that unchanged.)

- [ ] **Step 2: Run the parse test**

```bash
node test/parse-safety.js
```

Expected: `4 passed, 0 failed`

- [ ] **Step 3: Commit**

```bash
git add src/creative/conceptGenerator.js
git commit -m "fix(conceptGenerator): embed STEP 1 reasoning in JSON field — Flux 1

Instructs the model to put its meme angle reasoning into a 'reasoning'
JSON field instead of outputting it as Markdown prose, eliminating the
root cause of JSON parse failures in generateFromSignal.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Update `generateVariants` prompt

**Files:**
- Modify: `src/creative/conceptGenerator.js` (`generateVariants` function, `prompt` template literal)

- [ ] **Step 1: Find and replace the `Return JSON only:` block in `generateVariants`**

Search for `Return JSON only:` inside the `generateVariants` function. Replace:

```
Return JSON only:
{
  "name": string,
  "ticker": string,
  "description": string,
  "narrative": string,
  "image_prompt": string,
  "flux": "2"
}`;
```

With:

```
Return JSON only — put your STEP 1 reasoning in the "reasoning" field:
{
  "reasoning": string (your meme angle from STEP 1, one sentence),
  "name": string,
  "ticker": string,
  "description": string,
  "narrative": string,
  "image_prompt": string,
  "flux": "2"
}`;
```

- [ ] **Step 2: Run the parse test**

```bash
node test/parse-safety.js
```

Expected: `4 passed, 0 failed`

- [ ] **Step 3: Commit**

```bash
git add src/creative/conceptGenerator.js
git commit -m "fix(conceptGenerator): embed STEP 1 reasoning in JSON field — Flux 2

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Update `generateFromCTTrend` prompt

**Files:**
- Modify: `src/creative/conceptGenerator.js` (`generateFromCTTrend` function, `prompt` template literal)

- [ ] **Step 1: Find and replace the `Return JSON only:` block in `generateFromCTTrend`**

Search for `Return JSON only:` inside the `generateFromCTTrend` function. Replace:

```
Return JSON only:
{
  "name": string (max 32 chars),
  "ticker": string,
  "description": string (1 sentence, shitpost energy),
  "narrative": string (1 sentence, why degens buy this),
  "image_prompt": string (visual for pump.fun thumbnail),
  "flux": "3"
}`;
```

With:

```
Return JSON only — put your STEP 1 reasoning in the "reasoning" field:
{
  "reasoning": string (your hook from STEP 1, one sentence),
  "name": string (max 32 chars),
  "ticker": string,
  "description": string (1 sentence, shitpost energy),
  "narrative": string (1 sentence, why degens buy this),
  "image_prompt": string (visual for pump.fun thumbnail),
  "flux": "3"
}`;
```

- [ ] **Step 2: Run the parse test**

```bash
node test/parse-safety.js
```

Expected: `4 passed, 0 failed`

- [ ] **Step 3: Commit**

```bash
git add src/creative/conceptGenerator.js
git commit -m "fix(conceptGenerator): embed STEP 1 reasoning in JSON field — Flux 3

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Done

All changes land in `src/creative/conceptGenerator.js` only. The fix is complete when:
- `node test/parse-safety.js` shows `4 passed, 0 failed`
- All three `Return JSON only:` occurrences (in `generateFromSignal`, `generateVariants`, `generateFromCTTrend`) now say `Return JSON only — put your STEP 1 reasoning in the "reasoning" field:`
- `callClaude()` uses the defensive extraction block instead of bare `JSON.parse()`
- `generateCrossover` is unchanged (it has no STEP 1/STEP 2 structure)
