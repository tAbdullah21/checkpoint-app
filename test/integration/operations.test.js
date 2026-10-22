// Running Checkpoint on a server (NFR-13): the health check that uptime monitors and load balancers call, and a
// clean stop when the host stops the server. The stop is tested on real `node app.js` processes, as `npm start`
// runs them, because a signal stops the whole process.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { DatabaseSync } = require('node:sqlite');
const { after, before, describe, it } = require('node:test');
const { Client, formBody, startApp, startServerProcess, useTemporaryDatabase, waitUntil } = require('../helpers');
const { version } = require('../../package.json');

useTemporaryDatabase('operations');

let app;

before(async () => {
  app = await startApp();
});

after(() => app.close());

describe('the health check', () => {
  it('reports the version and a working database', async () => {
    const response = await app.client().get('/health');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^application\/json/);
    assert.equal(response.headers.get('cache-control'), 'no-store', 'a monitor always gets a fresh answer');
    const body = response.json();
    assert.deepEqual(Object.keys(body), ['status', 'version', 'uptimeSeconds', 'database']);
    assert.equal(body.status, 'ok');
    assert.equal(body.version, version);
    assert.equal(body.database, 'ok');
    assert.ok(Number.isInteger(body.uptimeSeconds) && body.uptimeSeconds >= 0);
  });

  it('never starts a session, so monitors calling it every few seconds leave nothing behind', async () => {
    const { db } = require('../../database/database');
    const sessions = () => db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count;
    const before = sessions();
    for (let check = 0; check < 5; check += 1) {
      const response = await app.client().get('/health');
      assert.equal(response.headers.get('set-cookie'), null);
    }
    assert.equal(sessions(), before);
  });

  // Last in this file: it closes the database the app is using.
  it('answers 503 when the database stops answering', async () => {
    require('../../database/database').closeDatabase();
    const response = await app.client().get('/health');
    assert.equal(response.status, 503);
    const { uptimeSeconds, ...body } = response.json();
    assert.deepEqual(body, { status: 'unavailable', version, database: 'unavailable' });
    assert.ok(Number.isInteger(uptimeSeconds));
  });
});

describe('stopping the server', { skip: process.platform === 'win32' && 'Windows has no stop signals to send' }, () => {
  const databaseFiles = [];
  const temporaryDatabase = (name) => {
    const file = path.join(os.tmpdir(), `checkpoint-test-stop-${name}-${process.pid}-${Date.now()}.db`);
    databaseFiles.push(file, `${file}-shm`, `${file}-wal`);
    return file;
  };
  const memberEmails = (file) => {
    const check = new DatabaseSync(file, { readOnly: true });
    try {
      return check.prepare('SELECT email FROM users ORDER BY id').all().map((row) => row.email);
    } finally {
      check.close();
    }
  };

  after(() => {
    for (const file of databaseFiles) fs.rmSync(file, { force: true });
  });

  for (const signal of ['SIGTERM', 'SIGINT']) {
    it(`closes the database and exits with code 0 on ${signal}`, async () => {
      const file = temporaryDatabase(signal);
      const server = await startServerProcess({ DATABASE_PATH: file });
      await new Client(server.baseUrl).register({ name: 'Stop Sami', email: 'sami@checkpoint.test' });
      assert.ok(fs.existsSync(`${file}-wal`), 'while running, SQLite writes to its write-ahead log');

      assert.equal(await server.stop(signal), 0);
      assert.match(server.output(), new RegExp(`${signal} received: finishing the requests already running, then stopping\\.\\nCheckpoint stopped\\.\\n$`));
      assert.equal(server.errors(), '');
      assert.equal(fs.existsSync(`${file}-wal`), false, 'the log was written back into the database file');
      assert.deepEqual(memberEmails(file), ['sami@checkpoint.test']);
    });
  }

  it('turns new visitors away but finishes the request already running', async () => {
    const file = temporaryDatabase('running');
    const server = await startServerProcess({ DATABASE_PATH: file });
    const form = formBody({ name: 'Late Laila', email: 'laila@checkpoint.test', password: 'Checkpoint123', confirmPassword: 'Checkpoint123' });

    // A sign-up whose form is still on its way: "Expect: 100-continue" makes the server confirm it has the
    // request before the form is sent, so the stop signal arrives in the middle of it.
    const signUp = http.request(`${server.baseUrl}/register`, {
      method: 'POST',
      agent: false,
      headers: {
        connection: 'close',
        'content-length': Buffer.byteLength(form),
        'content-type': 'application/x-www-form-urlencoded',
        expect: '100-continue',
        origin: server.baseUrl,
      },
    });
    const response = once(signUp, 'response');
    signUp.flushHeaders();
    await once(signUp, 'continue');

    const stopped = server.stop('SIGTERM');
    await waitUntil(() => server.output().includes('SIGTERM received'), { what: 'the stop message' });
    await assert.rejects(fetch(`${server.baseUrl}/health`), 'a new connection is refused');

    signUp.end(form);
    const [answer] = await response;
    answer.resume();
    assert.equal(answer.statusCode, 302, 'the sign-up still completes');
    assert.equal(answer.headers.location, '/welcome?next=%2Ffor-you');
    assert.equal(await stopped, 0);
    assert.deepEqual(memberEmails(file), ['laila@checkpoint.test']);
  });
});
