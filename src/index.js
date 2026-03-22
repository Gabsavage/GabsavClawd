import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { startWebSocket, getRecentMigrations } from './scout/webSocketScout.js';
import { runPerplexityScan } from './scout/perplexityScout.js';
import { scanCryptoTwitter } from './scout/grokScout.js';
import { refreshTokenData, getTopMovers } from './scout/dexScreenerScout.js';
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
    const movers = getTopMovers(10);
    entry.signalCount = movers.length;

    if (movers.length === 0) {
      console.log('[flux2] No top movers found — skipping');
      finishEntry(entry, { conceptCount: 0 });
      return;
    }

    console.log(`[flux2] ${movers.length} top mover(s) found`);
    const concepts = await generateConcepts([], movers);
    entry.conceptCount = concepts.length;
    console.log(`[flux2] ${concepts.length} variant(s) generated`);

    const sent = await broadcastConcepts(concepts);
    console.log(`[flux2] ${sent}/${concepts.length} concept(s) sent to Telegram`);

    finishEntry(entry, { conceptCount: concepts.length });
  } catch (err) {
    entry.status = 'error';
    finishEntry(entry);
    console.error(`[flux2] Cycle error: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// FLUX 3 CYCLE — runs every 45 minutes, offset 20 minutes after start
// ---------------------------------------------------------------------------

const FLUX3_INTERVAL_MS = 45 * 60 * 1000;
const FLUX3_OFFSET_MS   = 20 * 60 * 1000;

async function runFlux3Cycle() {
  const entry = logEntry('flux3');
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`[flux3] CT trend scan starting at ${entry.startedAt}`);

  try {
    const trends = await scanCryptoTwitter();
    entry.signalCount = trends.length;

    if (trends.length === 0) {
      console.log('[flux3] No CT trends found — skipping');
      finishEntry(entry, { conceptCount: 0 });
      return;
    }

    console.log(`[flux3] ${trends.length} CT trend(s) found`);
    const concepts = await generateConcepts([], [], trends);
    entry.conceptCount = concepts.length;
    console.log(`[flux3] ${concepts.length} concept(s) generated`);

    const sent = await broadcastConcepts(concepts);
    console.log(`[flux3] ${sent}/${concepts.length} concept(s) sent to Telegram`);

    finishEntry(entry, { conceptCount: concepts.length });
  } catch (err) {
    entry.status = 'error';
    finishEntry(entry);
    console.error(`[flux3] Cycle error: ${err.message}`);
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

  // TEMP: disabled — Flux 1 / Perplexity cycle disabled for testing
  // await runPerplexityCycle();
  // setInterval(() => {
  //   runPerplexityCycle().catch((err) =>
  //     console.error(`[perplexity] Unhandled error: ${err.message}`)
  //   );
  // }, PERPLEXITY_INTERVAL_MS);

  // TEMP: modified — Flux 2 launches immediately (offset removed)
  runFlux2Cycle().catch((err) =>
    console.error(`[flux2] Unhandled error: ${err.message}`)
  );
  setInterval(() => {
    runFlux2Cycle().catch((err) =>
      console.error(`[flux2] Unhandled error: ${err.message}`)
    );
  }, FLUX2_INTERVAL_MS);

  // TEMP: modified — Flux 3 launches immediately (offset removed)
  runFlux3Cycle().catch((err) =>
    console.error(`[flux3] Unhandled error: ${err.message}`)
  );
  setInterval(() => {
    runFlux3Cycle().catch((err) =>
      console.error(`[flux3] Unhandled error: ${err.message}`)
    );
  }, FLUX3_INTERVAL_MS);

  // DexScreener token data refresh — every 15 minutes, immediate start
  const DEX_REFRESH_MS = 15 * 60 * 1000;
  const runDexRefresh = () => {
    console.log('[DexScreener] Token data refresh...');
    refreshTokenData().catch(err => console.error('[DexScreener] Refresh error:', err.message));
  };
  runDexRefresh();
  setInterval(runDexRefresh, DEX_REFRESH_MS);

  console.log('[main] Flux 1: DISABLED (TEMP)');
  console.log('[main] Flux 2 cycle: every 60 min, immediate start');
  console.log('[main] Flux 3 cycle: every 45 min, immediate start');
  console.log('[main] DexScreener refresh: every 15 min, immediate start');
}

main();
