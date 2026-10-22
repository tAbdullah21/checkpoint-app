// Features added with the 2.1 redesign: the library board's background updates, catalogue filters,
// game page insights, the activity sidebar, player levels, list ideas and the self-hosted front end.
const assert = require('node:assert/strict');
const { after, before, describe, it } = require('node:test');
const { memberIdByName, startApp, useTemporaryDatabase } = require('../helpers');

useTemporaryDatabase('redesign');

let app;
let guest;
let maya;
let noor;

const JSON_HEADERS = { headers: { accept: 'application/json' } };

before(async () => {
  app = await startApp();
  guest = app.client();
  maya = await app.client().signUp('Maya Board', 'maya@checkpoint.test');
  noor = await app.client().signUp('Noor Hidden', 'noor@checkpoint.test');
});

after(() => app.close());

describe('library board background updates', () => {
  it('adds, moves, favourites and removes a game without leaving the page', async () => {
    let response = await maya.post('/library/elden-ring/add', { status: 'want_to_play' }, JSON_HEADERS);
    assert.equal(response.status, 200);
    let data = response.json();
    assert.deepEqual(
      { ok: data.ok, status: data.status, statusLabel: data.statusLabel, statusClass: data.statusClass },
      { ok: true, status: 'want_to_play', statusLabel: 'Want to Play', statusClass: 'status-want' },
    );
    assert.match(data.message, /Elden Ring was saved as Want to Play/);

    response = await maya.post('/library/elden-ring/update', { status: 'completed', isFavorite: 'on' }, JSON_HEADERS);
    data = response.json();
    assert.equal(data.status, 'completed');
    assert.equal(data.isFavorite, true);

    response = await maya.post('/library/elden-ring/update', { status: 'completed' }, JSON_HEADERS);
    assert.match(response.json().message, /removed from your favorites/);

    const board = await maya.get('/library');
    assert.ok(board.body.includes('data-status="completed"'));
    assert.ok(board.body.includes('data-slug="elden-ring"'));

    response = await maya.post('/library/elden-ring/remove', {}, JSON_HEADERS);
    assert.equal(response.status, 200);
    assert.equal(response.json().slug, 'elden-ring');
  });

  it('answers errors as JSON with the right status codes', async () => {
    assert.equal((await maya.post('/library/not-a-game/add', { status: 'playing' }, JSON_HEADERS)).status, 404);
    assert.equal((await maya.post('/library/stardew-valley/update', { status: 'playing' }, JSON_HEADERS)).status, 404);

    await maya.post('/library/stardew-valley/add', { status: 'playing' }, JSON_HEADERS);
    const invalid = await maya.post('/library/stardew-valley/update', { status: 'finished-maybe' }, JSON_HEADERS);
    assert.equal(invalid.status, 400);
    assert.equal(invalid.json().ok, false);

    const signedOut = await guest.post('/library/stardew-valley/add', { status: 'playing' }, JSON_HEADERS);
    assert.equal(signedOut.status, 401);
  });

  it('enforces the four-favourite limit in the background too', async () => {
    for (const slug of ['baldurs-gate-3', 'cyberpunk-2077', 'split-fiction', 'it-takes-two', 'subnautica']) {
      await maya.post(`/library/${slug}/add`, { status: 'played' }, JSON_HEADERS);
    }
    for (const slug of ['baldurs-gate-3', 'cyberpunk-2077', 'split-fiction', 'it-takes-two']) {
      assert.equal((await maya.post(`/library/${slug}/update`, { status: 'played', isFavorite: 'on' }, JSON_HEADERS)).status, 200);
    }
    const fifth = await maya.post('/library/subnautica/update', { status: 'played', isFavorite: 'on' }, JSON_HEADERS);
    assert.equal(fifth.status, 409);
    assert.match(fifth.json().message, /up to four favorite games/);
  });

  it('returns to the page the change came from, but never to another site', async () => {
    let response = await maya.post('/library/forza-horizon-5/add', { status: 'playing', returnTo: '/for-you' });
    assert.equal(response.location, '/for-you');
    response = await maya.post('/library/forza-horizon-5/update', { status: 'played', returnTo: '//evil.example' });
    assert.equal(response.location, '/library');
  });
});

describe('catalogue filters', () => {
  it('filters by platform', async () => {
    const page = await guest.get('/games?platform=playstation');
    assert.ok(page.body.includes('Death Stranding 2: On the Beach'), 'a PlayStation exclusive is listed');
    const xbox = await guest.get('/games?platform=xbox');
    assert.ok(!xbox.body.includes('Death Stranding 2: On the Beach cover'), 'it is not listed for Xbox');
  });

  it('sorts by rating and by title', async () => {
    const byTitle = await guest.get('/games?sort=title');
    const titles = [...byTitle.body.matchAll(/alt="([^"]+) cover"/g)].map((match) => match[1]);
    assert.deepEqual(titles, [...titles].sort((first, second) => first.localeCompare(second)));

    const byRating = await guest.get('/games?sort=rating');
    const ratings = [...byRating.body.matchAll(/<\/svg>(\d\.\d)<\/span>/g)].map((match) => Number(match[1]));
    assert.ok(ratings.length >= 60);
    assert.deepEqual(ratings, [...ratings].sort((first, second) => second - first));
  });

  it('offers "best match" only to players with a taste profile', async () => {
    const guestPage = await guest.get('/games');
    assert.ok(!guestPage.body.includes('Best match for you'));
    const page = await maya.get('/games?sort=match');
    assert.ok(page.body.includes('Best match for you'));
    assert.equal((await guest.get('/games?sort=match')).status, 200, 'unknown sorts fall back safely');
  });
});

describe('game page insights', () => {
  let noorId;

  before(async () => {
    await maya.post('/games/elden-ring/review', { rating: '5', reviewText: 'An unforgettable world.' });
    await noor.post('/library/elden-ring/add', { status: 'playing' });
    await noor.post('/games/elden-ring/review', { rating: '3', reviewText: 'Too hard for me, beautiful though.' });
    await noor.post('/lists', { title: 'Secret favourites', description: '', game: 'elden-ring' });
    noorId = await memberIdByName(guest, 'Noor');
    await noor.post('/profile/edit', { name: 'Noor Hidden', bio: '', steamId: '', psnId: '', xboxId: '', preferredPlatform: '' });
  });

  it('shows the rating breakdown and how many players track the game', async () => {
    const page = await guest.get('/games/elden-ring');
    assert.ok(page.body.includes('Community score'));
    assert.ok(page.body.includes('2 member ratings'));
    assert.ok(page.body.includes('Players tracking'));
    assert.ok(page.body.includes('Tracked by'));
    assert.ok(noorId > 0);
  });

  it('keeps private members out of featured lists', async () => {
    const page = await guest.get('/games/elden-ring');
    assert.ok(!page.body.includes('Secret favourites'));
    assert.ok(!page.body.includes('Noor Hidden'));
    const own = await noor.get('/games/elden-ring');
    assert.ok(own.body.includes('Secret favourites'), 'the owner still sees their own list');
  });

  it('loads the trailer only after a click (no third-party frame in the page source)', async () => {
    const page = await guest.get('/games/elden-ring');
    assert.ok(page.body.includes('data-trailer-play'));
    assert.ok(!/<iframe[^>]+\ssrc="https:\/\/www\.youtube-nocookie\.com/.test(page.body.replace(/<noscript>[\s\S]*?<\/noscript>/g, '')));
  });
});

describe('activity sidebar', () => {
  it('shows trending games and suggestions without private members', async () => {
    const page = await guest.get('/activity');
    assert.ok(page.body.includes('Trending this week'));
    assert.ok(page.body.includes('Elden Ring'));
    assert.ok(!page.body.includes('Noor Hidden'));
  });
});

describe('player page', () => {
  it('shows level, achievements and the top four favourites', async () => {
    const profile = await maya.get('/profile');
    assert.equal(profile.status, 200);
    assert.match(profile.body, /Lv \d+ · (Rookie|Player|Adventurer|Veteran|Hero|Legend|Mythic)/);
    assert.ok(profile.body.includes('Achievements'));
    assert.ok(profile.body.includes('First Checkpoint'));
    assert.ok(profile.body.includes('Top 4 favorites'));
  });

  it('is the same page as the public profile', async () => {
    const mayaId = await memberIdByName(guest, 'Maya');
    const publicPage = await guest.get(`/members/${mayaId}`);
    assert.ok(publicPage.body.includes('Achievements'));
    assert.ok(!publicPage.body.includes('Edit profile'), 'visitors do not get the owner actions');
  });
});

describe('lists page', () => {
  it('fills empty spots with list ideas and pre-fills their title', async () => {
    const page = await maya.get('/lists');
    assert.ok(page.body.includes('List idea'));
    const form = await maya.get('/lists/new?title=Best%20co-op%20nights');
    assert.ok(form.body.includes('value="Best co-op nights"'));
  });
});

describe('self-hosted front end', () => {
  it('serves fonts, styles and scripts from the app itself', async () => {
    for (const asset of ['/css/base.css', '/css/layout.css', '/css/components.css', '/css/pages.css', '/js/main.js', '/fonts/inter-latin-wght.woff2']) {
      assert.equal((await guest.get(asset)).status, 200, asset);
    }
    const page = await guest.get('/');
    assert.ok(!page.body.includes('cdn.jsdelivr.net'), 'no CDN dependency');
    assert.doesNotMatch(page.headers.get('content-security-policy'), /jsdelivr/);
  });
});
