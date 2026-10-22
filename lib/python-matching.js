// Local JSON bridge. The executable is configuration, never user-controlled shell text.
const { spawnSync } = require('node:child_process');
const path = require('node:path');

function fallback(games, taste) {
  const known = new Set([...taste.history.map((entry) => entry.slug), ...(taste.dismissed || [])]);
  const picks = games.filter((game) => !known.has(game.slug))
    .sort((a, b) => Number(b.rating) - Number(a.rating) || Number(b.year) - Number(a.year))
    .map((game) => ({ slug: game.slug, score: null, match: null, reason: 'Popular with Checkpoint players', traits: [game.genre], basedOn: null }));
  return { engine: 'fallback', picks, scores: [], dna: [], isColdStart: true, knownCount: known.size };
}

function pythonMatching(games, taste, { executable = process.env.PYTHON_BIN || 'python3', timeout = 5000 } = {}) {
  // Keep personal identifiers, email addresses and review text out of the Python input.
  const catalogue = games.map(({ slug, title, genre, tags, platforms, year, description, rating }) => ({ slug, title, genre, tags, platforms, year, description, rating }));
  try {
    const result = spawnSync(executable, [path.join(__dirname, '../python/matching.py')], {
      input: JSON.stringify({ games: catalogue, taste }), encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
    if (result.error || result.status !== 0) throw new Error('Python process unavailable');
    const data = JSON.parse(result.stdout);
    if (data.engine !== 'python' || !Array.isArray(data.picks) || !Array.isArray(data.scores) || !Array.isArray(data.dna)) throw new Error('Invalid Python result');
    return data;
  } catch {
    console.warn('Python matching unavailable. Showing popular games. Check PYTHON_BIN and Python 3.');
    return fallback(games, taste);
  }
}

module.exports = { pythonMatching };
