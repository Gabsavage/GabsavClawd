import { fileURLToPath } from 'url';
import db, { insertSignal } from '../database/db.js';

const API_URL = 'https://api.perplexity.ai/chat/completions';

const SYSTEM_MESSAGE =
  'You are a meme token scout for pump.fun, a Solana meme token launchpad. \n' +
  'Your job is to identify topics that are currently gaining momentum — not yet viral, \n' +
  'but clearly on the rise — that have strong meme token potential on pump.fun.\n\n' +
  'You monitor the entire internet: mainstream media (CNN, BBC, NYT, Fox), Twitter/X, \n' +
  'Reddit, crypto media, and general web buzz. You synthesize all sources into a unified \n' +
  'signal score.\n\n' +
  'PRIORITY CATEGORIES (in order of importance):\n' +
  '1. Politics — Trump, Washington drama, absurd political moments, geopolitical chaos\n' +
  '2. Viral animals — any animal making news or going viral for any reason\n' +
  '3. Geopolitics — wars, tensions, unexpected world events, regime changes\n' +
  '4. Internet culture — memes, viral moments, absurd trends, anything weird going viral\n\n' +
  'AVOID:\n' +
  '- Sports news (unless an athlete is involved in non-sport drama)\n' +
  '- Pure economic data (inflation reports, interest rate decisions)\n' +
  '- Tragedies or mass casualty events\n' +
  '- Highly technical or niche topics with no mass appeal\n\n' +
  'TIMING: Focus on topics that are GAINING momentum right now — confirmed rising signals, \n' +
  'not just breaking news (too early) and not already peaked (too late). \n' +
  'The sweet spot is: \'this is clearly getting bigger in the next 24-48 hours\'.\n\n' +
  'Always respond with valid JSON only. No markdown, no preamble, no explanation outside the JSON.';

const USER_MESSAGE =
  'Search the web right now and find 6-8 topics that are gaining momentum as of the last \n' +
  '4 hours. For each topic, evaluate its potential as a meme token on pump.fun.\n\n' +
  'Pump.fun context: meme tokens thrive on absurdity, humor, dark comedy, recognizable \n' +
  'figures doing unexpected things, animals going viral, and geopolitical chaos. \n' +
  'The community is irreverent, degen, and loves satirical takes on current events.\n\n' +
  'For each topic, return:\n' +
  '{\n' +
  '  topic: string (short, punchy name for the topic),\n' +
  '  summary: string (2 sentences max — what happened and why it matters),\n' +
  '  meme_potential: number 1-10 (how tokenizable is this on pump.fun?),\n' +
  '  momentum: string (\'rising\' | \'confirmed\' | \'peaking\') — where is it in its viral arc?,\n' +
  '  why_it_pumps: string (1 sentence — the specific angle that would make degens ape in),\n' +
  '  keywords: string[] (3-5 keywords for DB matching),\n' +
  '  category: string (\'politics\' | \'animal\' | \'geopolitics\' | \'internet\' | \'celebrity\' | \'crypto\' | \'other\'),\n' +
  '  sources: string[] (1-3 source names where this is trending, e.g. [\'Twitter\', \'CNN\', \'Reddit\'])\n' +
  '}\n\n' +
  'Scoring guide for meme_potential:\n' +
  '- 9-10: Absurd political moment, viral animal, unexpected celebrity drama — immediately tokenizable\n' +
  '- 7-8: Strong topic with clear meme angle but needs creative framing\n' +
  '- 5-6: Interesting but niche or too serious\n' +
  '- Below 5: Skip it\n\n' +
  'Only return topics with meme_potential >= 6.\n' +
  'Return a JSON array only, nothing else.';

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

  const signals = topics.filter(t => t.meme_potential >= 6);
  const created_at = new Date().toISOString();

  for (const t of signals) {
    insertSignal({
      title: t.topic,
      source: 'perplexity',
      score: t.meme_potential,
      reasoning: JSON.stringify({
        summary: t.summary,
        keywords: t.keywords,
        category: t.category,
      }),
      momentum: t.momentum ?? null,
      why_it_pumps: t.why_it_pumps ?? null,
      sources: t.sources ? JSON.stringify(t.sources) : null,
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
    console.log(`[Perplexity] ${signals.length} signal(s) with meme_potential >= 6:\n`);
    for (const s of signals) {
      console.log(`  [${s.meme_potential}/10] ${s.topic} (${s.category}) [${s.momentum}]`);
      console.log(`    ${s.summary}`);
      console.log(`    why it pumps: ${s.why_it_pumps}`);
      console.log(`    keywords: ${s.keywords.join(', ')}`);
      console.log(`    sources: ${(s.sources ?? []).join(', ')}\n`);
    }
  }
}
