// Versus rounds, verdicts and radar geometry, the instant-navigation rules, and tag spellings in the recommender.
const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { barPercent, bestTitleMatch, compactNumber, duelRadar, sharedTags, versus } = require('../../lib/versus');
const { SAFE_PAGES, SPECULATION_RULES, patternsFor } = require('../../lib/speculation');
const { gameplayTags } = require('../../lib/recommender');

const side = (changes = {}) => ({
  title: 'Left', rating: 4.5, steamPositive: 90, steamReviews: 50000, tracked: 3, memberReviews: 2,
  gameplay: null, story: null, visuals: null, audio: null, value: null, tags: ['open world', 'rpg'], ...changes,
});

describe('Versus rounds', () => {
  it('gives each round to the better number and calls small gaps a draw', () => {
    const result = versus(side(), side({ title: 'Right', rating: 4.48, steamPositive: 95, steamReviews: 900, tracked: 3, memberReviews: 5 }));
    const winners = Object.fromEntries(result.rounds.map((round) => [round.key, round.winner]));
    assert.deepEqual(winners, { rating: 'draw', steamPositive: 'right', steamReviews: 'left', tracked: 'draw', memberReviews: 'right' });
    assert.deepEqual(result.score, { left: 1, right: 2, draws: 2 });
    assert.equal(result.verdict.winner, 'right');
    assert.equal(result.verdict.text, 'Right edges it, 2–1');
  });

  it('leaves out rounds without data for both games instead of guessing', () => {
    const result = versus(side({ steamPositive: null, story: 4 }), side({ title: 'Right', story: null, tracked: 0, memberReviews: 0 }));
    assert.ok(!result.rounds.some((round) => ['steamPositive', 'story'].includes(round.key)));
    const empty = versus(side({ tracked: 0, memberReviews: 0 }), side({ title: 'Right', tracked: 0, memberReviews: 0 }));
    assert.ok(!empty.rounds.some((round) => round.key === 'tracked'), 'two zero counts are not a round');
  });

  it('names the size of the win', () => {
    const big = versus(side({ rating: 5, steamPositive: 99, steamReviews: 9e6, tracked: 9, memberReviews: 9 }), side({ title: 'Right', rating: 2, steamPositive: 40, steamReviews: 10, tracked: 1, memberReviews: 1 }));
    assert.equal(big.verdict.text, 'Left wins by a knockout, 5–0');
    const tie = versus(side(), side({ title: 'Right' }));
    assert.deepEqual(tie.verdict, { winner: 'draw', text: 'Too close to call: a draw' });
    const none = versus({ title: 'A' }, { title: 'B' });
    assert.deepEqual(none.verdict, { winner: 'draw', text: 'Not enough data to call it yet' });
  });

  it('draws bars against the maximum, or against the larger count on a log scale', () => {
    assert.equal(barPercent(4, 2, { max: 5 }), 80);
    assert.equal(barPercent(100, 10000, { log: true }), 50);
    assert.equal(barPercent(0, 5, {}), 0);
    assert.equal(barPercent(1, 100, {}), 6, 'a non-zero count stays visible');
    assert.equal(compactNumber(834397), '834K');
    assert.equal(compactNumber(9939791), '9.9M');
    assert.equal(compactNumber(4200), '4.2K');
  });

  it('lists shared tags and the recommender similarity as a percentage', () => {
    assert.deepEqual(sharedTags(['open world', 'RPG', 'horror'], ['rpg', 'open world']), ['open world', 'RPG']);
    assert.equal(versus(side(), side(), { similarity: 0.234 }).similarity, 23);
    assert.equal(versus(side(), side()).similarity, null);
  });

  it('builds a two-shape radar only with three aspects or more', () => {
    const scored = versus(side({ gameplay: 5, story: 4, visuals: 3 }), side({ title: 'Right', gameplay: 3, story: 5, visuals: 4 }));
    const radar = duelRadar(scored, { size: 200, padding: 40 });
    assert.equal(radar.labels.length, 3);
    assert.equal(radar.left.split(' ').length, 3);
    assert.equal(radar.left.split(' ')[0], '100.0,40.0', 'a 5 reaches the outer ring at the top');
    assert.equal(duelRadar(versus(side({ gameplay: 5 }), side({ gameplay: 4 }))), null);
  });

  it('finds the game a typed name means', () => {
    const games = [
      { title: 'Elden Ring Nightreign', steam_reviews: 100 },
      { title: 'Elden Ring', steam_reviews: 50 },
      { title: 'Ring Fit', steam_reviews: 999 },
    ];
    assert.equal(bestTitleMatch('elden ring', games).title, 'Elden Ring');
    assert.equal(bestTitleMatch('elden', games).title, 'Elden Ring Nightreign', 'the most reviewed of the titles starting with it');
    assert.equal(bestTitleMatch('ring', games).title, 'Ring Fit');
    assert.equal(bestTitleMatch('', games), null);
    assert.equal(bestTitleMatch('x', []), null);
  });
});

describe('instant navigation rules', () => {
  it('prefetch only safe pages, with and without a query', () => {
    assert.deepEqual(patternsFor(['/games', true]), ['/games', '/games\\?*', '/games/*', '/games/*\\?*']);
    const patterns = SPECULATION_RULES.prefetch[0].where.and[0].href_matches;
    assert.equal(patterns.length, SAFE_PAGES.reduce((sum, [, nested]) => sum + (nested ? 4 : 2), 0));
    for (const path of ['/logout', '/notifications', '/account/export', '/dev/mailbox', '/moderation']) {
      assert.ok(!patterns.some((pattern) => pattern.startsWith(path)), `${path} is never fetched early`);
    }
    assert.equal(SPECULATION_RULES.prefetch[0].eagerness, 'moderate');
  });
});

describe('tag spellings', () => {
  it('treats Steam\'s and the hand-picked spellings of a tag as one tag', () => {
    assert.deepEqual(gameplayTags('Souls-like, soulslike, Coop, co-op, city-builder, open world'), ['soulslike', 'co-op', 'city builder', 'open world']);
  });
});
