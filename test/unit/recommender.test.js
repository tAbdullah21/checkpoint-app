const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const {
  buildIndex,
  buildProfile,
  compareProfiles,
  descriptionWords,
  gameplayTags,
  matchPercent,
  recommend,
  scoreGame,
  similarGames,
  tagLabel,
  tasteDna,
  toMatchPercent,
} = require('../../lib/recommender');

const catalogue = [
  { slug: 'dragon-quest', title: 'Dragon Quest', genre: 'Action RPG', tags: 'open world,fantasy', platforms: 'steam,playstation', year: 2022, rating: 4.6, description: 'Explore a vast fantasy kingdom and slay ancient dragons.' },
  { slug: 'sword-saga', title: 'Sword Saga', genre: 'Action RPG', tags: 'open world,fantasy,story rich', platforms: 'steam', year: 2021, rating: 4.4, description: 'A fantasy kingdom torn by war, told through sword fights and choices.' },
  { slug: 'dark-house', title: 'Dark House', genre: 'Survival Horror', tags: 'horror,atmospheric', platforms: 'playstation', year: 2023, rating: 4.7, description: 'Survive a haunted mansion with limited resources.' },
  { slug: 'dark-house-2', title: 'Dark House 2', genre: 'Survival Horror', tags: 'horror,atmospheric', platforms: 'playstation', year: 2025, rating: 4.8, description: 'Return to the haunted mansion and survive the night.' },
  { slug: 'turbo', title: 'Turbo', genre: 'Racing', tags: 'driving,multiplayer', platforms: 'xbox', year: 2024, rating: 4.1, description: 'Race supercars through neon cities at night.' },
  { slug: 'goal', title: 'Goal', genre: 'Sports', tags: 'football,multiplayer,competitive', platforms: 'xbox,steam', year: 2026, rating: 3.9, description: 'Build a football club and win the league.' },
];

const index = buildIndex(catalogue);
const norm = (vector) => Math.sqrt([...vector.values()].reduce((sum, value) => sum + value * value, 0));

describe('buildIndex', () => {
  it('creates one unit-length feature vector per game', () => {
    assert.equal(index.vectors.size, catalogue.length);
    for (const vector of index.vectors.values()) assert.ok(Math.abs(norm(vector) - 1) < 1e-9);
  });

  it('turns genre, genre words, gameplay tags, platforms and era into features', () => {
    const features = [...index.vectors.get('dragon-quest').keys()];
    for (const feature of ['genre:action rpg', 'tag:rpg', 'tag:open world', 'tag:fantasy', 'platform:steam', 'era:modern']) {
      assert.ok(features.includes(feature), `missing ${feature}`);
    }
    assert.ok(features.some((feature) => feature.startsWith('kw:')), 'description keywords are features too');
  });
});

describe('reusing the catalogue vectors', () => {
  it('reuses them while the catalogue is the same, even with other library data', () => {
    const again = buildIndex(catalogue.map((game) => ({ ...game, status: 'playing', rating: 1 })));
    assert.equal(again.vectors, index.vectors, 'the same vectors, not a copy');
    assert.equal(again.games.get('turbo').status, 'playing', 'the rows are the new ones');
  });

  it('builds new ones when a field they are made from changes', () => {
    const changed = buildIndex(catalogue.map((game) => (game.slug === 'turbo' ? { ...game, tags: 'driving,open world' } : game)));
    assert.notEqual(changed.vectors, index.vectors);
    assert.ok(changed.vectors.get('turbo').has('tag:open world'));
    assert.equal(buildIndex(catalogue).vectors.get('turbo').has('tag:open world'), false, 'and the old catalogue gets its own again');
  });
});

describe('similarGames', () => {
  it('ranks the closest game first', () => {
    assert.equal(similarGames(index, 'dragon-quest', 1)[0].slug, 'sword-saga');
    assert.equal(similarGames(index, 'dark-house', 1)[0].slug, 'dark-house-2');
  });

  it('never returns the game itself and respects the limit', () => {
    const similar = similarGames(index, 'turbo', 3);
    assert.equal(similar.length, 3);
    assert.ok(similar.every((item) => item.slug !== 'turbo'));
  });

  it('returns nothing for an unknown game', () => {
    assert.deepEqual(similarGames(index, 'missing'), []);
  });
});

describe('buildProfile and recommend', () => {
  it('falls back to the best-rated games for a new player (cold start)', () => {
    const profile = buildProfile(index, {});
    assert.equal(profile.isEmpty, true);
    const picks = recommend(index, profile, { limit: 3 });
    assert.deepEqual(picks.map((pick) => pick.slug), ['dark-house-2', 'dark-house', 'dragon-quest']);
    assert.ok(picks.every((pick) => pick.match === null && pick.reason === 'Popular with Checkpoint players'));
  });

  it('recommends games similar to a 5-star rating and explains why', () => {
    const profile = buildProfile(index, { history: [{ slug: 'dragon-quest', status: 'completed', rating: 5 }] });
    const [first] = recommend(index, profile, { exclude: new Set(['dragon-quest']), limit: 3 });
    assert.equal(first.slug, 'sword-saga');
    assert.equal(first.reason, 'Because you rated Dragon Quest 5★');
    assert.equal(first.basedOn, 'dragon-quest');
    assert.ok(first.match > 50 && first.match <= 100);
  });

  it('pushes away what the player rated badly', () => {
    const profile = buildProfile(index, {
      history: [
        { slug: 'dragon-quest', status: 'completed', rating: 5 },
        { slug: 'dark-house', status: 'played', rating: 1 },
      ],
    });
    assert.ok(![...profile.vector.keys()].includes('tag:horror'), 'disliked features are dropped from the profile');
    const ranking = recommend(index, profile, { exclude: new Set(['dragon-quest', 'dark-house']), limit: 10 }).map((pick) => pick.slug);
    assert.ok(ranking.indexOf('sword-saga') < ranking.indexOf('dark-house-2'));
  });

  it('uses favourite genres from the profile', () => {
    const profile = buildProfile(index, { favoriteGenres: ['Racing'] });
    const [first] = recommend(index, profile, { limit: 1 });
    assert.equal(first.slug, 'turbo');
    assert.equal(first.reason, 'Matches your favorite genre: Racing');
  });

  it('excludes games the player already knows', () => {
    const profile = buildProfile(index, { history: [{ slug: 'goal', status: 'playing' }] });
    const picks = recommend(index, profile, { exclude: new Set(['goal']), limit: 10 });
    assert.ok(picks.every((pick) => pick.slug !== 'goal'));
    assert.equal(picks.length, catalogue.length - 1);
  });

  it('scores are sorted from best to worst', () => {
    const profile = buildProfile(index, { history: [{ slug: 'turbo', status: 'completed', isFavorite: true }] });
    const scores = recommend(index, profile, { limit: 10 }).map((pick) => pick.score);
    assert.deepEqual(scores, [...scores].sort((first, second) => second - first));
  });
});

describe('scoreGame', () => {
  it('returns null for an unknown game', () => {
    const profile = buildProfile(index, { favoriteGenres: ['RPG'] });
    assert.equal(scoreGame(index, profile, 'missing'), null);
  });

  it('lists readable shared traits without repeating words of a longer label', () => {
    const profile = buildProfile(index, { history: [{ slug: 'dragon-quest', status: 'completed', rating: 5 }] });
    const { traits } = scoreGame(index, profile, 'sword-saga');
    assert.ok(traits.length > 0 && traits.length <= 3);
    assert.ok(traits.includes('Action RPG'));
    assert.ok(!traits.includes('RPG'), '"RPG" is already part of "Action RPG"');
  });
});

describe('matchPercent', () => {
  it('gives the same number as scoreGame for every game, and null for unknown games', () => {
    const profile = buildProfile(index, { history: [{ slug: 'dark-house', status: 'completed', isFavorite: true, rating: 5 }] });
    for (const slug of index.games.keys()) assert.equal(matchPercent(index, profile, slug), scoreGame(index, profile, slug).match, slug);
    assert.equal(matchPercent(index, profile, 'nope'), null);
  });
});

describe('toMatchPercent', () => {
  it('maps 0..1 to 0..100, keeps the order and clamps', () => {
    assert.equal(toMatchPercent(0), 0);
    assert.equal(toMatchPercent(1), 100);
    assert.equal(toMatchPercent(-3), 0);
    assert.equal(toMatchPercent(7), 100);
    const values = [0.1, 0.3, 0.5, 0.7, 0.9].map(toMatchPercent);
    assert.deepEqual(values, [...values].sort((first, second) => first - second));
  });
});

describe('tasteDna and compareProfiles', () => {
  const rpgFan = buildProfile(index, { history: [{ slug: 'dragon-quest', status: 'completed', rating: 5 }], favoriteGenres: ['RPG'] });
  const rpgFan2 = buildProfile(index, { history: [{ slug: 'sword-saga', status: 'completed', rating: 5 }] });
  const racer = buildProfile(index, { history: [{ slug: 'turbo', status: 'completed', rating: 5 }] });

  it('describes a taste as labelled shares', () => {
    const dna = tasteDna(rpgFan);
    assert.ok(dna.length > 0 && dna.length <= 6);
    assert.equal(dna[0].label, 'RPG');
    assert.ok(dna.reduce((sum, trait) => sum + trait.share, 0) <= 101);
  });

  it('finds similar players and the traits they share', () => {
    const close = compareProfiles(rpgFan, rpgFan2);
    const far = compareProfiles(rpgFan, racer);
    assert.ok(close.match > far.match);
    assert.ok(close.shared.includes('RPG') || close.shared.includes('Fantasy'));
    assert.equal(compareProfiles(rpgFan, rpgFan).match, 100);
  });

  it('cannot compare an empty profile', () => {
    assert.equal(compareProfiles(rpgFan, buildProfile(index, {})), null);
  });
});

describe('text features', () => {
  it('keeps meaningful description words only', () => {
    const words = descriptionWords('Explore the vast, haunted world of the Dragon King!');
    assert.deepEqual(words, ['vast', 'haunted', 'dragon', 'king']);
  });

  it('parses and labels gameplay tags', () => {
    assert.deepEqual(gameplayTags(' Open World, co-op ,,RPG'), ['open world', 'co-op', 'rpg']);
    assert.equal(tagLabel('open world'), 'Open World');
    assert.equal(tagLabel('co-op'), 'Co-op');
    assert.equal(tagLabel('rpg'), 'RPG');
    assert.equal(tagLabel('sci-fi'), 'Sci-fi');
  });
});
