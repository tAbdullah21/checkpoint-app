// Review extras without the database: checking the optional details of a review form (aspect scores, hours played,
// platform, spoiler warning), shaping them for review cards, the per-aspect breakdown of a game, how members and
// Steam players compare, and the badges on the top reviewers board.

const ASPECTS = [
  { key: 'gameplay', label: 'Gameplay' },
  { key: 'story', label: 'Story' },
  { key: 'visuals', label: 'Visuals' },
  { key: 'audio', label: 'Audio' },
  { key: 'value', label: 'Value' },
];

const PLATFORMS = [
  { key: 'pc', label: 'PC' },
  { key: 'playstation', label: 'PlayStation' },
  { key: 'xbox', label: 'Xbox' },
  { key: 'switch', label: 'Switch' },
  { key: 'mobile', label: 'Mobile' },
  { key: 'other', label: 'Other' },
];
const PLATFORM_LABELS = Object.fromEntries(PLATFORMS.map((platform) => [platform.key, platform.label]));

const MAX_HOURS = 9999;

// The optional fields of the review form. Empty fields mean "not given"; anything malformed is an error, so a
// tampered form is refused instead of being stored half-read.
function readReviewDetails(body = {}) {
  const errors = [];
  const aspects = {};
  for (const { key, label } of ASPECTS) {
    const value = String(body[`aspect_${key}`] ?? '').trim();
    if (value === '') aspects[key] = null;
    else if (/^(?:[0-4]\.5|[1-5](?:\.0)?)$/.test(value)) aspects[key] = Number(value);
    else errors.push(`${label} must be scored from 0.5 to 5 in half-star steps.`);
  }
  const hoursText = String(body.hours ?? '').trim();
  let hours = null;
  if (hoursText !== '') {
    if (/^\d{1,4}$/.test(hoursText) && Number(hoursText) <= MAX_HOURS) hours = Number(hoursText);
    else errors.push(`Hours played must be a whole number from 0 to ${MAX_HOURS}.`);
  }
  const platformText = String(body.platform ?? '').trim();
  if (platformText !== '' && !Object.hasOwn(PLATFORM_LABELS, platformText)) errors.push('Choose a platform from the list.');
  return {
    details: {
      aspects,
      hours,
      platform: Object.hasOwn(PLATFORM_LABELS, platformText) ? platformText : '',
      spoiler: ['on', '1', 'true'].includes(String(body.spoiler ?? '')),
    },
    errors,
  };
}

// A stored details row (or nothing) as what a review card shows.
function describeDetails(row) {
  if (!row) return { spoiler: false, hours: null, platform: '', aspects: [] };
  return {
    spoiler: Boolean(row.spoiler),
    hours: row.hours ?? null,
    hoursLabel: row.hours === null || row.hours === undefined ? '' : `${row.hours} ${row.hours === 1 ? 'hour' : 'hours'} played`,
    platform: PLATFORM_LABELS[row.platform] || '',
    aspects: ASPECTS.filter(({ key }) => row[key] !== null && row[key] !== undefined)
      .map(({ key, label }) => ({ key, label, score: Number(row[key]) })),
  };
}

// The values to pre-fill the form with when a member edits their review.
function formValues(row) {
  return {
    aspects: Object.fromEntries(ASPECTS.map(({ key }) => [key, row?.[key] ?? null])),
    hours: row?.hours ?? '',
    platform: row?.platform || '',
    spoiler: Boolean(row?.spoiler),
  };
}

// Per-aspect averages (from the model) as bars: average to one decimal, width as a share of 5.
function aspectBreakdown(averages) {
  const rows = ASPECTS.map(({ key, label }) => {
    const entry = averages?.aspects?.[key] || { average: null, count: 0 };
    const average = entry.average === null ? null : Math.round(entry.average * 10) / 10;
    return { key, label, average, count: entry.count, percent: average === null ? 0 : Math.round((average / 5) * 100) };
  });
  const scored = rows.filter((row) => row.average !== null);
  const best = scored.length > 1 ? [...scored].sort((first, second) => second.average - first.average)[0] : null;
  const hours = averages?.hours?.count ? Math.round(averages.hours.average) : null;
  return { rows, hasAny: scored.length > 0, best, hours, hoursCount: averages?.hours?.count || 0 };
}

// Steam players' share of positive reviews next to the members' star average. Null when either side is missing.
function scoreComparison({ steamPositive, steamReviews, memberRating, memberCount }) {
  if (steamPositive === null || steamPositive === undefined || !steamReviews || !memberCount) return null;
  const steamStars = Math.max(1, Math.round((steamPositive / 20) * 10) / 10);
  const members = Math.round(Number(memberRating) * 10) / 10;
  const gap = Math.round((members - steamStars) * 10) / 10;
  let verdict = 'Members and Steam players agree';
  if (gap >= 0.3) verdict = 'Members like it more than Steam players';
  else if (gap <= -0.3) verdict = 'Members are tougher on it than Steam players';
  return { steamPositive, steamReviews, steamStars, members, memberCount, gap, verdict };
}

// Badges for the top reviewers board, each with the rule that earns it. `rank` is 1 for the first place.
const BADGES = [
  { key: 'top', label: 'Top critic', earned: (stats, rank) => rank === 1 && stats.helpful > 0 },
  { key: 'trusted', label: 'Trusted voice', earned: (stats) => stats.helpful >= 10 },
  { key: 'prolific', label: 'Prolific', earned: (stats) => stats.reviews >= 10 },
  { key: 'analyst', label: 'Analyst', earned: (stats) => stats.detailed >= 3 },
  { key: 'tough', label: 'Tough critic', earned: (stats) => stats.reviews >= 5 && stats.average !== null && stats.average <= 3 },
  { key: 'generous', label: 'Generous', earned: (stats) => stats.reviews >= 5 && stats.average !== null && stats.average >= 4.5 },
];

function reviewerBadges(row = {}, rank = 0) {
  const stats = {
    reviews: Number(row.reviews) || 0,
    helpful: Number(row.helpful) || 0,
    detailed: Number(row.detailed) || 0,
    average: row.average_rating === null || row.average_rating === undefined ? null : Number(row.average_rating),
  };
  return BADGES.filter((badge) => badge.earned(stats, rank)).map(({ key, label }) => ({ key, label }));
}

module.exports = {
  ASPECTS,
  MAX_HOURS,
  PLATFORMS,
  aspectBreakdown,
  describeDetails,
  formValues,
  readReviewDetails,
  reviewerBadges,
  scoreComparison,
};
