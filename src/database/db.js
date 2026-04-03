import { createClient } from '@libsql/client';

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export async function initDb() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      source TEXT,
      score REAL,
      reasoning TEXT,
      momentum TEXT,
      why_it_pumps TEXT,
      sources TEXT,
      created_at TEXT,
      used INTEGER DEFAULT 0,
      signal_strength INTEGER,
      spread TEXT,
      velocity TEXT,
      shelf_life TEXT,
      absurdity_angle TEXT,
      source_date TEXT
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS concepts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      signal_id INTEGER,
      name TEXT,
      ticker TEXT,
      description TEXT,
      narrative TEXT,
      image_prompt TEXT,
      flux TEXT,
      telegram_status TEXT DEFAULT 'pending',
      created_at TEXT,
      feedback_notes TEXT,
      sources TEXT,
      source_date TEXT,
      source_signal TEXT
    )
  `);
}

// --- Tokens ---

export async function insertToken(token) {
  await db.execute({
    sql: `INSERT OR IGNORE INTO tokens
      (name, ticker, description, created_at, migrated_at, volume_sol, trade_count,
       theme, format, keywords, migrated, source, raw_data, mint)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      token.name, token.ticker, token.description, token.created_at,
      token.migrated_at, token.volume_sol, token.trade_count,
      token.theme, token.format, token.keywords, token.migrated,
      token.source, token.raw_data, token.mint,
    ],
  });
}

export async function updateTokenVolume(ticker, volume_sol, trade_count) {
  await db.execute({
    sql: `UPDATE tokens SET volume_sol = ?, trade_count = ? WHERE ticker = ?`,
    args: [volume_sol, trade_count, ticker],
  });
}

export async function updateTokenDexData(mint, data) {
  await db.execute({
    sql: `UPDATE tokens SET
      volume_usd_h1 = ?, volume_usd_h24 = ?,
      price_change_h1 = ?, price_change_h24 = ?,
      buys_h24 = ?, sells_h24 = ?,
      price_usd = ?, last_dex_update = ?
    WHERE mint = ?`,
    args: [
      data.volumeH1, data.volumeH24,
      data.priceChangeH1, data.priceChangeH24,
      data.buysH24, data.sellsH24,
      data.priceUsd, new Date().toISOString(),
      mint,
    ],
  });

  await db.execute({
    sql: `INSERT INTO token_volume_history (mint, volume_usd_h1, price_change_h1, price_usd, recorded_at)
      VALUES (?, ?, ?, ?, ?)`,
    args: [mint, data.volumeH1, data.priceChangeH1, data.priceUsd, new Date().toISOString()],
  });
}

export async function getTopThemes(limit = 10) {
  const result = await db.execute({
    sql: `SELECT theme, COUNT(*) as count, SUM(volume_sol) as total_volume
      FROM tokens
      WHERE theme IS NOT NULL
      GROUP BY theme
      ORDER BY total_volume DESC
      LIMIT ?`,
    args: [limit],
  });
  return result.rows;
}

export async function getTopFormats(limit = 10) {
  const result = await db.execute({
    sql: `SELECT format, COUNT(*) as count, SUM(volume_sol) as total_volume
      FROM tokens
      WHERE format IS NOT NULL
      GROUP BY format
      ORDER BY total_volume DESC
      LIMIT ?`,
    args: [limit],
  });
  return result.rows;
}

export async function getRecentMigrations(hours = 24) {
  const result = await db.execute({
    sql: `SELECT * FROM tokens
      WHERE migrated = 1
        AND migrated_at > datetime('now', '-' || ? || ' hours')
      ORDER BY migrated_at DESC`,
    args: [hours],
  });
  return result.rows;
}

export async function getTokensByTheme(theme, limit = 20) {
  const result = await db.execute({
    sql: `SELECT * FROM tokens WHERE theme = ? ORDER BY volume_sol DESC LIMIT ?`,
    args: [theme, limit],
  });
  return result.rows;
}

export async function searchSimilarTokens(keywords) {
  if (!keywords || keywords.length === 0) return [];
  const conditions = keywords.map(() => '(name LIKE ? OR description LIKE ?)').join(' OR ');
  const args = keywords.flatMap(kw => [`%${kw}%`, `%${kw}%`]);
  const result = await db.execute({
    sql: `SELECT * FROM tokens WHERE ${conditions} ORDER BY volume_sol DESC LIMIT 10`,
    args,
  });
  return result.rows;
}

export async function hasRecentConcept(topic) {
  const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const result = await db.execute({
    sql: `SELECT 1 FROM concepts WHERE source_signal = ? AND created_at >= ? LIMIT 1`,
    args: [topic, since],
  });
  return result.rows.length > 0;
}

export async function hasRecentConceptExtended(topic, hours = 6) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const result = await db.execute({
    sql: `SELECT id FROM concepts WHERE source_signal = ? AND created_at >= ?`,
    args: [topic, since],
  });
  return result.rows.length > 0;
}

export async function hasRecentConceptByKeywords(keywords, hours = 6) {
  if (!keywords || keywords.length === 0) return false;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const conditions = keywords.map(() => 'LOWER(source_signal) LIKE ?').join(' OR ');
  const args = [...keywords.map(k => `%${k.toLowerCase()}%`), since];
  const result = await db.execute({
    sql: `SELECT id FROM concepts WHERE (${conditions}) AND created_at >= ? LIMIT 1`,
    args,
  });
  return result.rows.length > 0;
}

// --- Signals ---

export async function insertSignal(signal) {
  const result = await db.execute({
    sql: `INSERT INTO signals
      (title, source, score, reasoning, momentum, why_it_pumps, sources, created_at, used,
       signal_strength, spread, velocity, shelf_life, absurdity_angle, source_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      signal.title, signal.source, signal.score, signal.reasoning,
      signal.momentum, signal.why_it_pumps, signal.sources, signal.created_at,
      signal.used, signal.signal_strength, signal.spread, signal.velocity,
      signal.shelf_life, signal.absurdity_angle, signal.source_date,
    ],
  });
  return result.lastInsertRowid;
}

// --- Concepts ---

export async function insertConcept(concept) {
  const result = await db.execute({
    sql: `INSERT INTO concepts
      (signal_id, name, ticker, description, narrative, image_prompt,
       flux, telegram_status, created_at, feedback_notes, sources, source_date, source_signal)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      concept.signal_id, concept.name, concept.ticker,
      concept.description, concept.narrative, concept.image_prompt,
      concept.flux, concept.telegram_status, concept.created_at,
      concept.feedback_notes, concept.sources, concept.source_date,
      concept.source_signal,
    ],
  });
  return result.lastInsertRowid;
}

export async function updateConceptStatus(id, status, feedback_notes) {
  await db.execute({
    sql: `UPDATE concepts SET telegram_status = ?, feedback_notes = ? WHERE id = ?`,
    args: [status, feedback_notes, id],
  });
}

export async function getTopMovers(limit = 20) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { rows } = await db.execute({
    sql: `SELECT name, ticker, mint, theme, volume_usd_h1, volume_usd_h24,
            price_change_h1, price_change_h24, buys_h24, sells_h24, price_usd
     FROM tokens
     WHERE source = 'pumpportal' AND last_dex_update IS NOT NULL
     AND created_at >= ? AND volume_usd_h1 > 0
     ORDER BY volume_usd_h1 DESC
     LIMIT ?`,
    args: [since, limit],
  });
  return rows;
}

export async function getTokenMomentum(mint) {
  const { rows: history } = await db.execute({
    sql: `SELECT volume_usd_h1, price_change_h1, recorded_at FROM token_volume_history
     WHERE mint = ? ORDER BY recorded_at DESC LIMIT 2`,
    args: [mint],
  });
  if (history.length < 2) return 'new';
  const [latest, previous] = history;
  if (latest.volume_usd_h1 > previous.volume_usd_h1 * 1.5) return 'pumping';
  if (latest.volume_usd_h1 < previous.volume_usd_h1 * 0.5) return 'dumping';
  return 'stable';
}

export async function getApprovedConcepts(limit = 20) {
  const result = await db.execute({
    sql: `SELECT * FROM concepts WHERE telegram_status = 'approved' ORDER BY created_at DESC LIMIT ?`,
    args: [limit],
  });
  return result.rows;
}

// --- Pump Trends ---

export async function getActiveTrends(limit = 3) {
  const { rows } = await db.execute({
    sql: `SELECT keyword, display_name, trend_type, strength_score,
                 token_count, tokens_json, detected_at, expires_at
          FROM pump_trends
          WHERE active = 1
          ORDER BY strength_score DESC
          LIMIT ?`,
    args: [limit],
  });
  return rows;
}

export async function getTrendForKeyword(keyword) {
  const { rows } = await db.execute({
    sql: `SELECT keyword, display_name, trend_type, strength_score,
                 token_count, tokens_json
          FROM pump_trends
          WHERE active = 1 AND LOWER(keyword) = LOWER(?)
          ORDER BY strength_score DESC
          LIMIT 1`,
    args: [keyword],
  });
  return rows[0] ?? null;
}

export async function getTrendForToken(mint) {
  const { rows } = await db.execute({
    sql: `SELECT keyword, display_name, trend_type, strength_score, token_count, tokens_json
          FROM pump_trends
          WHERE active = 1 AND tokens_json LIKE ?
          ORDER BY strength_score DESC
          LIMIT 1`,
    args: [`%${mint}%`],
  });
  return rows[0] ?? null;
}

export default db;
