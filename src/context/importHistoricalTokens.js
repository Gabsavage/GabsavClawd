import { createReadStream, existsSync, mkdirSync } from 'fs';
import { createInterface } from 'readline';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, 'data', 'pumpfun_tokens.csv');
const DB_PATH = join(__dirname, '../database/data', 'pumpfun.db');

// --- Theme detection (mirrored from webSocketScout.js) ---

const THEME_KEYWORDS = {
  animal:    ['dog', 'cat', 'monkey', 'ape', 'frog', 'pepe', 'bear', 'bull', 'fish', 'bird', 'penguin', 'hamster', 'rat', 'snake', 'punch'],
  politics:  ['trump', 'biden', 'elon', 'musk', 'putin', 'zelensky', 'barron', 'melania', 'congress', 'senate', 'president', 'election'],
  celebrity: ['kanye', 'taylor', 'swift', 'lebron', 'rihanna', 'drake', 'musk', 'bezos'],
  crypto:    ['bitcoin', 'btc', 'eth', 'solana', 'sol', 'doge', 'shib', 'pepe', 'rug', 'moon', 'pump'],
  religion:  ['god', 'jesus', 'allah', 'church', 'pray', 'pope', 'bible'],
  internet:  ['meme', 'viral', 'based', 'chad', 'sigma', 'npc', 'ai', 'gpt'],
};

const ALL_KEYWORDS = Object.values(THEME_KEYWORDS).flat();

function detectTheme(name, description = '') {
  const text = `${name} ${description}`.toLowerCase();
  for (const [theme, keywords] of Object.entries(THEME_KEYWORDS)) {
    if (keywords.some(kw => text.includes(kw))) return theme;
  }
  return 'other';
}

function detectFormat(name) {
  if (name.startsWith('Send ')) return 'send';
  if (name.includes('What the')) return 'what-the';
  if (/Inu$/i.test(name)) return 'inu';
  if (/Coin$/i.test(name)) return 'coin';
  return 'classic';
}

// --- CSV parsing ---

function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

// --- Main ---

if (!existsSync(CSV_PATH)) {
  console.error(`[Import] CSV not found at: ${CSV_PATH}`);
  console.error(`[Import] Please place your pumpfun_tokens.csv in src/context/data/`);
  process.exit(1);
}

mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Migrate: rebuild tokens table if still using old ticker UNIQUE constraint
{
  const info = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='tokens'`).get();
  if (info && /ticker TEXT UNIQUE/i.test(info.sql)) {
    console.log('[Import] Migrating tokens table: ticker UNIQUE → UNIQUE(name, ticker)...');
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
    console.log('[Import] Migration done.');
  }
}

// Ensure tokens table exists
db.exec(`
  CREATE TABLE IF NOT EXISTS tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    ticker TEXT UNIQUE,
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
    raw_data TEXT
  )
`);

const rl = createInterface({ input: createReadStream(CSV_PATH), crlfDelay: Infinity });

let headers = null;
let volumeColIndex = -1;
let nameColIndex = -1;
let tickerColIndex = -1;
let useLamports = null; // determined after first data row

let rowCount = 0;
let inserted = 0;
let skipped = 0;
const rows = [];

console.log('[Import] Reading CSV...');

for await (const line of rl) {
  if (!line.trim()) continue;

  const fields = parseCSVLine(line);

  if (!headers) {
    headers = fields.map(h => h.toLowerCase().replace(/[^a-z0-9_]/g, ''));
    console.log('[Import] Detected headers:', headers.join(', '));

    nameColIndex   = headers.findIndex(h => h === 'name');
    tickerColIndex = headers.findIndex(h => ['ticker', 'symbol', 'sym'].includes(h));
    volumeColIndex = headers.findIndex(h => ['volume', 'volume_sol', 'volumesol', 'vol'].includes(h));

    if (nameColIndex === -1)   { console.error('[Import] Could not find "name" column'); process.exit(1); }
    if (tickerColIndex === -1) { console.error('[Import] Could not find ticker/symbol column'); process.exit(1); }
    if (volumeColIndex === -1) { console.error('[Import] Could not find volume column'); process.exit(1); }
    continue;
  }

  const name   = fields[nameColIndex]   ?? '';
  const ticker = fields[tickerColIndex] ?? '';
  const rawVol = parseFloat(fields[volumeColIndex]) || 0;

  // Auto-detect lamports vs SOL on first data row with a non-zero volume
  if (useLamports === null && rawVol > 0) {
    useLamports = rawVol > 1_000_000;
    console.log(`[Import] Volume unit detected: ${useLamports ? 'lamports (dividing by 1e9)' : 'SOL (using as-is)'} (sample value: ${rawVol})`);
  }

  const volume_sol = useLamports ? rawVol / 1e9 : rawVol;
  const migrated   = volume_sol > 69 ? 1 : 0;

  const theme    = detectTheme(name);
  const format   = detectFormat(name);
  const text     = name.toLowerCase();
  const matchedKeywords = ALL_KEYWORDS.filter(kw => text.includes(kw));

  rows.push({
    name,
    ticker,
    description: '',
    created_at: '',
    migrated_at: null,
    volume_sol,
    trade_count: 0,
    theme,
    format,
    keywords: JSON.stringify(matchedKeywords),
    migrated,
    source: 'historical',
    raw_data: JSON.stringify({ name, ticker, volume: fields[volumeColIndex] }),
  });

  rowCount++;
  if (rowCount % 1000 === 0) console.log(`[Import] Read ${rowCount} rows...`);
}

console.log(`[Import] Parsed ${rowCount} rows. Starting bulk insert...`);

const stmt = db.prepare(`
  INSERT OR IGNORE INTO tokens
    (name, ticker, description, created_at, migrated_at, volume_sol, trade_count,
     theme, format, keywords, migrated, source, raw_data)
  VALUES
    (@name, @ticker, @description, @created_at, @migrated_at, @volume_sol, @trade_count,
     @theme, @format, @keywords, @migrated, @source, @raw_data)
`);

const insertMany = db.transaction((batch) => {
  for (const row of batch) {
    const result = stmt.run(row);
    if (result.changes > 0) inserted++;
    else skipped++;
  }
});

// Process in chunks of 5000
const CHUNK = 5000;
for (let i = 0; i < rows.length; i += CHUNK) {
  insertMany(rows.slice(i, i + CHUNK));
  console.log(`[Import] Inserted up to row ${Math.min(i + CHUNK, rows.length)}...`);
}

// --- Summary ---

console.log('\n[Import] Done.');
console.log(`  Total rows:  ${rowCount}`);
console.log(`  Inserted:    ${inserted}`);
console.log(`  Skipped:     ${skipped} (duplicate tickers)`);

const topThemes = db
  .prepare(`SELECT theme, COUNT(*) as count FROM tokens WHERE source = 'historical' GROUP BY theme ORDER BY count DESC LIMIT 5`)
  .all();

const topFormats = db
  .prepare(`SELECT format, COUNT(*) as count FROM tokens WHERE source = 'historical' GROUP BY format ORDER BY count DESC LIMIT 5`)
  .all();

console.log('\n  Top 5 themes:');
for (const r of topThemes)  console.log(`    ${r.theme.padEnd(12)} ${r.count}`);

console.log('\n  Top 5 formats:');
for (const r of topFormats) console.log(`    ${r.format.padEnd(12)} ${r.count}`);

db.close();
