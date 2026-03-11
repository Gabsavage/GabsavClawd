import { getTopThemes, getTopFormats, searchSimilarTokens, insertConcept } from '../database/db.js';
import { getRecentTokens } from '../scout/webSocketScout.js';

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
const CONCURRENCY = 3;

// ---------------------------------------------------------------------------
// Shared rules appended to every prompt
// ---------------------------------------------------------------------------

const CRITICAL_RULES = `
CRITICAL RULES FOR TOKEN CONCEPTS:
- Name: short, punchy, FUNNY — maximum 4 words, ideally 1-2
- Ticker: 3-5 chars, degen energy, never generic words (no VOTE, STRIKE, REGIME, PUMP, COIN)
- Tone: absurdist, dark humor, internet culture — never serious or corporate
- GOOD examples: $PUNCH, $RICO, $JUDY, $KHAMESTONKS, $MOSSAD, $BRON, $NUKE
- BAD examples: 'The Strike Protocol $STRIKE', 'The Fed Chair Pump $FDRUMP', 'The Supreme Departure $SUPREME'
- Think: what would a Solana degen actually ape into at 2am?

Return JSON only:
{
  "name": string,
  "ticker": string,
  "description": string (max 2 sentences, punchy),
  "narrative": string (max 2 sentences, why it will pump),
  "image_prompt": string (visual description for image generation),
  "flux": "1" | "2" | "3"
}`;

// ---------------------------------------------------------------------------
// Claude API call with retry on 529
// ---------------------------------------------------------------------------

async function callClaude(prompt) {
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
        messages: [{ role: 'user', content: prompt }],
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

  const themesBlock = themes.map((t) => `  - ${t.theme} (${t.count} tokens)`).join('\n');
  const formatsBlock = formats.map((f) => `  - ${f.format} (${f.count} tokens)`).join('\n');

  const prompt = `You are a degenerate Solana trader who invents meme coins. A viral news topic just broke — be FIRST to tokenize it before anyone else.

TRENDING TOPIC: ${signal.topic}
SUMMARY: ${signal.summary}
MEME POTENTIAL: ${signal.meme_potential}/10
KEYWORDS: ${(signal.keywords || []).join(', ')}
CATEGORY: ${signal.category}

TOP PERFORMING THEMES on pump.fun right now:
${themesBlock}

TOP PERFORMING FORMATS on pump.fun right now:
${formatsBlock}

Your goal: create a token concept that hasn't been done yet. This topic is fresh — own it.
${CRITICAL_RULES}`;

  const concept = await callClaude(prompt);
  return { ...concept, flux: '1', source_signal: signal.topic };
}

// ---------------------------------------------------------------------------
// FLUX 2 — Crypto → Crypto
// ---------------------------------------------------------------------------

async function generateVariants(migrations) {
  if (!migrations || migrations.length === 0) return [];

  const migrationList = migrations
    .map((t) => `  - "${t.name}" ($${t.ticker}) | theme: ${t.theme || 'unknown'} | format: ${t.format || 'unknown'}`)
    .join('\n');

  const prompt = `You are a degenerate Solana trader studying what just pumped and migrated. These tokens just successfully migrated on pump.fun — they are proven winners:

RECENTLY MIGRATED TOKENS:
${migrationList}

Your goal: create a fresh variant or remix of the energy that made these pump. Don't copy — evolve. Find the pattern and push it further or flip it sideways.
${CRITICAL_RULES}`;

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

  const historicalBlock = similar
    .slice(0, 5)
    .map((t) => `  - "${t.name}" ($${t.ticker}) | ${t.volume_sol?.toFixed(0) || 0} SOL volume | theme: ${t.theme || 'unknown'}`)
    .join('\n');

  const prompt = `You are a degenerate Solana trader who combines viral news with proven pump.fun formats.

TRENDING TOPIC: ${signal.topic}
SUMMARY: ${signal.summary}
KEYWORDS: ${(signal.keywords || []).join(', ')}

SIMILAR TOKENS THAT PERFORMED WELL HISTORICALLY:
${historicalBlock}

Your goal: combine the viral energy of this trending topic with the proven pump.fun formats shown above. Take what worked before and inject it with today's news.
${CRITICAL_RULES}`;

  const concept = await callClaude(prompt);
  return { ...concept, flux: '3', source_signal: signal.topic, source_similar: similar.slice(0, 5).map((t) => t.ticker).join(', ') };
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

  // Flux 3: up to 2 signals with DB matches
  let flux3Count = 0;
  for (const signal of signals) {
    if (flux3Count >= 2) break;
    const similar = searchSimilarTokens(signal.keywords || []);
    if (similar && similar.length > 0) {
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
