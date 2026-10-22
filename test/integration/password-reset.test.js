// "Forgot your password?" (FR-27): the reset email, the single-use link and what a reset changes, tested
// through HTTP. The emails are read from the development mailbox, as a developer would.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { after, before, beforeEach, describe, it } = require('node:test');
const { startApp, useTemporaryDatabase } = require('../helpers');

useTemporaryDatabase('password-reset');

let app;
let mailer;
let db;
let resetLimiters;

const resetPath = (message) => message.text.match(/\/reset-password\/[A-Za-z0-9_-]{43}/)[0];
const inbox = (address) => mailer.listMailbox().filter((message) => message.to === address);

async function askForLink(email, client = app.client()) {
  const response = await client.post('/forgot-password', { email });
  return { response, client };
}

before(async () => {
  app = await startApp();
  mailer = require('../../lib/mailer');
  ({ db } = require('../../database/database'));
  ({ resetLimiters } = require('../../lib/security'));
  for (const [name, email] of [['Reset Rana', 'rana@checkpoint.test'], ['Reset Omar', 'omar@checkpoint.test'], ['Locked Lama', 'lama@checkpoint.test']]) {
    await app.client().register({ name, email });
  }
});

// Every case starts with an empty mailbox and no reset requests counted yet.
beforeEach(() => {
  mailer.clearMailbox();
  resetLimiters.email.clear();
  resetLimiters.visitor.clear();
});

after(() => app.close());

describe('asking for a reset link', () => {
  it('links to the reset page from the login form', async () => {
    const page = await app.client().get('/login');
    assert.match(page.body, /href="\/forgot-password">Forgot password\?<\/a>/);
    assert.equal((await app.client().get('/forgot-password')).status, 200);
  });

  it('answers the same whether or not an account uses the address', async () => {
    const { response: known, client: first } = await askForLink('rana@checkpoint.test');
    const { response: unknown, client: second } = await askForLink('nobody@checkpoint.test');
    assert.equal(known.status, 302);
    assert.equal(known.location, '/forgot-password/sent');
    assert.equal(unknown.location, known.location);
    const knownPage = (await first.get('/forgot-password/sent')).body;
    const unknownPage = (await second.get('/forgot-password/sent')).body;
    assert.ok(knownPage.includes('If an account uses <strong class="auth-email">rana@checkpoint.test</strong>'));
    assert.equal(unknownPage.replace('nobody@checkpoint.test', 'rana@checkpoint.test'), knownPage, 'the pages differ only in the address typed');
    assert.equal(mailer.listMailbox().length, 1, 'only the real account gets an email');
    assert.equal(inbox('rana@checkpoint.test')[0].subject, 'Reset your Checkpoint password');
  });

  it('checks the address and shows the sent page only once', async () => {
    const response = await app.client().post('/forgot-password', { email: 'not-an-email' });
    assert.equal(response.status, 422);
    assert.ok(response.body.includes('Enter a valid email address.'));
    assert.equal((await app.client().get('/forgot-password/sent')).location, '/forgot-password', 'nothing was asked for');
  });

  it('stores only a SHA-256 hash of the token', async () => {
    await askForLink('omar@checkpoint.test');
    const token = resetPath(inbox('omar@checkpoint.test')[0]).split('/').pop();
    const stored = db.prepare("SELECT token_hash FROM password_resets p JOIN users u ON u.id = p.user_id WHERE u.email = 'omar@checkpoint.test'").all();
    assert.equal(stored.length, 1);
    assert.equal(stored[0].token_hash, crypto.createHash('sha256').update(token).digest('hex'));
    assert.ok(!JSON.stringify(db.prepare('SELECT * FROM password_resets').all()).includes(token), 'the token itself is not in the database');
  });

  it('limits requests to three per address in 15 minutes, for unknown addresses too', async () => {
    for (const email of ['limit@checkpoint.test', 'omar@checkpoint.test']) {
      for (let request = 1; request <= 3; request += 1) assert.equal((await askForLink(email)).response.status, 302, `${email}, request ${request}`);
      const blocked = (await askForLink(email)).response;
      assert.equal(blocked.status, 429);
      assert.ok(Number(blocked.headers.get('retry-after')) > 0);
      assert.ok(blocked.body.includes('Too many reset requests.'));
    }
  });

  it('limits one visitor to twenty requests in 15 minutes', async () => {
    for (let request = 1; request <= 20; request += 1) {
      assert.equal((await askForLink(`visitor${request}@checkpoint.test`)).response.status, 302, `request ${request}`);
    }
    assert.equal((await askForLink('visitor21@checkpoint.test')).response.status, 429);
  });

  it('builds the link from PUBLIC_URL, never from the Host header', async () => {
    process.env.PUBLIC_URL = 'https://checkpoint.example/';
    try {
      // A raw request, because fetch() does not let a script choose the Host header.
      await new Promise((resolve, reject) => {
        const body = 'email=rana%40checkpoint.test';
        const request = http.request(`${app.baseUrl}/forgot-password`, {
          method: 'POST',
          headers: { host: 'attacker.example', 'content-type': 'application/x-www-form-urlencoded', 'content-length': body.length },
        }, (response) => response.resume().on('end', resolve));
        request.on('error', reject);
        request.end(body);
      });
      const [message] = inbox('rana@checkpoint.test');
      assert.match(message.text, /^https:\/\/checkpoint\.example\/reset-password\/[A-Za-z0-9_-]{43}$/m);
      assert.ok(!message.text.includes('attacker.example'));
    } finally {
      delete process.env.PUBLIC_URL;
    }
  });
});

describe('using the link', () => {
  it('works only for the newest link, and never sends a Referer or lets the page be stored', async () => {
    const member = app.client();
    await member.post('/forgot-password', { email: 'rana@checkpoint.test' });
    await member.post('/forgot-password', { email: 'rana@checkpoint.test' });
    const [newest, older] = inbox('rana@checkpoint.test');
    const replaced = await app.client().get(resetPath(older));
    assert.equal(replaced.status, 404);
    assert.ok(replaced.body.includes('This link no longer works'));
    const form = await app.client().get(resetPath(newest));
    assert.equal(form.status, 200);
    assert.ok(form.body.includes('Hi Reset, pick a new password for'));
    assert.equal(form.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(form.headers.get('cache-control'), 'no-store');
  });

  it('refuses malformed and unknown tokens', async () => {
    assert.equal((await app.client().get('/reset-password/not-a-token')).status, 404);
    assert.equal((await app.client().get(`/reset-password/${'A'.repeat(43)}`)).status, 404);
    assert.equal((await app.client().post(`/reset-password/${'A'.repeat(43)}`, { password: 'NewPassword9', confirmPassword: 'NewPassword9' })).status, 404);
  });

  it('applies the password rules', async () => {
    await askForLink('omar@checkpoint.test');
    const link = resetPath(inbox('omar@checkpoint.test')[0]);
    const mismatch = await app.client().post(link, { password: 'NewPassword9', confirmPassword: 'NewPassword8' });
    assert.equal(mismatch.status, 422);
    assert.ok(mismatch.body.includes('Passwords do not match.'));
    const weak = await app.client().post(link, { password: 'short', confirmPassword: 'short' });
    assert.equal(weak.status, 422);
    assert.equal((await app.client().get(link)).status, 200, 'a refused password does not use the link up');
  });

  it('expires after 30 minutes', async () => {
    await askForLink('omar@checkpoint.test');
    const link = resetPath(inbox('omar@checkpoint.test')[0]);
    db.prepare("UPDATE password_resets SET expires_at = datetime('now', '-1 second')").run();
    assert.equal((await app.client().get(link)).status, 404);
  });

  it('changes the password once, signs out every device and emails the member', async () => {
    const laptop = app.client();
    await laptop.login('rana@checkpoint.test');
    await askForLink('rana@checkpoint.test');
    const link = resetPath(inbox('rana@checkpoint.test')[0]);

    const browser = app.client();
    const response = await browser.post(link, { password: 'BrandNew2026', confirmPassword: 'BrandNew2026' });
    assert.equal(response.status, 302);
    assert.equal(response.location, '/login');
    const login = await browser.get('/login');
    assert.ok(login.body.includes('Your password was reset and you were signed out everywhere.'));
    assert.ok(login.body.includes('value="rana@checkpoint.test"'), 'the login form is filled in');

    assert.equal((await laptop.get('/library')).location, '/login', 'the other device is signed out');
    assert.equal((await app.client().post(link, { password: 'Another2026', confirmPassword: 'Another2026' })).status, 404, 'the link is used up');
    assert.equal((await app.client().post('/login', { email: 'rana@checkpoint.test', password: 'Checkpoint123' })).status, 401, 'the old password is gone');
    await browser.login('rana@checkpoint.test', 'BrandNew2026');

    const [confirmation] = inbox('rana@checkpoint.test');
    assert.equal(confirmation.subject, 'Your Checkpoint password was changed');
    assert.ok(confirmation.text.includes('reset with a link sent to this address'));
    const account = await browser.get('/account');
    assert.ok(account.body.includes('Password reset with an email link'));
    assert.ok(account.body.includes('Password reset link requested'));
  });

  it('lets a member whose sign-ins were paused log in right after resetting', async () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await app.client().post('/login', { email: 'lama@checkpoint.test', password: `Wrong${attempt}pass` });
    }
    assert.equal((await app.client().post('/login', { email: 'lama@checkpoint.test', password: 'Checkpoint123' })).status, 429);
    await askForLink('lama@checkpoint.test');
    await app.client().post(resetPath(inbox('lama@checkpoint.test')[0]), { password: 'Unlocked2026', confirmPassword: 'Unlocked2026' });
    assert.equal((await app.client().post('/login', { email: 'lama@checkpoint.test', password: 'Unlocked2026' })).status, 302);
  });

  it('offers signed-in members the same way, with their address filled in', async () => {
    const member = app.client();
    await member.login('omar@checkpoint.test');
    const account = await member.get('/account');
    assert.match(account.body, /href="\/forgot-password">Forgot your current password\?<\/a>/);
    const page = await member.get('/forgot-password');
    assert.ok(page.body.includes('value="omar@checkpoint.test"'));
    assert.ok(page.body.includes('href="/account#password">Back to your account'));
  });
});

describe('the development mailbox', () => {
  it('shows the emails with working links', async () => {
    await askForLink('omar@checkpoint.test');
    const page = await app.client().get('/dev/mailbox');
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.match(page.body, /<a class="text-link" href="http:\/\/localhost:\d+\/reset-password\/[A-Za-z0-9_-]{43}">/);
    assert.ok(page.body.includes('To <strong>omar@checkpoint.test</strong>'));
  });

  it('keeps the last 50 emails', async () => {
    for (let index = 0; index < mailer.MAILBOX_SIZE + 5; index += 1) mailer.sendMail({ to: `m${index}@checkpoint.test`, subject: 'Test', text: 'Hi' });
    const messages = mailer.listMailbox();
    assert.equal(messages.length, mailer.MAILBOX_SIZE);
    assert.equal(messages[0].to, `m${mailer.MAILBOX_SIZE + 4}@checkpoint.test`, 'newest first');
  });
});
