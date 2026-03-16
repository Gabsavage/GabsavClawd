import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, 'data', 'pumpfun.db');

mkdirSync(join(__dirname, 'data'), { recursive: true });

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    ticker TEXT,
    description TEXT,
    created_at TEXT,
    migrated_at TEXT,
    volume_sol REAL DEFAULT 0,
    trade_count INTEGER DEFAULT 0,
    theme TEXT,
    format TEXT,
    keywords TEXT,
    migrated INTEGER DEFAULT 0,
    source TEXT,
    raw_data TEXT,
    UNIQUE(name, ticker)
  );

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
    absurdity_angle TEXT
  );

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
    feedback_notes TEXT
  );
`);

// Migrate: rebuild tokens table if still using old ticker UNIQUE constraint
{
  const info = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='tokens'`).get();
  if (info && /ticker TEXT UNIQUE/i.test(info.sql)) {
    db.exec(`
      ALTER TABLE tokens RENAME TO tokens_old;
      CREATE TABLE tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        ticker TEXT,
        description TEXT,
        created_at TEXT,
        migrated_at TEXT,
        volume_sol REAL DEFAULT 0,
        trade_count INTEGER DEFAULT 0,
        theme TEXT,
        format TEXT,
        keywords TEXT,
        migrated INTEGER DEFAULT 0,
        source TEXT,
        raw_data TEXT,
        UNIQUE(name, ticker)
      );
      INSERT OR IGNORE INTO tokens SELECT * FROM tokens_old;
      DROP TABLE tokens_old;
    `);
    console.log('[DB] Migrated tokens table: ticker UNIQUE → UNIQUE(name, ticker)');
  }
}

// Migrate: add columns to concepts if they don't exist yet
for (const col of ['sources TEXT', 'source_date TEXT', 'source_signal TEXT']) {
  try { db.exec(`ALTER TABLE concepts ADD COLUMN ${col}`); } catch {}
}

// Migrate: add new columns to signals if they don't exist yet
for (const col of [
  'momentum TEXT',
  'why_it_pumps TEXT',
  'sources TEXT',
  'signal_strength INTEGER',
  'spread TEXT',
  'velocity TEXT',
  'shelf_life TEXT',
  'absurdity_angle TEXT',
  'source_date TEXT',
]) {
  try {
    db.exec(`ALTER TABLE signals ADD COLUMN ${col}`);
  } catch {
    // column already exists — ignore
  }
}

// --- Tokens ---

export function insertToken(token) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO tokens
      (name, ticker, description, created_at, migrated_at, volume_sol, trade_count,
       theme, format, keywords, migrated, source, raw_data)
    VALUES
      (@name, @ticker, @description, @created_at, @migrated_at, @volume_sol, @trade_count,
       @theme, @format, @keywords, @migrated, @source, @raw_data)
  `);
  return stmt.run(token);
}

export function updateTokenVolume(ticker, volume_sol, trade_count) {
  const stmt = db.prepare(`
    UPDATE tokens SET volume_sol = @volume_sol, trade_count = @trade_count
    WHERE ticker = @ticker
  `);
  return stmt.run({ ticker, volume_sol, trade_count });
}

export function getTopThemes(limit = 10) {
  const stmt = db.prepare(`
    SELECT theme, COUNT(*) as count, SUM(volume_sol) as total_volume
    FROM tokens
    WHERE theme IS NOT NULL
    GROUP BY theme
    ORDER BY total_volume DESC
    LIMIT ?
  `);
  return stmt.all(limit);
}

export function getTopFormats(limit = 10) {
  const stmt = db.prepare(`
    SELECT format, COUNT(*) as count, SUM(volume_sol) as total_volume
    FROM tokens
    WHERE format IS NOT NULL
    GROUP BY format
    ORDER BY total_volume DESC
    LIMIT ?
  `);
  return stmt.all(limit);
}

export function getRecentMigrations(hours = 24) {
  const stmt = db.prepare(`
    SELECT * FROM tokens
    WHERE migrated = 1
      AND migrated_at > datetime('now', '-' || ? || ' hours')
    ORDER BY migrated_at DESC
  `);
  return stmt.all(hours);
}

export function getTokensByTheme(theme, limit = 20) {
  const stmt = db.prepare(`
    SELECT * FROM tokens
    WHERE theme = ?
    ORDER BY volume_sol DESC
    LIMIT ?
  `);
  return stmt.all(theme, limit);
}

export function searchSimilarTokens(keywords) {
  if (!keywords || keywords.length === 0) return [];

  const conditions = keywords.map(() => '(name LIKE ? OR description LIKE ?)').join(' OR ');
  const params = keywords.flatMap(kw => [`%${kw}%`, `%${kw}%`]);

  const stmt = db.prepare(`
    SELECT * FROM tokens
    WHERE ${conditions}
    ORDER BY volume_sol DESC
    LIMIT 10
  `);
  return stmt.all(...params);
}

export function hasRecentConcept(topic) {
  const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const row = db
    .prepare(`SELECT 1 FROM concepts WHERE source_signal = ? AND created_at >= ? LIMIT 1`)
    .get(topic, since);
  return !!row;
}

// --- Signals ---

export function insertSignal(signal) {
  const stmt = db.prepare(`
    INSERT INTO signals
      (title, source, score, reasoning, momentum, why_it_pumps, sources, created_at, used,
       signal_strength, spread, velocity, shelf_life, absurdity_angle, source_date)
    VALUES
      (@title, @source, @score, @reasoning, @momentum, @why_it_pumps, @sources, @created_at, @used,
       @signal_strength, @spread, @velocity, @shelf_life, @absurdity_angle, @source_date)
  `);
  const result = stmt.run(signal);
  return result.lastInsertRowid;
}

// --- Concepts ---

export function insertConcept(concept) {
  const stmt = db.prepare(`
    INSERT INTO concepts
      (signal_id, name, ticker, description, narrative, image_prompt,
       flux, telegram_status, created_at, feedback_notes, sources, source_date, source_signal)
    VALUES
      (@signal_id, @name, @ticker, @description, @narrative, @image_prompt,
       @flux, @telegram_status, @created_at, @feedback_notes, @sources, @source_date, @source_signal)
  `);
  const result = stmt.run(concept);
  return result.lastInsertRowid;
}

export function updateConceptStatus(id, status, feedback_notes) {
  const stmt = db.prepare(`
    UPDATE concepts SET telegram_status = ?, feedback_notes = ?
    WHERE id = ?
  `);
  return stmt.run(status, feedback_notes, id);
}

export function getApprovedConcepts(limit = 20) {
  const stmt = db.prepare(`
    SELECT * FROM concepts
    WHERE telegram_status = 'approved'
    ORDER BY created_at DESC
    LIMIT ?
  `);
  return stmt.all(limit);
}

export default db;
