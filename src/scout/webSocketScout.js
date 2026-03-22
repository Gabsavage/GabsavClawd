import WebSocket from 'ws';
import db, { insertToken, getRecentMigrations as dbGetRecentMigrations } from '../database/db.js';

const WS_URL = 'wss://pumpportal.fun/api/data';
const MAX_RECENT = 200;
const RECONNECT_DELAY_MS = 5000;

const recentTokens = [];

// --- Theme detection ---

const THEME_KEYWORDS = {
  animal: ['dog', 'cat', 'monkey', 'ape', 'frog', 'pepe', 'bear', 'bull', 'fish', 'bird', 'penguin', 'hamster', 'rat', 'snake', 'punch'],
  politics: ['trump', 'biden', 'elon', 'musk', 'putin', 'zelensky', 'barron', 'melania', 'congress', 'senate', 'president', 'election'],
  celebrity: ['kanye', 'taylor', 'swift', 'lebron', 'rihanna', 'drake', 'musk', 'bezos'],
  crypto: ['bitcoin', 'btc', 'eth', 'solana', 'sol', 'doge', 'shib', 'pepe', 'rug', 'moon', 'pump'],
  religion: ['god', 'jesus', 'allah', 'church', 'pray', 'pope', 'bible'],
  internet: ['meme', 'viral', 'based', 'chad', 'sigma', 'npc', 'ai', 'gpt'],
};

function detectTheme(name, description) {
  const text = `${name} ${description}`.toLowerCase();
  for (const [theme, keywords] of Object.entries(THEME_KEYWORDS)) {
    if (keywords.some(kw => text.includes(kw))) return theme;
  }
  return 'other';
}

// --- Format detection ---

function detectFormat(name) {
  if (name.startsWith('Send ')) return 'send';
  if (name.includes('What the')) return 'what-the';
  if (/Inu$/i.test(name)) return 'inu';
  if (/Coin$/i.test(name)) return 'coin';
  return 'classic';
}

// --- recentTokens management ---

function pushRecent(token) {
  if (recentTokens.length >= MAX_RECENT) recentTokens.shift();
  recentTokens.push(token);
}

// --- Event handlers ---

function handleNewToken(data) {
  const marketCap = data.marketCapSol || 0;
  if (marketCap < 300) return; // Ignore tokens under 300 SOL market cap

  console.log(`[WebSocket] New token (${marketCap.toFixed(0)} SOL mcap): ${data.name} ($${data.symbol})`);
  const name = data.name || '';
  const ticker = data.symbol || data.ticker || '';
  const description = data.description || '';
  const created_at = new Date(Date.now()).toISOString();

  const theme = detectTheme(name, description);
  const format = detectFormat(name);

  const allKeywords = Object.values(THEME_KEYWORDS).flat();
  const text = `${name} ${description}`.toLowerCase();
  const matchedKeywords = allKeywords.filter(kw => text.includes(kw));

  const token = {
    name,
    ticker,
    description,
    created_at,
    migrated_at: null,
    volume_sol: data.marketCapSol || 0,
    trade_count: 0,
    theme,
    format,
    keywords: JSON.stringify(matchedKeywords),
    migrated: 0,
    source: 'pumpportal',
    raw_data: JSON.stringify(data),
    mint: data.mint || null,
  };

  insertToken(token);
  pushRecent({ ...token, migrated: false });

  console.log(`[WebSocket] new token: ${name} $${ticker}`);
}

function handleMigration(data) {
  console.log(`[WebSocket] Migration received: ${data.name || 'unknown'} ($${data.symbol || 'unknown'})`);
  const name = data.name || '';
  const ticker = data.symbol || data.ticker || '';
  const migrated_at = new Date(Date.now()).toISOString();

  const result = db.prepare(`UPDATE tokens SET migrated = 1, migrated_at = ? WHERE ticker = ?`)
    .run(migrated_at, ticker);

  if (result.changes === 0) {
    // Token wasn't in DB yet — insert it as already migrated
    try {
      db.prepare(`INSERT INTO tokens (name, ticker, migrated, migrated_at, source, created_at) VALUES (?, ?, 1, ?, 'pumpportal', ?)`)
        .run(name || ticker, ticker, migrated_at, new Date().toISOString());
      console.log(`[WebSocket] Migration inserted (new): ${name || ticker} ($${ticker})`);
    } catch (e) {
      // UNIQUE constraint = token already exists with different casing, ignore
    }
  }

  pushRecent({ name, ticker, migrated: true, migrated_at, source: 'pumpportal' });

  console.log(`[WebSocket] migration: ${name} $${ticker}`);
}

function isNewToken(data) {
  return data.txType === 'create';
}

function isMigration(data) {
  return data.txType === 'migrate' || data.pool === 'raydium';
}

// --- WebSocket connection ---

function connect() {
  const ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.log('[WebSocket] connected');
    ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
    ws.send(JSON.stringify({ method: 'subscribeMigration' }));
  });

  ws.on('message', (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    if (isMigration(data)) {
      handleMigration(data);
    } else if (isNewToken(data)) {
      handleNewToken(data);
    }
  });

  ws.on('close', () => {
    console.log(`[WebSocket] disconnected — reconnecting in ${RECONNECT_DELAY_MS / 1000}s`);
    setTimeout(connect, RECONNECT_DELAY_MS);
  });

  ws.on('error', (err) => {
    console.error('[WebSocket] error:', err.message);
    // 'close' fires after 'error', so reconnect is handled there
  });
}

// --- Exports ---

export function startWebSocket() {
  connect();
}

export function getRecentTokens() {
  return recentTokens;
}

export { dbGetRecentMigrations as getRecentMigrations };
