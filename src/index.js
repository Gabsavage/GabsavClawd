import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import scoutReddit from './scout/redditScout.js';
import scoutTrends from './scout/trendsScout.js';
import scoutPredictionMarkets from './scout/predictionMarketScout.js';
import filterSignals from './filter/scorer.js';
import generateConcepts from './creative/conceptGenerator.js';
import { sendConcept, startBot, stopBot, getPendingLaunches } from './bot/telegramBot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// .env loader — no external dependencies
// ---------------------------------------------------------------------------

function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!existsSync(envPath)) {
    console.warn('[env] No .env file found — relying on existing environment variables');
    return;
  }

  const lines = readFileSync(envPath, 'utf-8').split('\n');
  let loaded = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, ''); // strip optional quotes

    if (key && !(key in process.env)) {
      process.env[key] = value;
      loaded++;
    }
  }

  console.log(`[env] Loaded ${loaded} variable(s) from .env`);
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

function shutdown() {
  console.log('\n[main] Shutting down...');
  stopBot();

  const launches = getPendingLaunches();
  if (launches.length > 0) {
    console.log(`\n[main] Pending launches (${launches.length}):`);
    for (const l of launches) {
      console.log(`  $${l.ticker} — "${l.name}"`);
    }
  } else {
    console.log('[main] No pending launches.');
  }

  console.log('[main] Goodbye.');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ---------------------------------------------------------------------------
// Signal cache — deduplicate titles seen within the TTL window
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const seenSignals = new Map(); // title -> timestamp (ms)

function evictExpired() {
  const cutoff = Date.now() - CACHE_TTL_MS;
  for (const [title, ts] of seenSignals) {
    if (ts < cutoff) seenSignals.delete(title);
  }
}

function filterUnseen(signals) {
  evictExpired();
  return signals.filter((s) => !seenSignals.has(s.title));
}

function markSeen(signals) {
  const now = Date.now();
  for (const s of signals) seenSignals.set(s.title, now);
}

// ---------------------------------------------------------------------------
// Scout cycle
// ---------------------------------------------------------------------------

async function runCycle() {
  const cycleStart = new Date().toISOString();
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`[cycle] Starting scout cycle at ${cycleStart}`);

  // 1. Scout — all sources run in parallel
  console.log('[scout] Fetching Reddit, Google Trends, and prediction market signals...');
  const [redditSignals, trendsSignals, predictionSignals] = await Promise.all([
    scoutReddit().catch((err) => {
      console.warn(`[scout] Reddit failed: ${err.message}`);
      return [];
    }),
    scoutTrends().catch((err) => {
      console.warn(`[scout] Google Trends failed: ${err.message}`);
      return [];
    }),
    scoutPredictionMarkets().catch((err) => {
      console.warn(`[scout] Prediction markets failed: ${err.message}`);
      return [];
    }),
  ]);

  const raw = [...redditSignals, ...trendsSignals, ...predictionSignals];
  console.log(
    `[scout] ${raw.length} signal(s) total` +
    ` (Reddit: ${redditSignals.length}, Trends: ${trendsSignals.length},` +
    ` Prediction markets: ${predictionSignals.length})`
  );

  // 2. Deduplicate against cache
  const fresh = filterUnseen(raw);
  console.log(`[cache] ${fresh.length} new signal(s) (${raw.length - fresh.length} already seen)`);

  if (fresh.length === 0) {
    console.log('[cycle] No new signals — skipping cycle');
    return;
  }

  // Mark as seen before scoring so a slow cycle doesn't double-process
  markSeen(fresh);

  // 3. Filter & score
  console.log('[filter] Scoring signals with Gemini...');
  const filtered = await filterSignals(fresh);
  console.log(`[filter] ${filtered.length} high-potential signal(s) (score ≥ 70)`);

  if (filtered.length === 0) {
    console.log('[cycle] No signals passed the filter — skipping cycle');
    return;
  }

  // 4. Generate concepts
  console.log('[creative] Generating token concepts with Claude...');
  const concepts = await generateConcepts(filtered);
  console.log(`[creative] ${concepts.length} concept(s) generated`);

  if (concepts.length === 0) {
    console.log('[cycle] No concepts generated — skipping cycle');
    return;
  }

  // 5. Send to Telegram
  console.log('[bot] Sending concepts to Telegram...');
  let sent = 0;
  for (const concept of concepts) {
    try {
      await sendConcept(concept);
      console.log(`[bot] Sent: $${concept.ticker} — "${concept.name}"`);
      sent++;
    } catch (err) {
      console.warn(`[bot] Failed to send $${concept.ticker}: ${err.message}`);
    }
  }

  console.log(`[cycle] Done. ${sent}/${concepts.length} concept(s) sent to Telegram`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

async function main() {
  loadEnv();

  console.log('[main] OpenClawd autonomous meme token scout starting...');

  startBot();

  // Run immediately, then on a fixed interval
  await runCycle().catch((err) => console.error(`[cycle] Unhandled error: ${err.message}`));

  setInterval(() => {
    runCycle().catch((err) => console.error(`[cycle] Unhandled error: ${err.message}`));
  }, INTERVAL_MS);

  console.log(`[main] Scheduler active — next cycle in 5 minutes`);
}

main();
