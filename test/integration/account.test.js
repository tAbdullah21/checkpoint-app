// The account page: signed-in devices, "Keep me signed in", password changes, data export and account
// deletion, tested through HTTP and checked against the database.
const assert = require('node:assert/strict');
const { after, before, describe, it } = require('node:test');
const { memberIdByName, startApp, useTemporaryDatabase } = require('../helpers');

useTemporaryDatabase('account');

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const WINDOWS_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const DAY = 24 * 60 * 60 * 1000;

let app;
let db;

before(async () => {
  app = await startApp();
  ({ db } = require('../../database/database'));
});

after(() => app.close());

// Signs in with a browser name, optionally ticking "Keep me signed in".
async function signInAs(email, password, { userAgent = WINDOWS_CHROME, remember = false } = {}) {
  const client = app.client();
  const form = { email, password };
  if (remember) form.remember = 'on';
  const response = await client.post('/login', form, { headers: { 'user-agent': userAgent } });
  assert.equal(response.status, 302, `login as ${email}`);
  return { client, response };
}

function cookieLifetime(response) {
  const expires = response.headers.get('set-cookie').match(/Expires=([^;]+)/i)[1];
  return Date.parse(expires) - Date.now();
}

describe('account page access', () => {
  it('sends guests to the login page and back to the account page afterwards', async () => {
    const client = app.client();
    await app.client().register({ name: 'Ahmad Account', email: 'ahmad@checkpoint.test' });
    const response = await client.get('/account');
    assert.equal(response.status, 302);
    assert.equal(response.location, '/login');
    const login = await client.post('/login', { email: 'ahmad@checkpoint.test', password: 'Checkpoint123' });
    assert.equal(login.location, '/account');
    const page = await client.get('/account');
    assert.equal(page.status, 200);
    assert.ok(page.body.includes('Where you are signed in'));
    assert.ok(page.body.includes('ahmad@checkpoint.test'));
  });
});

describe('signed-in devices', () => {
  let laptop;
  let phone;

  before(async () => {
    await app.client().register({ name: 'Dana Devices', email: 'dana@checkpoint.test' });
    ({ client: laptop } = await signInAs('dana@checkpoint.test', 'Checkpoint123'));
    ({ client: phone } = await signInAs('dana@checkpoint.test', 'Checkpoint123', { userAgent: IPHONE, remember: true }));
  });

  it('keeps a sign-in for a day, or 30 days with "Keep me signed in"', async () => {
    const { response: normal } = await signInAs('dana@checkpoint.test', 'Checkpoint123');
    const { response: remembered } = await signInAs('dana@checkpoint.test', 'Checkpoint123', { remember: true });
    assert.ok(Math.abs(cookieLifetime(normal) - DAY) < 60_000);
    assert.ok(Math.abs(cookieLifetime(remembered) - 30 * DAY) < 60_000);
  });

  it('counts that time from the last visit, not from the sign-in', async () => {
    // The first page after logging in shows the welcome notice; the second one changes nothing in the session.
    await phone.get('/library');
    await laptop.get('/');
    assert.ok(Math.abs(cookieLifetime(await phone.get('/library')) - 30 * DAY) < 60_000, 'a remembered sign-in is renewed for 30 days');
    assert.ok(Math.abs(cookieLifetime(await laptop.get('/')) - DAY) < 60_000, 'a normal one for a day');
  });

  it('lists every browser that is signed in, with this one marked', async () => {
    const page = await laptop.get('/account');
    assert.match(page.body, /Chrome on Windows <span class="device-tag">This device<\/span>/);
    assert.ok(page.body.includes('Safari on iPhone'));
    assert.match(page.body, /Sign out of \d+ other devices?/);
  });

  it('signs out every other browser on request', async () => {
    const response = await laptop.post('/account/sessions/sign-out-others');
    assert.equal(response.status, 302);
    assert.equal(response.location, '/account#devices');
    assert.equal((await phone.get('/library')).location, '/login', 'the phone is signed out');
    const page = await laptop.get('/account');
    assert.ok(page.body.includes('Signed out of'));
    const devices = page.body.slice(page.body.indexOf('id="devices"'), page.body.indexOf('id="security"'));
    assert.ok(devices.includes('Chrome on Windows') && !devices.includes('Safari on iPhone'), 'only this browser is listed');
    assert.ok(page.body.includes('Signed out of the other devices'), 'the security activity records it');
    assert.equal((await laptop.get('/library')).status, 200, 'this browser stays signed in');
  });
});

describe('changing the password', () => {
  let client;
  let otherDevice;

  before(async () => {
    await app.client().register({ name: 'Pavel Password', email: 'pavel@checkpoint.test', password: 'OldPassword1' });
    ({ client } = await signInAs('pavel@checkpoint.test', 'OldPassword1'));
    ({ client: otherDevice } = await signInAs('pavel@checkpoint.test', 'OldPassword1', { userAgent: IPHONE }));
  });

  it('refuses a wrong current password, weak or mismatched new passwords, and the same password', async () => {
    const cases = [
      [{ currentPassword: 'nope', newPassword: 'NewPassword2', confirmPassword: 'NewPassword2' }, 'Your current password is not correct.'],
      [{ currentPassword: 'OldPassword1', newPassword: 'short1', confirmPassword: 'short1' }, 'at least 8 characters'],
      [{ currentPassword: 'OldPassword1', newPassword: 'NewPassword2', confirmPassword: 'NewPassword3' }, 'Passwords do not match.'],
      [{ currentPassword: 'OldPassword1', newPassword: 'OldPassword1', confirmPassword: 'OldPassword1' }, 'different from your current one'],
      [{ currentPassword: 'OldPassword1', newPassword: `A1${'x'.repeat(71)}`, confirmPassword: `A1${'x'.repeat(71)}` }, '72 bytes or fewer (about 72 English or 36 Arabic letters)'],
    ];
    for (const [form, message] of cases) {
      const response = await client.post('/account/password', form);
      assert.equal(response.status, 422, message);
      assert.ok(response.body.includes(message), message);
      assert.ok(response.body.includes('Your password was not changed:'));
    }
  });

  it('changes it, keeps this browser signed in and signs out the others', async () => {
    const response = await client.post('/account/password', {
      currentPassword: 'OldPassword1',
      newPassword: 'NewPassword2',
      confirmPassword: 'NewPassword2',
    });
    assert.equal(response.status, 302);
    assert.equal(response.location, '/account');
    const page = await client.get('/account');
    // The browser that registered the account and the "phone" were both still signed in.
    assert.match(page.body, /Password changed\. 2 other devices signed out\./);
    assert.equal((await otherDevice.get('/library')).location, '/login');
  });

  it('accepts only the new password from then on', async () => {
    const old = await app.client().post('/login', { email: 'pavel@checkpoint.test', password: 'OldPassword1' });
    assert.equal(old.status, 401);
    const fresh = await app.client().post('/login', { email: 'pavel@checkpoint.test', password: 'NewPassword2' });
    assert.equal(fresh.status, 302);
  });

  it('slows down guessing the current password', async () => {
    await app.client().register({ name: 'Gina Guess', email: 'gina@checkpoint.test' });
    const { client: guesser } = await signInAs('gina@checkpoint.test', 'Checkpoint123');
    const form = { currentPassword: 'wrong-guess1', newPassword: 'NewPassword2', confirmPassword: 'NewPassword2' };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert.equal((await guesser.post('/account/password', form)).status, 422);
    }
    const blocked = await guesser.post('/account/password', { ...form, currentPassword: 'Checkpoint123' });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    assert.ok(blocked.body.includes('Too many wrong passwords'));
  });
});

describe('downloading your data', () => {
  let client;

  before(async () => {
    await app.client().register({ name: 'Eman Export', email: 'eman@checkpoint.test' });
    ({ client } = await signInAs('eman@checkpoint.test', 'Checkpoint123'));
    const sami = await app.client().signUp('Sami Secret', 'sami@checkpoint.test');
    await client.post('/library/elden-ring/add', { status: 'completed' });
    await client.post('/games/elden-ring/review', { rating: '5', reviewText: 'Exported with care.' });
    await client.post('/lists', { title: 'Export test list', description: 'For the file' });
    await client.post(`/members/${await memberIdByName(client, 'Sami')}/follow`);
    // Sami makes his profile private after Eman followed him.
    await sami.post('/profile/edit', { name: 'Sami Secret', bio: '' });
  });

  it('sends a JSON file with everything the member stored', async () => {
    const response = await client.get('/account/export');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^application\/json/);
    assert.match(response.headers.get('content-disposition'), /^attachment; filename="checkpoint-data-\d{4}-\d{2}-\d{2}\.json"$/);
    const data = response.json();
    assert.equal(data.format, 'checkpoint-account-export/3');
    assert.equal(data.account.email, 'eman@checkpoint.test');
    assert.deepEqual(data.library.map((entry) => [entry.slug, entry.status]), [['elden-ring', 'Completed']]);
    assert.equal(data.reviews[0].text, 'Exported with care.');
    assert.match(data.reviews[0].link, /^\/games\/elden-ring#review-\d+$/);
    assert.equal(data.lists[0].title, 'Export test list');
    assert.deepEqual(data.following.map((member) => member.name), ['Private member'], 'private members stay anonymous');
    assert.deepEqual(data.securityActivity.map((event) => event.event), ['account_created', 'sign_in']);
    assert.deepEqual(data.reportsMade, []);
    assert.deepEqual(data.moderationOfYourPosts, []);
  });

  it('never contains the password or its hash', async () => {
    const { body } = await client.get('/account/export');
    assert.ok(!body.includes('Checkpoint123'), 'not the password');
    assert.ok(!/"[^"]*password[^"]*":/i.test(body), 'no field holds a password');
    assert.ok(!body.includes('$2'), 'no bcrypt hash');
  });

  it('is only for the signed-in member', async () => {
    const response = await app.client().get('/account/export');
    assert.equal(response.status, 302);
    assert.equal(response.location, '/login');
  });
});

describe('deleting the account', () => {
  let client;
  let otherDevice;
  let userId;

  before(async () => {
    const friend = await app.client().signUp('Faris Friend', 'faris@checkpoint.test');
    await app.client().register({ name: 'Leila Leaving', email: 'leila@checkpoint.test' });
    ({ client } = await signInAs('leila@checkpoint.test', 'Checkpoint123'));
    ({ client: otherDevice } = await signInAs('leila@checkpoint.test', 'Checkpoint123', { userAgent: IPHONE }));
    userId = await memberIdByName(client, 'Leila');
    const friendId = await memberIdByName(client, 'Faris');

    await client.post('/library/stardew-valley/add', { status: 'playing' });
    await client.post('/games/stardew-valley/review', { rating: '4', reviewText: 'Cozy and endless.' });
    await client.post('/lists', { title: 'Leaving soon', description: '' });
    await client.post(`/members/${friendId}/follow`);
    await friend.post(`/members/${userId}/follow`);
    const page = await friend.get('/games/stardew-valley');
    const reviewId = Number(page.body.match(/id="review-(\d+)"/)[1]);
    await friend.post(`/reviews/${reviewId}/like`);
    await friend.post(`/reviews/${reviewId}/comments`, { body: 'Agreed!' });
  });

  it('needs the password and the confirmation box', async () => {
    let response = await client.post('/account/delete', { password: 'Checkpoint123' });
    assert.equal(response.status, 422);
    assert.ok(response.body.includes('Tick the box to confirm'));
    response = await client.post('/account/delete', { password: 'wrong', confirm: 'on' });
    assert.equal(response.status, 422);
    assert.ok(response.body.includes('Your current password is not correct.'));
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users WHERE id = ?').get(userId).count, 1);
  });

  it('deletes the member and everything they created', async () => {
    const response = await client.post('/account/delete', { password: 'Checkpoint123', confirm: 'on' });
    assert.equal(response.status, 302);
    assert.equal(response.location, '/');
    const home = await client.get('/');
    assert.ok(home.body.includes('Your account and everything in it were deleted.'));
    assert.ok(home.body.includes('class="is-guest"'));

    const leftovers = {
      users: 'SELECT COUNT(*) AS count FROM users WHERE id = ?',
      library: 'SELECT COUNT(*) AS count FROM user_library WHERE user_id = ?',
      reviews: 'SELECT COUNT(*) AS count FROM reviews WHERE user_id = ?',
      lists: 'SELECT COUNT(*) AS count FROM game_lists WHERE user_id = ?',
      follows: 'SELECT COUNT(*) AS count FROM follows WHERE follower_id = ?1 OR followed_id = ?1',
      activity: 'SELECT COUNT(*) AS count FROM activities WHERE user_id = ?1 OR target_user_id = ?1',
      notifications: 'SELECT COUNT(*) AS count FROM notifications WHERE user_id = ?1 OR actor_id = ?1',
      sessions: 'SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?',
    };
    for (const [table, sql] of Object.entries(leftovers)) {
      assert.equal(Number(db.prepare(sql).get(userId).count), 0, `${table} rows are gone`);
    }
    // Likes and replies other members left on the deleted review go with it.
    assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM review_comments WHERE body = 'Agreed!'").get().count), 0);
  });

  it('signs the account out everywhere, and its password no longer works', async () => {
    assert.equal((await otherDevice.get('/library')).location, '/login');
    const login = await app.client().post('/login', { email: 'leila@checkpoint.test', password: 'Checkpoint123' });
    assert.equal(login.status, 401);
    assert.equal((await app.client().get(`/members/${userId}`)).status, 404);
  });
});

describe('member pages are never cached', () => {
  it('sends Cache-Control: no-store to signed-in members only', async () => {
    const { client } = await signInAs('ahmad@checkpoint.test', 'Checkpoint123');
    assert.equal((await client.get('/library')).headers.get('cache-control'), 'no-store');
    assert.equal((await app.client().get('/games')).headers.get('cache-control'), null);
  });
});
