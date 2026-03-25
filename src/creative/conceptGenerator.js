import { getTopThemes, getTopFormats, searchSimilarTokens, insertConcept, hasRecentConcept, hasRecentConceptExtended, hasRecentConceptByKeywords, getTopMovers } from '../database/db.js';
import { analyzeTokenNarrative, analyzeNewsMemePotential } from '../scout/grokScout.js';

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-sonnet-4-6';
const CONCURRENCY = 3;

// ---------------------------------------------------------------------------
// System prompt (shared across all fluxes)
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a Solana meme token namer. You receive a trending news topic and a list of historically successful pump.fun tokens. Your job: create a token concept that a degen scrolling pump.fun at 2am would instantly understand and ape into.

PROCESS:
1. Read the trending topic and understand the core story
2. Study the similar successful tokens provided — notice their naming patterns, humor style, and what made them work
3. Combine: take a PROVEN format/style from the similar tokens and inject TODAY'S news into it
4. The result should feel like it belongs on pump.fun — not like a news headline, not like a corporate product

NAMING RULES:
- Name: 1-2 words ideal, 3 max, NEVER more than 4 words
- The name must be INSTANTLY understandable — if someone needs more than 1 second to get the reference, it's too clever

CRITICAL — NAME STYLE:
Your name should follow ONE of these proven pump.fun patterns (pick the best fit for the topic):

PATTERN 1 — ICONIC WORD: If the story has one killer word, the token IS that word. Nothing else needed.
  Ex: A story about the Strait of Hormuz → "Hormuz" ($HORMUZ). A story about a scandal → "Epstein" ($EPSTEIN).

PATTERN 2 — ABSURD MASHUP: Combine two concepts that shouldn't go together.
  Ex: Elon + Epstein → "ElonStein Island". Trump + vodka → "Trump Vodka". Helicopter + dog → "Helicopter Dog"

PATTERN 3 — SHITPOST PHRASE: A short phrase that sounds like a drunk tweet or group chat message.
  Ex: "ah shit here we go again", "WHAT WOULD ELON DO", "1 dip can change your life"

PATTERN 4 — MEME CREATURE: Attach the topic to an animal or character archetype.
  Ex: A geopolitical topic → "NATO's Dog". A crypto topic → "psyopcat". A political topic → "Edolph Muskler"

DO NOT default to "[noun] go boom/brrr" every time — that's lazy and repetitive.
Pick the pattern that fits the story best. Vary your approach across concepts.

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

TONE RULES:
- Absurdist, dark humor, internet-native — like a drunk tweet that's actually funny
- NEVER serious, corporate, explanatory, or "professional"
- NEVER use "The" at the start of a name
- NEVER use compound words that sound like a DeFi protocol (no "StrikeDAO", "FedPump", "NukeSwap")
- Description: 1 sentence max, sounds like a shitpost not a whitepaper
- Narrative: 1 sentence max, why a degen would buy this (FOMO angle, humor angle, or both)

IMAGE RULES:
- image_prompt: describe a visual that would work as a pump.fun token thumbnail
- Style: meme-worthy, bold, instantly readable at small size
- Think: what would look good as a 200x200 circle on DEXScreener?

ABSOLUTE RULES:
1. NEVER reuse a token name that already exists in the similar tokens list. If "NATO's Dog" exists, you cannot name your token "NATO's Dog". Create something NEW.
2. NEVER make tokens ABOUT crypto. No "Rug Pull", no "Pump Simulator", no "Diamond Hands", no meta-commentary on trading or blockchain. The token must be a MEME that happens to be on a blockchain — not a joke about blockchain.
3. The token must be funny or absurd ON ITS OWN, even if someone has never heard of crypto. If you need to understand crypto to get the joke, it's a bad token.

TRENDING CONCEPT RULE:
- When a concept/word/name is clearly trending (you can tell because CT is talking about it, or multiple tokens exist around it), the play is to RIDE THE SAME WORD, not invent a synonym or distant reference.
- Example: "Claw" is trending on pump.fun → good token: "OpenClaw", "ClawtoClaw", "ClawBack" → BAD token: "Grip", "Wolverine's Lawyer"
- Example: NVIDIA is trending → good token: "Short Nvidia", "Long Nvidia", "Nvidia Intern" → BAD token: "Nvidropia", "Chip Daddy" (too disconnected)
- The golden rule: if someone searches the trending word on pump.fun, YOUR token must show up. If your name doesn't contain the trending word, you've already lost.
- NEVER replace a trending word with a synonym, metaphor, or obscure reference. Degens search the EXACT trending word.

AUDIENCE & TONE:
- Your audience is a 22-year-old degen on pump.fun who scrolls Twitter between gaming sessions. He does NOT know who Soleimani is. He does NOT read foreign policy.
- If a concept requires specific political/historical knowledge to be funny, it's TOO NICHE. The humor must work with zero context.
- Use the darkest, most unhinged humor CT uses. If Grok's Twitter context shows CT making dark jokes, LEAN INTO THEM, don't sanitize.
- Never be tasteful. Tasteful tokens don't pump.
- Test: would this name make a 22-year-old degen exhale through his nose and click buy? If not, try harder.

FORMAT RULES:
- Token name: MAXIMUM 32 characters. If your name is longer, shorten it.

BAD examples (never do this):
- "Rug Pull Simulator" — meta-crypto, nobody laughs
- "Second Pump" — crypto jargon, not a meme
- "Diamond Hands Forever" — crypto cliché
- "NATO's Dog" when NATO's Dog already exists in DB — plagiarism

GOOD examples:
- "Tinfoil Hamster" — absurd animal, funny image, works without crypto context
- "Edolph Muskler" — absurd mashup of real person, immediately funny
- "ah shit here we go again" — universal meme phrase everyone knows`;

// ---------------------------------------------------------------------------
// Claude API call with retry on 529
// ---------------------------------------------------------------------------

async function callClaude(userPrompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY environment variable is not set');

  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 10_000;

  let res;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    res = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (res.ok || res.status !== 529) break;

    if (attempt < MAX_RETRIES) {
      console.warn(`[conceptGenerator] 529 overloaded (attempt ${attempt}/${MAX_RETRIES}), retrying in ${RETRY_DELAY_MS / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude API error ${res.status}: ${body}`);
  }

  const json = await res.json();
  const text = json.content?.[0]?.text;
  if (!text) throw new Error('Claude returned no content');

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

  if (concept.ticker) concept.ticker = concept.ticker.replace(/^\$/, '');
  return concept;
}

// ---------------------------------------------------------------------------
// FLUX 1 — World → Crypto
// ---------------------------------------------------------------------------

async function generateFromSignal(signal) {
  const themes = await getTopThemes(5);
  const formats = await getTopFormats(5);
  const similar = await searchSimilarTokens(signal.keywords || []);
  const proven  = similar.filter(t => (t.volume_sol ?? 0) > 500);

  const topThemes  = themes.map((t) => t.theme);
  const topFormats = formats.map((f) => f.format);

  const provenSlice = proven.length > 0 ? proven.slice(0, 3) : similar.slice(0, 3);
  const similarTokensBlock = provenSlice.length > 0
    ? provenSlice
        .map((t) => `  - "${t.name}" ($${t.ticker}) | ${t.volume_sol?.toFixed(0) ?? 0} SOL volume | theme: ${t.theme || 'unknown'}`)
        .join('\n')
    : '  (none found)';
  const blacklistBlock = similar.length > 0
    ? similar.map(t => `  - "${t.name}" ($${t.ticker})`).join('\n')
    : '  (none)';

  const memeContext = await analyzeNewsMemePotential(signal);

  let memeContextBlock;
  if (memeContext) {
    memeContextBlock = `THE REAL MEME ANGLE (what CT actually cares about, not the headline):
${memeContext.meme_angle}

WHAT CT IS SAYING RIGHT NOW:
${memeContext.ct_reaction}

THE CHARACTER/MOMENT degens will latch onto:
${memeContext.key_character_or_moment}

VISUAL POTENTIAL: ${memeContext.visual_potential}

TRENDING WORDS (use these in the name/ticker if possible):
${(memeContext.trending_words || []).join(', ')}`;
  } else {
    memeContextBlock = `CT IS SILENT ON THIS TOPIC.
Reason from the most absurd or shareable fact: "${signal.what_happened || signal.absurdity_angle || signal.summary}"
What single word or moment from this story would a degen immediately understand?`;
  }

  const existingTokensBlock = `TOKENS THAT ALREADY EXIST (DO NOT COPY THESE NAMES — use their style as inspiration only):
${similarTokensBlock}

TOKENS THAT ALREADY EXIST (DO NOT REUSE ANY OF THESE NAMES):
${blacklistBlock}

TOP PERFORMING THEMES RIGHT NOW: ${topThemes.join(', ')}
TOP PERFORMING FORMATS RIGHT NOW: ${topFormats.join(', ')}`;

  const prompt = `NEWS SIGNAL: ${signal.topic}
WHAT HAPPENED: ${signal.summary}
MOST ABSURD/SHAREABLE FACT: ${signal.what_happened || signal.absurdity_angle || 'none'}

${memeContextBlock}

${existingTokensBlock}

STEP 1 — BEFORE YOU NAME ANYTHING: In one sentence, state the meme angle.
Not the news headline — the specific angle that would make a degen laugh or FOMO.

STEP 2 — CREATE THE TOKEN from that meme angle.

EXAMPLE of good vs bad:
- Signal: "Iran launches missile strike on Israel"
- BAD token: "Iran Strike" ($MISSILE) — this is a news headline, not a meme
- GOOD token: "Free Fireworks" ($BOOM) — CT's dark humor angle, funny without geopolitics context

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

  const concept = await callClaude(prompt);
  return {
    ...concept,
    flux: '1',
    source_signal: signal.topic,
    sources: signal.sources ?? null,
    source_date: signal.source_date ?? null,
    ...(proven.length > 0 && { source_similar: proven.slice(0, 3).map(t => t.ticker).join(', ') }),
  };
}

// ---------------------------------------------------------------------------
// FLUX 2 — Crypto → Crypto
// ---------------------------------------------------------------------------

async function generateVariants(movers) {
  if (!movers || movers.length === 0) return [];

  const validMovers = movers.filter(m => m.name && m.ticker);
  if (validMovers.length === 0) return [];

  // One token per call (called with single-item arrays from generateConcepts)
  const migration = validMovers[0];

  const migrationKeywords = [
    ...(migration.name || '').toLowerCase().split(/\s+/),
    (migration.ticker || '').toLowerCase(),
  ].filter(Boolean);
  const existingTokens = await searchSimilarTokens(migrationKeywords);
  const existingList = existingTokens.length > 0
    ? 'TOKENS THAT ALREADY EXIST (DO NOT REUSE ANY OF THESE NAMES):\n' +
      existingTokens.map(t => `  - "${t.name}" ($${t.ticker})`).join('\n')
    : '';

  // Structured CT narrative — replaces generic getTwitterContext
  const narrative = await analyzeTokenNarrative(migration);

  // Build the narrative block for the prompt
  let narrativeBlock;
  if (narrative) {
    narrativeBlock = `WHY IT'S PUMPING: ${narrative.why_pumping}

WHAT CT IS SAYING:
${narrative.ct_reaction}

MEME ANGLE CT IS WORKING WITH: ${narrative.meme_angle}

VIBE: ${narrative.vibe}`;
  } else {
    narrativeBlock = `CT IS SILENT ON THIS TOKEN.
Study the name "${migration.name}" and its theme (${migration.theme || 'unknown'}). Make your best guess at the underlying energy or story. What event, meme, or feeling could explain why degens are aping in? Build on THAT energy.`;
  }

  const migrationLine = `"${migration.name}" ($${migration.ticker}) | vol $${migration.volume_usd_h1 || 0}/h | +${migration.price_change_h1 || 0}% | theme: ${migration.theme || 'unknown'}`;

  const prompt = `This token is pumping HARD on pump.fun right now:

${migrationLine}

${narrativeBlock}${existingList ? '\n\n' + existingList : ''}

STEP 1 — BEFORE YOU NAME ANYTHING: In one sentence, state the real energy or story behind this pump. Not the token name — the underlying reason a degen would ape in.

STEP 2 — CREATE A NEW TOKEN that rides that same energy from a completely different angle. Do NOT riff on the token's name. Find what made it pump, then express that with something totally fresh.

CONCRETE EXAMPLE of how to think:
- Token pumping: "Hello World" — WHY: pump.fun's site showed a "Hello World" error when it went down. Degens made a token about the crash.
- Good new token: "Goodbye World" ($CRASH) — rides the site-going-down energy from the opposite angle. NOT "Hello Again" or "World Error" — different angle, same story.
- Bad new token: "Dev Error" ($RUGGED) — $RUGGED is a generic crypto term with no real connection to the story. The ticker must be as specific as the name.

RULES:
- Follow proven pump.fun patterns: Iconic Word | Absurd Mashup | Shitpost Phrase | Meme Creature.
- Description: 1 sentence, shitpost energy.
- Narrative: 1 sentence, why a degen buys this.

Before returning: Could someone who has never heard of crypto laugh at this? If no, try again.

Return JSON only:
{
  "name": string,
  "ticker": string,
  "description": string,
  "narrative": string,
  "image_prompt": string,
  "flux": "2"
}`;

  const concept = await callClaude(prompt);
  return { ...concept, flux: '2', source_migrations: migration.ticker };
}

// ---------------------------------------------------------------------------
// FLUX 3 — World → Crypto → Crypto
// ---------------------------------------------------------------------------

async function generateCrossover(signal) {
  const similar = await searchSimilarTokens(signal.keywords || []);

  if (!similar || similar.length === 0) {
    console.log(`[conceptGenerator] Flux 3: no similar tokens found for "${signal.topic}", falling back to Flux 1`);
    const concept = await generateFromSignal(signal);
    return { ...concept, flux: '3' };
  }

  const top3 = similar.slice(0, 3);

  const historicalBlock = top3
    .map((t) => `  - "${t.name}" ($${t.ticker}) | ${t.volume_sol?.toFixed(0) || 0} SOL volume | theme: ${t.theme || 'unknown'}`)
    .join('\n');

  const prompt = `Pump.fun degens have short memory and love recycled themes. A topic that pumped 3 months ago can pump again with a fresh angle. Use historical winners as inspiration, not as things to avoid.

TRENDING TOPIC: ${signal.topic}
WHAT'S HAPPENING: ${signal.summary}
ABSURDITY ANGLE: ${signal.absurdity_angle ?? 'none'}
KEYWORDS: ${(signal.keywords || []).join(', ')}

HISTORICAL WINNERS on this theme — use these as style inspiration:
${historicalBlock}

Combine the viral energy of this trending topic with the proven pump.fun formats shown above. These historical tokens prove the market loves this theme — now give degens a fresh reason to ape in again.

Return JSON only:
{
  "name": string,
  "ticker": string,
  "description": string (1 sentence, shitpost energy),
  "narrative": string (1 sentence, why degens buy this),
  "image_prompt": string (visual for pump.fun thumbnail),
  "flux": "3"
}`;

  const concept = await callClaude(prompt);
  return { ...concept, flux: '3', source_signal: signal.topic, sources: signal.sources ?? null, source_date: signal.source_date ?? null, source_similar: top3.map((t) => t.ticker).join(', ') };
}

// ---------------------------------------------------------------------------
// Concurrency helper
// ---------------------------------------------------------------------------

async function runWithConcurrency(tasks, limit) {
  const results = [];
  for (let i = 0; i < tasks.length; i += limit) {
    const batch = tasks.slice(i, i + limit);
    const settled = await Promise.allSettled(batch.map((fn) => fn()));
    for (const outcome of settled) {
      if (outcome.status === 'fulfilled') {
        results.push(outcome.value);
      } else {
        console.warn(`[conceptGenerator] Task failed: ${outcome.reason?.message}`);
      }
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Flux 3: CT trend → concept
// ---------------------------------------------------------------------------

async function generateFromCTTrend(trend) {
  if (!trend) return [];

  const movers = await getTopMovers(10);
  const similar = await searchSimilarTokens(trend.keywords || []);

  const moversBlock = movers.length > 0
    ? 'WHAT\'S PUMPING ON PUMP.FUN RIGHT NOW (market context — what degens are buying):\n' +
      movers.map(m => `  - "${m.name}" ($${m.ticker}) | $${m.volume_usd_h1?.toFixed(0) || 0}/h vol | theme: ${m.theme || 'unknown'}`).join('\n')
    : 'WHAT\'S PUMPING ON PUMP.FUN RIGHT NOW:\n  (no data yet — DexScreener refresh pending)';

  const blacklistBlock = similar.length > 0
    ? 'TOKENS THAT ALREADY EXIST ON THIS THEME (DO NOT COPY THESE NAMES):\n' +
      similar.map(t => `  - "${t.name}" ($${t.ticker})`).join('\n')
    : '';

  const prompt = `CT TREND: ${trend.trend}
WHAT CT IS SAYING: ${trend.what_ct_says}
VIBE: ${trend.vibe}
MEME POTENTIAL: ${trend.meme_potential}

${moversBlock}${blacklistBlock ? '\n\n' + blacklistBlock : ''}

STEP 1 — BEFORE YOU NAME ANYTHING: In one sentence, what is the specific hook
from this CT trend that would make a degen APE IN immediately?
Not the trend name — the exact joke, energy, or moment CT is reacting to.
Consider what's pumping right now — is there an angle that bridges the CT wave
with what the market is already buying?

STEP 2 — CREATE THE TOKEN from that hook.

EXAMPLE of good vs bad:
- CT trend: "we're so back" wave sweeping CT, full degen optimism
- BAD token: "We're So Back" ($BACK) — too literal, CT already has 10 of these
- GOOD token: "Cope Harder" ($COPE) — the ironic counter-energy CT actually memes

RULES:
- Use the EXACT slang from WHAT CT IS SAYING — degens search these exact words
- If CT has a specific joke or nickname, BUILD ON THAT, don't abstract it
- The token must be funny ON ITS OWN without knowing the CT context
Return JSON only:
{
  "name": string (max 32 chars),
  "ticker": string,
  "description": string (1 sentence, shitpost energy),
  "narrative": string (1 sentence, why degens buy this),
  "image_prompt": string (visual for pump.fun thumbnail),
  "flux": "3"
}`;

  const concept = await callClaude(prompt);
  const moverTickers = movers.length > 0 ? movers.map(m => `$${m.ticker}`).join(', ') : null;
  return concept ? { ...concept, flux: '3', source_signal: trend.trend, source_migrations: moverTickers } : null;
}

// ---------------------------------------------------------------------------
// MAIN EXPORT
// ---------------------------------------------------------------------------

async function generateConcepts(signals = [], migrations = [], ctTrends = []) {
  const tasks = [];

  const usedTopics = new Set();

  // Flux 1: up to 3 signals — deduplicate by category, skip if generated in last 6h
  const categoryCounts = {};
  const diverseSignals = signals.filter(s => {
    const cat = s.category || JSON.parse(s.reasoning || '{}').category || 'other';
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    return categoryCounts[cat] <= 2;
  });
  for (const signal of diverseSignals.slice(0, 3)) {
    if (await hasRecentConceptExtended(signal.topic)) {
      console.log(`[conceptGenerator] Flux 1: skipping "${signal.topic}" — already generated recently`);
      continue;
    }
    usedTopics.add(signal.topic);
    tasks.push(() => generateFromSignal(signal));
  }

  // Flux 2: up to 3 variants from migrations (one prompt per migration, max 3)
  // Deduplicate migrations by theme — max 1 per theme
  const seenThemes = new Set();
  const diverseMigrations = migrations.filter(m => {
    const theme = m.theme || 'unknown';
    if (seenThemes.has(theme)) return false;
    seenThemes.add(theme);
    return true;
  });
  for (const migration of diverseMigrations.slice(0, 3)) {
    if (await hasRecentConcept(migration.ticker)) {
      console.log(`[conceptGenerator] Flux 2: skipping "${migration.ticker}" — variant already generated recently`);
      continue;
    }
    tasks.push(() => generateVariants([migration]));
  }

  // Flux 3: up to 3 concepts from CT trends (Grok-sourced)
  for (const trend of ctTrends.slice(0, 3)) {
    const trendKeywords = trend.keywords?.length ? trend.keywords : [trend.trend];
    if (await hasRecentConceptByKeywords(trendKeywords)) {
      console.log(`[conceptGenerator] Flux 3: skipping "${trend.trend}" — keywords already covered recently`);
      continue;
    }
    tasks.push(() => generateFromCTTrend(trend));
  }

  const concepts = await runWithConcurrency(tasks, CONCURRENCY);

  // Flatten and filter nulls (individual generators return null on Claude failure)
  const flat = concepts.flat().filter(Boolean);

  // Save to DB
  const now = new Date().toISOString();
  for (const concept of flat) {
    try {
      await insertConcept({
        signal_id: null,
        name: concept.name,
        ticker: concept.ticker,
        description: concept.description,
        narrative: concept.narrative,
        image_prompt: concept.image_prompt,
        flux: concept.flux,
        telegram_status: 'pending',
        created_at: now,
        feedback_notes: null,
        sources: Array.isArray(concept.sources) ? JSON.stringify(concept.sources) : null,
        source_date: concept.source_date ?? null,
        source_signal: concept.source_signal ?? (concept.flux === '2' ? concept.source_migrations ?? null : null),
      });
    } catch (err) {
      console.warn(`[conceptGenerator] Failed to insert concept "${concept.name}": ${err.message}`);
    }
  }

  console.log(`[conceptGenerator] Generated and saved ${flat.length} concepts`);
  return flat;
}

export { generateFromSignal, generateVariants, generateCrossover, generateFromCTTrend };
export default generateConcepts;
