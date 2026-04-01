# Grok named_entities hint in analyzeNewsMemePotential — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strengthen `key_character_or_moment` in `analyzeNewsMemePotential` to return exact proper nouns, and inject `named_entities` from the signal as a non-binding hint to Grok.

**Architecture:** Single function edit in `grokScout.js`. Extract `named_entities` from the signal object (direct field or parsed from `reasoning` JSON blob), inject conditionally into the user prompt, and rewrite the `key_character_or_moment` field description with contrast examples and a fallback rule.

**Tech Stack:** Node.js ESM, xAI Grok API (`grok-4-1-fast-non-reasoning`), no test framework in project.

---

### Task 1: Extract named_entities and update the prompt

**Files:**
- Modify: `src/scout/grokScout.js:214-293`

This task replaces the entire user `content` string inside `analyzeNewsMemePotential`. Three changes land together because they are all part of the same template literal.

- [ ] **Step 1: Add named_entities extraction after the date variables**

In `src/scout/grokScout.js`, after line 222 (`const twoDaysAgo = ...`), add:

```js
const namedEntities = signal.named_entities
  ?? (() => { try { return JSON.parse(signal.reasoning || '{}').named_entities; } catch { return null; } })()
  ?? [];
```

The `??` chain mirrors the exact pattern at `src/creative/conceptGenerator.js:225-227`. Falls back to `[]` if the field is absent or `reasoning` is malformed — the hint block is then omitted silently.

- [ ] **Step 2: Replace the user prompt content string**

Replace the `content` value of the `role: 'user'` message (lines 242-257) with:

```js
content: `Today is ${today}. This topic is in the news right now: "${signal.topic}"

What happened: ${signal.summary}

Search X/Twitter and CT. Is the crypto community talking about this? What angle are they taking? Is there already a meme emerging?
${namedEntities.length > 0
  ? `\nPROPER NOUNS IDENTIFIED IN THIS STORY: ${namedEntities.join(', ')}\nCT may be using these exact names. Confirm or refine — use them in key_character_or_moment and trending_words if CT is actually using them.\n`
  : ''}
Return JSON:
{
  "meme_angle": string (the specific angle CT is exploiting — NOT the headline, the joke/meme/absurd take),
  "ct_reaction": string (2-3 sentences — what people are actually posting, use their exact slang),
  "key_character_or_moment": string (the EXACT proper noun CT is using — a real name, nickname, ticker, or animal name. If no named entity is central, use a tight moment label. NEVER a vague description. Good: "Punch", "SMCI", "Hawk Tuah". Bad: "the monkey", "the chip company", "the viral moment"),
  "visual_potential": string (1 sentence — what would work as a pump.fun thumbnail),
  "trending_words": string[] (3-5 exact words or phrases CT is using for this topic)
}

If CT is completely silent on this topic (not mentioned at all), return: {"ct_silent": true}`,
```

- [ ] **Step 3: Verify the function visually**

Read `src/scout/grokScout.js` lines 214-293 and confirm:
1. `namedEntities` extraction is present before the `try` block
2. The hint block (`PROPER NOUNS IDENTIFIED...`) appears in the template literal, wrapped in a conditional
3. `key_character_or_moment` description contains the contrast examples ("Punch", "SMCI", "Hawk Tuah" / "the monkey", "the chip company", "the viral moment")
4. No other part of the function changed

- [ ] **Step 4: Commit**

```bash
git add src/scout/grokScout.js
git commit -m "feat(grokScout): inject named_entities hint and enforce proper noun in key_character_or_moment"
```

---

## Self-Review

**Spec coverage:**
- [x] Extract `named_entities` from signal (direct field or `reasoning` JSON) → Task 1 Step 1
- [x] Conditional hint block before `Return JSON:` → Task 1 Step 2
- [x] Redefined `key_character_or_moment` with proper noun rule + contrast examples → Task 1 Step 2
- [x] `trending_words` unchanged → not touched anywhere in the plan
- [x] No consumer change (`conceptGenerator.js` reads same field name) → confirmed in Step 3

**Placeholder scan:** No TBD, no vague steps, all code shown inline.

**Type consistency:** Single task, single function — no cross-task type drift possible.
