// Account controller: where you are signed in, recent security activity, password changes, "Download my data"
// and account deletion. Changing the password and deleting the account ask for the current password, and wrong
// passwords are rate limited per member. Signing out the other devices needs no password: it can only take
// access away.
const express = require('express');
const { findUserById } = require('../database/database');
const { accountCounts, accountExportRows, deleteAccount, findPasswordHash, updatePasswordHash } = require('../database/account');
const { listSecurityEvents, recordSecurityEvent, removePasswordResets } = require('../database/security');
const { destroyOtherSessions, listUserSessions } = require('../database/session-store');
const { buildAccountExport, exportFileName } = require('../lib/account-export');
const { PASSWORD_MAX_BYTES, hashPassword, passwordErrors, passwordMatches, requireLogin, signIn } = require('../lib/auth');
const { describeDevice } = require('../lib/devices');
const { passwordChangedMessage, publicUrl, sendMail } = require('../lib/mailer');
const { describeSecurityEvent } = require('../lib/security-activity');
const { createLoginLimiter } = require('../lib/security');
const { formatDate, relativeTime } = require('../lib/text');
const { plural } = require('../lib/view-helpers');

const router = express.Router();
const passwordLimiter = createLoginLimiter({ max: 5, windowMs: 15 * 60 * 1000 });

router.use('/account', requireLogin('Log in to manage your account.'));

function deviceList(req) {
  return listUserSessions(req.session.user.id, req.sessionID).map((entry) => ({
    ...describeDevice(entry.userAgent),
    current: entry.current,
    signedIn: entry.signedInAt ? formatDate(entry.signedInAt, { month: 'short', day: 'numeric', year: 'numeric' }) : null,
    lastActive: entry.current ? 'Active now' : `Active ${relativeTime(entry.lastActiveAt)}`,
  }));
}

function renderAccount(req, res, { status = 200, passwordErrors: passwordProblems = [], deleteErrors = [] } = {}) {
  const member = findUserById(req.session.user.id);
  return res.status(status).render('account', {
    title: 'Account & security',
    member: {
      name: member.name,
      email: member.email,
      since: formatDate(member.created_at, { month: 'long', year: 'numeric' }),
    },
    counts: accountCounts(member.id),
    devices: deviceList(req),
    securityEvents: listSecurityEvents(member.id, 8).map((row) => describeSecurityEvent(row)),
    passwordErrors: passwordProblems,
    deleteErrors,
    passwordMaxBytes: PASSWORD_MAX_BYTES,
  });
}

// Checks the current password, counting wrong guesses so a borrowed session cannot be used to guess it.
async function verifyCurrentPassword(req, password) {
  const key = `account:${req.session.user.id}`;
  const retryAfter = passwordLimiter.retryAfterSeconds(key);
  if (retryAfter > 0) {
    return { ok: false, status: 429, retryAfter, message: `Too many wrong passwords. Try again in ${Math.ceil(retryAfter / 60)} minutes.` };
  }
  const hash = findPasswordHash(req.session.user.id);
  if (password && (await passwordMatches(password, hash))) {
    passwordLimiter.reset(key);
    return { ok: true, hash };
  }
  passwordLimiter.recordFailure(key);
  return { ok: false, status: 422, message: 'Your current password is not correct.' };
}

router.get('/account', (req, res, next) => {
  try {
    return renderAccount(req, res);
  } catch (error) {
    return next(error);
  }
});

router.post('/account/password', async (req, res, next) => {
  try {
    const currentPassword = req.body.currentPassword || '';
    const newPassword = req.body.newPassword || '';
    const check = await verifyCurrentPassword(req, currentPassword);
    if (!check.ok) {
      if (check.retryAfter) res.set('Retry-After', String(check.retryAfter));
      return renderAccount(req, res, { status: check.status, passwordErrors: [check.message] });
    }

    const errors = passwordErrors(newPassword, req.body.confirmPassword || '');
    if (errors.length === 0 && (await passwordMatches(newPassword, check.hash))) {
      errors.push('Choose a new password that is different from your current one.');
    }
    if (errors.length > 0) return renderAccount(req, res, { status: 422, passwordErrors: errors });

    const userId = req.session.user.id;
    updatePasswordHash(userId, await hashPassword(newPassword));
    // Anyone else who had this account open is signed out, and this browser gets a fresh session ID. A reset
    // link that is still waiting in the inbox stops working, and the member gets an email about the change.
    const signedOut = destroyOtherSessions(userId, req.sessionID);
    removePasswordResets(userId);
    recordSecurityEvent(userId, 'password_changed', req.get('user-agent'));
    const member = findUserById(userId);
    sendMail({ to: member.email, ...passwordChangedMessage({ name: member.name, how: 'account', resetLink: publicUrl('/forgot-password') }) });
    const notice = {
      type: 'success',
      message: signedOut > 0 ? `Password changed. ${plural(signedOut, 'other device')} signed out.` : 'Password changed.',
    };
    return signIn(req, member, notice, (error) => (error ? next(error) : res.redirect('/account')), {
      lifetime: req.session.cookie.originalMaxAge,
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/account/sessions/sign-out-others', (req, res, next) => {
  try {
    const signedOut = destroyOtherSessions(req.session.user.id, req.sessionID);
    if (signedOut > 0) recordSecurityEvent(req.session.user.id, 'signed_out_others', req.get('user-agent'));
    req.session.notice = {
      type: 'success',
      message: signedOut > 0 ? `Signed out of ${plural(signedOut, 'other device')}.` : 'You were not signed in anywhere else.',
    };
    return res.redirect('/account#devices');
  } catch (error) {
    return next(error);
  }
});

// A JSON file with everything Checkpoint stores about the member (never the password hash).
router.get('/account/export', (req, res, next) => {
  try {
    const rows = accountExportRows(req.session.user.id);
    if (!rows) return res.status(404).render('404', { title: 'Account not found' });
    const now = new Date();
    res.attachment(exportFileName(now));
    return res.send(`${JSON.stringify(buildAccountExport(rows, now), null, 2)}\n`);
  } catch (error) {
    return next(error);
  }
});

router.post('/account/delete', async (req, res, next) => {
  try {
    const errors = [];
    if (req.body.confirm !== 'on') errors.push('Tick the box to confirm that you want to delete your account.');
    const check = await verifyCurrentPassword(req, req.body.password || '');
    if (!check.ok) {
      if (check.retryAfter) res.set('Retry-After', String(check.retryAfter));
      errors.push(check.message);
    }
    if (errors.length > 0) return renderAccount(req, res, { status: check.status || 422, deleteErrors: errors });

    const name = req.session.user.name.split(' ')[0];
    deleteAccount(req.session.user.id);
    // The member's sessions were deleted with the account; this browser starts again as a guest.
    return req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.notice = { type: 'info', message: `Your account and everything in it were deleted. Goodbye, ${name}.` };
      return req.session.save((saveError) => (saveError ? next(saveError) : res.redirect('/')));
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
