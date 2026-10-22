// Account model: password changes, the "download my data" export and account deletion.
// Deleting the users row removes everything that belongs to the member through ON DELETE CASCADE (library,
// reviews, replies, likes, follows, lists, activity, notifications, reports, security activity, reset links
// and sessions). The moderation log keeps its decisions, but not the member's words.
const { dismissedGames, setupCompleted } = require('./preferences');
const { db, transaction } = require('./database');
require('./community');
require('./moderation');
require('./notifications');
require('./review-details');
require('./tiers');
require('./security');
require('./session-store');

const statements = {
  passwordHash: db.prepare('SELECT password_hash FROM users WHERE id = ?'),
  updatePassword: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
  deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
  forgetModeratedText: db.prepare("UPDATE moderation_log SET content = '' WHERE author_id = ?"),
  account: db.prepare(`
    SELECT id, name, email, bio, steam_id, psn_id, xbox_id, steam_visible, psn_visible, xbox_visible,
      preferred_platform, favorite_genres, profile_public, created_at
    FROM users WHERE id = ?
  `),
  library: db.prepare(`
    SELECT g.slug, g.title, l.status, l.is_favorite, l.added_at, l.updated_at
    FROM user_library l JOIN games g ON g.id = l.game_id
    WHERE l.user_id = ? ORDER BY l.added_at, g.title
  `),
  reviews: db.prepare(`
    SELECT r.id, g.slug, g.title, r.rating, r.review_text, r.created_at, r.updated_at,
      (SELECT COUNT(*) FROM review_likes rl WHERE rl.review_id = r.id) AS helpful_votes,
      d.spoiler, d.hours, d.platform, d.gameplay, d.story, d.visuals, d.audio, d.value
    FROM reviews r JOIN games g ON g.id = r.game_id
    LEFT JOIN review_details d ON d.review_id = r.id
    WHERE r.user_id = ? ORDER BY r.created_at
  `),
  tiers: db.prepare(`
    SELECT t.tier, t.position, t.updated_at, g.slug, g.title
    FROM tier_entries t JOIN games g ON g.id = t.game_id
    WHERE t.user_id = ? ORDER BY t.tier, t.position
  `),
  replies: db.prepare(`
    SELECT c.body, c.created_at, g.slug, g.title, r.id AS review_id
    FROM review_comments c JOIN reviews r ON r.id = c.review_id JOIN games g ON g.id = r.game_id
    WHERE c.user_id = ? ORDER BY c.created_at, c.id
  `),
  votes: db.prepare(`
    SELECT g.slug, g.title, r.id AS review_id, rl.created_at
    FROM review_likes rl JOIN reviews r ON r.id = rl.review_id JOIN games g ON g.id = r.game_id
    WHERE rl.user_id = ? ORDER BY rl.created_at
  `),
  lists: db.prepare('SELECT id, title, description, created_at, updated_at FROM game_lists WHERE user_id = ? ORDER BY created_at, id'),
  listItems: db.prepare(`
    SELECT i.list_id, g.slug FROM game_list_items i JOIN game_lists l ON l.id = i.list_id JOIN games g ON g.id = i.game_id
    WHERE l.user_id = ? ORDER BY i.list_id, i.position, i.added_at
  `),
  following: db.prepare(`
    SELECT u.id, u.name, u.profile_public, f.created_at
    FROM follows f JOIN users u ON u.id = f.followed_id
    WHERE f.follower_id = ? ORDER BY f.created_at
  `),
  followerCount: db.prepare('SELECT COUNT(*) AS count FROM follows WHERE followed_id = ?'),
  activity: db.prepare(`
    SELECT a.type, a.detail, a.created_at, g.slug, l.title AS list_title
    FROM activities a LEFT JOIN games g ON g.id = a.game_id LEFT JOIN game_lists l ON l.id = a.list_id
    WHERE a.user_id = ? ORDER BY a.created_at, a.id
  `),
  securityEvents: db.prepare('SELECT type, user_agent, created_at FROM security_events WHERE user_id = ? ORDER BY id'),
  reports: db.prepare(`
    SELECT CASE WHEN rep.review_id IS NULL THEN 'reply' ELSE 'review' END AS kind, rep.review_id, rep.comment_id,
      COALESCE(rg.slug, cg.slug) AS slug, rep.reason, rep.note, rep.status, rep.created_at, rep.resolved_at
    FROM reports rep
    LEFT JOIN reviews r ON r.id = rep.review_id
    LEFT JOIN games rg ON rg.id = r.game_id
    LEFT JOIN review_comments c ON c.id = rep.comment_id
    LEFT JOIN reviews cr ON cr.id = c.review_id
    LEFT JOIN games cg ON cg.id = cr.game_id
    WHERE rep.reporter_id = ? ORDER BY rep.created_at, rep.id
  `),
  moderation: db.prepare(`
    SELECT l.action, l.reason, l.content, l.created_at, g.title
    FROM moderation_log l LEFT JOIN games g ON g.id = l.game_id
    WHERE l.author_id = ? ORDER BY l.created_at, l.id
  `),
  counts: db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM user_library WHERE user_id = :id) AS games,
      (SELECT COUNT(*) FROM reviews WHERE user_id = :id) AS reviews,
      (SELECT COUNT(*) FROM review_comments WHERE user_id = :id) AS replies,
      (SELECT COUNT(*) FROM game_lists WHERE user_id = :id) AS lists,
      (SELECT COUNT(*) FROM follows WHERE follower_id = :id) AS following
  `),
};

function findPasswordHash(userId) {
  return statements.passwordHash.get(userId)?.password_hash || null;
}

function updatePasswordHash(userId, passwordHash) {
  return statements.updatePassword.run(passwordHash, userId).changes > 0;
}

function deleteAccount(userId) {
  return transaction(() => {
    statements.forgetModeratedText.run(userId);
    return statements.deleteUser.run(userId).changes > 0;
  });
}

// How much the member has stored, shown on the account page before they export or delete it.
function accountCounts(userId) {
  const row = statements.counts.get({ id: userId });
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
}

// Everything Checkpoint stores about one member, as plain rows (lib/account-export.js shapes the file).
function accountExportRows(userId) {
  const account = statements.account.get(userId);
  if (!account) return null;
  return {
    account,
    library: statements.library.all(userId),
    reviews: statements.reviews.all(userId),
    tiers: statements.tiers.all(userId),
    dismissedGames: dismissedGames(userId),
    setupCompleted: setupCompleted(userId),
    replies: statements.replies.all(userId),
    votes: statements.votes.all(userId),
    lists: statements.lists.all(userId),
    listItems: statements.listItems.all(userId),
    following: statements.following.all(userId),
    followerCount: Number(statements.followerCount.get(userId).count),
    activity: statements.activity.all(userId),
    securityEvents: statements.securityEvents.all(userId),
    reports: statements.reports.all(userId),
    moderation: statements.moderation.all(userId),
  };
}

module.exports = { accountCounts, accountExportRows, deleteAccount, findPasswordHash, updatePasswordHash };
