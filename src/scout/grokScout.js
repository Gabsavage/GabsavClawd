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

// Standalone test
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const query = process.argv[2] || 'Trump Iran';
  console.log(`[GrokScout] Testing with query: "${query}"`);
  const context = await getTwitterContext(query);
  console.log('\n--- Twitter Context ---');
  console.log(context || '(empty)');
}
