const TRENDS_RSS_URL = 'https://trends.google.com/trending/rss?geo=US';
const TRENDS_EXPLORE_URL = 'https://trends.google.com/trends/explore?geo=US&q=';
const USER_AGENT = 'OpenClawd/1.0 (autonomous meme token scout)';

// ---------------------------------------------------------------------------
// Minimal XML helpers — no external parser needed for this well-structured feed
// ---------------------------------------------------------------------------

function extractTag(xml, tag) {
  // Handles regular tags and namespaced tags like ht:approx_traffic
  const escaped = tag.replace(':', '\\:');
  const match = xml.match(new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`));
  if (!match) return '';
  // Strip CDATA wrappers if present
  return match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1').trim();
}

function extractItems(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    items.push(m[1]);
  }
  return items;
}

// Items in the Trends RSS feed are already sorted by velocity (hottest first).
// We use rank-based scoring so Trends signals are comparable to Reddit scores,
// rather than relying on raw approx_traffic values which vary wildly in scale.
function rankScore(index, total) {
  return (total - index) * 1_000;
}

// ---------------------------------------------------------------------------
// Scout
// ---------------------------------------------------------------------------

async function scoutTrends() {
  const res = await fetch(TRENDS_RSS_URL, {
    headers: { 'User-Agent': USER_AGENT },
  });

  if (!res.ok) {
    throw new Error(`Google Trends RSS returned ${res.status}`);
  }

  const xml = await res.text();
  const items = extractItems(xml);

  return items
    .map((item, i) => {
      const title = extractTag(item, 'title');
      const pubDate = extractTag(item, 'pubDate');

      return {
        title,
        score: rankScore(i, items.length),
        url: TRENDS_EXPLORE_URL + encodeURIComponent(title),
        subreddit: 'google_trends',
        created_at: pubDate ? new Date(pubDate) : new Date(),
      };
    })
    .filter((s) => s.title); // drop malformed items
}

export default scoutTrends;
