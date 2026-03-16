import { getTopThemes, getTopFormats, searchSimilarTokens, insertConcept, hasRecentConcept } from '../database/db.js';
import { getRecentTokens } from '../scout/webSocketScout.js';
import { getTwitterContext } from '../scout/grokScout.js';

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
- Ticker: 3-5 characters, must feel like something you'd see trending on DEXScreener
- GOOD tickers: $PUNCH, $RICO, $JUDY, $NUKE, $BRON, $MOSSAD
- BAD tickers: $STRIKE, $REGIME, $SUPREME, $PUMP, $COIN, $TOKEN — these are generic and boring
- The ticker should make someone smirk when they read it
- NEVER include the $ symbol in the ticker field — return only the letters (e.g. "NUKE" not "$NUKE")

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
- The ticker must be a REAL word or recognizable name, not an abbreviation
- GOOD: $HORMUZ, $VODKA, $BOOM, $SINK, $CHAD, $BARRON, $MULLER
- BAD: $FHOUR, $CRISPY, $HOUR1, $WSCN, $FCH — nobody knows what these mean
- If in doubt, use the most memorable single word from the story

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

  const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const concept = JSON.parse(clean);
  if (concept.ticker) concept.ticker = concept.ticker.replace(/^\$/, '');
  return concept;
}

// ---------------------------------------------------------------------------
// FLUX 1 — World → Crypto
// ---------------------------------------------------------------------------

async function generateFromSignal(signal) {
  const themes = getTopThemes(5);
  const formats = getTopFormats(5);
  const similar = searchSimilarTokens(signal.keywords || []);
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

  const twitterContext = await getTwitterContext(signal.topic || signal.title);

  const prompt = `TRENDING TOPIC: ${signal.topic}
WHAT'S HAPPENING: ${signal.summary}
WHAT MAKES IT SHAREABLE: ${signal.absurdity_angle ?? signal.what_happened ?? 'none'}
HOW BIG: ${signal.spread ?? 'unknown'} coverage, ${signal.velocity ?? 'unknown'} velocity
KEYWORDS: ${(signal.keywords || []).join(', ')}

TOKENS THAT ALREADY EXIST (DO NOT COPY THESE NAMES — use their style as inspiration only):
${similarTokensBlock}

TOKENS THAT ALREADY EXIST (DO NOT REUSE ANY OF THESE NAMES):
${blacklistBlock}

TOP PERFORMING THEMES RIGHT NOW: ${topThemes.join(', ')}
TOP PERFORMING FORMATS RIGHT NOW: ${topFormats.join(', ')}
${twitterContext ? `\nWHAT CRYPTO TWITTER IS SAYING RIGHT NOW:\n${twitterContext}\n\nUse this CT context to match the ACTUAL language and angles degens are using. If CT has a specific meme or nickname for this topic, USE IT.` : ''}
Study the naming style of existing tokens above, then create something COMPLETELY NEW for this trending topic.

Return JSON only:
{
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

async function generateVariants(migrations) {
  if (!migrations || migrations.length === 0) return [];

  const migrationList = migrations
    .map((t) => `  - "${t.name}" ($${t.ticker}) | theme: ${t.theme || 'unknown'} | format: ${t.format || 'unknown'}`)
    .join('\n');

  const migrationKeywords = migrations.flatMap(m => {
    const name = (m.name || '').toLowerCase().split(/\s+/);
    const ticker = (m.ticker || '').toLowerCase();
    return [...name, ticker].filter(Boolean);
  });
  const existingTokens = searchSimilarTokens(migrationKeywords);
  const existingList = existingTokens.length > 0
    ? '\n\nTOKENS THAT ALREADY EXIST (DO NOT REUSE ANY OF THESE NAMES):\n' +
      existingTokens.map(t => `  - "${t.name}" ($${t.ticker})`).join('\n')
    : '';

  const migrationQuery = migrations.map(m => m.name || m.ticker).join(' OR ');
  const twitterContext = await getTwitterContext(migrationQuery);

  const prompt = `This token just successfully migrated on pump.fun (hit 69 SOL threshold):

${migrationList}${twitterContext ? `\n\nWHAT CRYPTO TWITTER IS SAYING RIGHT NOW:\n${twitterContext}\n\nUse this CT context. If CT already has memes or slang about this, lean into it instead of inventing from scratch.` : ''}${existingList}

RULES:
- Do NOT reuse or remix the token's name. Create something COMPLETELY DIFFERENT.
- Find what ENERGY or THEME made it pump, then express that energy with a totally new angle.
- Example: if "psyopcat" migrated, the energy is "conspiracy + animal". A good variant: "Tinfoil Hamster" ($TINFOIL), NOT "Counter Psyop" or "Psyop Dog".
- Follow these proven pump.fun naming patterns:
  1. ICONIC WORD — one killer word that captures everything (ex: "Hormuz", "Geppetto")
  2. ABSURD MASHUP — two concepts that shouldn't go together (ex: "Helicopter Dog", "Trump Vodka")
  3. SHITPOST PHRASE — sounds like a drunk tweet (ex: "ah shit here we go again")
  4. MEME CREATURE — theme + animal/character (ex: "NATO's Dog", "snow pepe")
- Ticker must be a REAL word, never an abbreviation. Must be immediately obvious what it means.
- Description: one sentence, shitpost energy, sounds like a drunk tweet not a CNN headline.

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
  return { ...concept, flux: '2', source_migrations: migrations.map((t) => t.ticker).join(', ') };
}

// ---------------------------------------------------------------------------
// FLUX 3 — World → Crypto → Crypto
// ---------------------------------------------------------------------------

async function generateCrossover(signal) {
  const similar = searchSimilarTokens(signal.keywords || []);

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
// MAIN EXPORT
// ---------------------------------------------------------------------------

async function generateConcepts(signals = [], migrations = []) {
  const tasks = [];

  const usedTopics = new Set();

  // Flux 1: up to 3 signals (skip if concept for same topic generated in last 2h)
  for (const signal of signals.slice(0, 3)) {
    if (hasRecentConcept(signal.topic)) {
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
    if (hasRecentConcept(migration.ticker)) {
      console.log(`[conceptGenerator] Flux 2: skipping "${migration.ticker}" — variant already generated recently`);
      continue;
    }
    tasks.push(() => generateVariants([migration]));
  }

  // Flux 3: up to 2 signals that have high-volume historical matches (proven theme appetite)
  let flux3Count = 0;
  for (const signal of signals) {
    if (flux3Count >= 2) break;
    if (usedTopics.has(signal.topic) || hasRecentConcept(signal.topic)) continue;
    const similar = searchSimilarTokens(signal.keywords || []);
    const hasProven = similar && similar.some(t => (t.volume_sol ?? 0) > 500);
    if (hasProven) {
      usedTopics.add(signal.topic);
      tasks.push(() => generateCrossover(signal));
      flux3Count++;
    }
  }

  const concepts = await runWithConcurrency(tasks, CONCURRENCY);

  // Flatten (generateVariants returns a single object now, not an array)
  const flat = concepts.flat();

  // Save to DB
  const now = new Date().toISOString();
  for (const concept of flat) {
    try {
      insertConcept({
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

export { generateFromSignal, generateVariants, generateCrossover };
export default generateConcepts;
