const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { buildWrapped } = require('../../lib/wrapped');
const { describeActivity } = require('../../lib/activity');
const { escapeXml, placeholderCoverSvg } = require('../../lib/placeholder-cover');

const entry = (genre, status, extra = {}) => ({ genre, status, is_favorite: 0, ...extra });

describe('buildWrapped', () => {
  it('has an empty state for a new player', () => {
    const wrapped = buildWrapped({});
    assert.equal(wrapped.isEmpty, true);
    assert.equal(wrapped.archetype.name, 'The Rising Player');
    assert.equal(wrapped.averageRating, null);
  });

  it('counts statuses, genres and ratings', () => {
    const wrapped = buildWrapped({
      library: [entry('Action RPG', 'completed'), entry('Action RPG', 'completed'), entry('Racing', 'playing'), entry('Sports', 'want_to_play')],
      reviews: [{ rating: 5, like_count: 2 }, { rating: 4, like_count: 1 }],
      member: { follower_count: 3, following_count: 1 },
    });
    assert.equal(wrapped.tracked, 4);
    assert.equal(wrapped.completionRate, 50);
    assert.equal(wrapped.topGenre.name, 'Action RPG');
    assert.equal(wrapped.genres[0].width, 100);
    assert.equal(wrapped.genres[1].width, 50);
    assert.equal(wrapped.averageRating, 4.5);
    assert.equal(wrapped.likesReceived, 3);
    assert.deepEqual(wrapped.distribution.map((bucket) => bucket.stars), [5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5]);
    assert.equal(wrapped.distribution[0].width, 100);
  });

  it('picks a player type', () => {
    const critic = buildWrapped({ library: [entry('RPG', 'played')], reviews: [{ rating: 2 }, { rating: 3 }, { rating: 3 }] });
    assert.equal(critic.archetype.name, 'The Critic');

    const completionist = buildWrapped({ library: [entry('A', 'completed'), entry('B', 'completed'), entry('C', 'completed'), entry('D', 'playing')] });
    assert.equal(completionist.archetype.name, 'The Completionist');

    const dreamer = buildWrapped({ library: [entry('A', 'want_to_play'), entry('B', 'want_to_play'), entry('C', 'want_to_play'), entry('D', 'played')] });
    assert.equal(dreamer.archetype.name, 'The Dreamer');

    const specialist = buildWrapped({ library: [entry('Racing', 'played'), entry('Racing', 'playing'), entry('Sports', 'played')] });
    assert.equal(specialist.archetype.name, 'The Racing Specialist');
  });
});

describe('describeActivity', () => {
  const base = { id: 1, user_id: 7, user_name: 'Lina', created_at: '2026-10-14 10:00:00' };
  const now = Date.parse('2026-10-14T10:30:00Z');

  it('writes a sentence for each kind of activity', () => {
    const rated = describeActivity({ ...base, type: 'review', detail: '4', game_slug: 'elden-ring', game_title: 'Elden Ring' }, now);
    assert.equal(rated.verb, 'rated');
    assert.equal(rated.object, 'Elden Ring');
    assert.equal(rated.objectUrl, '/games/elden-ring');
    assert.equal(rated.stars, 4);
    assert.equal(rated.time, '30 min ago');

    const added = describeActivity({ ...base, type: 'library_add', detail: 'want_to_play', game_slug: 'x', game_title: 'X' }, now);
    assert.equal(`${added.verb} ${added.object} ${added.suffix}`, 'added X to Want to Play');

    const follow = describeActivity({ ...base, type: 'follow', target_id: 9, target_name: 'Omar' }, now);
    assert.equal(follow.objectUrl, '/members/9');

    const list = describeActivity({ ...base, type: 'list_add', game_slug: 'x', game_title: 'X', list_id: 3, list_title: 'Co-op' }, now);
    assert.equal(list.suffix, 'to “Co-op”');

    const finished = describeActivity({ ...base, type: 'status_change', detail: 'completed', game_slug: 'x', game_title: 'X' }, now);
    assert.equal(finished.verb, 'completed');
  });

  it('keeps star values in range and survives unknown types', () => {
    assert.equal(describeActivity({ ...base, type: 'review', detail: '99' }, now).stars, 5);
    assert.equal(describeActivity({ ...base, type: 'something-new' }, now).verb, 'was active');
  });
});

describe('placeholder covers', () => {
  it('escapes text so a title cannot inject markup', () => {
    assert.equal(escapeXml(`<a href="x">Tom & Jerry's</a>`), '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;');
    const svg = placeholderCoverSvg({ title: 'Doom <Eternal>', year: 2020, genre: 'Shooter & More' });
    assert.ok(svg.startsWith('<svg'));
    assert.ok(svg.includes('&lt;ETERNAL&gt;'));
    assert.ok(svg.includes('Shooter &amp; More'));
    assert.ok(!svg.includes('<Eternal>'));
  });
});
