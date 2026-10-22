// Getting around: signing up signs you in, logging in brings you back to the page you were on, and the
// header always shows where you are.
const assert = require('node:assert/strict');
const { after, before, describe, it } = require('node:test');
const { startApp, useTemporaryDatabase } = require('../helpers');

useTemporaryDatabase('navigation');

let app;

before(async () => {
  app = await startApp();
  await app.client().register({ name: 'Nadia Navigator', email: 'nadia@checkpoint.test' });
});

after(() => app.close());

const login = (client, form) => client.post('/login', { email: 'nadia@checkpoint.test', password: 'Checkpoint123', ...form });

describe('signing up', () => {
  it('signs the new member in and welcomes them', async () => {
    const client = app.client();
    const response = await client.register({ name: 'Omar Newcomer', email: 'omar.new@checkpoint.test' });
    assert.equal(response.location, '/welcome?next=%2Ffor-you');
    const home = await client.get('/');
    assert.ok(home.body.includes('Welcome to Checkpoint, Omar!'));
    assert.ok(home.body.includes('<body class="is-member">'));
  });

  it('explains what is wrong, keeps the name and email, and never echoes the password', async () => {
    const form = await app.client().get('/register?next=/lists');
    assert.equal(form.status, 200);
    assert.ok(form.body.includes('name="next" value="/lists"'), 'the form remembers where to go afterwards');

    const response = await app.client().post('/register', {
      name: 'A',
      email: 'not-an-email',
      password: 'short',
      confirmPassword: 'different',
    });
    assert.equal(response.status, 422);
    for (const message of [
      'Name must be between 2 and 60 characters.',
      'Enter a valid email address.',
      'Password must contain at least 8 characters, including a letter and a number.',
      'Passwords do not match.',
    ]) {
      assert.ok(response.body.includes(message), message);
    }
    assert.ok(response.body.includes('value="not-an-email"'));
    assert.ok(!response.body.includes('value="short"'), 'the password field starts empty again');
  });

  it('allows one account per email, whatever its capitals', async () => {
    const response = await app.client().post('/register', {
      name: 'Nadia Again',
      email: '  NADIA@Checkpoint.TEST ',
      password: 'Checkpoint123',
      confirmPassword: 'Checkpoint123',
    });
    assert.equal(response.status, 422);
    assert.ok(response.body.includes('An account with this email already exists.'));
  });

  it('sends members who open the login or sign-up page home', async () => {
    const client = app.client();
    await login(client);
    assert.equal((await client.get('/login')).location, '/');
    assert.equal((await client.get('/register')).location, '/');
  });
});

describe('coming back after logging in', () => {
  it('returns to a member-only page that asked the guest to log in', async () => {
    const client = app.client();
    const blocked = await client.get('/wrapped');
    assert.equal(blocked.location, '/login');
    const page = await client.get('/login');
    assert.ok(page.body.includes('Log in to see your Checkpoint Wrapped.'));
    assert.equal((await login(client)).location, '/wrapped');
  });

  it('gives every "Log in" link the page it was clicked on', async () => {
    const page = await app.client().get('/games/elden-ring?tab=reviews');
    assert.ok(page.body.includes('href="/login?next=%2Fgames%2Felden-ring%3Ftab%3Dreviews"'));
    const home = await app.client().get('/');
    assert.ok(home.body.includes('href="/login"'), 'the home page needs no return address');
  });

  it('carries ?next= through the login form', async () => {
    const client = app.client();
    const form = await client.get('/login?next=/games/elden-ring');
    assert.ok(form.body.includes('name="next" value="/games/elden-ring"'));
    assert.ok(form.body.includes('href="/register?next=%2Fgames%2Felden-ring"'), 'switching to sign-up keeps it');
    assert.equal((await login(client, { next: '/games/elden-ring' })).location, '/games/elden-ring');
  });

  it('ignores return addresses that lead to another website', async () => {
    for (const next of ['//evil.example', 'https://evil.example', '/\\evil.example', 'javascript:alert(1)']) {
      const response = await login(app.client(), { next });
      assert.equal(response.location, '/', next);
    }
  });

  it('keeps the return address when the password is wrong', async () => {
    const response = await login(app.client(), { password: 'wrong-password1', next: '/lists' });
    assert.equal(response.status, 401);
    assert.ok(response.body.includes('name="next" value="/lists"'));
  });
});

describe('logging out', () => {
  it('ends the session on the server, so the old cookie stops working', async () => {
    const client = app.client();
    await login(client);
    const oldCookie = client.cookie;
    const response = await client.post('/logout');
    assert.equal(response.status, 302);
    assert.equal(response.location, '/');
    assert.match(response.headers.get('set-cookie'), /checkpoint\.sid=;/, 'the browser is told to forget the cookie');

    const replay = app.client();
    replay.cookie = oldCookie;
    const profile = await replay.get('/profile');
    assert.equal(profile.status, 302);
    assert.equal(profile.location, '/login');
  });
});

describe('where am I', () => {
  it('marks the current page and section in the header for screen readers too', async () => {
    const games = await app.client().get('/games');
    assert.match(games.body, /class="nav-link is-active" aria-current="page" href="\/games"/);
    const game = await app.client().get('/games/elden-ring');
    assert.match(game.body, /class="nav-link is-active" aria-current="true" href="\/games"/);
    assert.ok(!game.body.includes('aria-current="page" href="/games"'));
  });
});
