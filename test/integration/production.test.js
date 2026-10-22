// Running Checkpoint on a server (NODE_ENV=production): the app needs a session secret, sends the session cookie
// only over HTTPS, behind an HTTPS proxy (TRUST_PROXY=1) keeps sign-ins and counts failed logins per visitor, and
// has no development mailbox. Each server runs in its own process, because these settings are read when the app
// starts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, describe, it } = require('node:test');
const { Client, startServerProcess, waitUntil } = require('../helpers');

const databaseFile = path.join(os.tmpdir(), `checkpoint-test-production-${process.pid}-${Date.now()}.db`);
const production = { DATABASE_PATH: databaseFile, NODE_ENV: 'production', SESSION_SECRET: 'production-test-secret', TRUST_PROXY: '' };
const viaHttpsProxy = (address = '203.0.113.10') => ({ headers: { 'x-forwarded-proto': 'https', 'x-forwarded-for': address } });

after(() => {
  for (const file of [databaseFile, `${databaseFile}-shm`, `${databaseFile}-wal`]) fs.rmSync(file, { force: true });
});

describe('production settings', () => {
  it('refuses to start without a session secret', async () => {
    await assert.rejects(startServerProcess({ ...production, SESSION_SECRET: '' }), /SESSION_SECRET must be set when NODE_ENV is production/);
  });

  it('sends the session cookie only over HTTPS and ignores forwarded headers by default', async () => {
    const server = await startServerProcess(production);
    try {
      const visitor = new Client(server.baseUrl);
      const signUp = await visitor.post('/register', { name: 'Plain Http', email: 'plain@checkpoint.test', password: 'Checkpoint123', confirmPassword: 'Checkpoint123' });
      assert.equal(signUp.status, 302, 'the account is created');
      assert.equal(signUp.headers.get('set-cookie'), null, 'but no session cookie travels over plain HTTP');
      assert.equal(signUp.headers.get('strict-transport-security'), null, 'HSTS is never sent over plain HTTP');

      const forged = await new Client(server.baseUrl).post('/login', { email: 'plain@checkpoint.test', password: 'Checkpoint123' }, viaHttpsProxy());
      assert.equal(forged.status, 302);
      assert.equal(forged.headers.get('set-cookie'), null, 'X-Forwarded-Proto is not trusted without TRUST_PROXY=1');
    } finally {
      await server.stop();
    }
  });
});

describe('behind an HTTPS proxy (TRUST_PROXY=1)', () => {
  let server;
  const client = () => new Client(server.baseUrl);

  before(async () => {
    server = await startServerProcess({ ...production, TRUST_PROXY: '1' });
    const response = await client().post('/register', { name: 'Proxy Player', email: 'proxy@checkpoint.test', password: 'Checkpoint123', confirmPassword: 'Checkpoint123' }, viaHttpsProxy());
    assert.equal(response.status, 302);
  });

  after(() => server.stop());

  it('keeps a sign-in with a Secure session cookie and HSTS', async () => {
    const member = client();
    const login = await member.post('/login', { email: 'proxy@checkpoint.test', password: 'Checkpoint123' }, viaHttpsProxy());
    assert.equal(login.status, 302);
    assert.match(login.headers.get('set-cookie'), /; Secure/i);
    assert.equal(login.headers.get('strict-transport-security'), 'max-age=31536000', 'browsers are told to stay on HTTPS');
    const library = await member.get('/library', viaHttpsProxy());
    assert.equal(library.status, 200);
    assert.ok(library.body.includes('Proxy Player'));
  });

  it('counts failed logins per visitor address, not for the proxy as a whole', async () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await client().post('/login', { email: 'proxy@checkpoint.test', password: `Wrong${attempt}pass` }, viaHttpsProxy('203.0.113.66'));
      assert.equal(response.status, 401, `attempt ${attempt}`);
    }
    const attacker = await client().post('/login', { email: 'proxy@checkpoint.test', password: 'Checkpoint123' }, viaHttpsProxy('203.0.113.66'));
    assert.equal(attacker.status, 429, 'the address that guessed is locked');
    const member = await client().post('/login', { email: 'proxy@checkpoint.test', password: 'Checkpoint123' }, viaHttpsProxy('198.51.100.7'));
    assert.equal(member.status, 302, 'the member, coming through the same proxy from another address, is not');
  });

  it('has no development mailbox, and logs that reset emails are not sent, without the address', async () => {
    assert.equal((await client().get('/dev/mailbox', viaHttpsProxy())).status, 404);
    const request = await client().post('/forgot-password', { email: 'proxy@checkpoint.test' }, viaHttpsProxy('198.51.100.20'));
    assert.equal(request.status, 302, 'the visitor sees the usual "check your inbox" page');
    assert.equal(request.location, '/forgot-password/sent');
    const warning = 'An email ("Reset your Checkpoint password") was not sent: no mail service is configured.';
    await waitUntil(() => server.errors().includes(warning), { what: 'the warning in the server log' });
    assert.ok(!server.errors().includes('proxy@checkpoint.test'), 'the address is personal data');
  });
});
