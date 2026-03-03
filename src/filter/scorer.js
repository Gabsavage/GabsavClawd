const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const MIN_SCORE = 70;

function buildPrompt(signals) {
  const signalList = signals
    .map(
      (s, i) =>
        `${i + 1}. Title: "${s.title}" | Subreddit: r/${s.subreddit} | Reddit Score: ${s.score} | Posted: ${s.created_at.toISOString()}`
    )
    .join('\n');

  return `You are a meme token trend analyst. Score each signal for meme token potential (0-100).

Evaluate each signal on:
- Virality/velocity: how fast is this spreading? (Reddit score is an indicator)
- Meme potential: is it funny, visual, absurd, or satirical?
- Crypto community relevance: would crypto Twitter care about this?
- Timing: is this fresh content or already stale news?
- Emotional/satirical angle: does it have an unexpected twist?

STRICT scoring rules — apply these before anything else:
- Pure price movement signals ("Bitcoin pumped X%", "ETH up/down Y%", "coin mooned") MUST score below 40. These are financial news, not meme material.
- Liquidation or trading loss signals ("trader lost $X", "got rekt", "liquidated") MUST score below 40 UNLESS there is a clear satirical or human-interest angle that transcends the numbers.
- Scores of 70 or above are reserved for signals with genuine meme potential: absurd situations, cultural moments, unexpected character twists, or deeply relatable emotions.

Signals to score:
${signalList}

Return a JSON array with one object per signal, in the same order. Each object must have:
- index (1-based integer, matching the signal number above)
- score (integer 0-100)
- reasoning (1-2 sentence explanation of the score)
- angle (the creative twist that could make a good meme token — e.g. a ticker name or absurd concept)

Return ONLY the JSON array. No markdown, no explanation, no code fences.`;
}

async function scoreSignals(signals) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY environment variable is not set');
  if (signals.length === 0) return [];

  const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildPrompt(signals) }] }],
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

async function filterSignals(signals) {
  let scored;
  try {
    scored = await scoreSignals(signals);
  } catch (err) {
    console.warn(`[scorer] Gemini scoring failed: ${err.message}`);
    return [];
  }
  const highPotential = scored.filter((s) => s.score >= MIN_SCORE);
  return deduplicateByAngle(highPotential);
}

export { scoreSignals };
export default filterSignals;
