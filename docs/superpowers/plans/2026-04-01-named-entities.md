# named_entities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `named_entities` field to the Perplexity signal pipeline so Sonar returns exact proper nouns (people, animals, company names, tickers) that Claude can use as ticker candidates in Flux 1 concept generation.

**Architecture:** Three surgical changes across two files — (1) add the field to the Sonar JSON schema prompt, (2) embed it in the `reasoning` blob on insert, (3) extract it in `generateFromSignal()` and inject a `TICKER CANDIDATES` block into the Claude prompt. No DB schema change.

**Tech Stack:** Node.js ESM, no test framework — verification is via the standalone runner (`node src/scout/perplexityScout.js`) and log inspection.

---

### Task 1: Add `named_entities` to the Sonar prompt and reasoning blob (`perplexityScout.js`)

**Files:**
- Modify: `src/scout/perplexityScout.js:35-60` (userMessage JSON schema)
- Modify: `src/scout/perplexityScout.js:118-138` (`insertSignal()` call)
- Modify: `src/scout/perplexityScout.js:155-170` (standalone test logger)

- [ ] **Step 1: Add `named_entities` to the JSON schema in `buildMessages()`**

In `buildMessages()`, the userMessage JSON schema ends at line ~51. `keywords` is currently the last field. Add a comma to the `keywords` line and append `named_entities` before the closing `}`:

Find this block:
```js
'  "keywords": string[] (3-5 keywords)\n' +
'}\n\n' +
```

Replace with:
```js
'  "keywords": string[] (3-5 keywords),\n' +
'  "named_entities": string[] (max 3 — the EXACT proper nouns at the center of this story: person names, animal names, company names, official tickers or acronyms. The exact word a degen would type into a search box. Examples: ["Punch"], ["SMCI", "Charles Liang"], ["Harambe"]. NOT a description — write "Punch" not "the monkey", "SMCI" not "the chip company". Empty array [] if no named proper noun is central to the story.)\n' +
'}\n\n' +
```

- [ ] **Step 2: Add `named_entities` to the `reasoning` blob in the `insertSignal()` call**

In `runPerplexityScan()`, find the `insertSignal` call (~line 118). Update the `reasoning` field:

Find:
```js
reasoning: JSON.stringify({
  summary: t.summary,
  keywords: t.keywords,
  category: t.category,
}),
```

Replace with:
```js
reasoning: JSON.stringify({
  summary: t.summary,
  keywords: t.keywords,
  category: t.category,
  named_entities: t.named_entities ?? [],
}),
```

- [ ] **Step 3: Add `named_entities` to the standalone test logger**

In the `if (process.argv[1] === ...)` block at the bottom, after the `keywords` log line:

Find:
```js
      console.log(`    keywords: ${s.keywords.join(', ')}`);
      console.log(`    sources: ${(s.sources ?? []).join(', ')}\n`);
```

Replace with:
```js
      console.log(`    keywords: ${s.keywords.join(', ')}`);
      if (s.named_entities?.length) console.log(`    named_entities: ${s.named_entities.join(', ')}`);
      console.log(`    sources: ${(s.sources ?? []).join(', ')}\n`);
```

- [ ] **Step 4: Verify with standalone runner**

```bash
node src/scout/perplexityScout.js
```

Expected output includes lines like:
```
  [8/10] Punch the Monkey (internet) [growing] [widespread]
    ...
    named_entities: Punch
```

If `named_entities` is absent from the log, Sonar didn't return the field — check that the schema string is valid JSON when rendered (no trailing commas on `named_entities` line, comma correctly added after `keywords`).

- [ ] **Step 5: Commit**

```bash
git add src/scout/perplexityScout.js
git commit -m "feat(perplexityScout): add named_entities field to Sonar prompt and reasoning blob"
```

---

### Task 2: Inject `named_entities` into the Flux 1 Claude prompt (`conceptGenerator.js`)

**Files:**
- Modify: `src/creative/conceptGenerator.js:174-262` (`generateFromSignal()`)

- [ ] **Step 1: Add extraction helper and `entitiesBlock` before the prompt string**

In `generateFromSignal(signal)`, find the `existingTokensBlock` definition (~line 216):

```js
  const existingTokensBlock = `TOKENS THAT ALREADY EXIST (DO NOT COPY THESE NAMES — use their style as inspiration only):
${similarTokensBlock}

TOKENS THAT ALREADY EXIST (DO NOT REUSE ANY OF THESE NAMES):
${blacklistBlock}

TOP PERFORMING THEMES RIGHT NOW: ${topThemes.join(', ')}
TOP PERFORMING FORMATS RIGHT NOW: ${topFormats.join(', ')}`;
```

Insert the following immediately after that block (before `const prompt = ...`):

```js
  const namedEntities = signal.named_entities
    ?? (() => { try { return JSON.parse(signal.reasoning || '{}').named_entities; } catch { return null; } })()
    ?? [];

  const entitiesBlock = namedEntities.length > 0
    ? `\nTICKER CANDIDATES (exact proper nouns from this story — strong default for the ticker unless the meme angle clearly points elsewhere):\n${namedEntities.join(', ')}\n`
    : '';
```

- [ ] **Step 2: Inject `entitiesBlock` into the prompt string**

In the `const prompt = \`...\`` template literal, find the section between `existingTokensBlock` and `STEP 1`:

Find:
```js
${existingTokensBlock}

STEP 1 — BEFORE YOU NAME ANYTHING:
```

Replace with:
```js
${existingTokensBlock}
${entitiesBlock}
STEP 1 — BEFORE YOU NAME ANYTHING:
```

Note: `entitiesBlock` already starts with `\n` when non-empty, so the blank line before `STEP 1` is preserved either way.

- [ ] **Step 3: Verify the prompt shape manually**

Add a temporary `console.log` immediately before `const concept = await callClaude(prompt);` in `generateFromSignal`:

```js
  console.log('[flux1] prompt preview:\n', prompt.slice(0, 600));
```

Run the standalone perplexity scan to get live signals, then trigger a single Flux 1 generation by calling from a test script or temporarily hardcoding a signal. Confirm `TICKER CANDIDATES` appears in the logged prompt when `named_entities` is non-empty, and is absent when empty.

Remove the `console.log` after verification.

- [ ] **Step 4: Commit**

```bash
git add src/creative/conceptGenerator.js
git commit -m "feat(conceptGenerator): inject named_entities as TICKER CANDIDATES in Flux 1 prompt"
```
