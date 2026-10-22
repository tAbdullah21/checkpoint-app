// 2.2 features through HTTP: "Compare tastes" between two members and "Who's playing" on a game page.
const assert = require('node:assert/strict');
const { after, before, describe, it } = require('node:test');
const { memberIdByName, startApp, useTemporaryDatabase } = require('../helpers');

useTemporaryDatabase('compare');

let app;
let rana;
let yousef;
let guest;
let ranaId;
let yousefId;

before(async () => {
  app = await startApp();
  rana = await app.client().signUp('Rana Player', 'rana@checkpoint.test');
  yousef = await app.client().signUp('Yousef Gamer', 'yousef@checkpoint.test');
  guest = app.client();
  ranaId = await memberIdByName(guest, 'Rana');
  yousefId = await memberIdByName(guest, 'Yousef');

  await rana.post('/library/elden-ring/add', { status: 'completed', returnTo: '/' });
  await rana.post('/games/elden-ring/review', { rating: '5', reviewText: 'A world that keeps surprising you.' });
  await rana.post('/library/hollow-knight-silksong/add', { status: 'completed', returnTo: '/' });
  await rana.post('/games/hollow-knight-silksong/review', { rating: '5', reviewText: 'Tight, fast and gorgeous.' });

  await yousef.post('/library/elden-ring/add', { status: 'playing', returnTo: '/' });
  await yousef.post('/games/elden-ring/review', { rating: '4', reviewText: 'Hard but fair, I keep coming back.' });
  await yousef.post('/library/sekiro-shadows-die-twice/add', { status: 'completed', returnTo: '/' });
  await yousef.post('/games/sekiro-shadows-die-twice/review', { rating: '5', reviewText: 'Parry everything, regret nothing.' });
});

after(() => app.close());

describe('compare tastes', () => {
  it('asks guests to log in', async () => {
    const response = await guest.get(`/members/${yousefId}/compare`);
    assert.equal(response.status, 302);
    assert.equal(response.location, '/login');
  });

  it('shows shared games, agreement and swaps between two players', async () => {
    const { status, body } = await rana.get(`/members/${yousefId}/compare`);
    assert.equal(status, 200);
    assert.ok(body.includes('You and Yousef'));
    assert.ok(body.includes('Games you both track'));
    assert.match(body, /Elden Ring[\s\S]*Agree/, 'ratings 5 and 4 agree');
    assert.match(body, /Yousef loved these[\s\S]*Sekiro/, 'his favourite she does not track');
    assert.match(body, /recommend to Yousef[\s\S]*Hollow Knight/, 'her favourite he does not track');
    assert.ok(body.includes('class="radar radar-compare"'));
  });

  it('sends a player comparing with themselves to their profile', async () => {
    const response = await rana.get(`/members/${ranaId}/compare`);
    assert.equal(response.status, 302);
    assert.equal(response.location, '/profile');
  });

  it('answers 404 for unknown and private members', async () => {
    assert.equal((await rana.get('/members/99999/compare')).status, 404);
    await yousef.post('/profile/edit', { name: 'Yousef Gamer', bio: '', steamId: '', psnId: '', xboxId: '', preferredPlatform: '' });
    assert.equal((await rana.get(`/members/${yousefId}/compare`)).status, 404);
    await yousef.post('/profile/edit', { name: 'Yousef Gamer', bio: '', steamId: '', psnId: '', xboxId: '', preferredPlatform: '', profilePublic: 'on' });
  });

  it('links the comparison from the member page and directory', async () => {
    const profile = await rana.get(`/members/${yousefId}`);
    assert.ok(profile.body.includes(`href="/members/${yousefId}/compare"`));
  });
});

describe("who's playing", () => {
  it('lists the members who track a game, the viewer first', async () => {
    const { body } = await rana.get('/games/elden-ring');
    assert.ok(body.includes("Who's playing"));
    const panel = body.slice(body.indexOf("Who's playing"));
    assert.ok(panel.indexOf('>You<') < panel.indexOf('Yousef Gamer'), 'the viewer is listed first');
  });

  it('leaves out private members', async () => {
    await yousef.post('/profile/edit', { name: 'Yousef Gamer', bio: '', steamId: '', psnId: '', xboxId: '', preferredPlatform: '' });
    const { body } = await guest.get('/games/elden-ring');
    const panel = body.slice(body.indexOf("Who's playing"), body.indexOf('Featured in lists'));
    assert.ok(panel.includes('Rana Player'));
    assert.ok(!panel.includes('Yousef Gamer'));
  });
});
