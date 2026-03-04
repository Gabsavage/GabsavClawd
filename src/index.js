import { readFileSync, existsSync } from 'fs';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import scoutReddit from './scout/redditScout.js';
import scoutTrends from './scout/trendsScout.js';
import scoutPredictionMarkets from './scout/predictionMarketScout.js';
import filterSignals, { minScore } from './filter/scorer.js';
import generateConcepts from './creative/conceptGenerator.js';
import { sendConcept, startBot, stopBot, getPendingLaunches } from './bot/telegramBot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const DATA_DIR  = path.join(__dirname, 'dashboard', 'data');

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

    const key   = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');

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
    for (const l of launches) console.log(`  $${l.ticker} — "${l.name}"`);
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

const CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const seenSignals  = new Map();

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
// Cycle stats — lightweight snapshot for Telegram /status command
// ---------------------------------------------------------------------------

const cycleStats = {
  lastCycleAt:      null,
  totalSignals:     0,
  passedFilter:     0,
  conceptsGenerated: 0,
};

// ---------------------------------------------------------------------------
// Activity log — full history for the dashboard Live Activity tab
// ---------------------------------------------------------------------------

const MAX_LOG   = 20;
const cycleLog  = [];   // newest first

let activityStatus = {
  currentStep:  'idle',   // 'scout' | 'filter' | 'creative' | 'bot' | 'idle'
  isRunning:    false,
  nextCycleAt:  null,     // ISO string of next scheduled run
};

async function persistActivity() {
  try {
    if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
    await Promise.all([
      writeFile(
        path.join(DATA_DIR, 'cycle_log.json'),
        JSON.stringify(cycleLog, null, 2)
      ),
      writeFile(
        path.join(DATA_DIR, 'activity_status.json'),
        JSON.stringify(activityStatus, null, 2)
      ),
    ]);
  } catch (err) {
    console.warn(`[activity] Failed to persist: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Scout cycle
// ---------------------------------------------------------------------------

async function runCycle() {
  const startMs = Date.now();

  // Reset next-cycle time while running
  activityStatus.nextCycleAt = null;

  // Create the log entry for this cycle
  const entry = {
    startedAt:        new Date().toISOString(),
    finishedAt:       null,
    duration:         null,
    redditCount:      0,
    trendsCount:      0,
    polymarketCount:  0,
    totalSignals:     0,
    filteredCount:    0,
    conceptsGenerated: 0,
    conceptsSent:     0,
    status:           'running',
    currentStep:      'scout',
  };

  activityStatus.isRunning   = true;
  activityStatus.currentStep = 'scout';

  // Sync cycleStats for Telegram
  cycleStats.lastCycleAt      = entry.startedAt;
  cycleStats.totalSignals     = 0;
  cycleStats.passedFilter     = 0;
  cycleStats.conceptsGenerated = 0;

  await persistActivity();

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`[cycle] Starting scout cycle at ${entry.startedAt}`);

  try {

    // 1. Scout ─────────────────────────────────────────────
    console.log('[scout] Fetching Reddit, Polymarket signals, and Google Trends context...');
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

    // Google Trends is used as context for Gemini scoring, not as individual signals
    const trendsContext = trendsSignals.map((s) => s.title);

    const raw = [...redditSignals, ...predictionSignals];

    entry.redditCount      = redditSignals.length;
    entry.trendsCount      = trendsSignals.length;
    entry.polymarketCount  = predictionSignals.length;
    entry.totalSignals     = raw.length;
    cycleStats.totalSignals = raw.length;

    console.log(
      `[scout] ${raw.length} signal(s) total` +
      ` (Reddit: ${redditSignals.length}, Polymarket: ${predictionSignals.length},` +
      ` Trends context: ${trendsSignals.length} topics)`
    );

    // 2. Deduplicate ───────────────────────────────────────
    const fresh = filterUnseen(raw);
    console.log(`[cache] ${fresh.length} new signal(s) (${raw.length - fresh.length} already seen)`);

    if (fresh.length === 0) {
      console.log('[cycle] No new signals — skipping cycle');
      return;
    }

    markSeen(fresh);

    // 3. Filter & score ────────────────────────────────────
    entry.currentStep          = 'filter';
    activityStatus.currentStep = 'filter';
    await persistActivity();

    console.log('[filter] Scoring signals with Gemini...');
    const filtered = await filterSignals(fresh, trendsContext);

    entry.filteredCount    = filtered.length;
    cycleStats.passedFilter = filtered.length;

    console.log(`[filter] ${filtered.length} high-potential signal(s) (score ≥ ${minScore})`);

    if (filtered.length === 0) {
      console.log('[cycle] No signals passed the filter — skipping cycle');
      return;
    }

    // 4. Generate concepts ─────────────────────────────────
    entry.currentStep          = 'creative';
    activityStatus.currentStep = 'creative';
    await persistActivity();

    const top = filtered.slice(0, 15);
    console.log(`[creative] Generating token concepts with Claude (top ${top.length})...`);
    const concepts = await generateConcepts(top);

    entry.conceptsGenerated       = concepts.length;
    cycleStats.conceptsGenerated  = concepts.length;

    console.log(`[creative] ${concepts.length} concept(s) generated`);

    if (concepts.length === 0) {
      console.log('[cycle] No concepts generated — skipping cycle');
      return;
    }

    // 5. Send to Telegram ──────────────────────────────────
    entry.currentStep          = 'bot';
    activityStatus.currentStep = 'bot';
    await persistActivity();

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

    entry.conceptsSent = sent;
    console.log(`[cycle] Done. ${sent}/${concepts.length} concept(s) sent to Telegram`);

  } catch (err) {
    entry.status = 'error';
    throw err;
  } finally {
    entry.finishedAt = new Date().toISOString();
    entry.duration   = Math.round((Date.now() - startMs) / 1000);
    if (entry.status === 'running') entry.status = 'done';
    entry.currentStep = 'idle';

    cycleLog.unshift(entry);
    if (cycleLog.length > MAX_LOG) cycleLog.length = MAX_LOG;

    activityStatus.isRunning   = false;
    activityStatus.currentStep = 'idle';

    await persistActivity();
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const INTERVAL_MS = 5 * 60 * 1000;

async function main() {
  loadEnv();

  console.log('[main] OpenClawd autonomous meme token scout starting...');

  startBot({ runCycle, getStats: () => ({ ...cycleStats }) });

  await runCycle().catch((err) => console.error(`[cycle] Unhandled error: ${err.message}`));

  activityStatus.nextCycleAt = new Date(Date.now() + INTERVAL_MS).toISOString();
  await persistActivity();

  setInterval(async () => {
    await runCycle().catch((err) => console.error(`[cycle] Unhandled error: ${err.message}`));
    activityStatus.nextCycleAt = new Date(Date.now() + INTERVAL_MS).toISOString();
    await persistActivity();
  }, INTERVAL_MS);

  console.log(`[main] Scheduler active — next cycle in 5 minutes`);
}

main();
