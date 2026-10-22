const { it } = require('node:test');
const assert = require('node:assert/strict');
const { pythonMatching } = require('../../lib/python-matching');
const games = [
  { slug: 'known', title: 'Known', genre: 'RPG', tags: 'open world', platforms: 'steam', year: 2025, rating: 4.5 },
  { slug: 'new', title: 'New', genre: 'RPG', tags: 'open world', platforms: 'steam', year: 2025, rating: 4.5 },
];
const taste = { history: [{ slug: 'known', rating: 4.5 }], favoriteGenres: [], preferredPlatform: '' };
it('executes Python and receives explained scores without known games', () => {
  const result = pythonMatching(games, taste);
  assert.equal(result.engine, 'python');
  assert.deepEqual(result.picks.map((pick) => pick.slug), ['new']);
  assert.equal(result.picks[0].basedOn, 'known');
  assert.ok(result.picks[0].match > 0);
});
it('uses unscored popular picks if Python is missing, fails, or times out', () => {
  for (const options of [{ executable: '/missing/checkpoint-python' }, { executable: process.execPath }, { timeout: 1 }]) {
    const result = pythonMatching(games, taste, options);
    assert.equal(result.engine, 'fallback');
    assert.deepEqual(result.picks.map((pick) => pick.slug), ['new']);
    assert.equal(result.picks[0].match, null);
    assert.equal(result.scores.length, 0);
  }
});

it('keeps dismissed games out of fallback recommendations', () => {
  const result = pythonMatching(games, { ...taste, dismissed: ['new'] }, { executable: '/missing/python' });
  assert.equal(result.engine, 'fallback');
  assert.deepEqual(result.picks, []);
});
