const express = require('express');
const { createUser, findUserByEmail, listGamesForUser } = require('../database/database');
const { notifyFromCheckpoint } = require('../database/notifications');
const { recordSecurityEvent } = require('../database/security');
const {
  EMAIL_MAX_LENGTH,
  PASSWORD_MAX_BYTES,
  REMEMBERED_LIFETIME,
  SESSION_LIFETIME,
  hashPassword,
  isEmailAddress,
  normalizeEmail,
  passwordErrors,
  passwordMatches,
  redirectAuthenticatedUser,
  signIn,
} = require('../lib/auth');
const { safeLocalPath } = require('../lib/members');
const { characterLength } = require('../lib/text');
const { loginLimiter, loginLimiterKey, loginLimiterIP, loginLimiterIPKey, registerLimiter, registerLimiterKey } = require('../lib/security');

const router = express.Router();

// Covers for the artwork side of the login, sign-up and password reset pages (best-rated games first), and the
// limits the forms give the browser (the server checks them again).
router.use(['/login', '/register', '/forgot-password', '/reset-password'], (req, res, next) => {
  res.locals.authCovers = listGamesForUser(0)
    .sort((first, second) => second.rating - first.rating || second.year - first.year)
    .slice(0, 9)
    .map((game) => game.image);
  res.locals.emailMaxLength = EMAIL_MAX_LENGTH;
  res.locals.passwordMaxBytes = PASSWORD_MAX_BYTES;
  next();
});

function validateRegistration({ name, email, password, confirmPassword }) {
  const errors = [];

  if (characterLength(name) < 2 || characterLength(name) > 60) {
    errors.push('Name must be between 2 and 60 characters.');
  }

  if (!isEmailAddress(email)) {
    errors.push('Enter a valid email address.');
  }

  return errors.concat(passwordErrors(password, confirmPassword));
}

// Where to go after logging in or signing up: the page named in ?next= (the "Log in" links carry it), else
// the page a guest was trying to open when requireLogin stopped them, else the dashboard.
function nextPath(value) {
  return safeLocalPath(value, '');
}

function pageAfterLogin(req) {
  return nextPath(req.body.next) || safeLocalPath(req.session.returnTo, '/');
}

router.get('/register', redirectAuthenticatedUser, (req, res) => {
  res.render('register', {
    title: 'Create your account',
    errors: [],
    values: { name: '', email: '' },
    next: nextPath(req.query.next),
  });
});

router.post('/register', redirectAuthenticatedUser, async (req, res, next) => {
  // Check registration limiter (defect 5 in 2.4 - register had no limit)
  const registerIpKey = registerLimiterKey(req);
  const registerRetryAfter = registerLimiter.retryAfterSeconds(registerIpKey);
  if (registerRetryAfter > 0) {
    res.set('Retry-After', String(registerRetryAfter));
    return res.status(429).render('register', {
      title: 'Create your account',
      errors: [`Too many registration attempts from this IP. Try again in ${Math.ceil(registerRetryAfter / 60)} minutes.`],
      values: { name: '', email: '' },
      next: nextPath(req.body.next),
    });
  }

  const name = (req.body.name || '').trim().replace(/\s+/g, ' ');
  const email = normalizeEmail(req.body.email);
  const password = req.body.password || '';
  const confirmPassword = req.body.confirmPassword || '';
  const errors = validateRegistration({ name, email, password, confirmPassword });

  if (findUserByEmail(email)) {
    errors.push('An account with this email already exists.');
  }

  if (errors.length > 0) {
    registerLimiter.recordFailure(registerIpKey);
    return res.status(422).render('register', {
      title: 'Create your account',
      errors,
      values: { name, email },
      next: nextPath(req.body.next),
    });
  }

  try {
    const passwordHash = await hashPassword(password);
    const user = createUser({ name, email, passwordHash });
    registerLimiter.reset(registerIpKey);
    recordSecurityEvent(user.id, 'account_created', req.get('user-agent'));
    const returnTo = pageAfterLogin(req);
    // New members are signed in straight away; the dashboard then shows their first steps.
    return signIn(req, user, {
      type: 'success',
      message: `Welcome to Checkpoint, ${user.name.split(' ')[0]}! Save a few games to get picks made for you.`,
    }, (error) => (error ? next(error) : res.redirect(`/welcome?next=${encodeURIComponent(returnTo === '/' ? '/for-you' : returnTo)}`)));
  } catch (error) {
    registerLimiter.recordFailure(registerIpKey);
    if (error.code === 'ERR_SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(422).render('register', {
        title: 'Create your account',
        errors: ['An account with this email already exists.'],
        values: { name, email },
        next: nextPath(req.body.next),
      });
    }

    return next(error);
  }
});

router.get('/login', redirectAuthenticatedUser, (req, res) => {
  // After a password reset the form already holds the member's address.
  const email = req.session.loginEmail || '';
  delete req.session.loginEmail;
  res.render('login', {
    title: 'Welcome back',
    errors: [],
    values: { email, remember: false },
    next: nextPath(req.query.next),
  });
});

router.post('/login', redirectAuthenticatedUser, async (req, res, next) => {
  const email = normalizeEmail(req.body.email);
  const password = req.body.password || '';
  const remember = req.body.remember === 'on';
  const limiterKey = loginLimiterKey(req, email);
  const ipLimiterKey = loginLimiterIPKey(req);
  const retryAfter = loginLimiter.retryAfterSeconds(limiterKey);
  const ipRetryAfter = loginLimiterIP.retryAfterSeconds(ipLimiterKey);
  const userAgent = req.get('user-agent');

  // Check IP-only limiter first (prevents one IP from trying many emails)
  if (ipRetryAfter > 0) {
    res.set('Retry-After', String(ipRetryAfter));
    return res.status(429).render('login', {
      title: 'Welcome back',
      errors: [`Too many failed attempts from this IP. Try again in ${Math.ceil(ipRetryAfter / 60)} minutes.`],
      values: { email, remember },
      next: nextPath(req.body.next),
    });
  }

  if (retryAfter > 0) {
    res.set('Retry-After', String(retryAfter));
    return res.status(429).render('login', {
      title: 'Welcome back',
      errors: [`Too many failed attempts for this account. Try again in ${Math.ceil(retryAfter / 60)} minutes, or reset your password by email.`],
      values: { email, remember },
      next: nextPath(req.body.next),
    });
  }

  const user = findUserByEmail(email);
  const passwordIsRight = await passwordMatches(password, user?.password_hash);

  if (!passwordIsRight) {
    loginLimiter.recordFailure(limiterKey);
    loginLimiterIP.recordFailure(ipLimiterKey);
    // The owner of the account can see every wrong password in their security activity, and is told when
    // sign-ins were paused (OWASP A09: failed logins are logged and alerted on).
    if (user) {
      recordSecurityEvent(user.id, 'sign_in_failed', userAgent);
      if (loginLimiter.retryAfterSeconds(limiterKey) > 0) {
        recordSecurityEvent(user.id, 'locked', userAgent);
        notifyFromCheckpoint({ userId: user.id, type: 'security', key: 'security:locked', detail: 'locked' });
      }
    }
    return res.status(401).render('login', {
      title: 'Welcome back',
      errors: ['The email or password is incorrect.'],
      values: { email, remember },
      next: nextPath(req.body.next),
    });
  }

  loginLimiter.reset(limiterKey);
  loginLimiterIP.reset(ipLimiterKey);
  recordSecurityEvent(user.id, 'sign_in', userAgent);
  const returnTo = pageAfterLogin(req);

  return signIn(req, user, {
    type: 'success',
    message: `Welcome back, ${user.name.split(' ')[0]}.`,
  }, (error) => (error ? next(error) : res.redirect(returnTo)), { lifetime: remember ? REMEMBERED_LIFETIME : SESSION_LIFETIME });
});

router.post('/logout', (req, res, next) => {
  req.session.destroy((error) => {
    if (error) {
      return next(error);
    }

    res.clearCookie('checkpoint.sid');
    return res.redirect('/');
  });
});

module.exports = router;
