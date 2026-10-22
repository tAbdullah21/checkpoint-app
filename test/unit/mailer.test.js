// Outgoing email (lib/mailer.js): links built from PUBLIC_URL, the development mailbox, production without a
// mail service, and the words of the two emails.
const assert = require('node:assert/strict');
const { afterEach, describe, it, mock } = require('node:test');
const mailer = require('../../lib/mailer');

const saved = Object.fromEntries(['PUBLIC_URL', 'PORT', 'NODE_ENV'].map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  mailer.clearMailbox();
});

describe('publicUrl', () => {
  it('starts every link with PUBLIC_URL, without a doubled slash', () => {
    process.env.PUBLIC_URL = 'https://checkpoint.example//';
    assert.equal(mailer.publicUrl('/reset-password/abc'), 'https://checkpoint.example/reset-password/abc');
  });

  it('falls back to this computer and the port the server listens on', () => {
    delete process.env.PUBLIC_URL;
    process.env.PORT = '4000';
    assert.equal(mailer.publicUrl('/login'), 'http://localhost:4000/login');
    delete process.env.PORT;
    assert.equal(mailer.publicUrl('/login'), 'http://localhost:3000/login');
  });
});

describe('the development mailbox', () => {
  it('keeps the emails newest first and hands out copies', () => {
    process.env.NODE_ENV = 'test';
    assert.equal(mailer.mailboxEnabled(), true);
    assert.equal(mailer.sendMail({ to: 'first@checkpoint.test', subject: 'One', text: 'First' }), true);
    mailer.sendMail({ to: 'second@checkpoint.test', subject: 'Two', text: 'Second' });
    const [newest, oldest] = mailer.listMailbox();
    assert.equal(newest.subject, 'Two');
    assert.equal(oldest.subject, 'One');
    assert.ok(newest.id > oldest.id);
    assert.ok(!Number.isNaN(Date.parse(newest.sentAt)));
    newest.subject = 'Changed';
    assert.equal(mailer.listMailbox()[0].subject, 'Two', 'a caller cannot change what was sent');
  });

  it('is off in production: nothing is kept, and the log names the email but not the address', () => {
    process.env.NODE_ENV = 'production';
    const warn = mock.method(console, 'warn', () => {});
    try {
      assert.equal(mailer.mailboxEnabled(), false);
      assert.equal(mailer.sendMail({ to: 'private@checkpoint.test', subject: 'Reset your Checkpoint password', text: 'A link' }), false);
      assert.deepEqual(mailer.listMailbox(), []);
      assert.deepEqual(warn.mock.calls.map((call) => call.arguments), [['An email ("Reset your Checkpoint password") was not sent: no mail service is configured.']]);
    } finally {
      warn.mock.restore();
    }
  });
});

describe('the emails', () => {
  it('greets the member by first name and puts the reset link on a line of its own', () => {
    const link = 'https://checkpoint.example/reset-password/abc';
    const message = mailer.passwordResetMessage({ name: 'Lina Al-Harbi', link, minutes: 30 });
    assert.equal(message.subject, 'Reset your Checkpoint password');
    const lines = message.text.split('\n');
    assert.equal(lines[0], 'Hi Lina,');
    assert.ok(lines.includes(link), 'mail programs turn a line with only the link into a link');
    assert.ok(message.text.includes('The link works once, for 30 minutes.'));
    assert.ok(message.text.includes('If you did not ask for this, ignore this email: your password stays the same.'));
  });

  it('says how the password was changed and what to do if it was not the member', () => {
    const reset = mailer.passwordChangedMessage({ name: 'Omar', how: 'reset', resetLink: 'https://checkpoint.example/forgot-password' });
    const account = mailer.passwordChangedMessage({ name: 'Omar', how: 'account', resetLink: 'https://checkpoint.example/forgot-password' });
    assert.ok(reset.text.includes('reset with a link sent to this address'));
    assert.ok(account.text.includes('changed on the account page'));
    for (const message of [reset, account]) {
      assert.equal(message.subject, 'Your Checkpoint password was changed');
      assert.ok(message.text.includes('If this was not you, choose a new password right away:\n\nhttps://checkpoint.example/forgot-password'));
    }
  });
});
