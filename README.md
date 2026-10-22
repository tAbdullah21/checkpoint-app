# Checkpoint 0.5

A gaming community app for discovering games, tracking your library, sharing ratings, and getting personalized recommendations.

## Included in this version

- Registration, profiles, and optional preference setup.
- Swipeable half-star ratings (0.5–5), with optional written reviews.
- Libraries: Want to Play, Playing, Played, and Completed.
- Python matching: top five recommendations, more picks below, and private “Not interested” feedback with restore.
- Search with genre, platform, year, and minimum-rating filters.
- Follows, review votes and replies, lists, notifications, game comparisons, and tier lists.
- Light/dark modes and responsive layouts.
- Nine included fictional demo users, with sample libraries, ratings, reviews, and community activity.

## Run locally

Install **Node.js 24+** and **Python 3.10+**. Open the project folder in a terminal:

```bash
npm ci
npm start
```

Open http://localhost:3000. Demo login:



The included `data/checkpoint.db` is already populated with demo users. No seeding step is needed. If you start with a fresh database later, run `npm run seed:demo` to recreate them. Python matching needs no extra packages or API key. If `python3` is unavailable, set `PYTHON_BIN` to your Python executable in `.env`.

Stop with `Ctrl+C`. Run `npm start` to launch again.

## Technology

Node.js, Express, EJS, HTML/CSS, JavaScript, SQLite, and Python.

The demo database is included and allowed by `.gitignore` so it can be uploaded to GitHub. Dependencies and secrets remain excluded. Keep only fictional demo data in the public repository.

Password-reset emails currently use a development mailbox; real email delivery must be configured before public hosting. Human recommendation-quality evaluation is still pending.

Detailed documentation: [Project guide](PROJECT-GUIDE.md) and [Python matching](docs/PYTHON-MATCHING.md).
