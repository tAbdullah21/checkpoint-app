// Security behaviour seen from the outside: headers, cross-site requests, brute force, redirects and input limits.
const assert = require('node:assert/strict');
const { after, before, describe, it } = require('node:test');
const { startApp, useTemporaryDatabase } = require('../helpers');

useTemporaryDatabase('security');

let app;
let guest;

before(async () => {
  app = await startApp();
  guest = app.client();
  await app.client().register({ name: 'Sami Secure', email: 'sami@checkpoint.test', password: 'Checkpoint123' });
});

after(() => app.close());

describe('response headers', () => {
  it('sends a Content Security Policy and hardening headers on every page', async () => {
    for (const path of ['/', '/games/elden-ring', '/login', '/api/stats', '/does-not-exist']) {
      const response = await guest.get(path);
      assert.match(response.headers.get('content-security-policy'), /default-src 'self'/, path);
      assert.equal(response.headers.get('x-frame-options'), 'DENY', path);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff', path);
      assert.equal(response.headers.get('x-powered-by'), null, path);
    }
  });

  it('marks the session cookie HttpOnly and SameSite=Lax', async () => {
    const client = app.client();
    const response = await client.post('/login', { email: 'sami@checkpoint.test', password: 'Checkpoint123' });
    const cookie = response.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
  });
});

describe('cross-site request forgery', () => {
  it('rejects a login form posted from another website', async () => {
    const client = app.client();
    const response = await client.post('/login', { email: 'sami@checkpoint.test', password: 'Checkpoint123' }, {
      headers: { origin: 'https://evil.example' },
    });
    assert.equal(response.status, 403);
    assert.ok(response.body.includes('This request was blocked to protect your account.'));
    assert.ok((await client.get('/profile')).location === '/login', 'no session was created');
  });

  it('rejects requests that the browser marks as cross-site', async () => {
    const client = app.client();
    await client.login('sami@checkpoint.test');
    const response = await client.post('/library/elden-ring/add', { status: 'playing', returnTo: '/' }, {
      headers: { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' },
    });
    assert.equal(response.status, 403);
    const game = await client.get('/games/elden-ring');
    assert.ok(game.body.includes('Add to your library'), 'nothing was added');
    assert.ok(!game.body.includes('In your library'));
  });

  it('answers API requests that are blocked with JSON', async () => {
    const response = await guest.post('/api/stats', {}, { headers: { origin: 'https://evil.example' } });
    assert.equal(response.status, 403);
    assert.equal(response.json().error, 'Cross-site request blocked.');
  });
});

describe('brute-force protection', () => {
  it('locks an account for this address after five wrong passwords', async () => {
    const attacker = app.client();
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await attacker.post('/login', { email: 'sami@checkpoint.test', password: `Wrong${attempt}pass` });
      assert.equal(response.status, 401, `attempt ${attempt}`);
    }

    const locked = await attacker.post('/login', { email: 'sami@checkpoint.test', password: 'Checkpoint123' });
    assert.equal(locked.status, 429, 'even the right password waits until the lock ends');
    assert.ok(Number(locked.headers.get('retry-after')) > 0);
    assert.ok(locked.body.includes('Too many failed attempts'));
  });

  it('cannot be dodged by sending a fake X-Forwarded-For address', async () => {
    await app.client().register({ name: 'Faked Address', email: 'faked@checkpoint.test', password: 'Checkpoint123' });
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const headers = { 'x-forwarded-for': `203.0.113.${attempt}` };
      const response = await app.client().post('/login', { email: 'faked@checkpoint.test', password: `Wrong${attempt}pass` }, { headers });
      assert.equal(response.status, attempt <= 5 ? 401 : 429, `attempt ${attempt}`);
    }
  });

  it('does not lock other accounts', async () => {
    await app.client().register({ name: 'Other User', email: 'other@checkpoint.test', password: 'Checkpoint123' });
    const response = await app.client().post('/login', { email: 'other@checkpoint.test', password: 'Checkpoint123' });
    assert.equal(response.status, 302);
  });
});

describe('redirects and input limits', () => {
  let member;

  before(async () => {
    member = await app.client().signUp('Redirect Tester', 'redirect@checkpoint.test');
  });

  it('never redirects to another website after saving a game', async () => {
    for (const returnTo of ['//evil.example', 'https://evil.example', '/\\evil.example']) {
      const response = await member.post('/library/subnautica/add', { status: 'playing', returnTo });
      assert.equal(response.status, 302);
      assert.ok(response.location.startsWith('/') && !response.location.startsWith('//'), `${returnTo} → ${response.location}`);
    }
  });

  it('counts emoji as single characters in names', async () => {
    const response = await app.client().post('/register', {
      name: '😀😀',
      email: 'emoji@checkpoint.test',
      password: 'Checkpoint123',
      confirmPassword: 'Checkpoint123',
    });
    assert.equal(response.status, 302, 'two emoji make a valid two-character name');
  });

  it('rejects oversized form bodies', async () => {
    const response = await member.post('/profile/edit', { name: 'Big', bio: 'x'.repeat(30_000) });
    assert.equal(response.status, 413);
  });

  it('does not leak stack traces on bad requests', async () => {
    const response = await guest.get('/games/%E0%A4%A');
    assert.equal(response.status, 400);
    assert.ok(!/at .*\.js:\d+/.test(response.body));
  });

  it('escapes what members type', async () => {
    const response = await member.post('/lists', { title: '<script>alert(1)</script>', description: '<img src=x onerror=alert(1)>' });
    const page = await guest.get(response.location);
    assert.ok(!page.body.includes('<script>alert(1)</script>'));
    assert.ok(page.body.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(!page.body.includes('<img src=x'));
  });
});
