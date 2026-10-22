// Security activity and alerts (FR-30, OWASP A09): sign-ins, wrong passwords and password changes are recorded
// for the member, shown on the account page, and a lockout raises a notification. Tested through HTTP.
const assert = require('node:assert/strict');
const { after, before, describe, it } = require('node:test');
const { startApp, useTemporaryDatabase } = require('../helpers');

useTemporaryDatabase('security-activity');

const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0';

let app;
let db;
let mailer;
let security;

const events = (email) => db.prepare(`
  SELECT type, user_agent FROM security_events WHERE user_id = (SELECT id FROM users WHERE email = ?) ORDER BY id
`).all(email).map((row) => ({ ...row }));

before(async () => {
  app = await startApp();
  ({ db } = require('../../database/database'));
  mailer = require('../../lib/mailer');
  security = require('../../database/security');
});

after(() => app.close());

describe('security activity', () => {
  it('records the sign-up, sign-ins and wrong passwords with the browser, never the address', async () => {
    await app.client().register({ name: 'Nada Secure', email: 'nada@checkpoint.test' });
    await app.client().post('/login', { email: 'nada@checkpoint.test', password: 'Wrong1pass' }, { headers: { 'user-agent': FIREFOX_LINUX } });
    await app.client().login('nada@checkpoint.test');
    assert.deepEqual(events('nada@checkpoint.test').map((event) => event.type), ['account_created', 'sign_in_failed', 'sign_in']);
    assert.equal(events('nada@checkpoint.test')[1].user_agent, FIREFOX_LINUX);
    const columns = db.prepare('PRAGMA table_info(security_events)').all().map((column) => column.name);
    assert.deepEqual(columns, ['id', 'user_id', 'type', 'user_agent', 'created_at'], 'no IP address column');
  });

  it('shows the newest events on the account page', async () => {
    const member = app.client();
    await member.login('nada@checkpoint.test');
    const page = await member.get('/account');
    const section = page.body.slice(page.body.indexOf('id="security"'), page.body.indexOf('id="password"'));
    assert.ok(section.includes('Recent security activity'));
    assert.ok(section.includes('<strong>Wrong password entered</strong>'));
    assert.ok(section.includes('Firefox on Linux'));
    assert.ok(section.includes('class="device is-warning"'), 'events to double-check stand out');
    assert.ok(page.body.includes('<a href="#security"><span>02</span>Security activity</a>'));
  });

  it('records nothing for addresses without an account', async () => {
    const before = db.prepare('SELECT COUNT(*) AS count FROM security_events').get().count;
    await app.client().post('/login', { email: 'ghost@checkpoint.test', password: 'Wrong1pass' });
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM security_events').get().count, before);
  });

  it('keeps only the newest 30 events per member', async () => {
    await app.client().register({ name: 'Busy Badr', email: 'badr@checkpoint.test' });
    const id = db.prepare("SELECT id FROM users WHERE email = 'badr@checkpoint.test'").get().id;
    for (let index = 0; index < 40; index += 1) security.recordSecurityEvent(id, 'sign_in', `Browser ${index}`);
    const kept = events('badr@checkpoint.test');
    assert.equal(kept.length, security.EVENTS_KEPT);
    assert.equal(kept.at(-1).user_agent, 'Browser 39', 'the newest stays');
    assert.equal(kept[0].user_agent, 'Browser 10', 'the oldest go');
  });
});

describe('the lockout alert', () => {
  it('pauses sign-ins after five wrong passwords and tells the member once', async () => {
    await app.client().register({ name: 'Faris Target', email: 'faris@checkpoint.test' });
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await app.client().post('/login', { email: 'faris@checkpoint.test', password: `Guess${attempt}word` });
      assert.equal(response.status, 401);
    }
    const paused = await app.client().post('/login', { email: 'faris@checkpoint.test', password: 'Checkpoint123' });
    assert.equal(paused.status, 429);
    assert.ok(paused.body.includes('or reset your password by email'));

    const types = events('faris@checkpoint.test').map((event) => event.type);
    assert.equal(types.filter((type) => type === 'sign_in_failed').length, 5);
    assert.equal(types.filter((type) => type === 'locked').length, 1);
    const alerts = db.prepare("SELECT key, detail FROM notifications WHERE type = 'security'").all().map((row) => ({ ...row }));
    assert.deepEqual(alerts, [{ key: 'security:locked', detail: 'locked' }]);
  });

  it('shows the alert in the inbox with a link to the security activity', async () => {
    // The pause lasts 15 minutes; the test lifts it to sign in as the member.
    const { loginLimiter } = require('../../lib/security');
    loginLimiter.clear();
    const member = app.client();
    await member.login('faris@checkpoint.test');
    const inbox = (await member.get('/notifications')).body.replace(/\s+/g, ' ');
    assert.ok(inbox.includes('<a href="/account#security">Sign-ins to your account were paused for 15 minutes after 5 wrong passwords.</a>'));
    assert.ok(inbox.includes('If this was not you, check your security activity and change your password.'));
  });
});

describe('password changes', () => {
  it('records the change, emails the member and cancels a waiting reset link', async () => {
    const member = app.client();
    await member.signUp('Hala Change', 'hala@checkpoint.test', 'Checkpoint123');
    await app.client().post('/forgot-password', { email: 'hala@checkpoint.test' });
    const link = mailer.listMailbox().find((message) => message.to === 'hala@checkpoint.test').text.match(/\/reset-password\/\S+/)[0];
    assert.equal((await app.client().get(link)).status, 200);

    const response = await member.post('/account/password', { currentPassword: 'Checkpoint123', newPassword: 'Changed2026', confirmPassword: 'Changed2026' });
    assert.equal(response.status, 302);
    assert.equal((await app.client().get(link)).status, 404, 'the reset link no longer works');
    const [email] = mailer.listMailbox().filter((message) => message.to === 'hala@checkpoint.test');
    assert.equal(email.subject, 'Your Checkpoint password was changed');
    assert.ok(email.text.includes('changed on the account page'));
    assert.ok(events('hala@checkpoint.test').some((event) => event.type === 'password_changed'));
  });
});
