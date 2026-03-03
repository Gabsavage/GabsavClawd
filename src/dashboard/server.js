import express from 'express';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PATHS = {
  themes:        path.resolve(__dirname, '../context/top_themes.json'),
  examples:      path.resolve(__dirname, '../context/top_examples.json'),
  patterns:      path.resolve(__dirname, '../context/top_patterns.json'),
  signals:       path.resolve(__dirname, 'data/latest_signals.json'),
  hotTopics:     path.resolve(__dirname, '../bot/hotTopics.json'),
  manualSignals: path.resolve(__dirname, 'data/manual_signals.json'),
};

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

const app = express();
app.use(express.json());

app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.get('/api/themes',    async (_req, res) => res.json(await readJson(PATHS.themes,   { themes: [] })));
app.get('/api/examples',  async (_req, res) => res.json(await readJson(PATHS.examples, [])));
app.get('/api/patterns',  async (_req, res) => res.json(await readJson(PATHS.patterns, {})));
app.get('/api/signals',   async (_req, res) => res.json(await readJson(PATHS.signals,  [])));
app.get('/api/hottopics', async (_req, res) => res.json(await readJson(PATHS.hotTopics, [])));

app.post('/api/manual-signal', async (req, res) => {
  const { title, subreddit = 'manual', score = 0 } = req.body ?? {};
  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });

  const dataDir = path.dirname(PATHS.manualSignals);
  if (!existsSync(dataDir)) await mkdir(dataDir, { recursive: true });

  const list = await readJson(PATHS.manualSignals, []);
  const entry = {
    title:      title.trim(),
    subreddit:  subreddit || 'manual',
    score:      Number(score) || 0,
    url:        '',
    created_at: new Date().toISOString(),
    manual:     true,
  };
  list.push(entry);
  await writeFile(PATHS.manualSignals, JSON.stringify(list, null, 2));
  res.json({ ok: true, signal: entry });
});

app.listen(3000, () => console.log('[dashboard] http://localhost:3000'));
