// Access control shared by every controller. Member-only pages send guests to the login page with a short
// explanation and come back to the page afterwards; background requests (Accept: application/json) get a
// 401 answer instead of a redirect. Moderation pages also need the administrator role.
const bcrypt = require('bcryptjs');
const { safeLocalPath } = require('./members');
const { characterLength } = require('./text');

const DAY = 24 * 60 * 60 * 1000;
// How long a sign-in lasts without activity: a day, or 30 days with "Keep me signed in".
const SESSION_LIFETIME = DAY;
const REMEMBERED_LIFETIME = 30 * DAY;
// bcrypt only reads the first 72 bytes of a password, so longer ones are refused instead of cut silently.
const PASSWORD_MAX_BYTES = 72;
// The longest email address that can be delivered (RFC 5321). The forms say the same with maxlength.
const EMAIL_MAX_LENGTH = 254;
const PASSWORD_RULE = 'Password must contain at least 8 characters, including a letter and a number.';
// bcrypt work factor for every stored password: 2^10 rounds, a fraction of a second per check.
const BCRYPT_ROUNDS = 10;
// The hash of a random password nobody knows. A login with an unknown email is checked against it, so it takes
// as long as a wrong password and the response time does not reveal which emails have an account.
const UNKNOWN_USER_HASH = '$2b$10$mHk46vTYkkKEWQE3RzzPDejwkiDTrkU0SM5Gzgfp8zDA43o6RTOau';

// Email addresses are stored and looked up trimmed and in lower case.
function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

// Something@something.something, short enough to deliver.
function isEmailAddress(email) {
  return email.length <= EMAIL_MAX_LENGTH && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// The password policy for sign-up and password changes.
function passwordErrors(password, confirmPassword) {
  const errors = [];
  // \p{L} matches any Unicode letter, \p{Nd} matches any decimal digit (Unicode).
  // characterLength counts Unicode code points (like SQLite length()), so emoji count as 1.
  if (characterLength(password) < 8 || !/\p{L}/u.test(password) || !/\p{Nd}/u.test(password)) {
    errors.push(PASSWORD_RULE);
  } else if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    // Bytes, not characters: an Arabic letter takes 2 bytes, an emoji 4.
    errors.push(`Password must be ${PASSWORD_MAX_BYTES} bytes or fewer (about ${PASSWORD_MAX_BYTES} English or ${PASSWORD_MAX_BYTES / 2} Arabic letters).`);
  }
  if (password !== confirmPassword) {
    errors.push('Passwords do not match.');
  }
  return errors;
}

function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

// True only when there is a stored hash and the password matches it; bcrypt runs either way.
async function passwordMatches(password, hash) {
  const matches = await bcrypt.compare(String(password || ''), hash || UNKNOWN_USER_HASH);
  return Boolean(hash) && matches;
}

function wantsJson(req) {
  return String(req.get('accept') || '').includes('application/json');
}

function requireLogin(message = 'Log in to continue.') {
  return (req, res, next) => {
    if (req.session.user) return next();
    if (wantsJson(req)) return res.status(401).json({ ok: false, message });

    // Only pages can be reopened after logging in; a form post goes back to where the form was.
    const returnTo = req.method === 'GET' ? req.originalUrl : req.body?.returnTo;
    req.session.returnTo = safeLocalPath(returnTo, '/');
    req.session.notice = { type: 'info', message };
    return res.redirect('/login');
  };
}

// Moderation pages are for administrators. app.js reads the role from the database on every request, so a
// role taken away with `npm run admin` stops working at once. Guests go to the login page, members get a 403.
function requireAdmin(req, res, next) {
  return requireLogin('Log in to moderate.')(req, res, () => {
    if (req.isAdmin) return next();
    return res.status(403).render('error', { title: 'Not allowed', status: 403, message: 'Only moderators can open this page.' });
  });
}

// Login and sign-up pages are for guests: a logged-in member is sent home instead.
function redirectAuthenticatedUser(req, res, next) {
  if (req.session.user) return res.redirect('/');
  return next();
}

// Starts a fresh session for the member (a new session ID prevents session fixation) and saves it. The
// browser name is kept so the account page can list where the member is signed in.
function signIn(req, user, notice, callback, { lifetime = SESSION_LIFETIME } = {}) {
  req.session.regenerate((error) => {
    if (error) return callback(error);
    req.session.cookie.maxAge = lifetime;
    req.session.user = { id: user.id, name: user.name, email: user.email };
    req.session.device = { userAgent: String(req.get('user-agent') || '').slice(0, 300), signedInAt: new Date().toISOString() };
    req.session.notice = notice;
    return req.session.save(callback);
  });
}

module.exports = {
  BCRYPT_ROUNDS,
  EMAIL_MAX_LENGTH,
  PASSWORD_MAX_BYTES,
  REMEMBERED_LIFETIME,
  SESSION_LIFETIME,
  UNKNOWN_USER_HASH,
  hashPassword,
  isEmailAddress,
  normalizeEmail,
  passwordErrors,
  passwordMatches,
  redirectAuthenticatedUser,
  requireAdmin,
  requireLogin,
  signIn,
  wantsJson,
};
