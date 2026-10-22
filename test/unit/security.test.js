const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const {
  CONTENT_SECURITY_POLICY,
  INLINE_SCRIPT,
  LOGIN_ATTEMPTS,
  LOGIN_LOCK_MINUTES,
  createLoginLimiter,
  createResetToken,
  hashResetToken,
  isResetToken,
  loginLimiter,
  loginLimiterKey,
  resetLimiters,
  securityHeaders,
  verifySameOrigin,
} = require('../../lib/security');
const { safeLocalPath } = require('../../lib/members');

function fakeRequest(method, headers = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return { method, get: (name) => lower[name.toLowerCase()] };
}

function runMiddleware(middleware, request) {
  let result = 'not called';
  middleware(request, {}, (error) => {
    result = error || 'next';
  });
  return result;
}

describe('verifySameOrigin (cross-site request forgery protection)', () => {
  it('lets reads through', () => {
    assert.equal(runMiddleware(verifySameOrigin, fakeRequest('GET', { 'sec-fetch-site': 'cross-site' })), 'next');
  });

  it('accepts form posts from the same site', () => {
    const request = fakeRequest('POST', { host: 'localhost:3000', origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' });
    assert.equal(runMiddleware(verifySameOrigin, request), 'next');
  });

  it('blocks posts that a browser labels as cross-site', () => {
    const error = runMiddleware(verifySameOrigin, fakeRequest('POST', { host: 'localhost:3000', 'sec-fetch-site': 'cross-site' }));
    assert.equal(error.status, 403);
  });

  it('blocks posts whose Origin is another host', () => {
    const error = runMiddleware(verifySameOrigin, fakeRequest('POST', { host: 'localhost:3000', origin: 'https://evil.example' }));
    assert.equal(error.status, 403);
    const nullOrigin = runMiddleware(verifySameOrigin, fakeRequest('POST', { host: 'localhost:3000', origin: 'null' }));
    assert.equal(nullOrigin.status, 403);
  });

  it('allows non-browser clients without these headers (they carry no victim cookies)', () => {
    assert.equal(runMiddleware(verifySameOrigin, fakeRequest('POST', { host: 'localhost:3000' })), 'next');
  });
});

describe('createLoginLimiter', () => {
  it('locks a key after five failures and unlocks after the window', () => {
    const limiter = createLoginLimiter({ max: 5, windowMs: 60_000 });
    const start = 1_000_000;
    for (let attempt = 0; attempt < 4; attempt += 1) limiter.recordFailure('ip|a@b.c', start);
    assert.equal(limiter.retryAfterSeconds('ip|a@b.c', start), 0, 'four failures are still allowed');
    limiter.recordFailure('ip|a@b.c', start);
    assert.equal(limiter.retryAfterSeconds('ip|a@b.c', start + 1_000), 59);
    assert.equal(limiter.retryAfterSeconds('ip|other@b.c', start + 1_000), 0, 'other accounts are not affected');
    assert.equal(limiter.retryAfterSeconds('ip|a@b.c', start + 61_000), 0, 'the lock expires');
  });

  it('is cleared by a successful login', () => {
    const limiter = createLoginLimiter({ max: 2, windowMs: 60_000 });
    limiter.recordFailure('key', 0);
    limiter.recordFailure('key', 0);
    assert.ok(limiter.retryAfterSeconds('key', 0) > 0);
    limiter.reset('key');
    assert.equal(limiter.retryAfterSeconds('key', 0), 0);
  });
});

describe('the shared limiters', () => {
  it('count wrong passwords per visitor address and email address', () => {
    assert.equal(loginLimiterKey({ ip: '203.0.113.5' }, 'lina@demo.checkpoint.local'), '203.0.113.5|lina@demo.checkpoint.local');
  });

  it(`pause sign-ins for ${LOGIN_LOCK_MINUTES} minutes after ${LOGIN_ATTEMPTS} wrong passwords, until cleared`, () => {
    const key = 'unit|limit@checkpoint.test';
    loginLimiter.clear();
    for (let attempt = 1; attempt < LOGIN_ATTEMPTS; attempt += 1) loginLimiter.recordFailure(key, 0);
    assert.equal(loginLimiter.retryAfterSeconds(key, 0), 0);
    loginLimiter.recordFailure(key, 0);
    assert.equal(loginLimiter.retryAfterSeconds(key, 0), LOGIN_LOCK_MINUTES * 60);
    loginLimiter.clear();
    assert.equal(loginLimiter.retryAfterSeconds(key, 0), 0);
  });

  it('allow three reset emails per address and twenty per visitor in 15 minutes', () => {
    for (const [limiter, allowed] of [[resetLimiters.email, 3], [resetLimiters.visitor, 20]]) {
      limiter.clear();
      for (let request = 1; request <= allowed; request += 1) {
        assert.equal(limiter.retryAfterSeconds('key', 0), 0, `request ${request} is allowed`);
        limiter.recordFailure('key', 0);
      }
      assert.equal(limiter.retryAfterSeconds('key', 0), 15 * 60, `request ${allowed + 1} waits`);
      limiter.clear();
    }
  });
});

describe('password reset tokens', () => {
  it('carry 256 random bits in 43 URL-safe characters, and only their SHA-256 hash is stored', () => {
    const { token, hash } = createResetToken();
    assert.ok(isResetToken(token));
    assert.equal(Buffer.from(token, 'base64url').length, 32);
    assert.equal(hash, crypto.createHash('sha256').update(token).digest('hex'));
    assert.equal(hashResetToken(token), hash);
    assert.match(hash, /^[0-9a-f]{64}$/);
  });

  it('are never the same twice', () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => createResetToken().token));
    assert.equal(tokens.size, 1000);
  });

  it('are recognised by their shape before the database is asked', () => {
    assert.ok(isResetToken(`${'A'.repeat(41)}-_`));
    for (const value of ['', 'short', 'A'.repeat(42), 'A'.repeat(44), `${'A'.repeat(42)}=`, `${'A'.repeat(42)}+`, `${'A'.repeat(42)}/`, `${'A'.repeat(42)}\n`, null, undefined]) {
      assert.equal(isResetToken(value), false, JSON.stringify(value));
    }
  });
});

describe('securityHeaders', () => {
  it('sends a strict Content Security Policy and related headers', () => {
    const headers = {};
    securityHeaders({}, { set: (values) => Object.assign(headers, values) }, () => {});
    assert.equal(headers['Content-Security-Policy'], CONTENT_SECURITY_POLICY);
    assert.match(CONTENT_SECURITY_POLICY, /default-src 'self'/);
    assert.match(CONTENT_SECURITY_POLICY, /object-src 'none'/);
    assert.match(CONTENT_SECURITY_POLICY, /frame-ancestors 'none'/);
    assert.doesNotMatch(CONTENT_SECURITY_POLICY, /script-src[^;]*'unsafe-inline'/);
    assert.equal(headers['X-Frame-Options'], 'DENY');
    assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  });

  it('asks browsers to stay on HTTPS, but only on secure connections', () => {
    const headersFor = (req) => {
      const headers = {};
      securityHeaders(req, { set: (values) => Object.assign(headers, values) }, () => {});
      return headers;
    };
    assert.equal(headersFor({ secure: true })['Strict-Transport-Security'], 'max-age=31536000');
    assert.equal(headersFor({ secure: false })['Strict-Transport-Security'], undefined);
  });

  it('allows exactly the inline script used in the header template', () => {
    const header = fs.readFileSync(path.join(__dirname, '..', '..', 'views', 'partials', 'header.ejs'), 'utf8');
    const inlineScripts = [...header.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
    assert.deepEqual(inlineScripts, [INLINE_SCRIPT], 'every inline script must be listed in lib/security.js');
    const hash = crypto.createHash('sha256').update(INLINE_SCRIPT).digest('base64');
    assert.ok(CONTENT_SECURITY_POLICY.includes(`'sha256-${hash}'`));
  });
});

describe('safeLocalPath (open redirect protection)', () => {
  it('keeps local paths', () => {
    assert.equal(safeLocalPath('/games/elden-ring#reviews'), '/games/elden-ring#reviews');
    assert.equal(safeLocalPath('/members?q=lina'), '/members?q=lina');
  });

  it('replaces anything that could leave the site', () => {
    for (const value of ['//evil.example', 'https://evil.example', '/\\evil.example', 'javascript:alert(1)', `/${'a'.repeat(250)}`, 42, undefined]) {
      assert.equal(safeLocalPath(value, '/fallback'), '/fallback', `rejects ${String(value).slice(0, 30)}`);
    }
  });
});
