const POLYMARKET_URL =
  'https://gamma-api.polymarket.com/markets?active=true&limit=50&order=volume24hr&ascending=false';

// Normalise a raw volume number to a 0–10000 score given the max seen in this batch.
function normaliseVolume(volume, max) {
  if (!max || max === 0) return 0;
  return Math.round((volume / max) * 10000);
}

// ---------------------------------------------------------------------------
// Topic deduplication — group similar markets, keep highest-volume per cluster
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

// Group markets with similar titles (e.g. multiple 2028 election candidates),
// keep only the highest-volume representative per cluster.
const TOPIC_SIMILARITY_THRESHOLD = 0.3;

function deduplicateByTopic(markets) {
  // Already sorted highest-volume first; first representative of each cluster wins
  const kept = [];
  for (const market of markets) {
    const isDupe = kept.some(
      (k) => jaccardSimilarity(k.title, market.title) >= TOPIC_SIMILARITY_THRESHOLD
    );
    if (!isDupe) kept.push(market);
  }
  return kept;
}

// ---------------------------------------------------------------------------

async function scoutPredictionMarkets() {
  const res = await fetch(POLYMARKET_URL, {
    headers: { 'User-Agent': 'OpenClawd/1.0 (meme token scout)' },
  });

  if (!res.ok) throw new Error(`Polymarket API returned ${res.status}`);

  const markets = await res.json();

  const volumes = markets.map((m) => parseFloat(m.volume24hr) || 0);
  const max = Math.max(...volumes, 1);

  const signals = markets.map((m, i) => ({
    title: m.question,
    score: normaliseVolume(volumes[i], max),
    url: m.url || `https://polymarket.com/market/${m.id}`,
    subreddit: 'polymarket',
    created_at: new Date(),
  }));

  return deduplicateByTopic(signals);
}

export default scoutPredictionMarkets;
