const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

export let minScore = 70;

export function setMinScore(n) {
  minScore = n;
}

function formatSignalLine(s, i) {
  if (s.subreddit === 'polymarket') {
    return `${i + 1}. Title: "${s.title}" | Source: Polymarket (prediction market) | Volume Score: ${s.score} | Posted: ${s.created_at.toISOString()}`;
  }
  return `${i + 1}. Title: "${s.title}" | Subreddit: r/${s.subreddit} | Reddit Score: ${s.score} | Posted: ${s.created_at.toISOString()}`;
}

function buildPrompt(signals, trendsContext) {
  const signalList = signals.map(formatSignalLine).join('\n');

  const trendsBlock = trendsContext && trendsContext.length > 0
    ? `\nCURRENT GLOBAL TRENDING TOPICS (context only — use this to understand what the world is talking about right now, do NOT score these as signals):\n${trendsContext.slice(0, 10).map((t, i) => `  ${i + 1}. ${t}`).join('\n')}\n`
    : '';

  return `You are a meme token trend analyst. Score each signal for meme token potential (0-100).

BE STRICT. Most signals are mediocre. A score above 85 requires truly exceptional viral potential — something that has never been done, a perfect cultural storm, or a moment that will be talked about for weeks. Most signals should score between 50-75. Only 1 in 20 signals deserves 80+. Scores of 90-100 should be extremely rare — reserved for once-in-a-cycle moments.
${trendsBlock}
Evaluate each signal on:
- Virality/velocity: how fast is this spreading? (Reddit score is an indicator)
- Meme potential: is it funny, visual, absurd, or satirical?
- Crypto community relevance: would crypto Twitter care about this?
- Timing: is this fresh content or already stale news?
- Emotional/satirical angle: does it have an unexpected twist?

STRICT scoring rules — apply these before anything else:
- Pure price movement signals ("Bitcoin pumped X%", "ETH up/down Y%", "coin mooned") MUST score below 40. These are financial news, not meme material.
- Liquidation or trading loss signals ("trader lost $X", "got rekt", "liquidated") MUST score below 40 UNLESS there is a clear satirical or human-interest angle that transcends the numbers.
- Generic political/election markets with no humor or cultural twist score 40-55 at most.
- Scores of 70+ require genuine meme potential: absurd situations, cultural moments, unexpected character twists, or deeply relatable emotions.
- Scores of 80+ require the signal to be actively spreading AND have a clear, irresistible meme hook that CT would immediately ape into.
- Scores of 85+ require all of the above PLUS perfect timing and mass cross-cultural appeal.

SOURCE BOOST rules — apply these on top of your base score:
- If the source is "Polymarket" and the title involves a genuinely funny, absurd, or culturally explosive event: add +10 to the base score. Real money is being bet — that signals strong public interest.
- Boosted scores still cannot exceed the strict rules above.

Signals to score:
${signalList}

Return a JSON array with one object per signal, in the same order. Each object must have:
- index (1-based integer, matching the signal number above)
- score (integer 0-100)
- reasoning (1-2 sentence explanation of the score)
- angle (the creative twist that could make a good meme token — e.g. a ticker name or absurd concept)

Return ONLY the JSON array. No markdown, no explanation, no code fences.`;
}

async function scoreSignals(signals, trendsContext) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY environment variable is not set');
  if (signals.length === 0) return [];

  const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildPrompt(signals, trendsContext) }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.4,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${body}`);
  }

  const json = await res.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no content');

  const scores = JSON.parse(text);

  return signals.map((signal, i) => {
    const result = scores.find((s) => s.index === i + 1) ?? {};
    const { score: redditScore, ...rest } = signal;
    return {
      ...rest,
      redditScore,
      score: result.score ?? 0,
      reasoning: result.reasoning ?? '',
      angle: result.angle ?? '',
    };
  });
}

// ---------------------------------------------------------------------------
// Deduplication — drop lower-scoring signals with similar angles
// ---------------------------------------------------------------------------

function tokenize(text) {
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean)
  );
}

function jaccardSimilarity(a, b) {
  const setA = tokenize(a);
  const setB = tokenize(b);
  const intersection = [...setA].filter((w) => setB.has(w)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

const SIMILARITY_THRESHOLD = 0.4;

function deduplicateByAngle(signals) {
  // Sort highest score first so the best version of each theme is always kept
  const sorted = [...signals].sort((a, b) => b.score - a.score);
  const kept = [];
  for (const signal of sorted) {
    const isDupe = kept.some(
      (k) => jaccardSimilarity(k.angle, signal.angle) >= SIMILARITY_THRESHOLD
    );
    if (!isDupe) kept.push(signal);
  }
  return kept;
}

// ---------------------------------------------------------------------------

async function filterSignals(signals, trendsContext) {
  let scored;
  try {
    scored = await scoreSignals(signals, trendsContext);
  } catch (err) {
    console.warn(`[scorer] Gemini scoring failed: ${err.message}`);
    return [];
  }
  const highPotential = scored.filter((s) => s.score >= minScore);
  return deduplicateByAngle(highPotential);
}

export { scoreSignals };
export default filterSignals;
