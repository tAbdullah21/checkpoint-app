// Community model: follows, review likes and replies, game lists and the activity feed.
// Uses the same SQLite connection as database.js and creates its own tables on first load.
const { db, transaction } = require('./database');

db.exec(`
  CREATE TABLE IF NOT EXISTS follows (
    follower_id INTEGER NOT NULL,
    followed_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (follower_id, followed_id),
    CHECK (follower_id <> followed_id),
    FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (followed_id) REFERENCES users(id) ON DELETE CASCADE
  ) STRICT;

  CREATE TABLE IF NOT EXISTS review_likes (
    user_id INTEGER NOT NULL,
    review_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, review_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE
  ) STRICT;

  CREATE TABLE IF NOT EXISTS review_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    review_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 300),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) STRICT;

  CREATE TABLE IF NOT EXISTS game_lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL CHECK(length(title) BETWEEN 3 AND 60),
    description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 280),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) STRICT;

  CREATE TABLE IF NOT EXISTS game_list_items (
    list_id INTEGER NOT NULL,
    game_id INTEGER NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (list_id, game_id),
    FOREIGN KEY (list_id) REFERENCES game_lists(id) ON DELETE CASCADE,
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
  ) STRICT;

  CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('library_add', 'status_change', 'review', 'follow', 'list_create', 'list_add')),
    game_id INTEGER,
    target_user_id INTEGER,
    list_id INTEGER,
    detail TEXT NOT NULL DEFAULT '' CHECK(length(detail) <= 40),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
    FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (list_id) REFERENCES game_lists(id) ON DELETE CASCADE
  ) STRICT;

  CREATE INDEX IF NOT EXISTS activities_created_idx ON activities (created_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS activities_user_idx ON activities (user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS follows_followed_idx ON follows (followed_id);
  CREATE INDEX IF NOT EXISTS review_likes_review_idx ON review_likes (review_id);
  CREATE INDEX IF NOT EXISTS review_comments_review_idx ON review_comments (review_id, created_at);
  CREATE INDEX IF NOT EXISTS game_lists_user_idx ON game_lists (user_id, updated_at DESC);

  -- Child keys of ON DELETE CASCADE are indexed too, so deleting an account or a list does not scan tables.
  CREATE INDEX IF NOT EXISTS review_comments_user_idx ON review_comments (user_id);
  CREATE INDEX IF NOT EXISTS activities_target_idx ON activities (target_user_id) WHERE target_user_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS activities_list_idx ON activities (list_id) WHERE list_id IS NOT NULL;
`);

const statements = {
  // Activity feed ------------------------------------------------------------
  lastActivity: db.prepare(`
    SELECT id, type, game_id, target_user_id, list_id, detail,
      (julianday('now') - julianday(created_at)) * 86400 AS age_seconds
    FROM activities WHERE user_id = ? ORDER BY id DESC LIMIT 1
  `),
  insertActivity: db.prepare(`
    INSERT INTO activities (user_id, type, game_id, target_user_id, list_id, detail)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  updateActivity: db.prepare(`
    UPDATE activities SET detail = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?
  `),
  removeGameActivity: db.prepare('DELETE FROM activities WHERE user_id = ? AND type = ? AND game_id = ?'),
  feed: db.prepare(`
    SELECT a.id, a.type, a.detail, a.created_at,
      u.id AS user_id, u.name AS user_name,
      g.slug AS game_slug, g.title AS game_title, g.image AS game_image,
      t.id AS target_id, t.name AS target_name,
      l.id AS list_id, l.title AS list_title
    FROM activities a
    JOIN users u ON u.id = a.user_id
    LEFT JOIN games g ON g.id = a.game_id
    LEFT JOIN users t ON t.id = a.target_user_id
    LEFT JOIN game_lists l ON l.id = a.list_id
    WHERE (u.profile_public = 1 OR u.id = :viewer)
      AND (a.target_user_id IS NULL OR t.profile_public = 1 OR t.id = :viewer)
      AND (:following = 0 OR a.user_id IN (SELECT followed_id FROM follows WHERE follower_id = :viewer) OR a.user_id = :viewer)
      AND (:onlyUser = 0 OR a.user_id = :onlyUser)
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT :limit
  `),

  // Members and follows ------------------------------------------------------
  members: db.prepare(`
    SELECT u.id, u.name, u.bio, u.preferred_platform, u.favorite_genres, u.created_at,
      (SELECT COUNT(*) FROM user_library ul WHERE ul.user_id = u.id) AS game_count,
      (SELECT COUNT(*) FROM reviews r WHERE r.user_id = u.id) AS review_count,
      (SELECT COUNT(*) FROM follows f WHERE f.followed_id = u.id) AS follower_count,
      EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = :viewer AND f.followed_id = u.id) AS is_following,
      (SELECT group_concat(image, '|') FROM (
        SELECT g.image FROM user_library ul JOIN games g ON g.id = ul.game_id
        WHERE ul.user_id = u.id ORDER BY ul.is_favorite DESC, ul.updated_at DESC, g.id ASC LIMIT 4
      )) AS preview_images
    FROM users u
    WHERE (u.profile_public = 1 OR u.id = :viewer)
      AND (:query = '' OR u.name LIKE '%' || :query || '%' COLLATE NOCASE)
    ORDER BY follower_count DESC, review_count DESC, game_count DESC, u.created_at DESC
    LIMIT 60
  `),
  member: db.prepare(`
    SELECT u.id, u.name, u.bio, u.steam_id, u.psn_id, u.xbox_id, u.steam_visible, u.psn_visible, u.xbox_visible,
      u.preferred_platform, u.favorite_genres, u.profile_public, u.created_at,
      (SELECT COUNT(*) FROM follows f WHERE f.followed_id = u.id) AS follower_count,
      (SELECT COUNT(*) FROM follows f WHERE f.follower_id = u.id) AS following_count,
      (SELECT COUNT(*) FROM reviews r WHERE r.user_id = u.id) AS review_count
    FROM users u WHERE u.id = ?
  `),
  follow: db.prepare('INSERT OR IGNORE INTO follows (follower_id, followed_id) VALUES (?, ?)'),
  unfollow: db.prepare('DELETE FROM follows WHERE follower_id = ? AND followed_id = ?'),
  isFollowing: db.prepare('SELECT 1 AS yes FROM follows WHERE follower_id = ? AND followed_id = ?'),
  followers: db.prepare(`
    SELECT u.id, u.name FROM follows f JOIN users u ON u.id = f.follower_id
    WHERE f.followed_id = ? AND (u.profile_public = 1 OR u.id = ?) ORDER BY f.created_at DESC LIMIT 24
  `),
  following: db.prepare(`
    SELECT u.id, u.name FROM follows f JOIN users u ON u.id = f.followed_id
    WHERE f.follower_id = ? AND (u.profile_public = 1 OR u.id = ?) ORDER BY f.created_at DESC LIMIT 24
  `),

  // Reviews with likes ---------------------------------------------------------
  reviewsForGame: db.prepare(`
    SELECT r.id, r.rating, r.review_text, r.created_at, r.updated_at,
      u.id AS user_id, u.name AS user_name, u.profile_public,
      (SELECT COUNT(*) FROM review_likes rl WHERE rl.review_id = r.id) AS like_count,
      EXISTS(SELECT 1 FROM review_likes rl WHERE rl.review_id = r.id AND rl.user_id = :viewer) AS liked
    FROM reviews r JOIN users u ON u.id = r.user_id
    WHERE r.game_id = :gameId
    ORDER BY like_count DESC, r.updated_at DESC, r.id DESC
  `),
  reviewsByUser: db.prepare(`
    SELECT r.id, r.rating, r.review_text, r.updated_at, g.slug, g.title, g.image,
      (SELECT COUNT(*) FROM review_likes rl WHERE rl.review_id = r.id) AS like_count
    FROM reviews r JOIN games g ON g.id = r.game_id
    WHERE r.user_id = ? ORDER BY r.updated_at DESC, r.id DESC LIMIT ?
  `),
  review: db.prepare(`
    SELECT r.id, r.user_id, g.slug AS game_slug FROM reviews r JOIN games g ON g.id = r.game_id WHERE r.id = ?
  `),
  likeReview: db.prepare('INSERT OR IGNORE INTO review_likes (user_id, review_id) VALUES (?, ?)'),
  // Replies under reviews: oldest first, so a conversation reads top to bottom.
  insertComment: db.prepare('INSERT INTO review_comments (review_id, user_id, body) VALUES (?, ?, ?)'),
  commentsForGame: db.prepare(`
    SELECT c.id, c.review_id, c.body, c.created_at, u.id AS user_id, u.name AS user_name, u.profile_public
    FROM review_comments c
    JOIN reviews r ON r.id = c.review_id
    JOIN users u ON u.id = c.user_id
    WHERE r.game_id = ?
    ORDER BY c.created_at ASC, c.id ASC
  `),
  comment: db.prepare(`
    SELECT c.id, c.review_id, c.user_id, r.user_id AS review_user_id, g.slug AS game_slug
    FROM review_comments c
    JOIN reviews r ON r.id = c.review_id
    JOIN games g ON g.id = r.game_id
    WHERE c.id = ?
  `),
  deleteComment: db.prepare('DELETE FROM review_comments WHERE id = ?'),
  unlikeReview: db.prepare('DELETE FROM review_likes WHERE user_id = ? AND review_id = ?'),
  ratingsByUser: db.prepare(`
    SELECT g.slug, r.rating FROM reviews r JOIN games g ON g.id = r.game_id WHERE r.user_id = ?
  `),

  // Lists -----------------------------------------------------------------------
  createList: db.prepare('INSERT INTO game_lists (user_id, title, description) VALUES (?, ?, ?)'),
  updateList: db.prepare(`
    UPDATE game_lists SET title = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?
  `),
  deleteList: db.prepare('DELETE FROM game_lists WHERE id = ? AND user_id = ?'),
  touchList: db.prepare('UPDATE game_lists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?'),
  list: db.prepare(`
    SELECT l.id, l.user_id, l.title, l.description, l.created_at, l.updated_at,
      u.name AS owner_name, u.profile_public AS owner_public
    FROM game_lists l JOIN users u ON u.id = l.user_id WHERE l.id = ?
  `),
  listItems: db.prepare(`
    SELECT g.id, g.slug, g.title, g.release_year AS year, g.genre, g.image,
      CASE WHEN COUNT(r.id) > 0 THEN ROUND(AVG(r.rating), 1) ELSE g.rating END AS rating
    FROM game_list_items li
    JOIN games g ON g.id = li.game_id
    LEFT JOIN reviews r ON r.game_id = g.id
    WHERE li.list_id = ?
    GROUP BY g.id, li.position, li.added_at
    ORDER BY li.position ASC, li.added_at ASC, li.rowid ASC
  `),
  listOrder: db.prepare(`
    SELECT li.game_id FROM game_list_items li WHERE li.list_id = ? ORDER BY li.position ASC, li.added_at ASC, li.rowid ASC
  `),
  setListPosition: db.prepare('UPDATE game_list_items SET position = ? WHERE list_id = ? AND game_id = ?'),
  gameIdBySlug: db.prepare('SELECT id FROM games WHERE slug = ?'),
  addListItem: db.prepare(`
    INSERT OR IGNORE INTO game_list_items (list_id, game_id, position)
    SELECT ?, g.id, COALESCE((SELECT MAX(position) + 1 FROM game_list_items WHERE list_id = ?), 0)
    FROM games g WHERE g.slug = ?
  `),
  removeListItem: db.prepare(`
    DELETE FROM game_list_items WHERE list_id = ? AND game_id = (SELECT id FROM games WHERE slug = ?)
  `),
  listsSummary: db.prepare(`
    SELECT l.id, l.title, l.description, l.updated_at, u.id AS owner_id, u.name AS owner_name,
      (SELECT COUNT(*) FROM game_list_items li WHERE li.list_id = l.id) AS game_count,
      (SELECT group_concat(image, '|') FROM (
        SELECT g.image FROM game_list_items li JOIN games g ON g.id = li.game_id
        WHERE li.list_id = l.id ORDER BY li.position ASC, li.added_at ASC LIMIT 5
      )) AS preview_images
    FROM game_lists l JOIN users u ON u.id = l.user_id
    WHERE (:owner = 0 OR l.user_id = :owner)
      AND (u.profile_public = 1 OR u.id = :viewer)
      AND (:owner <> 0 OR (SELECT COUNT(*) FROM game_list_items li WHERE li.list_id = l.id) > 0)
    ORDER BY l.updated_at DESC, l.id DESC
    LIMIT :limit
  `),
  listsForGame: db.prepare(`
    SELECT l.id, l.title,
      EXISTS(SELECT 1 FROM game_list_items li JOIN games g ON g.id = li.game_id
             WHERE li.list_id = l.id AND g.slug = ?) AS has_game
    FROM game_lists l WHERE l.user_id = ? ORDER BY l.updated_at DESC
  `),

  // Game page insights ---------------------------------------------------------------
  gameStatusCounts: db.prepare('SELECT status, COUNT(*) AS count FROM user_library WHERE game_id = ? GROUP BY status'),
  gameRatingCounts: db.prepare('SELECT rating, COUNT(*) AS count FROM reviews WHERE game_id = ? GROUP BY rating'),
  // Who tracks a game: the viewer first, then people they follow, then whoever is playing it right now.
  gamePlayers: db.prepare(`
    SELECT u.id, u.name, ul.status, ul.is_favorite, r.rating,
      EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = :viewer AND f.followed_id = u.id) AS is_following
    FROM user_library ul
    JOIN users u ON u.id = ul.user_id
    LEFT JOIN reviews r ON r.user_id = u.id AND r.game_id = ul.game_id
    WHERE ul.game_id = :gameId AND (u.profile_public = 1 OR u.id = :viewer)
    ORDER BY u.id = :viewer DESC, is_following DESC,
      CASE ul.status WHEN 'playing' THEN 0 WHEN 'completed' THEN 1 WHEN 'played' THEN 2 ELSE 3 END,
      ul.updated_at DESC, u.id ASC
    LIMIT :limit
  `),
  listsFeaturingGame: db.prepare(`
    SELECT l.id, l.title, u.id AS owner_id, u.name AS owner_name,
      (SELECT COUNT(*) FROM game_list_items x WHERE x.list_id = l.id) AS game_count
    FROM game_lists l
    JOIN users u ON u.id = l.user_id
    JOIN game_list_items li ON li.list_id = l.id
    WHERE li.game_id = :gameId AND (u.profile_public = 1 OR u.id = :viewer)
    ORDER BY l.updated_at DESC, l.id DESC
    LIMIT :limit
  `),

  // Trending: games with the most activity from public members in the last two weeks.
  trendingGames: db.prepare(`
    SELECT g.slug, g.title, g.image, g.genre, g.release_year AS year, COUNT(*) AS activity_count,
      COUNT(DISTINCT a.user_id) AS player_count
    FROM activities a
    JOIN users u ON u.id = a.user_id
    JOIN games g ON g.id = a.game_id
    WHERE (u.profile_public = 1 OR u.id = :viewer)
      AND a.created_at >= datetime('now', '-14 days')
    GROUP BY g.id
    ORDER BY activity_count DESC, player_count DESC, MAX(a.created_at) DESC
    LIMIT :limit
  `),

  // Community numbers -------------------------------------------------------------
  demoPresent: db.prepare("SELECT EXISTS(SELECT 1 FROM users WHERE email LIKE '%@demo.checkpoint.local') AS present"),
  stats: db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM users) AS members,
      (SELECT COUNT(*) FROM reviews) AS reviews,
      (SELECT COUNT(*) FROM user_library) AS tracked,
      (SELECT COUNT(*) FROM game_lists) AS lists,
      (SELECT COUNT(*) FROM games) AS games
  `),
  communityPick: db.prepare(`
    SELECT g.slug, g.title, g.release_year AS year, g.genre, g.image, g.description,
      ROUND(AVG(r.rating), 1) AS rating, COUNT(r.id) AS review_count
    FROM games g JOIN reviews r ON r.game_id = g.id
    GROUP BY g.id HAVING COUNT(r.id) >= 2
    ORDER BY AVG(r.rating) DESC, COUNT(r.id) DESC, g.release_year DESC
    LIMIT 1
  `),
};

// Repeating the same action within ten minutes updates the last entry instead of flooding the feed.
function recordActivity({ userId, type, gameId = null, targetUserId = null, listId = null, detail = '' }) {
  const last = statements.lastActivity.get(userId);
  const sameSubject = last && last.type === type && last.game_id === gameId
    && last.target_user_id === targetUserId && last.list_id === listId;
  if (sameSubject && last.age_seconds < 600) {
    statements.updateActivity.run(String(detail), last.id);
    return last.id;
  }
  return Number(statements.insertActivity.run(userId, type, gameId, targetUserId, listId, String(detail)).lastInsertRowid);
}

// Used when the subject is gone, e.g. a deleted review should not stay in the feed as "rated".
function removeGameActivity({ userId, type, gameId }) {
  return statements.removeGameActivity.run(userId, type, gameId).changes;
}

function listActivity({ viewerId = 0, followingOnly = false, userId = 0, limit = 10 } = {}) {
  return statements.feed.all({
    viewer: viewerId || 0,
    following: followingOnly ? 1 : 0,
    onlyUser: userId || 0,
    limit: Math.max(1, Math.min(Number(limit) || 10, 50)),
  });
}

function listMembers({ viewerId = 0, query = '' } = {}) {
  return statements.members.all({ viewer: viewerId || 0, query: String(query || '') });
}

function findMember(id) {
  return statements.member.get(Number(id) || 0);
}

function followMember(followerId, followedId) {
  if (Number(followerId) === Number(followedId)) return false;
  return statements.follow.run(followerId, followedId).changes > 0;
}

function unfollowMember(followerId, followedId) {
  return statements.unfollow.run(followerId, followedId).changes > 0;
}

function isFollowing(followerId, followedId) {
  return Boolean(followerId && statements.isFollowing.get(followerId, followedId));
}

function listFollowers(userId, viewerId = 0) {
  return statements.followers.all(userId, viewerId || 0);
}

function listFollowing(userId, viewerId = 0) {
  return statements.following.all(userId, viewerId || 0);
}

function listReviewsForGame(gameId, viewerId = 0) {
  return statements.reviewsForGame.all({ gameId, viewer: viewerId || 0 });
}

function listReviewsByUser(userId, limit = 6) {
  return statements.reviewsByUser.all(userId, Math.max(1, Math.min(Number(limit) || 6, 50)));
}

function findReview(reviewId) {
  return statements.review.get(Number(reviewId) || 0);
}

// Returns true when the review is liked after the call, false when unliked.
function toggleReviewLike(userId, reviewId) {
  if (statements.unlikeReview.run(userId, reviewId).changes > 0) return false;
  statements.likeReview.run(userId, reviewId);
  return true;
}

function addReviewComment(reviewId, userId, body) {
  return Number(statements.insertComment.run(reviewId, userId, body).lastInsertRowid);
}

// All replies on a game's reviews, grouped by review ID.
function listCommentsForGame(gameId) {
  const byReview = new Map();
  for (const comment of statements.commentsForGame.all(gameId)) {
    if (!byReview.has(comment.review_id)) byReview.set(comment.review_id, []);
    byReview.get(comment.review_id).push(comment);
  }
  return byReview;
}

function findComment(commentId) {
  return statements.comment.get(Number(commentId) || 0);
}

function deleteComment(commentId) {
  return statements.deleteComment.run(commentId).changes > 0;
}

function listRatingsByUser(userId) {
  return statements.ratingsByUser.all(userId);
}

function createList(userId, title, description) {
  return Number(statements.createList.run(userId, title, description).lastInsertRowid);
}

function updateList(listId, userId, title, description) {
  return statements.updateList.run(title, description, listId, userId).changes > 0;
}

function deleteList(listId, userId) {
  return statements.deleteList.run(listId, userId).changes > 0;
}

function findList(listId) {
  return statements.list.get(Number(listId) || 0);
}

function listGamesInList(listId) {
  return statements.listItems.all(listId);
}

function addGameToList(listId, slug) {
  const added = statements.addListItem.run(listId, listId, slug).changes > 0;
  if (added) statements.touchList.run(listId);
  return added;
}

// Moves one game a place up or down in a ranked list. The whole order is renumbered 0…n-1 in one
// transaction, so gaps left by removed games can never produce ties. Returns the new 1-based rank, or null
// when the game is not in the list or is already at that end.
function moveGameInList(listId, slug, direction) {
  const gameId = statements.gameIdBySlug.get(slug)?.id;
  const order = statements.listOrder.all(listId).map((row) => row.game_id);
  const from = order.indexOf(gameId);
  const to = direction === 'up' ? from - 1 : from + 1;
  if (from === -1 || to < 0 || to >= order.length) return null;
  [order[from], order[to]] = [order[to], order[from]];
  transaction(() => {
    order.forEach((id, position) => statements.setListPosition.run(position, listId, id));
    statements.touchList.run(listId);
  });
  return { position: to + 1, total: order.length };
}

function removeGameFromList(listId, slug) {
  const removed = statements.removeListItem.run(listId, slug).changes > 0;
  if (removed) statements.touchList.run(listId);
  return removed;
}

function summarizeLists(rows) {
  return rows.map((row) => ({
    ...row,
    previewImages: row.preview_images ? row.preview_images.split('|') : [],
  }));
}

function listPublicLists({ viewerId = 0, limit = 12 } = {}) {
  return summarizeLists(statements.listsSummary.all({ owner: 0, viewer: viewerId || 0, limit }));
}

function listListsByUser(ownerId, viewerId = 0, limit = 24) {
  return summarizeLists(statements.listsSummary.all({ owner: ownerId, viewer: viewerId || 0, limit }));
}

function listListsForGame(userId, slug) {
  return statements.listsForGame.all(slug, userId);
}

// Anonymous numbers for a game page: how many members track it per status and how they rated it.
function gameInsights(gameId) {
  const statuses = { want_to_play: 0, playing: 0, played: 0, completed: 0, total: 0 };
  for (const row of statements.gameStatusCounts.all(gameId)) {
    statuses[row.status] = Number(row.count);
    statuses.total += Number(row.count);
  }
  const counts = new Map(statements.gameRatingCounts.all(gameId).map((row) => [Number(row.rating), Number(row.count)]));
  const ratingTotal = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const ratings = [5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5].map((stars) => {
    const count = counts.get(stars) || 0;
    return { stars, count, share: ratingTotal ? Math.round((count / ratingTotal) * 100) : 0 };
  });
  return { statuses, ratings, ratingTotal };
}

function listGamePlayers(gameId, viewerId = 0, limit = 6) {
  return statements.gamePlayers.all({ gameId, viewer: viewerId || 0, limit });
}

function listsFeaturingGame(gameId, viewerId = 0, limit = 3) {
  return statements.listsFeaturingGame.all({ gameId, viewer: viewerId || 0, limit });
}

function listTrendingGames({ viewerId = 0, limit = 5 } = {}) {
  return statements.trendingGames.all({ viewer: viewerId || 0, limit });
}

function communityStats() {
  return statements.stats.get();
}

function hasDemoCommunity() {
  return Boolean(statements.demoPresent.get().present);
}

function findCommunityPick() {
  return statements.communityPick.get() || null;
}

module.exports = {
  addGameToList,
  addReviewComment,
  communityStats,
  createList,
  deleteComment,
  deleteList,
  findComment,
  findCommunityPick,
  findList,
  findMember,
  findReview,
  followMember,
  gameInsights,
  hasDemoCommunity,
  isFollowing,
  listActivity,
  listCommentsForGame,
  listFollowers,
  listFollowing,
  listGamePlayers,
  listGamesInList,
  listListsByUser,
  listListsForGame,
  listMembers,
  listTrendingGames,
  listsFeaturingGame,
  listPublicLists,
  moveGameInList,
  listRatingsByUser,
  listReviewsByUser,
  listReviewsForGame,
  recordActivity,
  removeGameActivity,
  removeGameFromList,
  toggleReviewLike,
  unfollowMember,
  updateList,
};
