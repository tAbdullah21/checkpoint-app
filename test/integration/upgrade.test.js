// Upgrading from Checkpoint 2.3 (NFR-15): a database created by 2.3 opens in 2.4 with every row kept. The 2.3
// schema is test/fixtures/checkpoint-2.3-schema.sql, copied from a real 2.3 database. 2.4 adds the role column
// and rebuilds the notifications table once, because SQLite cannot change a CHECK constraint in place.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const { after, before, describe, it } = require('node:test');
const { startApp, useTemporaryDatabase } = require('../helpers');

const databaseFile = useTemporaryDatabase('upgrade');

// Two members of a 2.3 community: Ola reviewed Elden Ring, Fahad followed her, found the review helpful and
// replied to it. Ola already read the oldest of the three notifications.
function createVersion23Database() {
  const old = new DatabaseSync(databaseFile, { enableForeignKeyConstraints: true });
  old.exec(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'checkpoint-2.3-schema.sql'), 'utf8'));
  const hash = bcrypt.hashSync('Checkpoint123', 4);
  old.prepare("INSERT INTO users (id, name, email, password_hash) VALUES (1, 'Ola Original', 'ola@checkpoint.test', ?), (2, 'Fahad Follower', 'fahad@checkpoint.test', ?)").run(hash, hash);
  old.exec(`
    INSERT INTO games (id, slug, title, release_year, genre, rating, image) VALUES (1, 'elden-ring', 'Elden Ring', 2022, 'Action RPG', 4.8, '/images/covers/elden-ring.jpg');
    INSERT INTO reviews (id, user_id, game_id, rating, review_text) VALUES (7, 1, 1, 5, 'Still the best open world.');
    INSERT INTO review_likes (user_id, review_id) VALUES (2, 7);
    INSERT INTO review_comments (id, review_id, user_id, body) VALUES (3, 7, 2, 'Which boss was the hardest?');
    INSERT INTO follows (follower_id, followed_id) VALUES (2, 1);
    INSERT INTO notifications (id, user_id, actor_id, type, key, review_id, comment_id, read_at, created_at) VALUES
      (10, 1, 2, 'follow', 'follow:2', NULL, NULL, '2026-10-01 09:00:00', '2026-10-01 08:00:00'),
      (11, 1, 2, 'review_like', 'like:7:2', 7, NULL, NULL, '2026-10-02 08:00:00'),
      (12, 1, 2, 'review_comment', 'comment:3', 7, 3, NULL, '2026-10-03 08:00:00');
  `);
  old.close();
}

let app;
let db;

before(async () => {
  createVersion23Database();
  app = await startApp();
  ({ db } = require('../../database/database'));
});

after(() => app.close());

const notificationRows = () => db.prepare('SELECT id, user_id, actor_id, type, key, review_id, comment_id, read_at, created_at, detail FROM notifications ORDER BY id').all().map((row) => ({ ...row }));

describe('opening a 2.3 database', () => {
  it('keeps every notification, exactly as it was', () => {
    assert.deepEqual(notificationRows(), [
      { id: 10, user_id: 1, actor_id: 2, type: 'follow', key: 'follow:2', review_id: null, comment_id: null, read_at: '2026-10-01 09:00:00', created_at: '2026-10-01 08:00:00', detail: '' },
      { id: 11, user_id: 1, actor_id: 2, type: 'review_like', key: 'like:7:2', review_id: 7, comment_id: null, read_at: null, created_at: '2026-10-02 08:00:00', detail: '' },
      { id: 12, user_id: 1, actor_id: 2, type: 'review_comment', key: 'comment:3', review_id: 7, comment_id: 3, read_at: null, created_at: '2026-10-03 08:00:00', detail: '' },
    ]);
  });

  it('accepts the new kinds of notification, which have no actor', () => {
    const { notifyFromCheckpoint } = require('../../database/notifications');
    assert.equal(notifyFromCheckpoint({ userId: 1, type: 'security', key: 'security:locked', detail: 'locked' }), true);
    const columns = db.prepare('PRAGMA table_info(notifications)').all();
    assert.equal(columns.find((column) => column.name === 'actor_id').notnull, 0);
    assert.throws(() => db.prepare("INSERT INTO notifications (user_id, type, key) VALUES (1, 'mystery', 'x')").run(), /CHECK constraint failed/);
  });

  it('gives every member the member role and adds the 2.4 tables', () => {
    assert.deepEqual(db.prepare('SELECT DISTINCT role FROM users').all().map((row) => row.role), ['member']);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
    for (const table of ['reports', 'moderation_log', 'security_events', 'password_resets']) assert.ok(tables.includes(table), table);
    assert.ok(!tables.includes('notifications_upgraded'), 'no leftover from the rebuild');
  });

  it('leaves a consistent database with the indexes in place', () => {
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    const indexes = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'notifications' AND sql IS NOT NULL").all();
    assert.deepEqual(indexes.map((index) => index.name).sort(), [
      'notifications_actor_idx', 'notifications_comment_idx', 'notifications_game_idx', 'notifications_review_idx', 'notifications_unread_idx', 'notifications_user_idx',
    ]);
    assert.match(indexes.find((index) => index.name === 'notifications_actor_idx').sql, /WHERE actor_id IS NOT NULL/);
  });

  it('rebuilds the table only once', () => {
    const { upgradeNotificationsTable } = require('../../database/notifications');
    assert.equal(upgradeNotificationsTable(), false);
    assert.equal(notificationRows().length, 4);
  });

  it('lets the old members log in and see their inbox', async () => {
    const ola = app.client();
    await ola.login('ola@checkpoint.test');
    const inbox = (await ola.get('/notifications')).body.replace(/\s+/g, ' ');
    assert.ok(inbox.includes('Fahad Follower</a> started following you'));
    assert.ok(inbox.includes('found your review of <a href="/games/elden-ring#review-7">Elden Ring</a> helpful'));
    assert.ok(inbox.includes('“Which boss was the hardest?”'));
    assert.ok(inbox.includes('Sign-ins to your account were paused'));
  });
});
