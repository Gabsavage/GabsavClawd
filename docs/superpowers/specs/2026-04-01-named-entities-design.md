# named_entities field — Design Spec

**Date:** 2026-04-01
**Scope:** `src/scout/perplexityScout.js`, `src/creative/conceptGenerator.js`
**No DB schema change.**

---

## Problem

Perplexity returns a rich signal per story, but the ticker-generation step in Claude has no structured list of "the exact proper nouns a degen would search." Keywords (`["monkey", "zoo", "punch"]`) are too generic. Named entities (`["Punch"]`) are the natural ticker candidates — PATTERN 1 (ICONIC WORD) in the system prompt.

---

## Solution

Add a `named_entities` field (string[], max 3) to the Sonar JSON schema, store it in the existing `reasoning` blob, and inject it into the `generateFromSignal()` Claude prompt as a `TICKER CANDIDATES` block.

---

## Changes

### 1. Sonar prompt — `buildMessages()` in `perplexityScout.js`

Add as the **last field** in the JSON schema, after `keywords`:

```
"named_entities": string[] (max 3 — the EXACT proper nouns at the center of this story: person names, animal names, company names, official tickers or acronyms. The exact word a degen would type into a search box. Examples: ["Punch"], ["SMCI", "Charles Liang"], ["Harambe"]. NOT a description — write "Punch" not "the monkey", "SMCI" not "the chip company". Empty array [] if no named proper noun is central to the story.)
```

### 2. Storage — `insertSignal()` call in `runPerplexityScan()`

Embed in the existing `reasoning` TEXT blob (no schema migration):

```js
reasoning: JSON.stringify({
  summary: t.summary,
  keywords: t.keywords,
  category: t.category,
  named_entities: t.named_entities ?? [],
}),
```

Old DB rows without the field parse to `undefined` — the extraction helper below handles this gracefully.

### 3. Generator injection — `generateFromSignal()` in `conceptGenerator.js`

**3a — Extraction helper** (at the top of `generateFromSignal`, before any prompt assembly):

```js
const namedEntities = signal.named_entities
  ?? (() => { try { return JSON.parse(signal.reasoning || '{}').named_entities; } catch { return null; } })()
  ?? [];
```

- Raw Perplexity object → reads `signal.named_entities` directly.
- DB row (via `getLatestSignals()`) → falls through to parse `reasoning` blob.
- Missing or malformed → falls back to `[]`.

**3b — TICKER CANDIDATES block** (built after `existingTokensBlock`, injected between it and `STEP 1`):

```js
const entitiesBlock = namedEntities.length > 0
  ? `\nTICKER CANDIDATES (exact proper nouns from this story — strong default for the ticker unless the meme angle clearly points elsewhere):\n${namedEntities.join(', ')}\n`
  : '';
```

Prompt injection order:
```
${existingTokensBlock}
${entitiesBlock}
STEP 1 — BEFORE YOU NAME ANYTHING: ...
```

---

## Design decisions

- **No new DB column.** `named_entities` rides in the `reasoning` blob alongside `summary`, `keywords`, `category`. It's not query-targeted, so a dedicated column adds migration cost for no query benefit.
- **Gated block.** `entitiesBlock` is empty-string when `namedEntities` is `[]` — no noise in the prompt for stories with no central proper noun.
- **Non-prescriptive wording.** "strong default … unless the meme angle clearly points elsewhere" guides Claude toward the entity without forcing it when the entity isn't the joke.
- **Flux 1 only.** Flux 2 and Flux 3 don't use `generateFromSignal()` — no changes needed there.

---

## Out of scope

- Flux 2 (`generateVariants`) and Flux 3 (`generateFromCTTrend`, `generateCrossover`) — no `named_entities` injection.
- `grokScout.js` enrichment functions — `analyzeNewsMemePotential` already provides `key_character_or_moment`; these are complementary, not duplicated.
- Dashboard or Telegram display of `named_entities`.
