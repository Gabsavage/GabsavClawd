const POLYMARKET_URL =
  'https://gamma-api.polymarket.com/markets?active=true&limit=50&order=volume24hr&ascending=false';

// Normalise a raw volume number to a 0–10000 score given the max seen in this batch.
function normaliseVolume(volume, max) {
  if (!max || max === 0) return 0;
  return Math.round((volume / max) * 10000);
}

async function scoutPredictionMarkets() {
  const res = await fetch(POLYMARKET_URL, {
    headers: { 'User-Agent': 'OpenClawd/1.0 (meme token scout)' },
  });

  if (!res.ok) throw new Error(`Polymarket API returned ${res.status}`);

  const markets = await res.json();

  const volumes = markets.map((m) => parseFloat(m.volume24hr) || 0);
  const max = Math.max(...volumes, 1);

  return markets.map((m, i) => ({
    title: m.question,
    score: normaliseVolume(volumes[i], max),
    url: m.url || `https://polymarket.com/market/${m.id}`,
    subreddit: 'polymarket',
    created_at: new Date(),
  }));
}

export default scoutPredictionMarkets;
