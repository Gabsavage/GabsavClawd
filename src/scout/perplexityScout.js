import { fileURLToPath } from 'url';
import db, { insertSignal } from '../database/db.js';

const API_URL = 'https://api.perplexity.ai/chat/completions';

const SYSTEM_MESSAGE =
  'You are a real-time news intelligence analyst. Your job is to identify topics that are currently part of the global conversation — things people are actively talking about, sharing, and reacting to right now.\n\n' +
  'You monitor all layers of the internet:\n' +
  '- Mainstream media (CNN, BBC, NYT, Fox News, AP, Reuters, Al Jazeera)\n' +
  '- Social platforms (X/Twitter, Reddit front page, TikTok trends)\n' +
  '- Internet culture hubs (Know Your Meme, YouTube trending)\n' +
  '- Crypto media (CoinDesk, The Block, Decrypt) — but ONLY for major drama, not market data\n\n' +
  'Your job is NOT to predict what will go viral. Your job is to report what people are ALREADY talking about and reacting to, with a bias toward topics that are GROWING in coverage right now.\n\n' +
  'PRIORITY CATEGORIES (in order):\n' +
  '1. Politics — US politics especially, absurd moments, unexpected statements, scandals, drama\n' +
  '2. Animals — any animal making news, going viral, or generating reactions\n' +
  '3. Geopolitics — wars, tensions, regime changes, unexpected diplomatic moments\n' +
  '4. Internet culture — memes gaining traction, viral moments, absurd trends\n' +
  '5. Celebrities — public figures doing unexpected things, feuds, gaffes\n' +
  '6. Crypto ecosystem — exchange drama, rug pulls, regulatory chaos (NOT price action)\n\n' +
  'EXCLUDE:\n' +
  '- Pure sports scores or results (unless an athlete is involved in off-field drama)\n' +
  '- Economic data releases (CPI, rate decisions, jobs reports)\n' +
  '- Tragedies, mass casualties, school shootings — never\n' +
  '- Highly technical or niche topics with no mass appeal\n' +
  '- Topics that are purely local news with no broader resonance\n\n' +
  'CRITICAL — SOURCE QUALITY:\n' +
  '- You MUST cite real, specific sources for each topic (outlet names at minimum, URLs when possible)\n' +
  '- If you cannot find real sources confirming a topic, DO NOT include it\n' +
  '- Never fabricate or assume sources — if it\'s only on one unverified Twitter account, skip it\n\n' +
  'Always respond with valid JSON only. No markdown, no preamble, no explanation outside the JSON.';

const USER_MESSAGE =
  'Scan the web right now. Find 6-8 topics that people are actively talking about and that have potential for humor, absurdity, or satirical takes.\n\n' +
  'For each topic, evaluate:\n' +
  '- How widespread is the conversation? (1 source vs everywhere)\n' +
  '- Is the coverage growing, stable, or fading?\n' +
  '- Is there an inherently funny, absurd, or ironic angle to this story?\n\n' +
  'For each topic, return:\n' +
  '{\n' +
  '  "topic": string (short factual name, 2-5 words),\n' +
  '  "summary": string (2 sentences max — what happened factually),\n' +
  '  "signal_strength": number 1-10 (how much are people talking about this RIGHT NOW?),\n' +
  '  "spread": "single_source" | "few_sources" | "widespread" (how many places is this being discussed?),\n' +
  '  "velocity": "emerging" | "growing" | "saturated" (is coverage increasing or plateauing?),\n' +
  '  "shelf_life": "flash" | "days" | "ongoing" (will people still care in 48h?),\n' +
  '  "absurdity_angle": string (1 sentence — what makes this funny, ironic, or absurd? If nothing, say "none"),\n' +
  '  "category": "politics" | "animal" | "geopolitics" | "internet" | "celebrity" | "crypto" | "other",\n' +
  '  "sources": string[] (2-4 REAL source names where you found this — e.g. ["Reuters", "r/worldnews", "@CNN on X"]),\n' +
  '  "keywords": string[] (3-5 keywords for matching)\n' +
  '}\n\n' +
  'Scoring guide for signal_strength:\n' +
  '- 9-10: Everyone is talking about this, trending on multiple platforms simultaneously\n' +
  '- 7-8: Strong coverage across several major outlets or platforms\n' +
  '- 5-6: Moderate discussion, limited to a few sources but clearly real\n' +
  '- Below 5: Skip it — not enough signal\n\n' +
  'Only return topics with signal_strength >= 5.\n' +
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

  const signals = topics.filter(t => t.signal_strength >= 5);
  const created_at = new Date().toISOString();

  for (const t of signals) {
    insertSignal({
      title: t.topic,
      source: 'perplexity',
      score: t.signal_strength,
      reasoning: JSON.stringify({
        summary: t.summary,
        keywords: t.keywords,
        category: t.category,
      }),
      momentum: t.velocity ?? null,
      why_it_pumps: t.absurdity_angle ?? null,
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
    console.log('[Perplexity] No signals found (signal_strength >= 5) or scan skipped.');
  } else {
    console.log(`[Perplexity] ${signals.length} signal(s) with signal_strength >= 5:\n`);
    for (const s of signals) {
      console.log(`  [${s.signal_strength}/10] ${s.topic} (${s.category}) [${s.velocity}] [${s.spread}]`);
      console.log(`    ${s.summary}`);
      console.log(`    absurdity: ${s.absurdity_angle}`);
      console.log(`    shelf life: ${s.shelf_life}`);
      console.log(`    keywords: ${s.keywords.join(', ')}`);
      console.log(`    sources: ${(s.sources ?? []).join(', ')}\n`);
    }
  }
}
