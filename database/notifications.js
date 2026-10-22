// Notifications model: "Omar started following you", "Noura found your review helpful", "Faisal replied to
// your review", and messages from Checkpoint itself: a moderator's decision and security alerts. Each row
// belongs to the member who receives it; `key` makes repeated actions update one row instead of piling up, and
// undoing an action (unfollow, removing a helpful vote) removes its notification.
const { db, transaction } = require('./database');
require('./community'); // creates the review and comment tables referenced below

const TYPES = ['follow', 'review_like', 'review_comment', 'content_removed', 'report_resolved', 'security'];

// Messages from Checkpoint (moderation, security) have no actor: moderators stay anonymous to members.
const createTable = (name) => `
  CREATE TABLE IF NOT EXISTS ${name} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    actor_id INTEGER,
    type TEXT NOT NULL CHECK(type IN (${TYPES.map((type) => `'${type}'`).join(', ')})),
    key TEXT NOT NULL CHECK(length(key) <= 40),
    review_id INTEGER,
    comment_id INTEGER,
    game_id INTEGER,
    detail TEXT NOT NULL DEFAULT '' CHECK(length(detail) <= 40),
    read_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, key),
    CHECK (actor_id IS NULL OR user_id <> actor_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE,
    FOREIGN KEY (comment_id) REFERENCES review_comments(id) ON DELETE CASCADE,
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
  ) STRICT;
`;

// Databases from 2.3 have a notifications table that allows only the first three types and always needs an
// actor. SQLite cannot change a CHECK constraint in place, so that table is rebuilt once with every row kept,
// following the steps in https://www.sqlite.org/lang_altertable.html#otheralter.
function upgradeNotificationsTable() {
  const table = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'notifications'").get();
  if (!table || table.sql.includes("'security'")) return false;
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    transaction(() => {
      db.exec(createTable('notifications_upgraded'));
      db.exec(`
        INSERT INTO notifications_upgraded (id, user_id, actor_id, type, key, review_id, comment_id, read_at, created_at)
          SELECT id, user_id, actor_id, type, key, review_id, comment_id, read_at, created_at FROM notifications;
        DROP TABLE notifications;
        ALTER TABLE notifications_upgraded RENAME TO notifications;
      `);
      const problems = db.prepare('PRAGMA foreign_key_check(notifications)').all();
      if (problems.length > 0) throw new Error(`The notifications upgrade found ${problems.length} broken references.`);
    });
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
  return true;
}

upgradeNotificationsTable();

db.exec(`
  ${createTable('notifications')}

  CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;
  CREATE INDEX IF NOT EXISTS notifications_actor_idx ON notifications (actor_id) WHERE actor_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS notifications_review_idx ON notifications (review_id) WHERE review_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS notifications_comment_idx ON notifications (comment_id) WHERE comment_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS notifications_game_idx ON notifications (game_id) WHERE game_id IS NOT NULL;
`);

const statements = {
  // A repeated action (follow again, like again) moves the same notification back to the top as unread.
  upsert: db.prepare(`
    INSERT INTO notifications (user_id, actor_id, type, key, review_id, comment_id, game_id, detail)
    VALUES (:userId, :actorId, :type, :key, :reviewId, :commentId, :gameId, :detail)
    ON CONFLICT(user_id, key) DO UPDATE SET
      detail = excluded.detail,
      created_at = CURRENT_TIMESTAMP,
      read_at = NULL
  `),
  removeByKey: db.prepare('DELETE FROM notifications WHERE user_id = ? AND key = ?'),
  list: db.prepare(`
    SELECT n.id, n.type, n.detail, n.read_at, n.created_at,
      a.id AS actor_id, a.name AS actor_name, a.profile_public AS actor_public,
      g.slug AS game_slug, g.title AS game_title, g.image AS game_image,
      r.id AS review_id, c.body AS comment_body
    FROM notifications n
    LEFT JOIN users a ON a.id = n.actor_id
    LEFT JOIN reviews r ON r.id = n.review_id
    LEFT JOIN games g ON g.id = COALESCE(r.game_id, n.game_id)
    LEFT JOIN review_comments c ON c.id = n.comment_id
    WHERE n.user_id = ?
    ORDER BY n.created_at DESC, n.id DESC
    LIMIT ?
  `),
  unreadCount: db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL'),
  markAllRead: db.prepare('UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL'),
};

// A notification caused by another member; nobody is notified about their own actions.
function notify({ userId, actorId, type, key, reviewId = null, commentId = null }) {
  if (!userId || !actorId || Number(userId) === Number(actorId)) return false;
  return statements.upsert.run({ userId, actorId, type, key, reviewId, commentId, gameId: null, detail: '' }).changes > 0;
}

// A message from Checkpoint itself (a moderator's decision, a security alert), without an actor.
function notifyFromCheckpoint({ userId, type, key, gameId = null, detail = '' }) {
  if (!userId) return false;
  return statements.upsert.run({ userId, actorId: null, type, key, reviewId: null, commentId: null, gameId, detail }).changes > 0;
}

function withdrawNotification(userId, key) {
  return statements.removeByKey.run(userId, key).changes > 0;
}

function listNotifications(userId, limit = 50) {
  return statements.list.all(userId, Math.max(1, Math.min(Number(limit) || 50, 100)));
}

function countUnreadNotifications(userId) {
  return userId ? Number(statements.unreadCount.get(userId).count) : 0;
}

function markNotificationsRead(userId) {
  return statements.markAllRead.run(userId).changes;
}

module.exports = {
  NOTIFICATION_TYPES: TYPES,
  countUnreadNotifications,
  listNotifications,
  markNotificationsRead,
  notify,
  notifyFromCheckpoint,
  upgradeNotificationsTable,
  withdrawNotification,
};
