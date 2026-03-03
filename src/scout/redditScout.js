const SUBREDDITS = [
  'solana',
  'memecoin',
  'SatoshiStreetBets',
  'wallstreetbets',
  'Superstonk',
  'dogecoin',
  'shitposting',
  'okbuddyretard',
];

const USER_AGENT = 'OpenClawd/1.0 (autonomous meme token scout)';

async function fetchSubredditSignals(subreddit) {
  const url = `https://www.reddit.com/r/${subreddit}/top.json?limit=25&t=day`;

  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
  });

  if (!res.ok) {
    throw new Error(`Reddit API returned ${res.status} for r/${subreddit}`);
  }

  const json = await res.json();

  return json.data.children.map((post) => ({
    title: post.data.title,
    score: post.data.score,
    url: `https://www.reddit.com${post.data.permalink}`,
    subreddit: post.data.subreddit,
    created_at: new Date(post.data.created_utc * 1000),
  }));
}

async function scoutReddit() {
  const results = await Promise.all(
    SUBREDDITS.map((subreddit) =>
      fetchSubredditSignals(subreddit).catch((err) => {
        console.warn(`[redditScout] Skipping r/${subreddit}: ${err.message}`);
        return [];
      })
    )
  );

  return results.flat().sort((a, b) => b.score - a.score);
}

export { fetchSubredditSignals };
export default scoutReddit;
