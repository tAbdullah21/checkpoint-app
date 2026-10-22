// Boundary value analysis (TESTING.md, "Test design"): every limit on what members type is tried just below, at
// and just above each edge, through the real forms. Lengths count characters the way SQLite does, so an emoji is
// one; passwords count bytes, because bcrypt reads at most 72 of them. The forms must give the browser the same
// limits (minlength and maxlength), so a member hears about a limit before sending. The last part sends malformed
// requests to every form and checks that none of them causes a server error.
const assert = require('node:assert/strict');
const { after, before, describe, it } = require('node:test');
const { startApp, useTemporaryDatabase } = require('../helpers');

useTemporaryDatabase('boundaries');

const ACCEPTED = true;
const REFUSED = false;
const GAME = 'elden-ring';

let app;
let db;
let member;
let reviewId;
let replyIds;

const idOf = (email) => db.prepare('SELECT id FROM users WHERE email = ?').get(email).id;

before(async () => {
  app = await startApp();
  ({ db } = require('../../database/database'));
  member = await app.client().signUp('Edge Eman', 'eman@checkpoint.test', 'Checkpoint123');

  // Another member's review and replies, for the reply and report limits.
  const author = await app.client().signUp('Author Adel', 'adel@checkpoint.test', 'Checkpoint123');
  await author.post(`/games/${GAME}/review`, { rating: '4', reviewText: 'A review to reply to and report.' });
  reviewId = db.prepare('SELECT id FROM reviews WHERE user_id = ?').get(idOf('adel@checkpoint.test')).id;
  for (const body of ['First reply by the author.', 'Second reply by the author.']) await author.post(`/reviews/${reviewId}/comments`, { body });
  replyIds = db.prepare('SELECT id FROM review_comments WHERE user_id = ? ORDER BY id').all(idOf('adel@checkpoint.test')).map((row) => row.id);
});

after(() => app.close());

// Runs one case per row: [what is typed, the value, ACCEPTED or REFUSED].
function boundaryCases(cases, check) {
  for (const [index, [label, value, accepted]] of cases.entries()) {
    it(`${accepted ? 'accepts' : 'refuses'} ${label}`, () => check(value, accepted, index));
  }
}

describe('sign-up name: 2 to 60 characters', () => {
  boundaryCases([
    ['1 character', 'A', REFUSED],
    ['2 characters', 'Al', ACCEPTED],
    ['60 characters', 'N'.repeat(60), ACCEPTED],
    ['61 characters', 'N'.repeat(61), REFUSED],
    ['1 character between spaces', '   A   ', REFUSED],
    ['60 emoji, one character each', '🎮'.repeat(60), ACCEPTED],
  ], async (name, accepted, index) => {
    const response = await app.client().post('/register', { name, email: `name${index}@checkpoint.test`, password: 'Checkpoint123', confirmPassword: 'Checkpoint123' });
    assert.equal(response.status, accepted ? 302 : 422);
    assert.equal(response.body.includes('Name must be between 2 and 60 characters.'), !accepted);
  });
});

describe('email address: at most 254 characters, at sign-up and when asking for a reset link', () => {
  const DOMAIN = '@checkpoint.test';
  boundaryCases([
    ['254 characters', 254, ACCEPTED],
    ['255 characters', 255, REFUSED],
  ], async (length, accepted, index) => {
    const email = `${String(index).padEnd(length - DOMAIN.length, 'e')}${DOMAIN}`;
    assert.equal(email.length, length);
    const signUp = await app.client().post('/register', { name: 'Long Address', email, password: 'Checkpoint123', confirmPassword: 'Checkpoint123' });
    assert.equal(signUp.status, accepted ? 302 : 422);
    assert.equal(signUp.body.includes('Enter a valid email address.'), !accepted);
    const reset = await app.client().post('/forgot-password', { email });
    assert.equal(reset.status, accepted ? 302 : 422);
  });
});

describe('password: at least 8 characters with a letter and a number, at most 72 bytes', () => {
  boundaryCases([
    ['7 characters', 'Abcdef1', REFUSED],
    ['8 characters', 'Abcdefg1', ACCEPTED],
    ['72 bytes', `A1${'x'.repeat(70)}`, ACCEPTED],
    ['73 bytes', `A1${'x'.repeat(71)}`, REFUSED],
    ['72 bytes of mostly Arabic letters (37 characters)', `A1${'ك'.repeat(35)}`, ACCEPTED],
    ['73 bytes of mostly Arabic letters (38 characters)', `A1${'ك'.repeat(35)}x`, REFUSED],
  ], async (password, accepted, index) => {
    const email = `password${index}@checkpoint.test`;
    const response = await app.client().post('/register', { name: 'Pass Word', email, password, confirmPassword: password });
    assert.equal(response.status, accepted ? 302 : 422);
    if (accepted) await app.client().login(email, password);
  });
});

describe('review: half-star scores from 0.5 to 5', () => {
  boundaryCases([
    ['0 stars', '0', REFUSED],
    ['1 star', '1', ACCEPTED],
    ['5 stars', '5', ACCEPTED],
    ['6 stars', '6', REFUSED],
    ['4.5 stars', '4.5', ACCEPTED],
    ['no rating', '', REFUSED],
    ['a rating with text after it', '3 stars', REFUSED],
  ], async (rating, accepted) => {
    db.prepare('DELETE FROM reviews WHERE user_id = ?').run(idOf('eman@checkpoint.test'));
    const response = await member.post(`/games/${GAME}/review`, { rating, reviewText: 'Boundary review.' });
    assert.equal(response.location, accepted ? `/games/${GAME}#reviews` : `/games/${GAME}`);
    const stored = db.prepare('SELECT rating FROM reviews WHERE user_id = ?').get(idOf('eman@checkpoint.test'));
    assert.equal(stored?.rating, accepted ? Number(rating) : undefined);
  });
});

describe('review: 3 to 800 characters', () => {
  boundaryCases([
    ['2 characters', 'ok', REFUSED],
    ['3 characters', 'Fun', ACCEPTED],
    ['800 characters', 'r'.repeat(800), ACCEPTED],
    ['801 characters', 'r'.repeat(801), REFUSED],
    ['2 characters between spaces', '   ok   ', REFUSED],
    ['3 characters once line breaks become one space', 'a\n\n\nb', ACCEPTED],
    ['800 emoji', '🔥'.repeat(800), ACCEPTED],
  ], async (reviewText, accepted) => {
    const response = await member.post(`/games/${GAME}/review`, { rating: '4', reviewText });
    assert.equal(response.location, accepted ? `/games/${GAME}#reviews` : `/games/${GAME}`);
  });
});

describe('reply: 1 to 300 characters', () => {
  boundaryCases([
    ['only spaces', '    ', REFUSED],
    ['1 character', '!', ACCEPTED],
    ['300 characters', 'y'.repeat(300), ACCEPTED],
    ['301 characters', 'y'.repeat(301), REFUSED],
  ], async (body, accepted) => {
    const response = await member.post(`/reviews/${reviewId}/comments`, { body });
    if (accepted) assert.match(response.location, new RegExp(`^/games/${GAME}#comment-\\d+$`));
    else assert.equal(response.location, `/games/${GAME}#review-${reviewId}`);
  });
});

describe('report note: optional, at most 200 characters', () => {
  const reportsBy = () => db.prepare('SELECT comment_id, review_id, length(note) AS length FROM reports WHERE reporter_id = ? ORDER BY id').all(idOf('eman@checkpoint.test')).map((row) => ({ ...row }));

  it('refuses 201 characters and keeps nothing', async () => {
    await member.post(`/reviews/${reviewId}/report`, { reason: 'spam', note: 'n'.repeat(201) });
    assert.deepEqual(reportsBy(), []);
    assert.ok((await member.get(`/games/${GAME}`)).body.includes('The note can be at most 200 characters.'));
  });

  it('accepts 200 characters', async () => {
    await member.post(`/reviews/${reviewId}/report`, { reason: 'spam', note: 'n'.repeat(200) });
    assert.deepEqual(reportsBy(), [{ comment_id: null, review_id: reviewId, length: 200 }]);
  });

  it('accepts no note at all', async () => {
    await member.post(`/comments/${replyIds[0]}/report`, { reason: 'off_topic', note: '' });
    assert.deepEqual(reportsBy().at(-1), { comment_id: replyIds[0], review_id: null, length: 0 });
  });
});

describe('list: a title of 3 to 60 characters and a description of at most 280', () => {
  boundaryCases([
    ['a 2-character title', { title: 'Go' }, REFUSED],
    ['a 3-character title', { title: 'RPG' }, ACCEPTED],
    ['a 60-character title', { title: 'T'.repeat(60) }, ACCEPTED],
    ['a 61-character title', { title: 'T'.repeat(61) }, REFUSED],
    ['a title of 61 emoji', { title: '🏆'.repeat(61) }, REFUSED],
    ['a 280-character description', { title: 'Described', description: 'd'.repeat(280) }, ACCEPTED],
    ['a 281-character description', { title: 'Described', description: 'd'.repeat(281) }, REFUSED],
  ], async (values, accepted) => {
    const response = await member.post('/lists', { description: '', ...values });
    assert.equal(response.status, accepted ? 302 : 422);
    if (accepted) {
      const listId = Number(response.location.split('/').pop());
      assert.equal(db.prepare('SELECT title FROM game_lists WHERE id = ?').get(listId).title, values.title, 'saved exactly as typed');
    }
  });
});

describe('profile: name 2 to 60, bio up to 280, Steam up to 64, PlayStation and Xbox up to 32 characters', () => {
  const valid = { name: 'Edge Eman', bio: '', steamId: '', psnId: '', xboxId: '', preferredPlatform: '' };
  boundaryCases([
    ['a 1-character name', { name: 'E' }, REFUSED],
    ['a 2-character name', { name: 'Em' }, ACCEPTED],
    ['a 60-character name', { name: 'E'.repeat(60) }, ACCEPTED],
    ['a 61-character name', { name: 'E'.repeat(61) }, REFUSED],
    ['a 280-character bio', { bio: 'b'.repeat(280) }, ACCEPTED],
    ['a 281-character bio', { bio: 'b'.repeat(281) }, REFUSED],
    ['a 64-character Steam name', { steamId: 's'.repeat(64) }, ACCEPTED],
    ['a 65-character Steam name', { steamId: 's'.repeat(65) }, REFUSED],
    ['a 32-character PlayStation ID', { psnId: 'p'.repeat(32) }, ACCEPTED],
    ['a 33-character PlayStation ID', { psnId: 'p'.repeat(33) }, REFUSED],
    ['a 32-character Xbox gamertag', { xboxId: 'x'.repeat(32) }, ACCEPTED],
    ['a 33-character Xbox gamertag', { xboxId: 'x'.repeat(33) }, REFUSED],
    ['a 32-character Xbox gamertag with emoji', { xboxId: `Gamer${'🎮'.repeat(27)}` }, ACCEPTED],
  ], async (values, accepted) => {
    const response = await member.post('/profile/edit', { ...valid, ...values });
    assert.equal(response.status, accepted ? 302 : 422);
  });
});

describe('the limits the forms give the browser', () => {
  // [page, field, minlength, maxlength]: the edges tested above, null where there is none to give.
  const LIMITS = [
    ['/register', 'name', 2, 60],
    ['/register', 'email', null, 254],
    ['/register', 'password', 8, 72],
    ['/register', 'confirmPassword', 8, 72],
    ['/forgot-password', 'email', null, 254],
    [`/games/${GAME}`, 'reviewText', 3, 800],
    [`/games/${GAME}`, 'body', null, 300],
    [`/games/${GAME}`, 'note', null, 200],
    ['/lists/new', 'title', 3, 60],
    ['/lists/new', 'description', null, 280],
    ['/profile/edit', 'name', 2, 60],
    ['/profile/edit', 'bio', null, 280],
    ['/profile/edit', 'steamId', null, 64],
    ['/profile/edit', 'psnId', null, 32],
    ['/profile/edit', 'xboxId', null, 32],
    ['/account', 'newPassword', 8, 72],
    ['/account', 'confirmPassword', 8, 72],
  ];
  const GUEST_PAGES = ['/register', '/forgot-password'];
  const number = (tag, attribute) => Number(tag.match(new RegExp(`\\s${attribute}="(\\d+)"`))?.[1]) || null;

  it('match the limits the server checks', async () => {
    const pages = new Map();
    const different = [];
    for (const [pathname, field, minlength, maxlength] of LIMITS) {
      if (!pages.has(pathname)) pages.set(pathname, (await (GUEST_PAGES.includes(pathname) ? app.client() : member).get(pathname)).body);
      const tag = pages.get(pathname).match(new RegExp(`<(?:input|textarea)\\b[^>]*\\sname="${field}"[^>]*>`))?.[0];
      const found = tag ? { minlength: number(tag, 'minlength'), maxlength: number(tag, 'maxlength') } : 'no such field';
      if (JSON.stringify(found) !== JSON.stringify({ minlength, maxlength })) different.push(`${pathname} ${field}: ${JSON.stringify(found)}`);
    }
    assert.deepEqual(different, []);
  });
});

describe('malformed requests', () => {
  // Every field name the forms use, each sent twice with different values.
  const FIELDS = [
    'bio', 'body', 'confirm', 'confirmPassword', 'currentPassword', 'description', 'direction', 'email', 'favoriteGenres',
    'game', 'isFavorite', 'listId', 'name', 'newPassword', 'next', 'note', 'password', 'preferredPlatform', 'profilePublic',
    'psnId', 'rating', 'reason', 'remember', 'returnTo', 'reviewText', 'slug', 'status', 'steamId', 'title', 'xboxId',
  ];
  const repeated = Object.fromEntries(FIELDS.map((field) => [field, ['first value', 'second value']]));

  const attempts = {
    'no body': (client, pathname) => client.request(pathname, { method: 'POST' }),
    'a JSON body': (client, pathname) => fetch(`${app.baseUrl}${pathname}`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie: client.cookie, origin: app.baseUrl, 'content-type': 'application/json' },
      body: '{"name":{"first":"value"},"email":["a@checkpoint.test"],"rating":5}',
    }),
    'every field twice': (client, pathname) => client.post(pathname, repeated),
  };

  async function serverErrors(client, paths) {
    const failures = [];
    for (const pathname of paths) {
      for (const [label, attempt] of Object.entries(attempts)) {
        const { status } = await attempt(client, pathname);
        if (status >= 500) failures.push(`${pathname} with ${label}: ${status}`);
      }
    }
    return failures;
  }

  it('never cause a server error on the guest forms', async () => {
    const paths = ['/register', '/login', '/forgot-password', `/reset-password/${'A'.repeat(43)}`, '/logout'];
    assert.deepEqual(await serverErrors(app.client(), paths), []);
  });

  it('never cause a server error on the member forms', async () => {
    const client = await app.client().signUp('Fuzzy Fahd', 'fahd@checkpoint.test', 'Checkpoint123');
    const listId = Number((await client.post('/lists', { title: 'Fuzz list', description: '' })).location.split('/').pop());
    await client.post(`/library/${GAME}/add`, { status: 'playing' });
    const adelId = idOf('adel@checkpoint.test');
    const paths = [
      `/games/${GAME}/review`, `/games/${GAME}/review/delete`, `/library/${GAME}/add`, `/library/${GAME}/update`,
      `/library/${GAME}/remove`, '/lists', '/lists/add', `/lists/${listId}/edit`, `/lists/${listId}/items`,
      `/lists/${listId}/items/${GAME}/move`, `/lists/${listId}/items/${GAME}/remove`, `/members/${adelId}/follow`,
      `/members/${adelId}/unfollow`, `/reviews/${reviewId}/like`, `/reviews/${reviewId}/comments`, `/reviews/${reviewId}/report`,
      `/comments/${replyIds[1]}/report`, `/comments/${replyIds[1]}/delete`, `/moderation/review/${reviewId}/remove`,
      '/profile/edit', '/account/password', '/account/sessions/sign-out-others', '/account/delete', `/lists/${listId}/delete`,
      '/logout',
    ];
    assert.deepEqual(await serverErrors(client, paths), []);
    assert.ok(db.prepare('SELECT id FROM users WHERE email = ?').get('fahd@checkpoint.test'), 'and the account was not deleted by mistake');
  });
});
