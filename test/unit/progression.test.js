// Pure helpers added with the 2.1 redesign: levels and achievements, the radar chart, view helpers and day labels.
const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { ACHIEVEMENTS, LEVEL_STEP, buildAchievements, experienceFor, levelFor, progressionFor } = require('../../lib/achievements');
const { dayLabel } = require('../../lib/activity');
const { radarChart } = require('../../lib/radar');
const { hueFor, icon, plural, starString, statusMeta } = require('../../lib/view-helpers');

describe('experience and levels', () => {
  it('adds up experience from every kind of activity', () => {
    assert.equal(experienceFor({}), 0);
    assert.equal(experienceFor({ tracked: 6, completed: 3, reviews: 4, helpful: 5, lists: 1, followers: 5 }), 320);
  });

  it('ignores negative, fractional and missing numbers', () => {
    assert.equal(experienceFor({ tracked: -4, completed: 1.9, reviews: 'x' }), 30);
  });

  it('turns experience into a level with progress to the next one', () => {
    assert.deepEqual(levelFor(0), { level: 1, title: 'Rookie', xp: 0, nextLevelXp: LEVEL_STEP, toNext: LEVEL_STEP, progress: 0 });
    const level = levelFor(320);
    assert.equal(level.level, 3);
    assert.equal(level.title, 'Adventurer');
    assert.equal(level.nextLevelXp, 360);
    assert.equal(level.toNext, 40);
    assert.equal(level.progress, 80);
  });

  it('keeps the last title for very high levels', () => {
    assert.equal(levelFor(100000).title, 'Mythic');
  });
});

describe('achievements', () => {
  it('starts with everything locked', () => {
    const { list, unlocked, total } = buildAchievements({});
    assert.equal(total, ACHIEVEMENTS.length);
    assert.equal(unlocked, 0);
    assert.ok(list.every((achievement) => achievement.progress === 0 && !achievement.unlocked));
  });

  it('unlocks goals and caps progress at 100%', () => {
    const { list } = buildAchievements({ tracked: 25, reviews: 2 });
    const byId = Object.fromEntries(list.map((achievement) => [achievement.id, achievement]));
    assert.equal(byId['first-save'].unlocked, true);
    assert.equal(byId.collector.unlocked, true);
    assert.equal(byId.collector.progress, 100);
    assert.equal(byId.collector.value, 10);
    assert.equal(byId.critic.unlocked, false);
    assert.equal(byId.critic.progress, 67);
  });

  it('bundles level and achievements', () => {
    const progression = progressionFor({ tracked: 1 });
    assert.equal(progression.level, 1);
    assert.equal(progression.achievements.unlocked, 1);
  });
});

describe('radar chart geometry', () => {
  it('needs at least three traits', () => {
    assert.equal(radarChart([{ label: 'RPG', share: 50 }, { label: 'Action', share: 50 }]), null);
    assert.equal(radarChart(null), null);
  });

  it('draws rings, axes, a shape and labels', () => {
    const chart = radarChart([
      { label: 'RPG', share: 40 },
      { label: 'Fantasy', share: 20 },
      { label: 'Action', share: 10 },
      { label: 'Open World', share: 0 },
    ], { size: 200, padding: 50, levels: 4 });
    assert.equal(chart.rings.length, 4);
    assert.equal(chart.axes.length, 4);
    assert.equal(chart.dots.length, 4);
    // The strongest trait reaches the outer ring, straight up from the centre.
    assert.deepEqual(chart.dots[0], { x: 100, y: 50 });
    // A trait with no share still gets a small visible point instead of collapsing into the centre.
    assert.ok(chart.dots[3].x < 100);
    assert.equal(chart.labels[0].anchor, 'middle');
    assert.equal(chart.labels[1].anchor, 'start');
    assert.equal(chart.labels[3].anchor, 'end');
    assert.match(chart.shape, /^[\d.]+,[\d.]+( [\d.]+,[\d.]+){3}$/);
  });
});

describe('view helpers', () => {
  it('only renders icons from the sprite', () => {
    assert.match(icon('star'), /<use href="#i-star">/);
    assert.match(icon('star', 'icon-sm'), /class="icon icon-sm"/);
    assert.throws(() => icon('"><script>'), /Unknown icon/);
  });

  it('gives every member a stable avatar colour', () => {
    assert.equal(hueFor('Lina Al-Harbi'), hueFor('Lina Al-Harbi'));
    assert.ok(hueFor('Lina') >= 0 && hueFor('Lina') < 360);
    assert.notEqual(hueFor('Lina'), hueFor('Omar'));
  });

  it('formats stars, plurals and statuses', () => {
    assert.match(starString(4.4), /★★★★<span class="star-half"/);
    assert.equal(starString(9), '★★★★★');
    assert.equal(starString(undefined), '☆☆☆☆☆');
    assert.equal(plural(1, 'game'), '1 game');
    assert.equal(plural(2, 'game'), '2 games');
    assert.equal(statusMeta('playing').className, 'status-playing');
    assert.equal(statusMeta('nope'), null);
  });
});

describe('activity day labels', () => {
  // Stored times are UTC; days follow Saudi time (UTC+3), whatever time zone the test machine uses.
  const now = Date.parse('2026-10-14T09:00:00Z'); // noon in Riyadh

  it('groups the feed into today, yesterday and older days', () => {
    assert.equal(dayLabel('2026-10-13 22:30:00', now), 'Today', '01:30 Riyadh time is already the 14th');
    assert.equal(dayLabel('2026-10-13 20:00:00', now), 'Yesterday', '23:00 Riyadh time on the 13th');
    assert.equal(dayLabel('2026-10-10 06:00:00', now), 'Saturday, Oct 10');
    assert.equal(dayLabel('not a date', now), 'Earlier');
  });
});
