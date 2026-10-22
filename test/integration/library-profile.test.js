// The original core features (library, favourites, profile editing) keep working with the 2.0 additions.
const assert = require('node:assert/strict');
const { after, before, describe, it } = require('node:test');
const { startApp, useTemporaryDatabase } = require('../helpers');

useTemporaryDatabase('library');

let app;
let player;

before(async () => {
  app = await startApp();
  player = await app.client().signUp('Lama Library', 'lama@checkpoint.test');
});

after(() => app.close());

describe('library', () => {
  it('saves, updates and removes a game, and the feed follows along', async () => {
    let response = await player.post('/library/subnautica/add', { status: 'want_to_play', returnTo: '/library' });
    assert.equal(response.location, '/library');

    response = await player.post('/library/subnautica/update', { status: 'completed', returnTo: '/library' });
    assert.equal(response.status, 302);
    const library = await player.get('/library');
    assert.ok(library.body.includes('Subnautica'));

    const feed = await player.get('/activity');
    assert.ok(feed.body.includes('completed'), 'finishing a game appears in the feed');

    response = await player.post('/library/subnautica/remove', { returnTo: '/library' });
    assert.equal(response.status, 302);
    const game = await player.get('/games/subnautica');
    assert.ok(game.body.includes('Add to your library'));
  });

  it('rejects unknown statuses and games', async () => {
    await player.post('/library/elden-ring/add', { status: 'playing', returnTo: '/library' });
    await player.post('/library/elden-ring/update', { status: 'finished-maybe', returnTo: '/library' });
    const library = await player.get('/library');
    assert.ok(library.body.includes('Choose a valid library status.'));
    assert.equal((await player.post('/library/not-a-game/add', { status: 'playing' })).status, 404);
    assert.equal((await player.post('/library/stardew-valley/update', { status: 'playing' })).status, 404, 'not in the library');
  });

  it('allows at most four favourite games', async () => {
    for (const slug of ['baldurs-gate-3', 'cyberpunk-2077', 'split-fiction', 'it-takes-two', 'stardew-valley']) {
      await player.post(`/library/${slug}/add`, { status: 'played', returnTo: '/library' });
    }
    for (const slug of ['baldurs-gate-3', 'cyberpunk-2077', 'split-fiction', 'it-takes-two']) {
      await player.post(`/library/${slug}/update`, { status: 'played', isFavorite: 'on', returnTo: '/library' });
    }
    await player.post('/library/stardew-valley/update', { status: 'played', isFavorite: 'on', returnTo: '/library' });
    const library = await player.get('/library');
    assert.ok(library.body.includes('You can choose up to four favorite games.'));
  });

  it('keeps guests out', async () => {
    const response = await app.client().post('/library/elden-ring/add', { status: 'playing' });
    assert.equal(response.location, '/login');
  });
});

describe('profile', () => {
  it('validates and saves the profile, including privacy and favourite genres', async () => {
    let response = await player.post('/profile/edit', { name: 'L', bio: '' });
    assert.equal(response.status, 422);
    assert.ok(response.body.includes('Display name must be between 2 and 60 characters.'));

    response = await player.post('/profile/edit', {
      name: 'Lama Library',
      bio: 'Cozy games and long RPGs 🎮',
      steamId: 'lama_steam',
      steamVisible: 'on',
      psnId: '',
      xboxId: '',
      preferredPlatform: 'steam',
      favoriteGenres: ['RPG', 'Simulation'],
      profilePublic: 'on',
    });
    assert.equal(response.location, '/profile');

    const profile = await player.get('/profile');
    assert.ok(profile.body.includes('Cozy games and long RPGs 🎮'));
    assert.ok(profile.body.includes('lama_steam'));
    assert.ok(profile.body.includes('Public profile'));
    assert.ok(profile.body.includes('Simulation'));
  });

  it('opens the edit form with the saved values', async () => {
    const { status, body } = await player.get('/profile/edit');
    assert.equal(status, 200);
    assert.ok(body.includes('value="Lama Library"'));
    assert.ok(body.includes('Cozy games and long RPGs 🎮'));
    assert.match(body, /name="favoriteGenres" value="RPG" checked/);
    assert.match(body, /name="favoriteGenres" value="Action" >/, 'genres that were not chosen stay unticked');
  });

  it('explains every rule that is broken and keeps what was typed', async () => {
    const response = await player.post('/profile/edit', {
      name: 'Lama Library',
      bio: 'b'.repeat(281),
      steamId: 's'.repeat(65),
      psnId: 'p'.repeat(33),
      xboxId: 'x'.repeat(33),
      preferredPlatform: 'sega',
      favoriteGenres: ['Action', 'Adventure', 'RPG', 'Strategy', 'Racing', 'Sports'],
      profilePublic: 'on',
    });
    assert.equal(response.status, 422);
    for (const message of [
      'Bio must be 280 characters or fewer.',
      'Steam username or ID must be 64 characters or fewer.',
      'PlayStation Network ID must be 32 characters or fewer.',
      'Xbox gamertag must be 32 characters or fewer.',
      'Choose a valid preferred platform.',
      'Choose up to five favorite genres.',
    ]) {
      assert.ok(response.body.includes(message), message);
    }
    assert.ok(response.body.includes('b'.repeat(281)), 'the bio is not lost');
    const profile = await player.get('/profile');
    assert.ok(profile.body.includes('Cozy games and long RPGs 🎮'), 'nothing was saved');
  });

  it('ignores genres that are not on the list', async () => {
    await player.post('/profile/edit', {
      name: 'Lama Library',
      bio: 'Cozy games and long RPGs 🎮',
      favoriteGenres: ['RPG', 'Made-up genre', 'RPG'],
      profilePublic: 'on',
    });
    const { body } = await player.get('/profile/edit');
    assert.match(body, /name="favoriteGenres" value="RPG" checked/);
    assert.ok(!body.includes('Made-up genre'));
  });

  it('feeds favourite genres into recommendations', async () => {
    const fresh = await app.client().signUp('Genre Only', 'genre@checkpoint.test');
    await fresh.post('/profile/edit', { name: 'Genre Only', bio: '', steamId: '', psnId: '', xboxId: '', preferredPlatform: '', favoriteGenres: ['Racing'], profilePublic: 'on' });
    const page = await fresh.get('/for-you');
    assert.ok(page.body.includes('Matches your favorite genre: Racing'));
  });
});
