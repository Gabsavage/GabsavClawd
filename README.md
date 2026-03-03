# OpenClawd

An autonomous meme token scout system that discovers, filters, and reports on emerging meme tokens.

## Project Structure

```
OpenClawd/
├── src/
│   ├── scout/       # Token discovery and data fetching
│   ├── filter/      # Scoring, filtering, and ranking logic
│   ├── creative/    # Content generation (memes, captions, reports)
│   └── bot/         # Bot interface and automation (Telegram, Discord, etc.)
├── package.json
└── README.md
```

## Modules

- **scout** — Monitors on-chain data, DEX listings, and social feeds to discover new meme tokens.
- **filter** — Applies scoring and filtering rules to surface the most relevant tokens.
- **creative** — Generates meme content, summaries, and alerts for discovered tokens.
- **bot** — Delivers alerts and interacts with users via messaging platforms.

## Getting Started

```bash
npm install
npm start
```

## Development

```bash
npm run dev
```
