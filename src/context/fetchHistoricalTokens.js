import { mkdirSync, createWriteStream } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR  = join(__dirname, 'data');
const OUT_FILE = join(OUT_DIR, 'pumpfun_tokens.csv');

const BASE             = 'https://api.dune.com/api/v1';
const POLL_INTERVAL_MS = 5000;
const MAX_POLLS        = 120;  // 10 minutes max
const PAGE_SIZE        = 1000;
const PAGE_DELAY_MS    = 1500; // stay under rate limit
const RETRY_DELAY_MS   = 15000;
const MAX_RETRIES      = 4;

const SQL = `
WITH token_trades AS (
  SELECT
    t.mint,
    SUM(t.sol_amount) / 1000000000.0 AS total_volume_sol
  FROM pumpdotfun_solana.pump_evt_tradeevent t
  GROUP BY t.mint
),
token_info AS (
  SELECT
    ce.mint,
    ce.symbol,
    ce.evt_block_time AS created_at
  FROM pumpdotfun_solana.pump_evt_createevent ce
)
SELECT
  ti.mint AS token_name,
  ti.symbol AS token_symbol,
  ti.created_at,
  ROUND(tt.total_volume_sol, 2) AS total_volume_sol
FROM token_info ti
INNER JOIN token_trades tt ON tt.mint = ti.mint
WHERE tt.total_volume_sol > 100
ORDER BY tt.total_volume_sol DESC
`.trim();

function headers(apiKey) {
  return {
    'Content-Type': 'application/json',
    'X-Dune-API-Key': apiKey,
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function apiPost(path, apiKey, body = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function apiGetWithRetry(path, apiKey) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      method: 'GET',
      headers: headers(apiKey),
    });

    if (res.status === 429) {
      console.warn(`[Dune] Rate limited (429) — waiting ${RETRY_DELAY_MS / 1000}s before retry ${attempt}/${MAX_RETRIES}...`);
      await sleep(RETRY_DELAY_MS * attempt); // exponential backoff
      continue;
    }

    const json = await res.json();
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${JSON.stringify(json)}`);
    return json;
  }

  throw new Error(`GET ${path} failed after ${MAX_RETRIES} retries (rate limited)`);
}

// --- Execute query ---

async function executeQuery(apiKey, queryId) {
  console.log(`[Dune] Executing query ${queryId}...`);
  const data = await apiPost(`/query/${queryId}/execute`, apiKey, {
    performance: 'medium',
  });
  const execId = data.execution_id;
  if (!execId) throw new Error(`No execution_id in response: ${JSON.stringify(data)}`);
  console.log(`[Dune] Execution started: id=${execId}`);
  return execId;
}

// --- Poll for completion ---

async function pollExecution(apiKey, execId) {
  console.log(`[Dune] Polling for results (every ${POLL_INTERVAL_MS / 1000}s, max ${MAX_POLLS} attempts)...`);

  for (let i = 1; i <= MAX_POLLS; i++) {
    await sleep(POLL_INTERVAL_MS);

    const data  = await apiGetWithRetry(`/execution/${execId}/status`, apiKey);
    const state = data.state;

    console.log(`[Dune] Poll ${i}/${MAX_POLLS} — state: ${state}`);

    if (state === 'QUERY_STATE_COMPLETED') return;
    if (state === 'QUERY_STATE_FAILED')    throw new Error(`Query failed: ${JSON.stringify(data)}`);
    if (state === 'QUERY_STATE_CANCELLED') throw new Error('Query was cancelled');
  }

  throw new Error('Timed out waiting for Dune query to complete');
}

// --- Fetch results incrementally, writing directly to CSV ---

async function fetchAndWriteResults(apiKey, execId) {
  mkdirSync(OUT_DIR, { recursive: true });

  const stream = createWriteStream(OUT_FILE, { encoding: 'utf8' });
  stream.setMaxListeners(0);
  const streamWrite = (data) => new Promise((resolve, reject) => {
    if (!stream.write(data)) {
      stream.once('drain', resolve);
    } else {
      resolve();
    }
    stream.once('error', reject);
  });

  await streamWrite('name,ticker,volume_sol\n');

  let offset = 0;
  let total  = 0;

  while (true) {
    const data = await apiGetWithRetry(
      `/execution/${execId}/results?limit=${PAGE_SIZE}&offset=${offset}`,
      apiKey
    );

    const batch = data.result?.rows ?? [];

    for (const row of batch) {
      const name   = (row.token_name   ?? '').replace(/"/g, '""');
      const ticker = (row.token_symbol ?? '').replace(/"/g, '""');
      const volume = parseFloat(row.total_volume_sol ?? 0).toFixed(4);
      await streamWrite(`"${name}","${ticker}",${volume}\n`);
    }

    total += batch.length;
    console.log(`[Dune] Fetched & saved ${total} rows so far...`);

    if (batch.length < PAGE_SIZE) break;

    offset += PAGE_SIZE;
    await sleep(PAGE_DELAY_MS); // avoid rate limiting between pages
  }

  await new Promise((resolve, reject) => {
    stream.end(err => err ? reject(err) : resolve());
  });

  return total;
}

// --- Main ---

const apiKey  = process.env.DUNE_API_KEY;
const queryId = process.env.DUNE_QUERY_ID;

if (!apiKey) {
  console.error('[Dune] DUNE_API_KEY not set in environment');
  process.exit(1);
}

if (!queryId) {
  console.error('[Dune] DUNE_QUERY_ID not set in environment');
  console.error('');
  console.error('  Query creation via API requires a paid Dune plan.');
  console.error('  Please create the query manually:');
  console.error('');
  console.error('  1. Go to https://dune.com/queries');
  console.error('  2. Click "New Query"');
  console.error('  3. Paste this SQL:');
  console.error('');
  console.error(SQL.split('\n').map(l => `     ${l}`).join('\n'));
  console.error('');
  console.error('  4. Save the query — note the query ID in the URL');
  console.error('     (e.g. dune.com/queries/1234567 → ID is 1234567)');
  console.error('  5. Add to .env:  DUNE_QUERY_ID=1234567');
  process.exit(1);
}

console.log('[Dune] Starting historical token fetch from pump.fun (90 days, volume > 100 SOL)');
console.log(`[Dune] Using query ID: ${queryId}`);

try {
  const execId = await executeQuery(apiKey, queryId);
  await pollExecution(apiKey, execId);

  const total = await fetchAndWriteResults(apiKey, execId);

  if (total === 0) {
    console.warn('[Dune] No rows returned — CSV is empty');
    process.exit(0);
  }

  console.log(`\n[Dune] Done. ${total} tokens saved to: ${OUT_FILE}`);
} catch (err) {
  console.error('[Dune] Fatal error:', err.message);
  process.exit(1);
}
