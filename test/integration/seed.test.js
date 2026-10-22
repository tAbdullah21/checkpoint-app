// The demo data script (npm run seed:demo), run as a separate process against a throwaway database.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { after, describe, it } = require('node:test');

const databaseFile = path.join(os.tmpdir(), `checkpoint-test-seed-${process.pid}-${Date.now()}.db`);
const root = path.join(__dirname, '..', '..');

function seed(...args) {
  const result = spawnSync(process.execPath, ['scripts/seed-demo.js', ...args], {
    cwd: root,
    env: { ...process.env, DATABASE_PATH: databaseFile },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function count(sql, ...params) {
  const db = new DatabaseSync(databaseFile);
  try {
    return Number(db.prepare(sql).get(...params).count);
  } finally {
    db.close();
  }
}

const DEMO = "SELECT id FROM users WHERE email LIKE '%@demo.checkpoint.local'";

after(() => {
  for (const file of [databaseFile, `${databaseFile}-shm`, `${databaseFile}-wal`]) fs.rmSync(file, { force: true });
});

describe('demo data', () => {
  it('creates the demo community', () => {
    const output = seed();
    assert.match(output, /Created 9 demo members/);
    assert.equal(count(`SELECT COUNT(*) AS count FROM users WHERE id IN (${DEMO})`), 9);
    assert.equal(count('SELECT COUNT(*) AS count FROM game_lists'), 6);
    assert.equal(count('SELECT COUNT(*) AS count FROM review_comments'), 10);
    assert.ok(count('SELECT COUNT(*) AS count FROM notifications WHERE read_at IS NULL') > 0, 'some notifications are new');
    assert.equal(count('SELECT COUNT(*) AS count FROM notifications WHERE user_id = actor_id'), 0);
  });

  it('includes a moderator with reports waiting, earlier decisions and security activity', () => {
    assert.equal(count("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND email = 'maha@demo.checkpoint.local'"), 1);
    assert.equal(count("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'"), 1, 'nobody else is a moderator');
    assert.equal(count("SELECT COUNT(DISTINCT COALESCE('review:' || review_id, 'reply:' || comment_id)) AS count FROM reports WHERE status = 'open'"), 2);
    assert.equal(count('SELECT COUNT(*) AS count FROM moderation_log'), 2);
    assert.equal(count('SELECT COUNT(*) AS count FROM notifications WHERE actor_id IS NULL'), 4, 'decisions and the security alert');
    assert.equal(count(`SELECT COUNT(*) AS count FROM security_events WHERE type = 'account_created' AND user_id IN (${DEMO})`), 9);
  });

  it('does not add the members twice', () => {
    assert.match(seed(), /already exist/);
    assert.equal(count(`SELECT COUNT(*) AS count FROM users WHERE id IN (${DEMO})`), 9);
  });

  it('removes only demo data, even when real members interacted with it', () => {
    const db = new DatabaseSync(databaseFile, { enableForeignKeyConstraints: true });
    const realId = Number(db.prepare("INSERT INTO users (name, email, password_hash) VALUES ('Real Player', 'real@checkpoint.test', 'x')").run().lastInsertRowid);
    const linaId = Number(db.prepare("SELECT id FROM users WHERE email = 'lina@demo.checkpoint.local'").get().id);
    db.prepare('INSERT INTO follows (follower_id, followed_id) VALUES (?, ?)').run(realId, linaId);
    db.prepare("INSERT INTO reviews (user_id, game_id, rating, review_text) SELECT ?, id, 4, 'Real review' FROM games WHERE slug = 'subnautica'").run(realId);
    db.close();

    assert.match(seed('--remove'), /Removed 9 demo members/);
    assert.equal(count(`SELECT COUNT(*) AS count FROM users WHERE id IN (${DEMO})`), 0);
    assert.equal(count("SELECT COUNT(*) AS count FROM users WHERE email = 'real@checkpoint.test'"), 1);
    assert.equal(count("SELECT COUNT(*) AS count FROM reviews WHERE review_text = 'Real review'"), 1);
    const owners = { follows: 'followed_id', reports: 'reporter_id' };
    for (const table of ['follows', 'review_likes', 'review_comments', 'game_lists', 'activities', 'notifications', 'reports', 'security_events']) {
      const owner = owners[table] || 'user_id';
      assert.equal(count(`SELECT COUNT(*) AS count FROM ${table} WHERE ${owner} NOT IN (SELECT id FROM users)`), 0, `${table} has no orphans`);
    }
    assert.equal(count('SELECT COUNT(*) AS count FROM moderation_log'), 0, 'no decisions about removed demo posts are left');
    assert.equal(count('SELECT COUNT(*) AS count FROM follows'), 0, 'the real member no longer follows a deleted demo member');
  });

  it('recreates everything with --reset', () => {
    seed();
    assert.match(seed('--reset'), /Created 9 demo members/);
    assert.equal(count(`SELECT COUNT(*) AS count FROM users WHERE id IN (${DEMO})`), 9);
  });
});
