// Password reset controller ("Forgot your password?"). A member asks for a link by email address; the link
// carries a random token that works once, for 30 minutes, and only the newest link works. The page answers the
// same whether or not an account uses the address, so it cannot be used to find out who is a member. Resetting
// signs the member out everywhere and they then log in as usual (OWASP Forgot Password Cheat Sheet).
const express = require('express');
const { findUserByEmail, findUserById } = require('../database/database');
const { updatePasswordHash } = require('../database/account');
const { consumePasswordReset, createPasswordReset, findValidPasswordReset, recordSecurityEvent } = require('../database/security');
const { destroyAllSessions } = require('../database/session-store');
const { PASSWORD_MAX_BYTES, hashPassword, isEmailAddress, normalizeEmail, passwordErrors } = require('../lib/auth');
const { mailboxEnabled, passwordChangedMessage, passwordResetMessage, publicUrl, sendMail } = require('../lib/mailer');
const { createResetToken, hashResetToken, isResetToken, loginLimiter, loginLimiterKey, resetLimiters } = require('../lib/security');

const router = express.Router();
const RESET_MINUTES = 30;

// The pages carry the token in their address: no browser or proxy keeps them, and no Referer header takes
// the token to another site.
router.use(['/forgot-password', '/reset-password'], (req, res, next) => {
  res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  next();
});

function renderRequestForm(res, { status = 200, errors = [], email = '' } = {}) {
  return res.status(status).render('forgot-password', { title: 'Reset your password', errors, email, minutes: RESET_MINUTES });
}

router.get('/forgot-password', (req, res) => renderRequestForm(res, { email: req.session.user?.email || '' }));

router.post('/forgot-password', (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!isEmailAddress(email)) {
      return renderRequestForm(res, { status: 422, errors: ['Enter a valid email address.'], email });
    }

    const retryAfter = Math.max(resetLimiters.email.retryAfterSeconds(email), resetLimiters.visitor.retryAfterSeconds(req.ip));
    if (retryAfter > 0) {
      res.set('Retry-After', String(retryAfter));
      return renderRequestForm(res, {
        status: 429,
        errors: [`Too many reset requests. Try again in ${Math.ceil(retryAfter / 60)} minutes.`],
        email,
      });
    }
    resetLimiters.email.recordFailure(email);
    resetLimiters.visitor.recordFailure(req.ip);

    const member = findUserByEmail(email);
    if (member) {
      const { token, hash } = createResetToken();
      createPasswordReset(member.id, hash, RESET_MINUTES);
      sendMail({ to: member.email, ...passwordResetMessage({ name: member.name, link: publicUrl(`/reset-password/${token}`), minutes: RESET_MINUTES }) });
      recordSecurityEvent(member.id, 'reset_requested', req.get('user-agent'));
    }
    // The same page for every address, so nobody learns from it whether an account exists.
    req.session.resetRequestedFor = email;
    return res.redirect('/forgot-password/sent');
  } catch (error) {
    return next(error);
  }
});

router.get('/forgot-password/sent', (req, res) => {
  const email = req.session.resetRequestedFor;
  if (!email) return res.redirect('/forgot-password');
  delete req.session.resetRequestedFor;
  return res.render('forgot-password-sent', { title: 'Check your email', email, minutes: RESET_MINUTES, mailboxEnabled: mailboxEnabled() });
});

// The reset for a link, or null when the token is malformed, unknown, expired or already used.
function resetFor(token) {
  return isResetToken(token) ? findValidPasswordReset(hashResetToken(token)) : null;
}

function renderResetForm(res, reset, { status = 200, errors = [] } = {}) {
  return res.status(status).render('reset-password', {
    title: 'Choose a new password',
    errors,
    email: reset.email,
    firstName: reset.name.split(' ')[0],
    passwordMaxBytes: PASSWORD_MAX_BYTES,
  });
}

function renderInvalidLink(res) {
  return res.status(404).render('reset-password-invalid', { title: 'This link no longer works', minutes: RESET_MINUTES });
}

router.get('/reset-password/:token', (req, res, next) => {
  try {
    const reset = resetFor(req.params.token);
    return reset ? renderResetForm(res, reset) : renderInvalidLink(res);
  } catch (error) {
    return next(error);
  }
});

router.post('/reset-password/:token', async (req, res, next) => {
  try {
    const reset = resetFor(req.params.token);
    if (!reset) return renderInvalidLink(res);
    const password = req.body.password || '';
    const errors = passwordErrors(password, req.body.confirmPassword || '');
    if (errors.length > 0) return renderResetForm(res, reset, { status: 422, errors });

    const passwordHash = await hashPassword(password);
    // Using the link up and saving the password happen together; a second request with the same link (sent
    // while bcrypt was running) finds it used.
    const userId = consumePasswordReset(hashResetToken(req.params.token));
    if (!userId) return renderInvalidLink(res);
    updatePasswordHash(userId, passwordHash);
    destroyAllSessions(userId);
    recordSecurityEvent(userId, 'password_reset', req.get('user-agent'));
    const member = findUserById(userId);
    sendMail({ to: member.email, ...passwordChangedMessage({ name: member.name, how: 'reset', resetLink: publicUrl('/forgot-password') }) });
    // The member proved they own the address, so earlier wrong passwords from this browser no longer count.
    loginLimiter.reset(loginLimiterKey(req, member.email));

    // This browser starts again as a guest too; the login form is filled in with the address.
    return req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.notice = { type: 'success', message: 'Your password was reset and you were signed out everywhere. Log in with the new password.' };
      req.session.loginEmail = member.email;
      return req.session.save((saveError) => (saveError ? next(saveError) : res.redirect('/login')));
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
