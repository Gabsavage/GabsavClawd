# Unified Ticker Rules — Design Spec
**Date:** 2026-03-23
**Status:** Approved

## Problem

Ticker rules in `src/creative/conceptGenerator.js` are fragmented across three locations in the system prompt (NAMING RULES, TICKER RULES, FORMAT RULES) and duplicated with variations in each flux's individual prompt. This causes:

1. **Contradiction:** "3-5 characters" (NAMING RULES) vs "MAXIMUM 10 characters" (FORMAT RULES) in the same system prompt.
2. **Uneven coverage:** Flux 2 has a 3-question self-check; Flux 3 has one bare line. Sonnet applies different standards depending on which flux it's generating for.
3. **Drift risk:** Rules added to one flux prompt never propagate to the others.
4. **Cognitive load:** Sonnet reads scattered ticker rules across a long prompt — the rules don't land as a coherent constraint set.

## Goal

Replace all ticker-related rules across the file with **one authoritative `TICKER RULES` block** in the shared system prompt. All three flux prompts inherit it automatically. No ticker rules in individual flux prompts.

## Design

### New `TICKER RULES` block (replaces existing TICKER RULES section in system prompt)

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

### Deletions in system prompt

**NAMING RULES** — remove these 5 lines:
```
- Ticker: 3-5 characters, must feel like something you'd see trending on DEXScreener
- GOOD tickers: $PUNCH, $RICO, $JUDY, $NUKE, $BRON, $MOSSAD
- BAD tickers: $STRIKE, $REGIME, $SUPREME, $PUMP, $COIN, $TOKEN — these are generic and boring
- The ticker should make someone smirk when they read it
- NEVER include the $ symbol in the ticker field — return only the letters (e.g. "NUKE" not "$NUKE")
```

**TICKER RULES block** — remove entirely and replace with new block above.

**FORMAT RULES** — remove these 3 lines:
```
- Ticker: MAXIMUM 10 characters. Must be a real word or recognizable name.
- Ticker must NOT just be the concept repeated. If the token is about a hamster who is a NEET, the ticker is NOT $NEET (already taken/obvious). Find a twist: $NEEH, $HAMST, etc.
- When a token is clearly a RESPONSE to an existing token (like $HERE already exists), the obvious play is the mirror/opposite ($THERE, $GONE, etc.) — don't overthink it.
```

### Deletions in flux prompts

**Flux 1 — `generateFromSignal()`** — remove from RULES block:
```
- The TICKER must relate to the meme angle, not the geopolitical event
- Use TRENDING WORDS from CT if provided — degens search the exact trending word
- If CT has a specific nickname or joke for this topic, BUILD ON THAT
- No generic geo-political tickers ($WAR, $NUKE, $IRAN) unless CT is literally using that word as a meme
```

**Flux 2 — `generateVariants()`** — remove from RULES block:
```
- The TICKER must be as specific and funny as the NAME — no generic crypto words ($RUGGED, $APE, $MOON, $GG) unless they are genuinely the best fit for THIS specific story.
- Ticker must be a real word or recognizable name that makes someone smirk independently of reading the full name.
```
Remove from QUALITY CHECK (questions 2 and 3):
```
2. Is the ticker a generic crypto word with no specific tie to THIS story? If yes, find something more specific.
3. Does the ticker add a new angle or punchline beyond the name? If it just repeats the name's main word, that's lazy.
```
Keep QUALITY CHECK question 1 (it's about the name, not the ticker):
```
1. Could someone who has never heard of crypto laugh at this? If no, try again.
```

**Flux 3 — `generateFromCTTrend()`** — remove from RULES:
```
- TICKER: real word or recognizable name, not an abbreviation
```
Simplify JSON schema comment:
```
"ticker": string (max 10 chars, real word, not abbreviation)
→ "ticker": string
```

## Out of scope

- No changes to name rules, description rules, or image_prompt rules.
- No changes to flux logic, enrichment, or dedup.
- No changes to the `callClaude()` post-processing (`concept.ticker.replace(/^\$/, '')`) — still needed as a safety net.
