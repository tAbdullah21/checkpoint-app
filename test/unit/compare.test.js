// "Compare tastes" (2.2): merging two taste profiles, comparing two libraries and the two-player radar.
const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { compareLibraries, mergeDna } = require('../../lib/compare');
const { compareRadar } = require('../../lib/radar');

const game = (slug, status, extra = {}) => ({ slug, title: slug.toUpperCase(), genre: 'RPG', status, is_favorite: 0, ...extra });

describe('mergeDna', () => {
  it('keeps the traits that matter most to both players, with each share', () => {
    const merged = mergeDna(
      [{ label: 'RPG', share: 30 }, { label: 'Horror', share: 5 }],
      [{ label: 'RPG', share: 10 }, { label: 'Racing', share: 25 }],
      2,
    );
    assert.deepEqual(merged, [
      { label: 'RPG', first: 30, second: 10 },
      { label: 'Racing', first: 0, second: 25 },
    ]);
  });

  it('handles a missing profile', () => {
    assert.deepEqual(mergeDna(null, [{ label: 'RPG', share: 10 }]), [{ label: 'RPG', first: 0, second: 10 }]);
  });
});

describe('compareLibraries', () => {
  const mine = [game('elden-ring', 'completed'), game('hades', 'playing'), game('celeste', 'completed', { is_favorite: 1 })];
  const theirs = [game('elden-ring', 'played'), game('hades', 'completed'), game('doom', 'completed'), game('fifa', 'want_to_play')];
  const result = compareLibraries({
    mine,
    theirs,
    myRatings: new Map([['elden-ring', 5], ['hades', 2]]),
    theirRatings: new Map([['elden-ring', 4], ['hades', 5], ['doom', 5]]),
  });

  it('finds the shared games and whether the ratings agree', () => {
    assert.deepEqual(result.shared.map((entry) => [entry.slug, entry.verdict]), [['elden-ring', 'agree'], ['hades', 'disagree']]);
    assert.deepEqual(result.agreement, { agree: 1, rated: 2 });
    assert.equal(result.shared[0].theirs.status, 'played');
  });

  it('recommends only loved games the other player does not track', () => {
    assert.deepEqual(result.theyRecommend.map((entry) => entry.slug), ['doom'], 'a wishlist game is not a recommendation');
    assert.equal(result.theyRecommend[0].theirRating, 5);
    assert.deepEqual(result.youRecommend.map((entry) => entry.slug), ['celeste']);
  });

  it('works with empty libraries', () => {
    const empty = compareLibraries();
    assert.deepEqual(empty.shared, []);
    assert.deepEqual(empty.agreement, { agree: 0, rated: 0 });
  });
});

describe('compareRadar', () => {
  it('needs at least three traits', () => {
    assert.equal(compareRadar([{ label: 'RPG', first: 1, second: 2 }]), null);
  });

  it('draws both players on one shared scale', () => {
    const chart = compareRadar([
      { label: 'RPG', first: 40, second: 10 },
      { label: 'Action', first: 10, second: 40 },
      { label: 'Story', first: 20, second: 20 },
    ]);
    assert.equal(chart.first.dots.length, 3);
    assert.equal(chart.second.dots.length, 3);
    // The strongest value on each axis reaches the outer ring (radius 100 from the centre at 170).
    assert.equal(chart.first.dots[0].y, 70);
    assert.equal(chart.second.dots[0].y, 145);
    assert.equal(chart.labels[2].first, 20);
  });
});
