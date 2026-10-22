// Review details model: the optional extras a member can add to a review — scores for five aspects (gameplay,
// story, visuals, audio, value), hours played, the platform played on, and a spoiler warning — plus the queries for
// the reviews hub (every review on the site) and the top reviewers. Details live in their own table, one row per
// review, so a review without them is still a whole review; deleting a review deletes its details.
const { db, upgradeRatingTable } = require('./database');

const ASPECT_KEYS = ['gameplay', 'story', 'visuals', 'audio', 'value'];
const PLATFORM_KEYS = ['pc', 'playstation', 'xbox', 'switch', 'mobile', 'other'];
const aspectColumn = (key) => `${key} REAL CHECK(${key} IS NULL OR (${key} BETWEEN 0.5 AND 5 AND ${key} * 2 = CAST(${key} * 2 AS INTEGER)))`;

db.exec(`
  CREATE TABLE IF NOT EXISTS review_details (
    review_id INTEGER PRIMARY KEY,
    spoiler INTEGER NOT NULL DEFAULT 0 CHECK(spoiler IN (0, 1)),
    hours INTEGER CHECK(hours IS NULL OR hours BETWEEN 0 AND 9999),
    platform TEXT NOT NULL DEFAULT '' CHECK(platform IN ('', ${PLATFORM_KEYS.map((key) => `'${key}'`).join(', ')})),
    ${ASPECT_KEYS.map(aspectColumn).join(',\n    ')},
    FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE
  ) STRICT;
`);

upgradeRatingTable('review_details', (sql) => ASPECT_KEYS.reduce((text, key) => text.replace(
  `${key} INTEGER CHECK(${key} IS NULL OR ${key} BETWEEN 1 AND 5)`, aspectColumn(key),
), sql));

const DETAIL_COLUMNS = `d.spoiler, d.hours, d.platform, ${ASPECT_KEYS.map((key) => `d.${key}`).join(', ')}`;

// Sort orders for the hub; the keys come from a fixed list, never from the request.
const HUB_ORDER = {
  newest: 'r.updated_at DESC, r.id DESC',
  helpful: 'like_count DESC, r.updated_at DESC, r.id DESC',
  highest: 'r.rating DESC, like_count DESC, r.id DESC',
  lowest: 'r.rating ASC, like_count DESC, r.id DESC',
};

// :stars 0 means every rating; :spoilers 0 hides reviews marked as spoilers.
const HUB_WHERE = `
  WHERE (:stars = 0 OR r.rating = :stars)
    AND (:spoilers = 1 OR COALESCE(d.spoiler, 0) = 0)
`;

const statements = {
  reviewId: db.prepare('SELECT r.id FROM reviews r JOIN games g ON g.id = r.game_id WHERE r.user_id = ? AND g.slug = ?'),
  upsert: db.prepare(`
    INSERT INTO review_details (review_id, spoiler, hours, platform, ${ASPECT_KEYS.join(', ')})
    VALUES (:review_id, :spoiler, :hours, :platform, ${ASPECT_KEYS.map((key) => `:${key}`).join(', ')})
    ON CONFLICT(review_id) DO UPDATE SET
      spoiler = excluded.spoiler, hours = excluded.hours, platform = excluded.platform,
      ${ASPECT_KEYS.map((key) => `${key} = excluded.${key}`).join(', ')}
  `),
  forGame: db.prepare(`
    SELECT d.review_id, ${DETAIL_COLUMNS}
    FROM review_details d JOIN reviews r ON r.id = d.review_id
    WHERE r.game_id = ?
  `),
  forUserReview: db.prepare(`
    SELECT ${DETAIL_COLUMNS}
    FROM review_details d JOIN reviews r ON r.id = d.review_id JOIN games g ON g.id = r.game_id
    WHERE r.user_id = ? AND g.slug = ?
  `),
  aspects: db.prepare(`
    SELECT ${ASPECT_KEYS.map((key) => `AVG(d.${key}) AS ${key}_average, COUNT(d.${key}) AS ${key}_count`).join(', ')},
      AVG(d.hours) AS hours_average, COUNT(d.hours) AS hours_count
    FROM review_details d JOIN reviews r ON r.id = d.review_id
    WHERE r.game_id = ?
  `),
  // The same averages over every review on the site, the baseline a game is compared with.
  overallAspects: db.prepare(`
    SELECT ${ASPECT_KEYS.map((key) => `AVG(${key}) AS ${key}_average, COUNT(${key}) AS ${key}_count`).join(', ')},
      AVG(hours) AS hours_average, COUNT(hours) AS hours_count
    FROM review_details
  `),
  hubCount: db.prepare(`
    SELECT COUNT(*) AS count FROM reviews r LEFT JOIN review_details d ON d.review_id = r.id ${HUB_WHERE}
  `),
  topReviewers: db.prepare(`
    SELECT u.id, u.name,
      COUNT(DISTINCT r.id) AS reviews,
      (SELECT COUNT(*) FROM review_likes rl JOIN reviews mine ON mine.id = rl.review_id WHERE mine.user_id = u.id) AS helpful,
      ROUND(AVG(r.rating), 1) AS average_rating,
      SUM(CASE WHEN d.gameplay IS NOT NULL OR d.story IS NOT NULL OR d.visuals IS NOT NULL OR d.audio IS NOT NULL
        OR d.value IS NOT NULL THEN 1 ELSE 0 END) AS detailed
    FROM users u
    JOIN reviews r ON r.user_id = u.id
    LEFT JOIN review_details d ON d.review_id = r.id
    WHERE u.profile_public = 1 OR u.id = :viewer
    GROUP BY u.id
    ORDER BY helpful DESC, reviews DESC, u.name COLLATE NOCASE
    LIMIT :limit
  `),
};

const hubPages = Object.fromEntries(Object.entries(HUB_ORDER).map(([sort, order]) => [sort, db.prepare(`
  SELECT r.id, r.rating, r.review_text, r.updated_at,
    u.id AS user_id, u.name AS user_name, u.profile_public,
    g.slug, g.title, g.image, g.genre, g.release_year AS year,
    (SELECT COUNT(*) FROM review_likes rl WHERE rl.review_id = r.id) AS like_count,
    EXISTS(SELECT 1 FROM review_likes rl WHERE rl.review_id = r.id AND rl.user_id = :viewer) AS liked,
    ${DETAIL_COLUMNS}
  FROM reviews r
  JOIN users u ON u.id = r.user_id
  JOIN games g ON g.id = r.game_id
  LEFT JOIN review_details d ON d.review_id = r.id
  ${HUB_WHERE}
  ORDER BY ${order}
  LIMIT :limit OFFSET :offset
`)]));

// Saves the details of the member's review of a game (the review must exist). `details` is already checked by
// lib/review-insights.js (readReviewDetails). Returns false when there is no review to attach them to.
function saveReviewDetails(userId, slug, details) {
  const review = statements.reviewId.get(userId, slug);
  if (!review) return false;
  statements.upsert.run({
    review_id: review.id,
    spoiler: details.spoiler ? 1 : 0,
    hours: details.hours ?? null,
    platform: details.platform || '',
    ...Object.fromEntries(ASPECT_KEYS.map((key) => [key, details.aspects?.[key] ?? null])),
  });
  return true;
}

// Details of every review of a game, by review ID.
function detailsForGame(gameId) {
  return new Map(statements.forGame.all(gameId).map((row) => [row.review_id, row]));
}

function findReviewDetails(userId, slug) {
  return statements.forUserReview.get(userId, slug) || null;
}

// Average score and number of scores per aspect, plus average hours played, for one game.
function averagesFrom(row) {
  return {
    aspects: Object.fromEntries(ASPECT_KEYS.map((key) => [key, {
      average: row[`${key}_average`] === null ? null : Number(row[`${key}_average`]),
      count: Number(row[`${key}_count`]),
    }])),
    hours: { average: row.hours_average === null ? null : Number(row.hours_average), count: Number(row.hours_count) },
  };
}

function aspectAverages(gameId) {
  return averagesFrom(statements.aspects.get(gameId));
}

function overallAspectAverages() {
  return averagesFrom(statements.overallAspects.get());
}

// One page of the reviews hub. `sort` must be a key of HUB_ORDER (anything else means newest).
function listHubReviews({ viewerId = 0, sort = 'newest', stars = 0, spoilers = true, limit = 20, offset = 0 } = {}) {
  const filters = { viewer: viewerId || 0, stars: Number(stars) || 0, spoilers: spoilers ? 1 : 0 };
  const statement = hubPages[Object.hasOwn(hubPages, sort) ? sort : 'newest'];
  return {
    total: Number(statements.hubCount.get({ stars: filters.stars, spoilers: filters.spoilers }).count),
    reviews: statement.all({ ...filters, limit: Math.max(1, Math.min(Number(limit) || 20, 50)), offset: Math.max(0, Number(offset) || 0) }),
  };
}

// Members ranked by helpful votes on their reviews, then by how many they wrote. Private profiles stay off the
// board, except for the viewer's own entry.
function listTopReviewers({ viewerId = 0, limit = 10 } = {}) {
  return statements.topReviewers.all({ viewer: viewerId || 0, limit: Math.max(1, Math.min(Number(limit) || 10, 50)) });
}

module.exports = {
  overallAspectAverages,
  ASPECT_KEYS,
  PLATFORM_KEYS,
  aspectAverages,
  detailsForGame,
  findReviewDetails,
  listHubReviews,
  listTopReviewers,
  saveReviewDetails,
};
