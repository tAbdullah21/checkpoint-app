// Account security model: the member's security activity (sign-ins, failed attempts, password changes) and
// password reset links. A reset link's token is never stored, only its SHA-256 hash, so a copy of the database
// cannot be used to reset anyone's password. IP addresses are not stored at all.
const { db, transaction } = require('./database');

const EVENT_TYPES = [
  'account_created', 'sign_in', 'sign_in_failed', 'locked', 'password_changed', 'reset_requested', 'password_reset', 'signed_out_others',
];
// Only the newest events are kept per member, so a password-guessing attack cannot fill the table.
const EVENTS_KEPT = 30;

db.exec(`
  CREATE TABLE IF NOT EXISTS security_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK(type IN (${EVENT_TYPES.map((type) => `'${type}'`).join(', ')})),
    user_agent TEXT NOT NULL DEFAULT '' CHECK(length(user_agent) <= 300),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) STRICT;

  CREATE INDEX IF NOT EXISTS security_events_user_idx ON security_events (user_id, id DESC);

  CREATE TABLE IF NOT EXISTS password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash) = 64),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) STRICT;

  CREATE INDEX IF NOT EXISTS password_resets_user_idx ON password_resets (user_id);
`);

const statements = {
  insertEvent: db.prepare('INSERT INTO security_events (user_id, type, user_agent) VALUES (?, ?, ?)'),
  pruneEvents: db.prepare(`
    DELETE FROM security_events
    WHERE user_id = :userId AND id NOT IN (
      SELECT id FROM security_events WHERE user_id = :userId ORDER BY id DESC LIMIT :kept
    )
  `),
  events: db.prepare(`
    SELECT id, type, user_agent, created_at FROM security_events
    WHERE user_id = ? ORDER BY id DESC LIMIT ?
  `),
  removeResets: db.prepare('DELETE FROM password_resets WHERE user_id = ?'),
  insertReset: db.prepare(`
    INSERT INTO password_resets (user_id, token_hash, expires_at)
    VALUES (?, ?, datetime('now', '+' || ? || ' minutes'))
  `),
  pruneResets: db.prepare("DELETE FROM password_resets WHERE expires_at <= datetime('now')"),
  validReset: db.prepare(`
    SELECT p.id, p.user_id, p.expires_at, u.email, u.name
    FROM password_resets p JOIN users u ON u.id = p.user_id
    WHERE p.token_hash = ? AND p.expires_at > datetime('now')
  `),
  consumeReset: db.prepare(`
    DELETE FROM password_resets WHERE token_hash = ? AND expires_at > datetime('now') RETURNING user_id
  `),
};

function recordSecurityEvent(userId, type, userAgent = '') {
  if (!userId) return false;
  transaction(() => {
    statements.insertEvent.run(userId, type, String(userAgent || '').slice(0, 300));
    statements.pruneEvents.run({ userId, kept: EVENTS_KEPT });
  });
  return true;
}

function listSecurityEvents(userId, limit = 10) {
  return statements.events.all(userId, Math.max(1, Math.min(Number(limit) || 10, EVENTS_KEPT)));
}

// A new link replaces every older one of the member, so only the newest email works.
function createPasswordReset(userId, tokenHash, minutes) {
  transaction(() => {
    statements.pruneResets.run();
    statements.removeResets.run(userId);
    statements.insertReset.run(userId, tokenHash, String(minutes));
  });
}

// The reset (with the member's email and name) for a token hash, if it exists and has not expired.
function findValidPasswordReset(tokenHash) {
  return statements.validReset.get(String(tokenHash || '')) || null;
}

// Uses up a reset link: returns the member's ID once, and null for an unknown, expired or used link. Checking
// and deleting happen in one statement, so two requests with the same link cannot both succeed.
function consumePasswordReset(tokenHash) {
  return transaction(() => {
    const row = statements.consumeReset.get(String(tokenHash || ''));
    if (!row) return null;
    statements.removeResets.run(row.user_id);
    return row.user_id;
  });
}

// Every link of the member stops working, for example after the password was changed on the account page.
function removePasswordResets(userId) {
  return Number(statements.removeResets.run(userId).changes);
}

module.exports = {
  EVENTS_KEPT,
  SECURITY_EVENT_TYPES: EVENT_TYPES,
  consumePasswordReset,
  createPasswordReset,
  findValidPasswordReset,
  listSecurityEvents,
  recordSecurityEvent,
  removePasswordResets,
};
