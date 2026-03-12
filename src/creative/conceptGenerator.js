import { getTopThemes, getTopFormats, searchSimilarTokens, insertConcept } from '../database/db.js';
import { getRecentTokens } from '../scout/webSocketScout.js';

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
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
- Think: what would look good as a 200x200 circle on DEXScreener?`;

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
  return JSON.parse(clean);
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

  const similarTokensBlock = proven.length > 0
    ? proven
        .slice(0, 3)
        .map((t) => `  - "${t.name}" ($${t.ticker}) | ${t.volume_sol?.toFixed(0)} SOL volume | theme: ${t.theme || 'unknown'}`)
        .join('\n')
    : similar
        .slice(0, 3)
        .map((t) => `  - "${t.name}" ($${t.ticker}) | theme: ${t.theme || 'unknown'}`)
        .join('\n');

  const prompt = `TRENDING TOPIC: ${signal.topic}
WHAT'S HAPPENING: ${signal.summary}
ABSURDITY ANGLE: ${signal.absurdity_angle ?? 'none'}
HOW BIG: ${signal.spread ?? 'unknown'} coverage, ${signal.velocity ?? 'unknown'} velocity
KEYWORDS: ${(signal.keywords || []).join(', ')}

SIMILAR TOKENS THAT PERFORMED WELL ON PUMP.FUN:
${similarTokensBlock || '  (none found)'}

TOP PERFORMING THEMES RIGHT NOW: ${topThemes.join(', ')}
TOP PERFORMING FORMATS RIGHT NOW: ${topFormats.join(', ')}

Using the successful tokens above as style inspiration, create a token concept for this trending topic.

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

  const prompt = `These tokens just successfully migrated on pump.fun — they are proven winners:

RECENTLY MIGRATED TOKENS:
${migrationList}

Your goal: create a fresh variant or remix of the energy that made these pump. Don't copy — evolve. Find the pattern and push it further or flip it sideways.

Return JSON only:
{
  "name": string,
  "ticker": string,
  "description": string (1 sentence, shitpost energy),
  "narrative": string (1 sentence, why degens buy this),
  "image_prompt": string (visual for pump.fun thumbnail),
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
  return { ...concept, flux: '3', source_signal: signal.topic, source_similar: top3.map((t) => t.ticker).join(', ') };
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

  // Flux 1: up to 3 signals
  for (const signal of signals.slice(0, 3)) {
    tasks.push(() => generateFromSignal(signal));
  }

  // Flux 2: up to 3 variants from migrations (one prompt per migration, max 3)
  for (const migration of migrations.slice(0, 3)) {
    tasks.push(() => generateVariants([migration]));
  }

  // Flux 3: up to 2 signals that have high-volume historical matches (proven theme appetite)
  let flux3Count = 0;
  for (const signal of signals) {
    if (flux3Count >= 2) break;
    const similar = searchSimilarTokens(signal.keywords || []);
    const hasProven = similar && similar.some(t => (t.volume_sol ?? 0) > 500);
    if (hasProven) {
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
