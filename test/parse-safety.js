// test/parse-safety.js
// Run with: node test/parse-safety.js
//
// Regression guard for callClaude() JSON parsing in conceptGenerator.js.
// Mirrors the defensive parse logic in callClaude() — all 4 cases must pass.

// --- parse logic (mirrors callClaude() in conceptGenerator.js) ---
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
