// Security middleware: response headers (including a Content Security Policy), cross-site request
// protection for every state-changing request, a small brute-force limiter for logins, and the random tokens
// in password reset links.
const crypto = require('node:crypto');

// The only inline script in the templates (header.ejs) is allowed by its hash, not by 'unsafe-inline'.
const INLINE_SCRIPT = "document.documentElement.classList.add('js');";
const INLINE_SCRIPT_HASH = `'sha256-${crypto.createHash('sha256').update(INLINE_SCRIPT).digest('base64')}'`;

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' ${INLINE_SCRIPT_HASH}`,
  // Inline style attributes carry data such as a match percentage (style="--match: 82").
  "style-src 'self' 'unsafe-inline'",
  // Wide artwork and screenshots load straight from Steam's image network (covers are cached and served locally).
  "img-src 'self' data: https://shared.akamai.steamstatic.com",
  // Steam's trailers (a short hover preview and the full video) stream straight from Steam's content network.
  "media-src 'self' https://video.akamai.steamstatic.com",
  "font-src 'self'",
  'frame-src https://www.youtube-nocookie.com',
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function securityHeaders(req, res, next) {
  res.set({
    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    // YouTube embeds need the site's origin as referrer; full URLs never leave the site.
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    // HTTPS only from now on, sent only over HTTPS (directly, or through a proxy trusted with TRUST_PROXY=1),
    // as RFC 6797 requires.
    ...(req.secure ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
  });
  next();
}

function forbidden(message) {
  const error = new Error(message);
  error.status = 403;
  error.expose = true;
  return error;
}

/*
 * Cross-site request forgery protection without per-form tokens: browsers label every request with
 * Sec-Fetch-Site and send an Origin header on form posts, and neither can be forged by another site.
 * State-changing requests are only accepted from this site (or from non-browser clients, which carry
 * no session cookie of a victim). SameSite=Lax cookies remain as a second layer.
 */
function verifySameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const fetchSite = req.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return next(forbidden('Cross-site request blocked.'));
  }

  const origin = req.get('origin');
  if (origin !== undefined) {
    let originHost;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (!originHost || originHost !== req.get('host')) {
      return next(forbidden('Cross-site request blocked.'));
    }
  }
  return next();
}

// Counts failed logins per IP + email; after `max` failures the pair is locked for the rest of the window.
function createLoginLimiter({ max = 5, windowMs = 15 * 60 * 1000 } = {}) {
  const failures = new Map();

  function prune(now) {
    if (failures.size < 500) return;
    for (const [key, entry] of failures) if (now - entry.first > windowMs) failures.delete(key);
  }

  return {
    retryAfterSeconds(key, now = Date.now()) {
      const entry = failures.get(key);
      if (!entry || now - entry.first > windowMs) return 0;
      return entry.count >= max ? Math.ceil((entry.first + windowMs - now) / 1000) : 0;
    },
    recordFailure(key, now = Date.now()) {
      prune(now);
      const entry = failures.get(key);
      if (!entry || now - entry.first > windowMs) failures.set(key, { count: 1, first: now });
      else entry.count += 1;
    },
    reset(key) {
      failures.delete(key);
    },
    // Forgets every count (the tests start each case from zero).
    clear() {
      failures.clear();
    },
  };
}

// The limiter behind the login form: five wrong passwords per visitor and email address lock that pair for 15
// minutes. It is shared because a password reset unlocks it: whoever just proved they own the email address can
// log in straight away.
const LOGIN_ATTEMPTS = 5;
const LOGIN_LOCK_MINUTES = 15;
const loginLimiter = createLoginLimiter({ max: LOGIN_ATTEMPTS, windowMs: LOGIN_LOCK_MINUTES * 60 * 1000 });
const loginLimiterKey = (req, email) => `${req.ip}|${email}`;

// Additional IP-only limiter to prevent one IP from trying many emails (defect 5 in 2.4).
// 20 failed logins per IP in 15 minutes, regardless of email.
const loginLimiterIP = createLoginLimiter({ max: 20, windowMs: 15 * 60 * 1000 });
const loginLimiterIPKey = (req) => req.ip;

// Password reset requests are counted the same way: three per email address and twenty per visitor in 15
// minutes, so the form can neither flood one inbox nor send mail to many addresses from one place.
const resetLimiters = {
  email: createLoginLimiter({ max: 3, windowMs: 15 * 60 * 1000 }),
  visitor: createLoginLimiter({ max: 20, windowMs: 15 * 60 * 1000 }),
};

// Registration limiter: 5 attempts per IP in 15 minutes (defect 5 in 2.4 - register had no limit).
const REGISTER_ATTEMPTS = 5;
const REGISTER_LOCK_MINUTES = 15;
const registerLimiter = createLoginLimiter({ max: REGISTER_ATTEMPTS, windowMs: REGISTER_LOCK_MINUTES * 60 * 1000 });
const registerLimiterKey = (req) => req.ip;

// A password reset token: 32 random bytes (256 bits) from the operating system's secure generator, written
// as 43 URL-safe characters. Only its SHA-256 hash is stored; a slow hash such as bcrypt is not needed because
// the token is random, not chosen by a person, so it cannot be guessed from a list.
function createResetToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: hashResetToken(token) };
}

function hashResetToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

// Anything that is not 43 URL-safe characters cannot be a token, and is refused before the database is asked.
function isResetToken(value) {
  return /^[A-Za-z0-9_-]{43}$/.test(String(value || ''));
}

module.exports = {
  CONTENT_SECURITY_POLICY,
  INLINE_SCRIPT,
  LOGIN_ATTEMPTS,
  LOGIN_LOCK_MINUTES,
  REGISTER_ATTEMPTS,
  REGISTER_LOCK_MINUTES,
  createLoginLimiter,
  createResetToken,
  hashResetToken,
  isResetToken,
  loginLimiter,
  loginLimiterKey,
  loginLimiterIP,
  loginLimiterIPKey,
  registerLimiter,
  registerLimiterKey,
  resetLimiters,
  securityHeaders,
  verifySameOrigin,
};
