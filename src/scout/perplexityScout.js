import { fileURLToPath } from 'url';
import db, { insertSignal } from '../database/db.js';

const API_URL = 'https://api.perplexity.ai/chat/completions';

const SYSTEM_MESSAGE =
  'You are a real-time news wire service. Your ONLY job is to report what topics are generating the most online conversation RIGHT NOW, as of ' + new Date().toISOString().split('T')[0] + '.\n\n' +
  'You are a REPORTER, not an analyst. Report facts and buzz levels. Do not editorialize, do not judge humor potential, do not try to be creative.\n\n' +
  'SOURCES YOU MONITOR:\n' +
  '- US mainstream media: CNN, Fox News, NYT, AP, Reuters, NBC, ABC\n' +
  '- Social platforms: X/Twitter trending, Reddit front page, TikTok trending\n' +
  '- Internet culture: Know Your Meme, YouTube trending\n' +
  '- Crypto media: CoinDesk, The Block, Decrypt — ONLY for major drama (hacks, rug pulls, regulatory bombs), NOT price action\n\n' +
  'PRIORITY ORDER (equal weight — you MUST cover multiple categories, not just the top one):\n' +
  '1. Viral content & internet culture — memes, TikTok trends, viral moments, anything breaking through on multiple platforms\n' +
  '2. Entertainment — movie trailers, celebrity drama, gaming events, music releases, TV show moments\n' +
  '3. US Politics — Trump, Congress, White House, culture war moments\n' +
  '4. Major geopolitics — wars, strikes, tensions — ONLY if it dominates US social media\n' +
  '5. Viral animals or creatures\n' +
  '6. Crypto ecosystem — exchange drama, rug pulls, major regulatory moves\n' +
  'SCALE FILTER (CRITICAL):\n' +
  '- A topic MUST be on at least 2 major platforms or outlets to qualify\n' +
  '- "Would the average American scrolling Twitter see this today?" — if no, SKIP\n' +
  '- Regional news, small country politics, niche stories — SKIP unless globally viral\n' +
  '- Better to return 3 strong topics than 6 weak ones\n\n' +
  'NEVER INCLUDE:\n' +
  '- Sports scores or game results (unless off-field drama)\n' +
  '- Economic data (CPI, rates, jobs)\n' +
  '- Anything you cannot back with real, named sources from the last 48 hours\n\n' +
  'Always respond with valid JSON only. No markdown, no backticks, no explanation.';

const USER_MESSAGE =
  'Today is ' + new Date().toISOString().split('T')[0] + '. Scan the last 72 hours.\n\n' +
  'Return 5-8 topics that are generating the MOST online conversation right now.\n\n' +
  'DIVERSITY REQUIREMENT: You MUST include topics from at least 3 different categories. Do not return more than 3 topics from any single category.\n\n' +
  'For each topic return:\n' +
  '{\n' +
  '  "topic": string (factual name, 2-5 words — like a wire headline, not a meme),\n' +
  '  "summary": string (2 sentences max — what happened, factually),\n' +
  '  "signal_strength": number 1-10,\n' +
  '  "spread": "single_source" | "few_sources" | "widespread",\n' +
  '  "velocity": "emerging" | "growing" | "saturated",\n' +
  '  "shelf_life": "flash" | "days" | "ongoing",\n' +
  '  "category": "politics" | "animal" | "geopolitics" | "internet" | "celebrity" | "crypto" | "other",\n' +
  '  "what_happened": string (1 sentence — the single most shareable or absurd FACT from this story),\n' +
  '  "sources": string[] (2-4 REAL source names — e.g. ["Reuters", "r/worldnews", "@CNN on X"]),\n' +
  '  "source_date": string ("YYYY-MM-DD"),\n' +
  '  "keywords": string[] (3-5 keywords)\n' +
  '}\n\n' +
  'SCORING:\n' +
  '- 9-10: Trending on multiple platforms simultaneously, everyone is talking about it\n' +
  '- 7-8: Strong multi-outlet coverage, clearly in the conversation\n' +
  '- 5-6: Real but limited — a few outlets, not yet mainstream\n' +
  '- Below 5: Do not include\n\n' +
  'FRESHNESS: Only include topics whose most recent source is from the last 48 hours. If you cannot confirm the date, skip it.\n\n' +
  'Return a JSON array only.';

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
    const raw_content = raw.choices?.[0]?.message?.content ?? '';
    const content = raw_content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    topics = JSON.parse(content);
    if (!Array.isArray(topics)) throw new Error('Response is not an array');
  } catch (err) {
    console.error('[Perplexity] Failed to parse response:', err.message);
    return [];
  }

  const signals = topics.filter(t => t.signal_strength >= 6 && (t.spread === 'widespread' || t.spread === 'few_sources') && (t.category !== 'sports' || t.signal_strength >= 9));
  console.log(`[Perplexity] ${signals.length} signal(s): ${signals.map(s => s.topic).join(' | ')}`);
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
      signal_strength: t.signal_strength,
      spread: t.spread ?? null,
      velocity: t.velocity ?? null,
      shelf_life: t.shelf_life ?? null,
      absurdity_angle: t.what_happened ?? null,
      source_date: t.source_date ?? null,
      momentum: t.velocity ?? null,
      why_it_pumps: t.what_happened ?? null,
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
      console.log(`    what_happened: ${s.what_happened}`);
      console.log(`    shelf life: ${s.shelf_life}`);
      console.log(`    keywords: ${s.keywords.join(', ')}`);
      console.log(`    sources: ${(s.sources ?? []).join(', ')}\n`);
    }
  }
}
