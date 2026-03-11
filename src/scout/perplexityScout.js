import { fileURLToPath } from 'url';
import db, { insertSignal } from '../database/db.js';

const API_URL = 'https://api.perplexity.ai/chat/completions';

const SYSTEM_MESSAGE =
  'You are a meme token scout. Your job is to identify emerging viral topics ' +
  'that have not yet been tokenized on pump.fun. Focus on: absurd news, ' +
  'viral animals, political chaos, celebrity drama, geopolitical events, ' +
  'internet culture. Always respond with valid JSON only, no markdown, no preamble.';

const USER_MESSAGE =
  'What are the 5-8 topics emerging or going viral in the last 6 hours?\n' +
  'For each, evaluate its meme token potential.\n' +
  'Return a JSON array with this exact shape:\n' +
  '[{\n' +
  '  topic: string,\n' +
  '  summary: string (max 2 sentences),\n' +
  '  meme_potential: number (1-10),\n' +
  '  crypto_exists: boolean (is there already a token for this?),\n' +
  '  keywords: string[] (3-5 keywords),\n' +
  '  category: string (animal/politics/celebrity/geopolitics/internet/other)\n' +
  '}]\n' +
  'Only return the JSON array, nothing else.';

export async function runPerplexityScan() {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    console.warn('[Perplexity] PERPLEXITY_API_KEY not set — skipping scan.');
    return [];
  }

  let raw;
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          { role: 'system', content: SYSTEM_MESSAGE },
          { role: 'user', content: USER_MESSAGE },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[Perplexity] API error ${res.status}: ${text}`);
      return [];
    }

    raw = await res.json();
  } catch (err) {
    console.error('[Perplexity] Request failed:', err.message);
    return [];
  }

  let topics;
  try {
    const content = raw.choices?.[0]?.message?.content ?? '';
    topics = JSON.parse(content);
    if (!Array.isArray(topics)) throw new Error('Response is not an array');
  } catch (err) {
    console.error('[Perplexity] Failed to parse response:', err.message);
    return [];
  }

  const signals = topics.filter(t => t.meme_potential >= 7);
  const created_at = new Date().toISOString();

  for (const t of signals) {
    insertSignal({
      title: t.topic,
      source: 'perplexity',
      score: t.meme_potential,
      reasoning: JSON.stringify({
        summary: t.summary,
        crypto_exists: t.crypto_exists,
        keywords: t.keywords,
        category: t.category,
      }),
      created_at,
      used: 0,
    });
  }

  return signals;
}

export function getLatestSignals() {
  const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  return db
    .prepare(
      `SELECT * FROM signals WHERE source = 'perplexity' AND used = 0 AND created_at >= ? ORDER BY score DESC`
    )
    .all(since);
}

// --- Standalone test ---

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('[Perplexity] Running standalone scan...');
  const signals = await runPerplexityScan();
  if (signals.length === 0) {
    console.log('[Perplexity] No high-potential signals found (or scan skipped).');
  } else {
    console.log(`[Perplexity] ${signals.length} signal(s) with meme_potential >= 7:\n`);
    for (const s of signals) {
      console.log(`  [${s.meme_potential}/10] ${s.topic} (${s.category})`);
      console.log(`    ${s.summary}`);
      console.log(`    keywords: ${s.keywords.join(', ')}`);
      console.log(`    crypto_exists: ${s.crypto_exists}\n`);
    }
  }
}
