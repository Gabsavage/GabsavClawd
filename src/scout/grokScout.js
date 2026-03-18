const GROK_API_URL = 'https://api.x.ai/v1/chat/completions';

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

export async function scanCryptoTwitter() {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    console.warn('[GrokScout] XAI_API_KEY not set — skipping CT scan.');
    return [];
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
            content: 'You are a Crypto Twitter trend spotter. You search X/Twitter and find memes, narratives, jokes, characters, and cultural moments that are RISING on Crypto Twitter right now. You are NOT looking for token launches or price action — you are looking for the CULTURE that tokens get built on. Always respond in English with valid JSON only, no markdown.'
          },
          {
            role: 'user',
            content: `Today is ${today}. Search Crypto Twitter right now.

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
    const raw = data.choices?.[0]?.message?.content ?? '';
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

// Standalone test
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const query = process.argv[2] || 'Trump Iran';
  console.log(`[GrokScout] Testing with query: "${query}"`);
  const context = await getTwitterContext(query);
  console.log('\n--- Twitter Context ---');
  console.log(context || '(empty)');
}
