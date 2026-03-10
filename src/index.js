import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { startWebSocket, getRecentTokens, getRecentMigrations } from './scout/webSocketScout.js';
import { runPerplexityScan, getLatestSignals } from './scout/perplexityScout.js';
import generateConcepts from './creative/conceptGenerator.js';
import { startBot, sendConcept, stopBot, getPendingLaunches } from './bot/telegramBot.js';

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
// Cycle log — max 20 entries, newest first
// ---------------------------------------------------------------------------

const MAX_LOG = 20;
const cycleLog = [];

function logEntry(type) {
  return {
    type,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    duration: null,
    signalCount: 0,
    conceptCount: 0,
    status: 'running',
  };
}

function finishEntry(entry, extra = {}) {
  entry.finishedAt = new Date().toISOString();
  entry.duration = Math.round((Date.now() - new Date(entry.startedAt).getTime()) / 1000);
  entry.status = 'done';
  Object.assign(entry, extra);
  cycleLog.unshift(entry);
  if (cycleLog.length > MAX_LOG) cycleLog.length = MAX_LOG;
}

// ---------------------------------------------------------------------------
// Send concepts to Telegram
// ---------------------------------------------------------------------------

async function broadcastConcepts(concepts) {
  let sent = 0;
  for (const concept of concepts) {
    try {
      await sendConcept(concept);
      console.log(`[bot] Sent: $${concept.ticker} — "${concept.name}" (Flux ${concept.flux})`);
      sent++;
    } catch (err) {
      console.warn(`[bot] Failed to send $${concept.ticker}: ${err.message}`);
    }
  }
  return sent;
}

// ---------------------------------------------------------------------------
// PERPLEXITY CYCLE — runs every 30 minutes
// ---------------------------------------------------------------------------

const PERPLEXITY_INTERVAL_MS = 30 * 60 * 1000;

async function runPerplexityCycle() {
  const entry = logEntry('perplexity');
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`[perplexity] Cycle starting at ${entry.startedAt}`);

  try {
    const signals = await runPerplexityScan();
    const migrations = getRecentMigrations(24);

    entry.signalCount = signals.length;
    console.log(`[perplexity] ${signals.length} signal(s), ${migrations.length} migration(s)`);

    const concepts = await generateConcepts(signals, migrations);
    entry.conceptCount = concepts.length;
    console.log(`[perplexity] ${concepts.length} concept(s) generated`);

    const sent = await broadcastConcepts(concepts);
    console.log(`[perplexity] ${sent}/${concepts.length} concept(s) sent to Telegram`);

    finishEntry(entry, { conceptCount: concepts.length });
  } catch (err) {
    entry.status = 'error';
    finishEntry(entry);
    console.error(`[perplexity] Cycle error: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// FLUX 2 CYCLE — runs every 60 minutes, offset 15 minutes after start
// ---------------------------------------------------------------------------

const FLUX2_INTERVAL_MS = 60 * 60 * 1000;
const FLUX2_OFFSET_MS   = 15 * 60 * 1000;

async function runFlux2Cycle() {
  const entry = logEntry('flux2');
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`[flux2] Cycle starting at ${entry.startedAt}`);

  try {
    const migrations = getRecentMigrations(24);
    entry.signalCount = migrations.length;

    if (migrations.length === 0) {
      console.log('[flux2] No recent migrations — skipping');
      finishEntry(entry, { conceptCount: 0 });
      return;
    }

    console.log(`[flux2] ${migrations.length} migration(s) found`);
    const concepts = await generateConcepts([], migrations);
    entry.conceptCount = concepts.length;
    console.log(`[flux2] ${concepts.length} variant(s) generated`);

    const sent = await broadcastConcepts(concepts);
    console.log(`[flux2] ${sent}/${concepts.length} variant(s) sent to Telegram`);

    finishEntry(entry, { conceptCount: concepts.length });
  } catch (err) {
    entry.status = 'error';
    finishEntry(entry);
    console.error(`[flux2] Cycle error: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  loadEnv();

  console.log('[main] GabsavClawd autonomous meme token scout starting...');

  startBot();
  startWebSocket();

  // Run first Perplexity cycle immediately
  await runPerplexityCycle();

  // Schedule Perplexity cycle every 30 minutes
  setInterval(() => {
    runPerplexityCycle().catch((err) =>
      console.error(`[perplexity] Unhandled error: ${err.message}`)
    );
  }, PERPLEXITY_INTERVAL_MS);

  // Schedule Flux 2 cycle every 60 minutes, starting 15 minutes after launch
  setTimeout(() => {
    runFlux2Cycle().catch((err) =>
      console.error(`[flux2] Unhandled error: ${err.message}`)
    );
    setInterval(() => {
      runFlux2Cycle().catch((err) =>
        console.error(`[flux2] Unhandled error: ${err.message}`)
      );
    }, FLUX2_INTERVAL_MS);
  }, FLUX2_OFFSET_MS);

  console.log('[main] Perplexity cycle: every 30 min');
  console.log('[main] Flux 2 cycle: every 60 min, first run in 15 min');
}

main();
