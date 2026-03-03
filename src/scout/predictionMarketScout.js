const POLYMARKET_URL =
  'https://gamma-api.polymarket.com/markets?active=true&limit=50&order=volume24hr&ascending=false';

const KALSHI_URL =
  'https://trading-api.kalshi.com/trade-api/v2/markets?limit=50&status=open';

// Normalise a raw volume number to a 0–10000 score given the max seen in this batch.
function normaliseVolume(volume, max) {
  if (!max || max === 0) return 0;
  return Math.round((volume / max) * 10000);
}

async function fetchPolymarketSignals() {
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

async function fetchKalshiSignals() {
  const res = await fetch(KALSHI_URL, {
    headers: { 'User-Agent': 'OpenClawd/1.0 (meme token scout)' },
  });

  if (!res.ok) throw new Error(`Kalshi API returned ${res.status}`);

  const json = await res.json();
  const markets = json.markets ?? [];

  const volumes = markets.map((m) => m.volume ?? 0);
  const max = Math.max(...volumes, 1);

  return markets.map((m, i) => ({
    title: m.title,
    score: normaliseVolume(volumes[i], max),
    url: `https://kalshi.com/markets/${m.ticker_name ?? m.ticker ?? m.id}`,
    subreddit: 'kalshi',
    created_at: new Date(),
  }));
}

async function scoutPredictionMarkets() {
  const [polySignals, kalshiSignals] = await Promise.all([
    fetchPolymarketSignals().catch((err) => {
      console.warn(`[predictionMarketScout] Polymarket failed: ${err.message}`);
      return [];
    }),
    fetchKalshiSignals().catch((err) => {
      console.warn(`[predictionMarketScout] Kalshi failed: ${err.message}`);
      return [];
    }),
  ]);

  return [...polySignals, ...kalshiSignals].sort((a, b) => b.score - a.score);
}

export default scoutPredictionMarkets;
