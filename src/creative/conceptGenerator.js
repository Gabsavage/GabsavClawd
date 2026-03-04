import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTEXT_DIR = path.join(__dirname, '..', 'context');

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
const CONCURRENCY = 1;

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
  const sourceLabel = signal.subreddit === 'polymarket' ? 'Polymarket' : `r/${signal.subreddit}`;
  return `You are a degenerate crypto trader with a dark sense of humor and a gift for meme token names. You've made and lost fortunes on $PEPE, $WIF, $BONK, $MOODENG, $BRETT, $TRUMP, $RICO, $JUDY. You know what makes a degen ape in: it's never the description — it's the NAME and TICKER. One word. Instantly funny. Immediately memeable.
${MARKET_CONTEXT_BLOCK}
You've been handed this high-potential signal:

Title: "${signal.title}"
Source: ${sourceLabel}
Score: ${signal.score}/100
Reasoning: "${signal.reasoning}"
Angle: "${signal.angle}"

Your job: create the NAME and TICKER first. Everything else follows from those.

THE GOLDEN RULE: Names and tickers must be SHORT, PUNCHY, and FUNNY. Not descriptive. Not literal. Absurdist, dark, or deeply internet-brained.

GOOD examples of the energy you're going for:
- $RICO (from RICO charges angle — sounds like a person, sounds illegal, instantly funny)
- $JUDY (from a judge angle — unexpected, human name, makes you laugh)
- $KHAMESTONKS (Khamenei + stonks — absurd mashup, self-explanatory)
- NUKE IRAN (direct, shocking, memeable — you either love it or hate it)
- JAMES 2028 (sounds like a real campaign, but it's a meme)
- $MOSSAD (one word, implies everything, says nothing)
- $PALANTIR (appropriates a serious brand for chaos)

BAD examples — do NOT do this:
- "The Strike Protocol" (sounds like a Netflix thriller, not a meme coin)
- "The Supreme Departure" (pretentious, zero laughs)
- "The Fed Chair Pump" (corporate speak, not a degen name)
- $PUMPCOIN, $VOTETOKEN, $REGIMECHANGE (generic, unfunny, immediately forgettable)

BANNED ticker words — never use these as tickers: PUMP, VOTE, CLOSE, STRIKE, REGIME, COIN, TOKEN, MOON, DEGEN, BASED, CHAD

NAMING STYLE GUIDE:
- Best: one unexpected word that captures the whole vibe ($JUDY, $RICO, $MOSSAD)
- Good: absurd mashup that makes people laugh ($KHAMESTONKS, $MOODENG)
- Good: a phrase so on-the-nose it becomes meme (NUKE IRAN, JAMES 2028)
- Avoid: anything that explains itself in the name

Tickers should feel like something a degen would ACTUALLY ape into at 2am.

Return ONLY a JSON object with exactly these fields:
{
  "name": "token name (max 25 chars, punchy, no $ prefix — use the naming guide above)",
  "ticker": "3-6 char symbol (uppercase, no $ — must feel like a degen would ape this)",
  "description": "1-2 sentence token description, dark humor welcome, no corporate speak",
  "narrative": "the satirical/emotional angle in 1 sentence — why does this exist?",
  "imagePrompt": "detailed image generation prompt for the token mascot/logo — make it weird and specific"
}

No markdown. No explanation. No code fences. Just the JSON object.`;
}

async function generateConcept(signal) {
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
        messages: [{ role: 'user', content: buildPrompt(signal) }],
      }),
    });

    if (res.ok || res.status !== 529) break;

    const body = await res.text();
    if (attempt < MAX_RETRIES) {
      console.warn(`[conceptGenerator] 529 overloaded (attempt ${attempt}/${MAX_RETRIES}), retrying in ${RETRY_DELAY_MS / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    } else {
      throw new Error(`Claude API error ${res.status}: ${body}`);
    }
  }

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

    if (i + CONCURRENCY < signals.length) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  return results;
}

export { generateConcept };
export default generateConcepts;
