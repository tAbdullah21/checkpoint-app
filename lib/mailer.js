// Outgoing email. Checkpoint has no mail service yet (README, "Limitations and future work"): in development and
// in the tests, messages are kept in memory and shown in the development mailbox at /dev/mailbox. With
// NODE_ENV=production they are not delivered, and the server log says so. A deployment replaces deliver() below
// with an SMTP or email API call; nothing else has to change.
const MAILBOX_SIZE = 50;
const mailbox = [];
let lastId = 0;

// Links in emails start with PUBLIC_URL, the address members use to open Checkpoint. They are never built
// from the request's Host header, which a visitor can set to another site to steal a reset link.
function publicUrl(pathname) {
  const base = String(process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, '');
  return `${base}${pathname}`;
}

// The development mailbox exists only outside production (app.js mounts it, routes/dev.js shows it).
function mailboxEnabled() {
  return process.env.NODE_ENV !== 'production';
}

function deliver(message) {
  if (!mailboxEnabled()) {
    // The address is personal data, so it is not written to the log.
    console.warn(`An email ("${message.subject}") was not sent: no mail service is configured.`);
    return false;
  }
  mailbox.unshift(message);
  mailbox.length = Math.min(mailbox.length, MAILBOX_SIZE);
  return true;
}

function sendMail({ to, subject, text }) {
  lastId += 1;
  return deliver({ id: lastId, to: String(to), subject: String(subject), text: String(text), sentAt: new Date().toISOString() });
}

// The development mailbox, newest first.
function listMailbox() {
  return mailbox.map((message) => ({ ...message }));
}

function clearMailbox() {
  mailbox.length = 0;
}

// The password reset email. Plain text, so it reads the same in every mail program.
function passwordResetMessage({ name, link, minutes }) {
  return {
    subject: 'Reset your Checkpoint password',
    text: [
      `Hi ${String(name).split(' ')[0]},`,
      '',
      'Someone asked to reset the password of your Checkpoint account. If it was you, open this link and choose a new password:',
      '',
      link,
      '',
      `The link works once, for ${minutes} minutes. Resetting the password signs you out on every device.`,
      '',
      'If you did not ask for this, ignore this email: your password stays the same.',
      '',
      'Checkpoint',
    ].join('\n'),
  };
}

// Sent after every password change, so a member whose account was taken over finds out (OWASP A09).
function passwordChangedMessage({ name, how, resetLink }) {
  return {
    subject: 'Your Checkpoint password was changed',
    text: [
      `Hi ${String(name).split(' ')[0]},`,
      '',
      how === 'reset'
        ? 'The password of your Checkpoint account was just reset with a link sent to this address, and you were signed out on every device.'
        : 'The password of your Checkpoint account was just changed on the account page, and every other device was signed out.',
      '',
      'If this was not you, choose a new password right away:',
      '',
      resetLink,
      '',
      'Checkpoint',
    ].join('\n'),
  };
}

module.exports = {
  MAILBOX_SIZE,
  clearMailbox,
  listMailbox,
  mailboxEnabled,
  passwordChangedMessage,
  passwordResetMessage,
  publicUrl,
  sendMail,
};
