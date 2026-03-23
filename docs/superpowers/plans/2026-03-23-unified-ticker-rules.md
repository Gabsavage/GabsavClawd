# Unified Ticker Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all scattered ticker rules in `conceptGenerator.js` with one authoritative `TICKER RULES` block in the shared system prompt.

**Architecture:** String-level edits to a single file. The SYSTEM_PROMPT is a template literal shared by all three flux generators — consolidating rules there means every flux inherits them automatically with no per-prompt changes needed beyond deletions.

**Tech Stack:** Node.js ESM. No build step. No test suite — verification is done by reading the edited sections and grepping for removed strings.

**Spec:** `docs/superpowers/specs/2026-03-23-unified-ticker-rules-design.md`

---

## File Map

| File | Action |
|------|--------|
| `src/creative/conceptGenerator.js` | Modify — 4 edit zones (SYSTEM_PROMPT ×3 + Flux 1 + Flux 2 + Flux 3) |

---

### Task 1: Clean up NAMING RULES in SYSTEM_PROMPT

Remove the 5 ticker lines from the NAMING RULES block and the entire TICKER RULES block, then insert the unified replacement.

**Files:**
- Modify: `src/creative/conceptGenerator.js:24-52`

- [ ] **Step 1: Verify current state**

```bash
grep -n "3-5 characters\|GOOD tickers\|BAD tickers\|smirk when they read\|NEVER include the \$" src/creative/conceptGenerator.js
```

Expected: 5 matches on lines ~24–28.

- [ ] **Step 2: Remove the 5 ticker lines from NAMING RULES**

In `src/creative/conceptGenerator.js`, remove these exact lines from the `NAMING RULES` section:

```
- Ticker: 3-5 characters, must feel like something you'd see trending on DEXScreener
- GOOD tickers: $PUNCH, $RICO, $JUDY, $NUKE, $BRON, $MOSSAD
- BAD tickers: $STRIKE, $REGIME, $SUPREME, $PUMP, $COIN, $TOKEN — these are generic and boring
- The ticker should make someone smirk when they read it
- NEVER include the $ symbol in the ticker field — return only the letters (e.g. "NUKE" not "$NUKE")
```

- [ ] **Step 3: Replace the old TICKER RULES block**

Find and replace the entire existing `TICKER RULES` section (currently 4 lines after the header):

Old:
```
TICKER RULES:
- The ticker must be a REAL word or recognizable name, not an abbreviation
- GOOD: $HORMUZ, $VODKA, $BOOM, $SINK, $CHAD, $BARRON, $MULLER
- BAD: $FHOUR, $CRISPY, $HOUR1, $WSCN, $FCH — nobody knows what these mean
- If in doubt, use the most memorable single word from the story
```

New:
```
TICKER RULES:
- Max 10 characters. Must be a real word or recognizable name — not an abbreviation, not random letters.
- Must NOT just repeat the main word of the name. "Crypto Daddy" → $DADDY is lazy. Find a twist.
- Must add a new angle or punchline beyond the name. A great ticker makes someone smirk without reading the name.
- If CT is using a specific word as a meme, use THAT EXACT WORD in the ticker — never a synonym or metaphor. Degens search the exact word. "OpenClaw trending" → $CLAW not $GRIP.
- NEVER use generic words: $WAR, $NUKE, $PUMP, $COIN, $APE, $MOON, $RUGGED, $STRIKE, $REGIME — these could go on any token.
- When a token is a direct response to an existing one ($HERE already exists → play: $THERE, $GONE).
- NEVER include the $ symbol in the ticker field — return only the letters (e.g. "NUKE" not "$NUKE").

GOOD tickers: $PAPI ("Crypto Daddy" — twist, smirk-worthy alone), $TRANS ("Transitory" — double-meaning), $FARM ("General Farming" — obvious but self-contained), $HORMUZ, $VODKA, $BOOM, $RICO, $JUDY
BAD tickers: $DADDY (copies name's last word), $FARMS (copies word from name), $GRIP (synonym for "Claw" — nobody searches this), $NUMB3R/$FHOUR/$WSCN (abbreviations), $STRIKE/$REGIME/$WAR/$RUGGED (generic)

TICKER SELF-CHECK — verify before returning JSON:
1. Is it a real word or recognizable name? If no → replace.
2. Does it repeat the main word of the name? If yes → find a twist.
3. Could it go on any token, not just this one? If yes → too generic, make it specific.
```

- [ ] **Step 4: Remove 3 ticker lines from FORMAT RULES**

Find and remove these exact lines from the `FORMAT RULES` section:

```
- Ticker: MAXIMUM 10 characters. Must be a real word or recognizable name.
- Ticker must NOT just be the concept repeated. If the token is about a hamster who is a NEET, the ticker is NOT $NEET (already taken/obvious). Find a twist: $NEEH, $HAMST, etc.
- When a token is clearly a RESPONSE to an existing token (like $HERE already exists), the obvious play is the mirror/opposite ($THERE, $GONE, etc.) — don't overthink it.
```

- [ ] **Step 5: Verify**

```bash
grep -n "3-5 characters\|MAXIMUM 10\|Ticker must NOT just be the concept\|smirk when they read\|GOOD tickers: \$PUNCH" src/creative/conceptGenerator.js
```

Expected: 0 matches (all deleted strings gone).

```bash
grep -n "TICKER SELF-CHECK\|Max 10 characters\|NEVER use generic words" src/creative/conceptGenerator.js
```

Expected: 3 matches (new block present).

- [ ] **Step 6: Commit**

```bash
git add src/creative/conceptGenerator.js
git commit -m "refactor(prompts): consolidate ticker rules into unified SYSTEM_PROMPT block"
```

---

### Task 2: Remove ticker rules from Flux 1 prompt

**Files:**
- Modify: `src/creative/conceptGenerator.js` — RULES block inside `generateFromSignal()`

- [ ] **Step 1: Verify current state**

```bash
grep -n "TICKER must relate to the meme angle\|TRENDING WORDS from CT\|No generic geo-political" src/creative/conceptGenerator.js
```

Expected: 3 matches.

- [ ] **Step 2: Remove 4 ticker lines from Flux 1 RULES**

Inside the `prompt` template literal of `generateFromSignal()`, find the RULES block and remove these exact lines:

```
- The TICKER must relate to the meme angle, not the geopolitical event
- Use TRENDING WORDS from CT if provided — degens search the exact trending word
- If CT has a specific nickname or joke for this topic, BUILD ON THAT
- No generic geo-political tickers ($WAR, $NUKE, $IRAN) unless CT is literally using that word as a meme
```

- [ ] **Step 3: Verify**

```bash
grep -n "TICKER must relate\|TRENDING WORDS from CT\|No generic geo-political" src/creative/conceptGenerator.js
```

Expected: 0 matches.

- [ ] **Step 4: Commit**

```bash
git add src/creative/conceptGenerator.js
git commit -m "refactor(prompts): remove redundant ticker rules from Flux 1 prompt"
```

---

### Task 3: Remove ticker rules from Flux 2 prompt

**Files:**
- Modify: `src/creative/conceptGenerator.js` — RULES block + QUALITY CHECK inside `generateVariants()`

- [ ] **Step 1: Verify current state**

```bash
grep -n "TICKER must be as specific\|Ticker must be a real word.*smirk independently\|Is the ticker a generic\|Does the ticker add a new angle" src/creative/conceptGenerator.js
```

Expected: 4 matches.

- [ ] **Step 2: Remove 2 ticker lines from Flux 2 RULES**

Inside `generateVariants()`, remove:

```
- The TICKER must be as specific and funny as the NAME — no generic crypto words ($RUGGED, $APE, $MOON, $GG) unless they are genuinely the best fit for THIS specific story.
- Ticker must be a real word or recognizable name that makes someone smirk independently of reading the full name.
```

- [ ] **Step 3: Simplify QUALITY CHECK — remove questions 2 and 3, drop the label**

Old:
```
QUALITY CHECK before returning:
1. Could someone who has never heard of crypto laugh at this? If no, try again.
2. Is the ticker a generic crypto word with no specific tie to THIS story? If yes, find something more specific.
3. Does the ticker add a new angle or punchline beyond the name? If it just repeats the name's main word, that's lazy.
```

New (one line, no numbered list, no "QUALITY CHECK" label):
```
Before returning: Could someone who has never heard of crypto laugh at this? If no, try again.
```

- [ ] **Step 4: Verify**

```bash
grep -n "QUALITY CHECK\|Is the ticker a generic\|Does the ticker add a new angle\|TICKER must be as specific" src/creative/conceptGenerator.js
```

Expected: 0 matches.

```bash
grep -n "Before returning: Could someone" src/creative/conceptGenerator.js
```

Expected: 1 match.

- [ ] **Step 5: Commit**

```bash
git add src/creative/conceptGenerator.js
git commit -m "refactor(prompts): remove redundant ticker rules from Flux 2 prompt"
```

---

### Task 4: Remove ticker rules from Flux 3 prompt

**Files:**
- Modify: `src/creative/conceptGenerator.js` — RULES block + JSON schema comment inside `generateFromCTTrend()`

- [ ] **Step 1: Verify current state**

```bash
grep -n "TICKER: real word or recognizable\|max 10 chars, real word, not abbreviation" src/creative/conceptGenerator.js
```

Expected: 2 matches.

- [ ] **Step 2: Remove ticker rule from Flux 3 RULES**

Inside `generateFromCTTrend()`, remove this line from the RULES block:

```
- TICKER: real word or recognizable name, not an abbreviation
```

- [ ] **Step 3: Simplify JSON schema ticker comment**

Old:
```
  "ticker": string (max 10 chars, real word, not abbreviation),
```

New:
```
  "ticker": string,
```

- [ ] **Step 4: Verify**

```bash
grep -n "TICKER: real word\|max 10 chars, real word" src/creative/conceptGenerator.js
```

Expected: 0 matches.

- [ ] **Step 5: Commit**

```bash
git add src/creative/conceptGenerator.js
git commit -m "refactor(prompts): remove redundant ticker rules from Flux 3 prompt"
```

---

### Task 5: Final verification

- [ ] **Step 1: Confirm the unified block is the only source of ticker rules**

```bash
grep -in "ticker" src/creative/conceptGenerator.js
```

Review the output. Expected remaining ticker mentions:
- Lines inside the new `TICKER RULES` block in SYSTEM_PROMPT
- The `concept.ticker.replace(/^\$/, '')` safety strip in `callClaude()` (keep — intentional)
- `t.ticker` / `m.ticker` variable references in token data (keep — not prompt rules)
- `"ticker": string` in JSON schema comments of Flux 1, 2, 3 (keep)

No remaining prompt-level ticker *rules* should appear outside `TICKER RULES`.

- [ ] **Step 2: Sanity-read the full SYSTEM_PROMPT**

```bash
node -e "import('./src/creative/conceptGenerator.js')" 2>&1 | head -5
```

Expected: no import errors (confirms the file is still valid ESM).

- [ ] **Step 3: Commit if any cleanup needed, otherwise done**
