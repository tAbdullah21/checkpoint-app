// The SQLite session store, tested directly against a throwaway database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { after, before, describe, it } = require('node:test');
const { useTemporaryDatabase } = require('../helpers');

const databaseFile = useTemporaryDatabase('sessions');
const { closeDatabase, createUser, db } = require('../../database/database');
const { SqliteSessionStore, TOUCH_AFTER, destroyOtherSessions, listUserSessions } = require('../../database/session-store');

const HOUR = 60 * 60 * 1000;
let clock = Date.parse('2026-10-16T09:00:00Z');
const store = new SqliteSessionStore({ now: () => clock });
const call = (method, ...args) => new Promise((resolve, reject) => {
  store[method](...args, (error, value) => (error ? reject(error) : resolve(value)));
});
const session = (userId, { lifetime = 24 * HOUR, userAgent = 'Firefox/143.0 (X11; Linux x86_64)' } = {}) => ({
  cookie: { originalMaxAge: lifetime, expires: new Date(clock + lifetime).toISOString(), httpOnly: true, path: '/' },
  user: userId ? { id: userId, name: 'Test' } : undefined,
  device: { userAgent, signedInAt: new Date(clock).toISOString() },
});

let userId;

before(() => {
  userId = createUser({ name: 'Store Tester', email: 'store@checkpoint.test', passwordHash: 'x' }).id;
});

after(() => {
  closeDatabase();
  for (const file of [databaseFile, `${databaseFile}-shm`, `${databaseFile}-wal`]) fs.rmSync(file, { force: true });
});

describe('SqliteSessionStore', () => {
  it('saves and reads a session', async () => {
    await call('set', 'sid-a', session(userId));
    const loaded = await call('get', 'sid-a');
    assert.equal(loaded.user.id, userId);
    assert.equal(await call('get', 'unknown-sid'), null);
  });

  it('forgets a session once it expires', async () => {
    await call('set', 'sid-short', session(userId, { lifetime: HOUR }));
    clock += 2 * HOUR;
    assert.equal(await call('get', 'sid-short'), null);
    assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE sid = 'sid-short'").get().count), 0);
  });

  it('moves the expiry forward when a session is touched', async () => {
    const data = session(userId, { lifetime: HOUR });
    await call('set', 'sid-touch', data);
    clock += 45 * 60 * 1000;
    data.cookie.expires = new Date(clock + HOUR).toISOString();
    await call('touch', 'sid-touch', data);
    clock += 45 * 60 * 1000;
    assert.notEqual(await call('get', 'sid-touch'), null, 'still valid 90 minutes after it was created');
  });

  it('writes a new expiry only once it is more than a minute ahead, so most page views do not write', async () => {
    const data = session(userId, { lifetime: HOUR });
    await call('set', 'sid-quiet', data);
    const stored = () => db.prepare("SELECT expires_at FROM sessions WHERE sid = 'sid-quiet'").get().expires_at;
    const first = stored();
    data.cookie.expires = new Date(first + TOUCH_AFTER - 1000).toISOString();
    await call('touch', 'sid-quiet', data);
    assert.equal(stored(), first, '59 seconds later: nothing written');
    data.cookie.expires = new Date(first + TOUCH_AFTER + 1000).toISOString();
    await call('touch', 'sid-quiet', data);
    assert.equal(stored(), first + TOUCH_AFTER + 1000, '61 seconds later: the expiry moves');
  });

  it('destroys, counts and clears sessions', async () => {
    await call('destroy', 'sid-touch');
    assert.equal(await call('get', 'sid-touch'), null);
    assert.ok((await call('length')) >= 1);
  });

  it('stores no member for guests or for accounts that no longer exist', async () => {
    await call('set', 'sid-guest', session(null));
    await call('set', 'sid-ghost', session(999999));
    const rows = db.prepare("SELECT sid, user_id FROM sessions WHERE sid IN ('sid-guest', 'sid-ghost') ORDER BY sid").all();
    assert.deepEqual(rows.map((row) => row.user_id), [null, null]);
  });

  it('lists a member\'s browsers, current first, and signs out the others', async () => {
    await call('set', 'sid-phone', session(userId, { userAgent: 'iPhone Safari' }));
    clock += 60 * 1000;
    const sessions = listUserSessions(userId, 'sid-a', clock);
    assert.equal(sessions[0].current, true);
    assert.ok(sessions.some((entry) => entry.userAgent === 'iPhone Safari'));
    assert.equal(destroyOtherSessions(userId, 'sid-a'), sessions.length - 1);
    assert.deepEqual(listUserSessions(userId, 'sid-a', clock).map((entry) => entry.current), [true]);
  });

  it('removes a member\'s sessions with the account', async () => {
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    assert.equal(await call('get', 'sid-a'), null);
  });

  it('prunes expired sessions while saving, at most once an hour', async () => {
    await call('set', 'sid-old', session(null, { lifetime: HOUR }));
    clock += 3 * HOUR;
    await call('set', 'sid-new', session(null));
    assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE sid = 'sid-old'").get().count), 0);
    await call('clear');
    assert.equal(await call('length'), 0);
  });
});
