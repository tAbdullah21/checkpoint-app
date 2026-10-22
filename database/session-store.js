// Sessions are kept in SQLite instead of server memory, so members stay signed in when the server restarts,
// and the account page can list a member's signed-in devices and sign the other ones out.
// express-session calls get/set/touch/destroy; the extra functions below are used by routes/account.js and
// routes/password-reset.js.
const session = require('express-session');
const { db } = require('./database');

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    user_id INTEGER,
    data TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) STRICT;

  CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions (expires_at);
  CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id) WHERE user_id IS NOT NULL;
`);

const ONE_DAY = 24 * 60 * 60 * 1000;
const PRUNE_EVERY = 60 * 60 * 1000;
// Rolling sessions move their expiry forward on every request. Writing that to the disk each time made every page
// view a database write, so the stored expiry is only moved once it is more than a minute behind.
const TOUCH_AFTER = 60 * 1000;

const statements = {
  get: db.prepare('SELECT data, expires_at FROM sessions WHERE sid = ?'),
  // The sub-select stores NULL instead of failing when the account was deleted while a request was running.
  set: db.prepare(`
    INSERT INTO sessions (sid, user_id, data, expires_at)
    VALUES (:sid, (SELECT id FROM users WHERE id = :userId), :data, :expiresAt)
    ON CONFLICT(sid) DO UPDATE SET user_id = excluded.user_id, data = excluded.data, expires_at = excluded.expires_at
  `),
  touch: db.prepare('UPDATE sessions SET expires_at = :expiresAt WHERE sid = :sid AND expires_at < :expiresAt - :touchAfter'),
  destroy: db.prepare('DELETE FROM sessions WHERE sid = ?'),
  prune: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
  length: db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE expires_at > ?'),
  clear: db.prepare('DELETE FROM sessions'),
  forUser: db.prepare('SELECT sid, data, expires_at FROM sessions WHERE user_id = ? AND expires_at > ?'),
  destroyOthers: db.prepare('DELETE FROM sessions WHERE user_id = ? AND sid <> ?'),
  destroyAll: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
};

// When the session cookie expires; sessions without a cookie date live for a day.
function expiryOf(sess, now) {
  const expires = sess?.cookie?.expires ? new Date(sess.cookie.expires).getTime() : NaN;
  return Number.isFinite(expires) ? expires : now + ONE_DAY;
}

class SqliteSessionStore extends session.Store {
  constructor({ now = () => Date.now() } = {}) {
    super();
    this.now = now;
    this.lastPrune = 0;
  }

  get(sid, callback) {
    try {
      const row = statements.get.get(sid);
      if (!row) return callback(null, null);
      if (row.expires_at <= this.now()) {
        statements.destroy.run(sid);
        return callback(null, null);
      }
      return callback(null, JSON.parse(row.data));
    } catch (error) {
      return callback(error);
    }
  }

  set(sid, sess, callback = () => {}) {
    try {
      const now = this.now();
      statements.set.run({ sid, userId: sess.user?.id ?? null, data: JSON.stringify(sess), expiresAt: expiryOf(sess, now) });
      // Expired rows are removed here, at most once an hour, instead of on a timer.
      if (now - this.lastPrune > PRUNE_EVERY) {
        this.lastPrune = now;
        statements.prune.run(now);
      }
      return callback(null);
    } catch (error) {
      return callback(error);
    }
  }

  touch(sid, sess, callback = () => {}) {
    try {
      statements.touch.run({ expiresAt: expiryOf(sess, this.now()), sid, touchAfter: TOUCH_AFTER });
      return callback(null);
    } catch (error) {
      return callback(error);
    }
  }

  destroy(sid, callback = () => {}) {
    try {
      statements.destroy.run(sid);
      return callback(null);
    } catch (error) {
      return callback(error);
    }
  }

  length(callback) {
    try {
      return callback(null, Number(statements.length.get(this.now()).count));
    } catch (error) {
      return callback(error);
    }
  }

  clear(callback = () => {}) {
    try {
      statements.clear.run();
      return callback(null);
    } catch (error) {
      return callback(error);
    }
  }
}

// The member's signed-in browsers: this one first, then the most recently active. A session's last activity
// is its expiry minus the cookie lifetime, because every request moves the expiry forward by that lifetime.
function listUserSessions(userId, currentSid, now = Date.now()) {
  return statements.forUser.all(userId, now)
    .map((row) => {
      const data = JSON.parse(row.data);
      const lifetime = Number(data.cookie?.originalMaxAge) || ONE_DAY;
      return {
        current: row.sid === currentSid,
        userAgent: data.device?.userAgent || '',
        signedInAt: data.device?.signedInAt || null,
        lastActiveAt: new Date(Math.min(row.expires_at - lifetime, now)).toISOString(),
      };
    })
    .sort((first, second) => Number(second.current) - Number(first.current) || second.lastActiveAt.localeCompare(first.lastActiveAt));
}

function destroyOtherSessions(userId, currentSid) {
  return Number(statements.destroyOthers.run(userId, currentSid).changes);
}

// Signs the member out everywhere, used after a password reset by email.
function destroyAllSessions(userId) {
  return Number(statements.destroyAll.run(userId).changes);
}

module.exports = { SqliteSessionStore, TOUCH_AFTER, destroyAllSessions, destroyOtherSessions, listUserSessions };
