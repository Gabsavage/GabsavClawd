import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

import {
  getRecentSignals,
  getConceptsByStatus,
  getTopThemes,
  getTopFormats,
  getRecentMigrations,
  getDashboardStats,
  updateConceptStatus,
  getAllTokens,
} from '../database/db.js';
import { state, emitter, triggers } from './state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function startDashboard() {
  const PORT = process.env.DASHBOARD_PORT || 3000;
  const app = express();
  app.use(express.json());

  // CORS — allow the Vite dev server and any local origin
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // Serve built React app if available
  const distPath = join(__dirname, '../../dashboard-ui/dist');
  if (existsSync(distPath)) {
    app.use(express.static(distPath));
  }

  // ── Health ──────────────────────────────────────────────────────────────────

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      uptime: Math.floor(process.uptime()),
      botRunning: Object.values(triggers).some(Boolean),
    });
  });

  // ── Cycles ──────────────────────────────────────────────────────────────────

  app.get('/api/cycles', (_req, res) => {
    res.json({
      log: state.cycleLog,
      running: [...state.running],
    });
  });

  app.post('/api/cycles/trigger/:flux', (req, res) => {
    const fn = triggers[req.params.flux];
    if (!fn) return res.status(503).json({ error: 'Main bot not running — start with npm start' });
    fn().catch(console.error);
    res.json({ ok: true });
  });

  // ── Pending launches ─────────────────────────────────────────────────────────

  app.get('/api/pending', (_req, res) => {
    res.json(state.pendingLaunches);
  });

  // ── Signals ──────────────────────────────────────────────────────────────────

  app.get('/api/signals', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    res.json(getRecentSignals(limit));
  });

  // ── Concepts ─────────────────────────────────────────────────────────────────

  app.get('/api/concepts', (req, res) => {
    const status = req.query.status || 'all';
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    res.json(getConceptsByStatus(status, limit));
  });

  app.patch('/api/concepts/:id/status', (req, res) => {
    const { status, notes } = req.body;
    try {
      updateConceptStatus(Number(req.params.id), status, notes || '');
      emitter.emit('status_change', { id: Number(req.params.id), status });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Analytics ─────────────────────────────────────────────────────────────────

  app.get('/api/analytics/themes', (_req, res) => res.json(getTopThemes(15)));
  app.get('/api/analytics/formats', (_req, res) => res.json(getTopFormats(15)));
  app.get('/api/analytics/migrations', (req, res) => {
    const hours = parseInt(req.query.hours) || 168;
    res.json(getRecentMigrations(hours));
  });
  app.get('/api/analytics/stats', (_req, res) => res.json(getDashboardStats()));

  // ── Tokens ────────────────────────────────────────────────────────────────────

  app.get('/api/tokens', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = parseInt(req.query.offset) || 0;
    res.json(getAllTokens(limit, offset));
  });

  // ── SPA fallback ──────────────────────────────────────────────────────────────

  if (existsSync(distPath)) {
    app.get('/{*splat}', (_req, res) => res.sendFile(join(distPath, 'index.html')));
  }

  // ── HTTP + WebSocket ──────────────────────────────────────────────────────────

  const server = createServer(app);
  const wss = new WebSocketServer({ server });
  const clients = new Set();

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify({
      type: 'init',
      data: {
        cycleLog: state.cycleLog,
        running: [...state.running],
        pendingLaunches: state.pendingLaunches,
      },
    }));
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  function broadcast(type, data) {
    const msg = JSON.stringify({ type, data });
    for (const ws of clients) {
      if (ws.readyState === 1) ws.send(msg);
    }
  }

  emitter.on('cycle_start', (d) => broadcast('cycle_start', d));
  emitter.on('cycle_update', (d) => broadcast('cycle_update', d));
  emitter.on('new_concept', (d) => broadcast('new_concept', d));
  emitter.on('launches_update', (d) => broadcast('launches_update', d));
  emitter.on('status_change', (d) => broadcast('status_change', d));

  server.listen(PORT, () => {
    console.log(`[dashboard] http://localhost:${PORT}`);
  });
}
