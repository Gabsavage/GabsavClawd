# Design: Grok named_entities hint in analyzeNewsMemePotential

**Date:** 2026-04-01  
**File:** `src/scout/grokScout.js` — `analyzeNewsMemePotential(signal)`  
**Scope:** Prompt-only change + named_entities extraction. No schema change, no consumer change.

## Problem

Grok returns vague descriptions for `key_character_or_moment` ("the monkey", "the chip company") instead of exact proper nouns ("Punch", "SMCI"). The `named_entities` field introduced in `perplexityScout.js` carries exactly this information but is not passed to Grok.

## Solution (Approach A)

Two targeted changes to `analyzeNewsMemePotential`:

### 1. Extract `named_entities` from the signal

At the top of the function, before building the fetch body:

```js
const namedEntities = signal.named_entities
  ?? (() => { try { return JSON.parse(signal.reasoning || '{}').named_entities; } catch { return null; } })()
  ?? [];
```

Same pattern as `conceptGenerator.js:225-227`. Falls back to `[]` if absent — hint is silently omitted.

### 2. Conditional hint block in the user prompt

Inserted immediately before `Return JSON:`:

```
${namedEntities.length > 0
  ? `PROPER NOUNS IDENTIFIED IN THIS STORY: ${namedEntities.join(', ')}\nCT may be using these exact names. Confirm or refine — use them in key_character_or_moment and trending_words if CT is actually using them.\n\n`
  : ''}Return JSON:
```

Non-constraining ("confirm or refine") — Grok can override if CT is using a different name.

### 3. Redefined `key_character_or_moment` field description

Old:
```
"key_character_or_moment": string (the person/moment/thing degens would latch onto),
```

New:
```
"key_character_or_moment": string (the EXACT proper noun CT is using — a real name, nickname, ticker, or animal name. If no named entity is central, use a tight moment label. NEVER a vague description. Good: "Punch", "SMCI", "Hawk Tuah". Bad: "the monkey", "the chip company", "the viral moment"),
```

## Out of scope

- `trending_words`: unchanged — its role is CT slang, not proper nouns.
- `conceptGenerator.js`: no changes — `key_character_or_moment` field name is preserved.
- `analyzeTokenNarrative`: not touched — different enrichment path (Flux 2).

## Behavior

| Case | Result |
|------|--------|
| `named_entities: ["Punch"]` | Hint injected; Grok confirms "Punch" or refines |
| `named_entities: []` | No hint; Grok uses redefined field rules alone |
| `named_entities` absent from signal | Parsed from `signal.reasoning`; same as above |
| CT uses a different name than named_entities | Grok can override — hint is non-binding |
