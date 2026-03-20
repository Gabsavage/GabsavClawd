import db, { updateTokenDexData } from '../database/db.js';

const DEX_API = 'https://api.dexscreener.com/tokens/v1/solana';

// Scan tous les tokens pumpportal des dernières 24h qui n'ont pas été mis à jour depuis 15min
export async function refreshTokenData() {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const since15m = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  const tokens = db.prepare(
    `SELECT mint, name, ticker FROM tokens
     WHERE source = 'pumpportal' AND mint IS NOT NULL AND created_at >= ?
     AND (last_dex_update IS NULL OR last_dex_update < ?)
     ORDER BY created_at DESC`
  ).all(since24h, since15m);

  if (tokens.length === 0) {
    console.log('[DexScreener] All tokens up to date');
    return 0;
  }

  console.log(`[DexScreener] Refreshing ${tokens.length} tokens...`);
  let updated = 0;

  for (let i = 0; i < tokens.length; i += 30) {
    const batch = tokens.slice(i, i + 30);
    const addresses = batch.map(t => t.mint).join(',');

    try {
      const res = await fetch(`${DEX_API}/${addresses}`);
      if (!res.ok) {
        console.error(`[DexScreener] API error ${res.status}`);
        continue;
      }

      const pairs = await res.json();
      if (!Array.isArray(pairs)) continue;

      for (const pair of pairs) {
        const token = batch.find(t => t.mint === pair.baseToken?.address);
        if (!token) continue;

        updateTokenDexData(token.mint, {
          volumeH1: pair.volume?.h1 || 0,
          volumeH24: pair.volume?.h24 || 0,
          priceChangeH1: pair.priceChange?.h1 || 0,
          priceChangeH24: pair.priceChange?.h24 || 0,
          buysH24: pair.txns?.h24?.buys || 0,
          sellsH24: pair.txns?.h24?.sells || 0,
          priceUsd: pair.priceUsd || '0',
        });
        updated++;
      }
    } catch (err) {
      console.error('[DexScreener] Request failed:', err.message);
    }

    // Rate limit safe
    if (i + 30 < tokens.length) await new Promise(r => setTimeout(r, 500));
  }

  console.log(`[DexScreener] Updated ${updated}/${tokens.length} tokens`);
  return updated;
}

// Récupérer les top movers (tokens avec le plus de momentum)
export function getTopMovers(limit = 20) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  return db.prepare(
    `SELECT name, ticker, mint, theme, volume_usd_h1, volume_usd_h24,
            price_change_h1, price_change_h24, buys_h24, sells_h24, price_usd
     FROM tokens
     WHERE source = 'pumpportal' AND last_dex_update IS NOT NULL
     AND created_at >= ? AND volume_usd_h1 > 0
     ORDER BY volume_usd_h1 DESC
     LIMIT ?`
  ).all(since, limit);
}

// Calculer le momentum d'un token (compare les 2 derniers scans)
export function getTokenMomentum(mint) {
  const history = db.prepare(
    `SELECT volume_usd_h1, price_change_h1, recorded_at FROM token_volume_history
     WHERE mint = ? ORDER BY recorded_at DESC LIMIT 2`
  ).all(mint);

  if (history.length < 2) return 'new';

  const [latest, previous] = history;
  if (latest.volume_usd_h1 > previous.volume_usd_h1 * 1.5) return 'pumping';
  if (latest.volume_usd_h1 < previous.volume_usd_h1 * 0.5) return 'dumping';
  return 'stable';
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  console.log('[DexScreener] Running full scan...');
  const updated = await refreshTokenData();
  console.log(`\n[DexScreener] Top movers:`);
  const movers = getTopMovers(10);
  for (const m of movers) {
    const momentum = getTokenMomentum(m.mint);
    console.log(`  ${m.name} ($${m.ticker}) | vol $${m.volume_usd_h1}/h | ${m.price_change_h1 > 0 ? '+' : ''}${m.price_change_h1}% | ${momentum}`);
  }
}
