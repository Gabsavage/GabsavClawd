import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTEXT_DIR = path.join(__dirname, '..', 'context');

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
const CONCURRENCY = 3;

// ---------------------------------------------------------------------------
// Load pump.fun market context once at module init
// ---------------------------------------------------------------------------

function loadContext() {
  try {
    const themes = JSON.parse(readFileSync(path.join(CONTEXT_DIR, 'top_themes.json'), 'utf-8'));
    const examples = JSON.parse(readFileSync(path.join(CONTEXT_DIR, 'top_examples.json'), 'utf-8'));
    const patterns = JSON.parse(readFileSync(path.join(CONTEXT_DIR, 'top_patterns.json'), 'utf-8'));
    return { themes, examples, patterns };
  } catch {
    return null;
  }
}

const MARKET_CONTEXT = loadContext();

function buildMarketContext() {
  if (!MARKET_CONTEXT) return '';

  const { themes, examples, patterns } = MARKET_CONTEXT;

  // Top 5 themes by avg volume
  const topThemes = themes.themes
    .slice(0, 5)
    .map((t) => `  - ${t.label} (avg ${t.avg_volume_sol.toFixed(0)} SOL/token): e.g. ${t.top_examples.slice(0, 2).map((e) => `"${e.name}" ($${e.ticker})`).join(', ')}`)
    .join('\n');

  // Top 10 all-time tokens
  const topTokens = examples
    .slice(0, 10)
    .map((e) => `  - "${e.name}" ($${e.ticker}) — ${e.total_volume_sol.toFixed(0)} SOL`)
    .join('\n');

  // Key naming patterns
  const bestNameWords = patterns.common_name_words.data
    .sort((a, b) => b.avg_volume_sol - a.avg_volume_sol)
    .slice(0, 8)
    .map((w) => w.word)
    .join(', ');

  return `
REAL PUMP.FUN MARKET DATA (use this to calibrate your concept):

Top themes by trading volume:
${topThemes}

All-time highest volume tokens:
${topTokens}

High-performing name keywords: ${bestNameWords}

Pattern insights:
- Names 6-20 chars perform best; multi-word names are common and work well
- Tickers: 3-6 chars, ALL_CAPS or TitleCase dominate
- "The ___" prefix is most common (190 tokens); works for gravitas
- Unexpected adjective+noun combos ("Goth Girl Spit", "Garlic Model") outperform generic names
`;
}

const MARKET_CONTEXT_BLOCK = buildMarketContext();

function buildPrompt(signal) {
  return `You are a crypto degen who lives on CT (Crypto Twitter) and has a gift for turning internet moments into viral meme tokens. You've studied every successful meme coin — $DOGE, $PEPE, $WIF, $BONK, $BRETT, $MOODENG, $SendBarron — and you understand exactly what makes them resonate: they're simple, emotional, immediately understandable, and tap into a shared cultural moment.
${MARKET_CONTEXT_BLOCK}
You've been handed this high-potential signal:

Title: "${signal.title}"
Subreddit: r/${signal.subreddit}
Reddit Score: ${signal.redditScore}
AI Score: ${signal.score}/100
Reasoning: "${signal.reasoning}"
Angle: "${signal.angle}"

Your job: create a meme token concept that captures the satirical/emotional core of this signal.

Rules:
- Think like a degen, not a marketer
- Be satirical, unexpected, and timely — not generic
- The name must feel inevitable in hindsight, like it couldn't be anything else
- Study the "angle" field hard — that's your creative seed
- Use the market data above to pick a theme and naming style that actually sells
- The imagePrompt should be vivid, specific, and weird enough to go viral

Return ONLY a JSON object with exactly these fields:
{
  "name": "token name (max 25 chars, punchy, no $ prefix)",
  "ticker": "3-6 char symbol (uppercase, no $)",
  "description": "1-2 sentence token description, humorous and on-point",
  "narrative": "the satirical/emotional angle in 1 sentence",
  "imagePrompt": "detailed image generation prompt for the token mascot/logo"
}

No markdown. No explanation. No code fences. Just the JSON object.`;
}

async function generateConcept(signal) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY environment variable is not set');

  const res = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 512,
      messages: [{ role: 'user', content: buildPrompt(signal) }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude API error ${res.status}: ${body}`);
  }

  const json = await res.json();
  const text = json.content?.[0]?.text;
  if (!text) throw new Error('Claude returned no content');

  const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/,'').trim();
  const concept = JSON.parse(clean);

  return { ...signal, ...concept };
}

async function generateConcepts(signals) {
  const results = [];

  for (let i = 0; i < signals.length; i += CONCURRENCY) {
    const batch = signals.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(batch.map(generateConcept));

    for (const outcome of settled) {
      if (outcome.status === 'fulfilled') {
        results.push(outcome.value);
      } else {
        console.warn(`[conceptGenerator] Skipping signal: ${outcome.reason.message}`);
      }
    }
  }

  return results;
}

export { generateConcept };
export default generateConcepts;
