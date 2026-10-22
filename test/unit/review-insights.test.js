// Review details without the database: the form check, card and form shapes, the per-aspect breakdown, members
// against Steam, and reviewer badges.
const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const {
  aspectBreakdown, describeDetails, formValues, readReviewDetails, reviewerBadges, scoreComparison,
} = require('../../lib/review-insights');

describe('reading the review details form', () => {
  it('accepts empty fields and well-formed values', () => {
    assert.deepEqual(readReviewDetails({}), {
      details: { aspects: { gameplay: null, story: null, visuals: null, audio: null, value: null }, hours: null, platform: '', spoiler: false },
      errors: [],
    });
    const { details, errors } = readReviewDetails({ aspect_story: '5', aspect_value: '1', hours: '42', platform: 'switch', spoiler: 'on' });
    assert.deepEqual(errors, []);
    assert.equal(details.aspects.story, 5);
    assert.equal(details.hours, 42);
    assert.equal(details.platform, 'switch');
    assert.equal(details.spoiler, true);
  });

  it('refuses tampered values instead of guessing', () => {
    assert.deepEqual(readReviewDetails({ aspect_audio: '6' }).errors, ['Audio must be scored from 0.5 to 5 in half-star steps.']);
    assert.deepEqual(readReviewDetails({ aspect_audio: '4.2' }).errors, ['Audio must be scored from 0.5 to 5 in half-star steps.']);
    assert.deepEqual(readReviewDetails({ hours: '-1' }).errors, ['Hours played must be a whole number from 0 to 9999.']);
    assert.deepEqual(readReviewDetails({ hours: '10000' }).errors, ['Hours played must be a whole number from 0 to 9999.']);
    assert.deepEqual(readReviewDetails({ platform: 'dreamcast' }).errors, ['Choose a platform from the list.']);
    assert.equal(readReviewDetails({ hours: '0' }).details.hours, 0);
  });
});

describe('showing review details', () => {
  const row = { spoiler: 1, hours: 1, platform: 'pc', gameplay: 4, story: null, visuals: 5, audio: null, value: null };

  it('describes a details row for review cards', () => {
    assert.deepEqual(describeDetails(row), {
      spoiler: true,
      hours: 1,
      hoursLabel: '1 hour played',
      platform: 'PC',
      aspects: [{ key: 'gameplay', label: 'Gameplay', score: 4 }, { key: 'visuals', label: 'Visuals', score: 5 }],
    });
    assert.deepEqual(describeDetails(null), { spoiler: false, hours: null, platform: '', aspects: [] });
  });

  it('pre-fills the form with what the member saved', () => {
    assert.deepEqual(formValues(row).aspects, { gameplay: 4, story: null, visuals: 5, audio: null, value: null });
    assert.equal(formValues(null).hours, '');
  });

  it('turns averages into bars and names the best aspect', () => {
    const breakdown = aspectBreakdown({
      aspects: { gameplay: { average: 4.66, count: 3 }, story: { average: 3, count: 2 }, visuals: { average: null, count: 0 }, audio: { average: null, count: 0 }, value: { average: null, count: 0 } },
      hours: { average: 41.6, count: 3 },
    });
    assert.equal(breakdown.hasAny, true);
    assert.deepEqual(breakdown.rows[0], { key: 'gameplay', label: 'Gameplay', average: 4.7, count: 3, percent: 94 });
    assert.equal(breakdown.best.key, 'gameplay');
    assert.equal(breakdown.hours, 42);
    assert.equal(aspectBreakdown({}).hasAny, false);
  });
});

describe('members against Steam players', () => {
  it('compares on one scale and says who likes it more', () => {
    const comparison = scoreComparison({ steamPositive: 70, steamReviews: 1000, memberRating: 4.6, memberCount: 3 });
    assert.equal(comparison.steamStars, 3.5);
    assert.equal(comparison.gap, 1.1);
    assert.equal(comparison.verdict, 'Members like it more than Steam players');
    assert.equal(scoreComparison({ steamPositive: 95, steamReviews: 10, memberRating: 4.7, memberCount: 1 }).verdict, 'Members and Steam players agree');
    assert.equal(scoreComparison({ steamPositive: 95, steamReviews: 10, memberRating: 3, memberCount: 2 }).verdict, 'Members are tougher on it than Steam players');
  });

  it('needs both sides', () => {
    assert.equal(scoreComparison({ steamPositive: null, steamReviews: 0, memberRating: 4, memberCount: 2 }), null);
    assert.equal(scoreComparison({ steamPositive: 90, steamReviews: 100, memberRating: 4, memberCount: 0 }), null);
  });
});

describe('reviewer badges', () => {
  it('earns badges by rule', () => {
    const keys = (row, rank) => reviewerBadges(row, rank).map((badge) => badge.key);
    assert.deepEqual(keys({ reviews: 12, helpful: 15, detailed: 4, average_rating: 4.6 }, 1), ['top', 'trusted', 'prolific', 'analyst', 'generous']);
    assert.deepEqual(keys({ reviews: 6, helpful: 0, detailed: 0, average_rating: 2.8 }, 1), ['tough']);
    assert.deepEqual(keys({}, 0), []);
  });
});
