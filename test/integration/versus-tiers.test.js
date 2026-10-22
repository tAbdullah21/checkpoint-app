// 3.8 showcase features through HTTP: Versus (two games head to head), tier lists (own board, menu moves, saving
// a dragged order, public pages, privacy, the data export), the live ticker, instant-navigation rules, and the
// moving game page backdrop.
const assert = require('node:assert/strict');
const { after, before, describe, it } = require('node:test');
const { memberIdByName, startApp, useTemporaryDatabase } = require('../helpers');

useTemporaryDatabase('versus-tiers');

let app;
let guest;
let tala;
let omar;

const json = { headers: { accept: 'application/json' } };

before(async () => {
  app = await startApp();
  guest = app.client();
  tala = await app.client().signUp('Tala Ranker', 'tala@checkpoint.test');
  omar = await app.client().signUp('Omar Private', 'omar@checkpoint.test');
  await tala.post('/library/hades/add', { status: 'completed' });
  await tala.post('/library/stardew-valley/add', { status: 'played' });
});

after(() => app.close());

describe('Versus', () => {
  it('shows the picker and famous match-ups without both games', async () => {
    const { status, body } = await guest.get('/versus');
    assert.equal(status, 200);
    assert.ok(body.includes('Pick two games. Let them fight.'));
    assert.ok(body.includes('Famous match-ups'));
    assert.match(body, /href="\/versus\?a=[a-z0-9-]+&b=[a-z0-9-]+"/);
  });

  it('turns typed names into the games\' addresses', async () => {
    const response = await guest.get('/versus?a=elden&b=hades');
    assert.equal(response.status, 302);
    assert.equal(response.location, '/versus?a=elden-ring&b=hades');
  });

  it('compares two games round by round with a verdict', async () => {
    const { status, body } = await guest.get('/versus?a=elden-ring&b=hades');
    assert.equal(status, 200);
    assert.match(body, /<title>Elden Ring vs Hades/);
    assert.ok(body.includes('Checkpoint score'));
    assert.ok(body.includes('Members tracking it'));
    assert.match(body, /class="versus-verdict versus-verdict-(left|right|draw)"/);
    assert.match(body, /won \d+ rounds/);
    assert.ok(body.includes('Same DNA?'));
    assert.ok(body.includes('href="/versus?a=hades&b=elden-ring"'), 'a rematch swaps the sides');
  });

  it('refuses the same game twice and says when a name matches nothing', async () => {
    const same = await guest.get('/versus?a=hades&b=hades');
    assert.ok(same.body.includes('That is the same game twice.'));
    const missing = await guest.get('/versus?a=hades&b=zzzzqqqq');
    assert.ok(missing.body.includes('No game matches “zzzzqqqq”'));
  });

  it('is offered on every game page', async () => {
    const { body } = await guest.get('/games/hades');
    assert.match(body, /href="\/versus\?a=hades(&amp;b=[a-z0-9-]+)?"/);
  });
});

describe('tier lists', () => {
  it('asks guests to log in', async () => {
    const response = await guest.get('/tiers');
    assert.equal(response.status, 302);
    assert.equal(response.location, '/login');
  });

  it('starts with the library games in the unranked pool', async () => {
    const { body } = await tala.get('/tiers');
    assert.ok(body.includes('Your tier list'));
    assert.match(body, /data-tier-list="pool"[\s\S]*data-slug="hades"/);
    assert.ok(body.includes('0 / 100 ranked'));
  });

  it('moves a game with the menu form and by a typed name', async () => {
    const moved = await tala.post('/tiers/place', { slug: 'hades', tier: 's' });
    assert.equal(moved.location, '/tiers');
    const typed = await tala.post('/tiers/place', { query: 'Elden Ring', tier: 'a' }, json);
    assert.deepEqual(typed.json(), { ok: true, message: 'Elden Ring is now in tier A.', slug: 'elden-ring', tier: 'a' });
    const { body } = await tala.get('/tiers');
    assert.match(body, /data-tier-list="s"[^>]*>[\s\S]*?data-slug="hades"/);
    assert.match(body, /data-tier-list="a"[^>]*>[\s\S]*?data-slug="elden-ring"/);
    assert.ok(body.includes('2 / 100 ranked'));
  });

  it('refuses an unknown tier and an unknown game', async () => {
    const tier = await tala.post('/tiers/place', { slug: 'hades', tier: 'z' }, json);
    assert.equal(tier.status, 400);
    const game = await tala.post('/tiers/place', { slug: 'no-such-game', tier: 's' }, json);
    assert.equal(game.status, 404);
  });

  it('saves the order of a dragged board and sends games back to the pool', async () => {
    const response = await tala.post('/tiers/order', { order: 's:elden-ring,s:hades,b:stardew-valley,pool:not a slug' }, json);
    assert.deepEqual(response.json(), { ok: true, message: 'Tier list saved.', total: 3 });
    let { body } = await tala.get('/tiers');
    assert.match(body, /data-tier-list="s"[^>]*>[\s\S]*?data-slug="elden-ring"[\s\S]*?data-slug="hades"/);
    await tala.post('/tiers/order', { order: 'pool:stardew-valley' }, json);
    ({ body } = await tala.get('/tiers'));
    assert.match(body, /data-tier-list="pool"[\s\S]*data-slug="stardew-valley"/);
    const empty = await tala.post('/tiers/order', { order: '' }, json);
    assert.equal(empty.status, 400);
  });

  it('shows a public list to everyone and hides a private member\'s list', async () => {
    const talaId = await memberIdByName(guest, 'Tala Ranker');
    const { body } = await guest.get(`/tiers/${talaId}`);
    assert.ok(body.includes('Tala Ranker&#39;s tier list'));
    assert.ok(body.includes('href="/games/elden-ring"'));
    assert.ok(!body.includes('data-editable'), 'visitors cannot edit it');
    const own = await tala.get(`/tiers/${talaId}`);
    assert.equal(own.location, '/tiers');

    const { db } = require('../../database/database');
    db.prepare('UPDATE users SET profile_public = 0 WHERE email = ?').run('omar@checkpoint.test');
    const omarId = db.prepare('SELECT id FROM users WHERE email = ?').get('omar@checkpoint.test').id;
    assert.equal((await guest.get(`/tiers/${omarId}`)).status, 404);
    assert.equal((await omar.get(`/tiers/${omarId}`)).location, '/tiers');
  });

  it('is part of the account export', async () => {
    const { body } = await tala.get('/account/export');
    const data = JSON.parse(body);
    assert.deepEqual(data.tierList.map((entry) => [entry.tier, entry.slug, entry.position]), [['S', 'elden-ring', 1], ['S', 'hades', 2]]);
  });
});

describe('motion and instant navigation', () => {
  it('announces the speculation rules, which list only pages that change nothing', async () => {
    const page = await guest.get('/');
    assert.equal(page.headers.get('speculation-rules'), '"/speculation-rules.json"');
    const rules = await guest.get('/speculation-rules.json');
    assert.match(rules.headers.get('content-type'), /^application\/speculationrules\+json/);
    const patterns = rules.json().prefetch[0].where.and[0].href_matches;
    assert.ok(patterns.includes('/games/*'));
    for (const unsafe of ['/logout', '/notifications', '/account/export', '/api/*']) assert.ok(!patterns.includes(unsafe));
  });

  it('shows the live ticker of community moments on the home page', async () => {
    await tala.post('/games/hades/review', { rating: '5', reviewText: 'Every run feels new.' });
    await tala.post('/games/stardew-valley/review', { rating: '4', reviewText: 'Tough and kind at once.' });
    const { body } = await guest.get('/');
    assert.match(body, /<section class="live-ticker" aria-label="Live on Checkpoint"/);
    assert.match(body, /<ul class="live-ticker-track" aria-hidden="true">/, 'the looping copy is hidden from screen readers');
  });

  it('gives every game page a moving backdrop, even without Steam artwork', async () => {
    const { body } = await guest.get('/games/hades');
    assert.match(body, /class="game-hero has-art/);
    assert.match(body, /data-cinema/);
    assert.match(body, /class="game-hero-art is-active"/);
    assert.match(body, /data-hero-motion-toggle/);
  });
});
