// Sessions are stored in SQLite: a member who logged in stays logged in after the server restarts.
// The app runs in child processes here, so this is a real restart, not a simulated one.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, describe, it } = require('node:test');
const { Client, startServerProcess } = require('../helpers');

const databaseFile = path.join(os.tmpdir(), `checkpoint-test-restart-${process.pid}-${Date.now()}.db`);
const settings = { DATABASE_PATH: databaseFile, SESSION_SECRET: 'restart-test-secret', NODE_ENV: 'test' };

after(() => {
  for (const file of [databaseFile, `${databaseFile}-shm`, `${databaseFile}-wal`]) fs.rmSync(file, { force: true });
});

describe('server restarts', () => {
  it('keeps members signed in', async () => {
    const first = await startServerProcess(settings);
    const member = new Client(first.baseUrl);
    await member.register({ name: 'Rami Restart', email: 'rami@checkpoint.test' });
    assert.equal((await member.get('/library')).status, 200);
    await first.stop();

    const second = await startServerProcess(settings);
    member.baseUrl = second.baseUrl;
    try {
      const library = await member.get('/library');
      assert.equal(library.status, 200, 'still signed in after the restart');
      assert.ok(library.body.includes('Rami'));
    } finally {
      await second.stop();
    }
  });
});
