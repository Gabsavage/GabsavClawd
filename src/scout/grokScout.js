const GROK_API_URL = 'https://api.x.ai/v1/chat/completions';
const GROK_RESPONSES_URL = 'https://api.x.ai/v1/responses';

export async function getTwitterContext(query, options = {}) {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    console.warn('[GrokScout] XAI_API_KEY not set — skipping Twitter context.');
    return '';
  }

  try {
    const res = await fetch(GROK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'grok-4-1-fast-non-reasoning',
        messages: [
          {
            role: 'system',
            content: 'You are a Crypto Twitter (CT) analyst. You search X/Twitter and report what the crypto community is saying about a given topic. You report RAW conversations, slang, memes, and sentiment — you do NOT editorialize or analyze. Report what people are ACTUALLY posting. Always respond in English.'
          },
          {
            role: 'user',
            content: `Search X/Twitter for what Crypto Twitter is saying about: "${query}"

Report back:
1. VIBE: One sentence — is CT bullish, bearish, memeing, ignoring, or fighting about this?
2. TOP ANGLES: 2-4 specific takes, jokes, or memes people are posting (use their actual words/slang when possible)
3. SLANG & NAMES: Any nicknames, hashtags, or slang CT is using for this topic
4. MEME POTENTIAL: What visual or concept is CT already turning into memes?

If CT is not talking about this topic at all, just say "CT silent on this" and nothing else.
Keep it under 200 words. Raw CT energy, not analyst report.`
          }
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[GrokScout] API error ${res.status}: ${text}`);
      return '';
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? '';
    console.log(`[GrokScout] Twitter context for "${query}": ${content.slice(0, 100)}...`);
    return content;

  } catch (err) {
    console.error('[GrokScout] Request failed:', err.message);
    return '';
  }
}

export async function analyzeTokenNarrative(token) {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    console.warn('[GrokScout] XAI_API_KEY not set — skipping token narrative analysis.');
    return null;
  }

  const today = new Date().toISOString().split('T')[0];

  try {
    const res = await fetch(GROK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'grok-4-1-fast-non-reasoning',
        messages: [
          {
            role: 'system',
            content: 'You are a Crypto Twitter analyst. Search X/Twitter and pump.fun community chatter to understand WHY specific tokens are pumping. Report raw CT energy, slang, and memes. Always respond in English with valid JSON only, no markdown.',
          },
          {
            role: 'user',
            content: `Today is ${today}. This token is pumping on pump.fun right now: "${token.name}" ($${token.ticker}) — +${token.price_change_h1 || 0}% in the last hour, $${token.volume_usd_h1 || 0} volume.

Search X/Twitter and CT. Find WHY it's pumping and what CT is saying.

Return JSON:
{
  "why_pumping": string (1-2 sentences — the real event, meme, or narrative driving the pump, or "pure hype / no clear reason"),
  "ct_reaction": string (2-3 sentences — what people are actually posting, use their exact slang),
  "meme_angle": string (1 sentence — the specific visual or concept CT is turning into a meme),
  "vibe": "bullish" | "ironic" | "chaotic" | "mocking" | "hyping"
}

If CT is completely silent on this token (not mentioned anywhere), return: {"ct_silent": true}`,
          },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[GrokScout] analyzeTokenNarrative error ${res.status}: ${text}`);
      return null;
    }

    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content ?? '';
    const content = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    let result;
    try {
      result = JSON.parse(content);
    } catch {
      console.error('[GrokScout] analyzeTokenNarrative JSON parse failed. Raw:', content.slice(0, 300));
      return null;
    }

    if (result.ct_silent) {
      console.log(`[GrokScout] CT silent on "${token.name}" ($${token.ticker})`);
      return null;
    }

    console.log(`[GrokScout] Narrative for "${token.name}": ${result.why_pumping?.slice(0, 80)}...`);
    return result;

  } catch (err) {
    console.error('[GrokScout] analyzeTokenNarrative failed:', err.message);
    return null;
  }
}

export async function scanCryptoTwitter() {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    console.warn('[GrokScout] XAI_API_KEY not set — skipping CT scan.');
    return [];
  }

  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  try {
    const res = await fetch(GROK_RESPONSES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'grok-4-1-fast-non-reasoning',
        include: ['no_inline_citations'],
        tools: [{ type: 'x_search', from_date: yesterday, to_date: today }],
        input: [
          {
            role: 'system',
            content: 'You are a Crypto Twitter trend spotter. You search X/Twitter and find memes, narratives, jokes, characters, and cultural moments that are RISING on Crypto Twitter right now. You are NOT looking for token launches or price action — you are looking for the CULTURE that tokens get built on. Always respond in English with valid JSON only, no markdown.'
          },
          {
            role: 'user',
            content: `Today is ${today}. Search Crypto Twitter in the last 24 hours.

Find 3-5 memes, narratives, jokes, or cultural moments that are GAINING TRACTION on CT in the last few hours. These are NOT tokens — these are the TOPICS and MEMES that degens are posting about, arguing about, or turning into jokes.

Examples of what you're looking for:
- A new inside joke spreading across CT ("we're so back" / "it's over" cycles)
- A crypto personality doing something absurd
- A mainstream event that CT is memeing in their own way
- A new visual meme or format gaining traction
- A narrative shift (from bearish to bullish, or a new meta like "AI coins" or "political coins")

For each trend return:
{
  "trend": string (2-5 words, the meme/narrative name),
  "what_ct_says": string (2-3 sentences — what people are ACTUALLY posting, use their slang),
  "vibe": "bullish" | "bearish" | "chaotic" | "ironic" | "angry",
  "meme_potential": string (1 sentence — what visual or concept is emerging),
  "keywords": string[] (3-5 keywords for matching)
}

RULES:
- Focus on what's RISING, not what's been around for weeks.
- Use the actual slang and language CT uses.

Return a JSON array only.`
          }
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[GrokScout] CT scan API error ${res.status}: ${text}`);
      return [];
    }

    const data = await res.json();
    const msgOutput = data.output?.find(o => o.type === 'message');
    const raw = msgOutput?.content?.[0]?.text ?? '';
    const content = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const trends = JSON.parse(content);

    if (!Array.isArray(trends)) return [];

    console.log(`[GrokScout] CT scan: ${trends.length} trend(s): ${trends.map(t => t.trend).join(' | ')}`);
    return trends;

  } catch (err) {
    console.error('[GrokScout] CT scan failed:', err.message);
    return [];
  }
}

export async function analyzeNewsMemePotential(signal) {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    console.warn('[GrokScout] XAI_API_KEY not set — skipping news meme potential analysis.');
    return null;
  }

  const today = new Date().toISOString().split('T')[0];
  const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().split('T')[0];

  const namedEntities = signal.named_entities
    ?? (() => { try { return JSON.parse(signal.reasoning || '{}').named_entities; } catch { return null; } })()
    ?? [];

  try {
    const res = await fetch(GROK_RESPONSES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'grok-4-1-fast-non-reasoning',
        include: ['no_inline_citations'],
        tools: [{ type: 'x_search', from_date: twoDaysAgo, to_date: today }],
        input: [
          {
            role: 'system',
            content: 'You are a Crypto Twitter analyst. Search X/Twitter to find out if and how the crypto community is reacting to real-world news topics. Report raw CT energy, slang, memes, and the specific angle degens are taking. Always respond in English with valid JSON only, no markdown.',
          },
          {
            role: 'user',
            content: `Today is ${today}. This topic is in the news right now: "${signal.topic}"

What happened: ${signal.summary}

Search X/Twitter and CT. Is the crypto community talking about this? What angle are they taking? Is there already a meme emerging?
${namedEntities.length > 0
  ? `\nPROPER NOUNS IDENTIFIED IN THIS STORY: ${namedEntities.join(', ')}\nCT may be using these exact names. Confirm or refine — use them in key_character_or_moment and trending_words if CT is actually using them.\n`
  : ''}
Return JSON:
{
  "meme_angle": string (the specific angle CT is exploiting — NOT the headline, the joke/meme/absurd take),
  "ct_reaction": string (2-3 sentences — what people are actually posting, use their exact slang),
  "key_character_or_moment": string (the EXACT proper noun CT is using — a real name, nickname, ticker, or animal name. If no named entity is central, use a tight moment label. NEVER a vague description. Good: "Punch", "SMCI", "Hawk Tuah". Bad: "the monkey", "the chip company", "the viral moment"),
  "visual_potential": string (1 sentence — what would work as a pump.fun thumbnail),
  "trending_words": string[] (3-5 exact words or phrases CT is using for this topic)
}

If CT is completely silent on this topic (not mentioned at all), return: {"ct_silent": true}`,
          },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[GrokScout] analyzeNewsMemePotential error ${res.status}: ${text}`);
      return null;
    }

    const data = await res.json();
    const msgOutput = data.output?.find(o => o.type === 'message');
    const raw = msgOutput?.content?.[0]?.text ?? '';
    const content = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    let result;
    try {
      result = JSON.parse(content);
    } catch {
      console.error('[GrokScout] analyzeNewsMemePotential JSON parse failed. Raw:', content.slice(0, 300));
      return null;
    }

    if (result.ct_silent) {
      console.log(`[GrokScout] CT silent on news topic "${signal.topic}"`);
      return null;
    }

    console.log(`[GrokScout] Meme potential for "${signal.topic}": ${result.meme_angle?.slice(0, 80)}...`);
    return result;

  } catch (err) {
    console.error('[GrokScout] analyzeNewsMemePotential failed:', err.message);
    return null;
  }
}

// Standalone test
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const query = process.argv[2] || 'Trump Iran';
  console.log(`[GrokScout] Testing with query: "${query}"`);
  const context = await getTwitterContext(query);
  console.log('\n--- Twitter Context ---');
  console.log(context || '(empty)');
}
