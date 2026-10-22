// "For You" recommendations, taste match, Wrapped, similar games, tag search, the JSON API and cover fallbacks.
const assert = require('node:assert/strict');
const { after, before, describe, it } = require('node:test');
const { memberIdByName, startApp, useTemporaryDatabase } = require('../helpers');

useTemporaryDatabase('discovery');

let app;
let guest;
let player;

before(async () => {
  app = await startApp();
  guest = app.client();
  player = await app.client().signUp('Rana Player', 'rana@checkpoint.test');
});

after(() => app.close());

describe('For You recommendations', () => {
  it('asks guests to log in', async () => {
    const response = await guest.get('/for-you');
    assert.equal(response.status, 302);
    assert.equal(response.location, '/login');
  });

  it('starts with popular games for a new player (cold start)', async () => {
    const page = await player.get('/for-you');
    assert.equal(page.status, 200);
    assert.ok(page.body.includes('No taste profile yet'));
    assert.ok(page.body.includes('Popular with Checkpoint players'));

    const home = await player.get('/');
    assert.ok(home.body.includes('Teach Checkpoint your taste'));
  });

  it('personalises picks after the player rates a game', async () => {
    await player.post('/library/elden-ring/add', { status: 'completed', returnTo: '/' });
    await player.post('/games/elden-ring/review', { rating: '5', reviewText: 'Hard, beautiful and worth every death.' });

    const page = await player.get('/for-you');
    assert.ok(!page.body.includes('No taste profile yet'));
    assert.ok(page.body.includes('Because you rated Elden Ring 5★'));
    assert.match(page.body, /class="match-ring" style="--match: \d+"/);
    assert.ok(page.body.includes('YOUR TASTE DNA'));
    assert.ok(page.body.includes('Your top 5 matches'));
    assert.equal((page.body.match(/<article class="podium-card /g) || []).length, 5);
    assert.equal((page.body.match(/<article class="pick-card"/g) || []).length, 7);
    assert.ok(!page.body.includes('data-assistant-open'));
    assert.ok(!page.body.includes('href="/games/elden-ring"'), 'games the player already has are not recommended');

    const home = await player.get('/');
    assert.ok(home.body.includes('% match'));
  });

  it('shows how well a game matches on its page', async () => {
    const page = await player.get('/games/the-witcher-3-wild-hunt');
    assert.ok(page.body.includes('YOUR MATCH'));
    assert.match(page.body, /<strong>\d+%<\/strong>/);
  });

  it('shows the match only to members with a taste profile', async () => {
    const page = await guest.get('/games/the-witcher-3-wild-hunt');
    assert.ok(!page.body.includes('YOUR MATCH'));
  });

  it('serves the recommendations as JSON', async () => {
    const response = await player.get('/api/me/recommendations');
    assert.equal(response.status, 200);
    const data = response.json();
    assert.equal(data.coldStart, false);
    assert.ok(data.recommendations.length > 0);
    assert.ok(data.recommendations.every((game) => game.slug !== 'elden-ring' && typeof game.reason === 'string'));
    assert.equal((await guest.get('/api/me/recommendations')).status, 401);
  });
});

describe('players like you and taste match', () => {
  let twinId;

  before(async () => {
    const twin = await app.client().signUp('Twin Player', 'twin@checkpoint.test');
    await twin.post('/library/elden-ring/add', { status: 'completed', returnTo: '/' });
    await twin.post('/games/elden-ring/review', { rating: '5', reviewText: 'The best open world I have played.' });
    twinId = await memberIdByName(guest, 'Twin');
  });

  it('shows a taste match on member pages and cards', async () => {
    const profile = await player.get(`/members/${twinId}`);
    assert.ok(profile.body.includes('TASTE MATCH'));
    assert.match(profile.body, /You and Twin have \d+% similar taste/);

    const members = await player.get('/members');
    assert.match(members.body, /<b>\d+%<\/b> taste match/);
  });

  it('suggests similar players on the For You page', async () => {
    const page = await player.get('/for-you');
    assert.ok(page.body.includes('PLAYERS LIKE YOU'));
    assert.ok(page.body.includes('Twin Player'));
  });
});

describe('Checkpoint Wrapped', () => {
  it('has an empty state', async () => {
    const newcomer = await app.client().signUp('New Comer', 'new@checkpoint.test');
    const page = await newcomer.get('/wrapped');
    assert.equal(page.status, 200);
    assert.ok(page.body.includes('Your story starts with one game'));
  });

  it('summarises the player', async () => {
    const page = await player.get('/wrapped');
    assert.equal(page.status, 200);
    assert.ok(page.body.includes('YOUR PLAYER TYPE'));
    assert.ok(page.body.includes('GAMES TRACKED'));
    assert.ok(page.body.includes('YOUR HIGHEST RATED'));
    assert.ok(page.body.includes('Hard, beautiful and worth every death.'));
  });

  it('asks guests to log in', async () => {
    assert.equal((await guest.get('/wrapped')).location, '/login');
  });
});

describe('catalogue discovery', () => {
  it('shows content-based similar games', async () => {
    const page = await guest.get('/games/resident-evil-4');
    assert.ok(page.body.includes('Similar games'));
    const similarSection = page.body.slice(page.body.indexOf('MORE LIKE THIS'));
    assert.ok(similarSection.includes('/games/resident-evil-requiem'));
  });

  it('shows gameplay tags that link to a search', async () => {
    const page = await guest.get('/games/elden-ring');
    assert.ok(page.body.includes('href="/games?query=soulslike"'));
    const search = await guest.get('/games?query=soulslike');
    assert.ok(search.body.includes('Elden Ring'));
    assert.ok(search.body.includes('Sekiro: Shadows Die Twice'));
    assert.ok(!search.body.includes('Stardew Valley'));
  });
});

describe('JSON API', () => {
  it('searches games for the instant search', async () => {
    const response = await guest.get('/api/search?q=elden');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const { results } = response.json();
    assert.equal(results[0].slug, 'elden-ring');
    assert.equal(results[0].url, '/games/elden-ring');
    assert.deepEqual((await guest.get('/api/search?q=e')).json().results, [], 'one letter is not searched');
  });

  it('describes one game with trailer, tags and reviews', async () => {
    const game = (await guest.get('/api/games/elden-ring')).json();
    assert.equal(game.title, 'Elden Ring');
    assert.ok(game.trailer.startsWith('https://www.youtube-nocookie.com/embed/'));
    assert.ok(game.tags.includes('soulslike'));
    assert.ok(game.reviews.length >= 1);
  });

  it('lists and filters games', async () => {
    const all = (await guest.get('/api/games')).json();
    assert.equal(all.count, 60);
    const horror = (await guest.get('/api/games?genre=Survival%20Horror')).json();
    assert.ok(horror.count >= 2 && horror.games.every((game) => game.genre === 'Survival Horror'));
  });

  it('reports community numbers', async () => {
    const stats = (await guest.get('/api/stats')).json();
    assert.equal(stats.games, 60);
    assert.ok(stats.members >= 2 && stats.reviews >= 1);
  });

  it('answers unknown resources with JSON 404s', async () => {
    const missingGame = await guest.get('/api/games/not-a-game');
    assert.equal(missingGame.status, 404);
    assert.equal(missingGame.json().error, 'Game not found');
    const missingRoute = await guest.get('/api/nothing-here');
    assert.equal(missingRoute.status, 404);
    assert.equal(missingRoute.json().error, 'Not found');
  });
});

describe('cover images', () => {
  it('serves real covers as images', async () => {
    const response = await guest.get('/images/covers/stardew-valley.jpg');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /image\/jpeg/);
  });

  it('draws a placeholder poster when a game cover file is missing', async () => {
    const response = await guest.get('/images/covers/elden-ring.png');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /image\/svg\+xml/);
    assert.ok(response.body.includes('ELDEN RING'));
  });

  it('answers 404 for files that are not game covers', async () => {
    assert.equal((await guest.get('/images/covers/not-a-game.jpg')).status, 404);
  });
});
