const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
const CONCURRENCY = 3;

function buildPrompt(signal) {
  return `You are a crypto degen who lives on CT (Crypto Twitter) and has a gift for turning internet moments into viral meme tokens. You've studied every successful meme coin — $DOGE, $PEPE, $WIF, $BONK, $BRETT, $MOODENG, $SendBarron — and you understand exactly what makes them resonate: they're simple, emotional, immediately understandable, and tap into a shared cultural moment.

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
- $SendBarron style: simple, emotional, immediately understandable
- The imagePrompt should be vivid, specific, and weird enough to go viral

Return ONLY a JSON object with exactly these fields:
{
  "name": "token name (max 20 chars, punchy, no $ prefix)",
  "ticker": "3-5 char symbol (uppercase, no $)",
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
