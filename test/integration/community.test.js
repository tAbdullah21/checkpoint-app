// Members, follows, privacy, helpful votes, lists and the activity feed, tested through HTTP.
const assert = require('node:assert/strict');
const { after, before, describe, it } = require('node:test');
const { memberIdByName, startApp, useTemporaryDatabase } = require('../helpers');

useTemporaryDatabase('community');

let app;
let alice;
let bob;
let guest;
let aliceId;
let bobId;

before(async () => {
  app = await startApp();
  alice = await app.client().signUp('Alice Player', 'alice@checkpoint.test');
  bob = await app.client().signUp('Bob Gamer', 'bob@checkpoint.test');
  guest = app.client();
  aliceId = await memberIdByName(guest, 'Alice');
  bobId = await memberIdByName(guest, 'Bob');
});

after(() => app.close());

describe('member directory and profiles', () => {
  it('lists public members for everyone', async () => {
    const { status, body } = await guest.get('/members');
    assert.equal(status, 200);
    assert.ok(body.includes('Alice Player') && body.includes('Bob Gamer'));
  });

  it('searches members by name', async () => {
    const { body } = await guest.get('/members?q=ali');
    assert.ok(body.includes('Alice Player'));
    assert.ok(!body.includes('Bob Gamer'));
  });

  it('shows a public profile and answers 404 for unknown members', async () => {
    const profile = await guest.get(`/members/${aliceId}`);
    assert.equal(profile.status, 200);
    assert.ok(profile.body.includes('Alice Player'));
    assert.ok(!profile.body.includes('alice@checkpoint.test'), 'email addresses stay private');
    assert.equal((await guest.get('/members/99999')).status, 404);
    assert.equal((await guest.get('/members/not-a-number')).status, 404);
  });
});

describe('following', () => {
  it('requires an account', async () => {
    const response = await guest.post(`/members/${aliceId}/follow`);
    assert.equal(response.status, 302);
    assert.equal(response.location, '/login');
  });

  it('follows and unfollows another member', async () => {
    let response = await bob.post(`/members/${aliceId}/follow`, { returnTo: `/members/${aliceId}` });
    assert.equal(response.status, 302);
    assert.equal(response.location, `/members/${aliceId}`);

    let page = await guest.get(`/members/${aliceId}`);
    assert.match(page.body, /<strong>1<\/strong> followers/);
    assert.ok(page.body.includes('Bob Gamer'), 'Bob appears in the followers list');

    page = await bob.get(`/members/${aliceId}`);
    assert.ok(page.body.includes('Following ✓'));

    response = await bob.post(`/members/${aliceId}/unfollow`);
    assert.equal(response.status, 302);
    page = await guest.get(`/members/${aliceId}`);
    assert.match(page.body, /<strong>0<\/strong> followers/);
  });

  it('does not let members follow themselves', async () => {
    await alice.post(`/members/${aliceId}/follow`);
    const page = await alice.get(`/members/${aliceId}`);
    assert.ok(page.body.includes('You cannot follow yourself.'));
    assert.match(page.body, /<strong>0<\/strong> followers/);
  });

  it('never redirects outside the site after following', async () => {
    const response = await bob.post(`/members/${aliceId}/follow`, { returnTo: '//evil.example/phish' });
    assert.equal(response.location, `/members/${aliceId}`);
  });
});

describe('helpful votes on reviews', () => {
  let reviewId;

  before(async () => {
    await alice.post('/games/elden-ring/review', { rating: '5', reviewText: 'A brilliant open world full of secrets.' });
    const page = await guest.get('/games/elden-ring');
    reviewId = Number(page.body.match(/id="review-(\d+)"/)[1]);
  });

  it('lets another member mark a review as helpful and undo it', async () => {
    const response = await bob.post(`/reviews/${reviewId}/like`);
    assert.equal(response.status, 302);
    assert.equal(response.location, `/games/elden-ring#review-${reviewId}`);

    let page = await bob.get('/games/elden-ring');
    assert.ok(page.body.includes('aria-pressed="true"'));
    assert.ok(page.body.includes('Helpful · 1'));

    await bob.post(`/reviews/${reviewId}/like`);
    page = await bob.get('/games/elden-ring');
    assert.ok(page.body.includes('aria-pressed="false"'));
    assert.ok(page.body.includes('Helpful · 0'));
  });

  it('does not count votes on your own review', async () => {
    await alice.post(`/reviews/${reviewId}/like`);
    const page = await alice.get('/games/elden-ring');
    assert.ok(page.body.includes('You cannot like your own review.'));
    assert.ok(!page.body.includes('helpful-button'), 'authors do not get a vote button');
  });

  it('answers 404 for a missing review', async () => {
    assert.equal((await bob.post('/reviews/99999/like')).status, 404);
  });
});

describe('game lists', () => {
  let listId;

  it('validates the title length in characters, not bytes', async () => {
    const tooShort = await alice.post('/lists', { title: 'ab', description: '' });
    assert.equal(tooShort.status, 422);
    assert.ok(tooShort.body.includes('List title must be between 3 and 60 characters.'));

    const emoji = await alice.post('/lists', { title: '🎮🎮🎮', description: '' });
    assert.equal(emoji.status, 302, 'three emoji are three characters');
  });

  it('creates a list that starts with a game', async () => {
    const response = await alice.post('/lists', { title: 'Best open worlds', description: 'Maps worth exploring.', game: 'elden-ring' });
    assert.equal(response.status, 302);
    listId = Number(response.location.match(/^\/lists\/(\d+)$/)[1]);

    const page = await guest.get(`/lists/${listId}`);
    assert.equal(page.status, 200);
    assert.ok(page.body.includes('Best open worlds'));
    assert.ok(page.body.includes('Maps worth exploring.'));
    assert.ok(page.body.includes('/games/elden-ring'));
    assert.ok(!page.body.includes('Delete list'), 'visitors cannot manage the list');
  });

  it('adds games from the game page form and refuses duplicates', async () => {
    let response = await alice.post('/lists/add', { listId: String(listId), slug: 'red-dead-redemption-2', returnTo: '/games/red-dead-redemption-2' });
    assert.equal(response.status, 302);
    assert.equal(response.location, '/games/red-dead-redemption-2');

    response = await alice.post('/lists/add', { listId: String(listId), slug: 'red-dead-redemption-2', returnTo: '/games/red-dead-redemption-2' });
    assert.equal(response.location, '/games/red-dead-redemption-2', 'a duplicate goes back to the same page');
    const page = await alice.get('/games/red-dead-redemption-2');
    assert.ok(page.body.includes('is already in'));

    const list = await guest.get(`/lists/${listId}`);
    assert.ok(list.body.includes('Red Dead Redemption 2'));
    assert.ok(list.body.includes('2 games'));
  });

  it('only lets the owner edit, delete or change the list', async () => {
    assert.equal((await bob.get(`/lists/${listId}/edit`)).status, 404);
    assert.equal((await bob.post(`/lists/${listId}/edit`, { title: 'Hacked', description: '' })).status, 404);
    assert.equal((await bob.post(`/lists/${listId}/delete`)).status, 404);
    assert.equal((await bob.post('/lists/add', { listId: String(listId), slug: 'subnautica' })).status, 404);
    assert.equal((await bob.post(`/lists/${listId}/items/elden-ring/remove`)).status, 404);

    const list = await guest.get(`/lists/${listId}`);
    assert.ok(list.body.includes('Best open worlds'));
    assert.ok(list.body.includes('Elden Ring'));
  });

  it('lets the owner edit, remove games and delete the list', async () => {
    let response = await alice.post(`/lists/${listId}/edit`, { title: 'Open worlds I love', description: 'Updated.' });
    assert.equal(response.status, 302);
    let page = await guest.get(`/lists/${listId}`);
    assert.ok(page.body.includes('Open worlds I love'));

    response = await alice.post(`/lists/${listId}/items/elden-ring/remove`);
    assert.equal(response.status, 302);
    page = await guest.get(`/lists/${listId}`);
    assert.ok(!page.body.includes('/games/elden-ring"'), 'the removed game is gone');

    response = await alice.post(`/lists/${listId}/delete`);
    assert.equal(response.location, '/lists');
    assert.equal((await guest.get(`/lists/${listId}`)).status, 404);
  });

  it('asks guests to log in before creating lists', async () => {
    const response = await guest.get('/lists/new');
    assert.equal(response.status, 302);
    assert.equal(response.location, '/login');
  });
});

describe('ranked list order', () => {
  let listId;
  const ranking = async () => {
    const page = await guest.get(`/lists/${listId}`);
    return [...page.body.matchAll(/id="rank-([a-z0-9-]+)"/g)].map((match) => match[1]);
  };
  const move = (client, slug, direction, json = true) => client.post(`/lists/${listId}/items/${slug}/move`, { direction }, {
    headers: json ? { accept: 'application/json' } : {},
  });

  before(async () => {
    const response = await alice.post('/lists', { title: 'Order matters', description: '', game: 'elden-ring' });
    listId = Number(response.location.match(/^\/lists\/(\d+)$/)[1]);
    for (const slug of ['subnautica', 'stardew-valley']) await alice.post(`/lists/${listId}/items`, { slug });
  });

  it('ranks games in the order they were added', async () => {
    assert.deepEqual(await ranking(), ['elden-ring', 'subnautica', 'stardew-valley']);
  });

  it('moves a game up or down and answers with its new rank', async () => {
    let response = await move(alice, 'stardew-valley', 'up');
    assert.deepEqual(response.json(), { ok: true, position: 2, total: 3 });
    response = await move(alice, 'elden-ring', 'down');
    assert.deepEqual(response.json(), { ok: true, position: 2, total: 3 });
    assert.deepEqual(await ranking(), ['stardew-valley', 'elden-ring', 'subnautica']);
  });

  it('works without JavaScript and returns to the moved game', async () => {
    const response = await move(alice, 'subnautica', 'up', false);
    assert.equal(response.status, 302);
    assert.equal(response.location, `/lists/${listId}#rank-subnautica`);
    assert.deepEqual(await ranking(), ['stardew-valley', 'subnautica', 'elden-ring']);
  });

  it('refuses moves past either end and unknown directions', async () => {
    assert.equal((await move(alice, 'stardew-valley', 'up')).status, 409);
    assert.equal((await move(alice, 'elden-ring', 'down')).status, 409);
    assert.equal((await move(alice, 'elden-ring', 'sideways')).status, 400);
    assert.equal((await move(alice, 'red-dead-redemption-2', 'up')).status, 409, 'a game that is not in the list');
    assert.deepEqual(await ranking(), ['stardew-valley', 'subnautica', 'elden-ring']);
  });

  it('keeps the order consistent after a game is removed', async () => {
    await alice.post(`/lists/${listId}/items/subnautica/remove`);
    await alice.post(`/lists/${listId}/items`, { slug: 'hollow-knight-silksong' });
    await move(alice, 'hollow-knight-silksong', 'up');
    assert.deepEqual(await ranking(), ['stardew-valley', 'hollow-knight-silksong', 'elden-ring']);
  });

  it('only lets the owner reorder', async () => {
    const refused = await move(bob, 'elden-ring', 'up');
    assert.equal(refused.status, 404);
    assert.deepEqual(refused.json(), { ok: false, message: 'List not found.' }, 'background requests get JSON');
    assert.equal((await move(bob, 'elden-ring', 'up', false)).status, 404);
    const response = await move(guest, 'elden-ring', 'up', false);
    assert.equal(response.location, '/login');
    assert.deepEqual(await ranking(), ['stardew-valley', 'hollow-knight-silksong', 'elden-ring']);
  });

  it('shows the arrows to the owner only, with the ends disabled', async () => {
    const owner = await alice.get(`/lists/${listId}`);
    assert.match(owner.body, /data-direction="up" aria-label="Move Stardew Valley up" title="Move up" disabled/);
    assert.match(owner.body, /data-direction="down" aria-label="Move Elden Ring down" title="Move down" disabled/);
    assert.ok(!(await guest.get(`/lists/${listId}`)).body.includes('data-move-form'));
  });
});

describe('activity feed', () => {
  it('records library, review, follow and list activity', async () => {
    await bob.post('/library/subnautica/add', { status: 'playing', returnTo: '/' });
    await bob.post('/lists', { title: 'Deep sea games', description: '', game: 'subnautica' });
    const { status, body } = await guest.get('/activity');
    assert.equal(status, 200);
    assert.ok(body.includes('Bob Gamer'));
    assert.ok(body.includes('started following'));
    assert.ok(body.includes('created the list'));
    assert.ok(body.includes('Subnautica'));
    assert.ok(body.includes('Alice Player'));
    assert.ok(body.includes('rated'));
  });

  it('filters the feed to people you follow', async () => {
    const carol = await app.client().signUp('Carol Quiet', 'carol@checkpoint.test');
    let feed = await carol.get('/activity?tab=following');
    assert.ok(feed.body.includes('Nothing from people you follow yet'));

    await carol.post(`/members/${bobId}/follow`);
    feed = await carol.get('/activity?tab=following');
    assert.ok(feed.body.includes('<strong>Bob Gamer</strong>'));
    assert.ok(!feed.body.includes('<strong>Alice Player</strong>'), 'people you do not follow are filtered out');
  });

  it('removes a deleted review from the feed', async () => {
    await bob.post('/games/battlefield-6/review', { rating: '4', reviewText: 'Big maps and great teamwork.' });
    let feed = await guest.get('/activity');
    assert.ok(feed.body.includes('Battlefield 6'));
    await bob.post('/games/battlefield-6/review/delete');
    feed = await guest.get('/activity');
    assert.ok(!feed.body.includes('Battlefield 6'));
  });
});

describe('private profiles', () => {
  before(async () => {
    const response = await alice.post('/profile/edit', {
      name: 'Alice Player',
      bio: 'I keep my games to myself.',
      steamId: '',
      psnId: '',
      xboxId: '',
      preferredPlatform: '',
      // profilePublic is left out, which is what an unticked checkbox sends
    });
    assert.equal(response.status, 302);
  });

  it('hides the member from the directory and the feed', async () => {
    const members = await guest.get('/members');
    assert.ok(!members.body.includes('Alice Player'));
    const feed = await guest.get('/activity');
    assert.ok(!feed.body.includes('Alice Player'), 'neither her actions nor follows of her are shown');
  });

  it('shows only a private notice on the profile page', async () => {
    const page = await bob.get(`/members/${aliceId}`);
    assert.equal(page.status, 200);
    assert.ok(page.body.includes('This profile is private'));
    assert.ok(!page.body.includes('I keep my games to myself.'));
    assert.ok(!page.body.includes('Alice Player'), 'private identity is absent from all rendered HTML');
    assert.ok(!page.body.includes('Member since'), 'the join date is private too');
  });

  it('keeps the identity and profile fields out of the guest response and view model', async () => {
    const page = await guest.get(`/members/${aliceId}`);
    assert.equal(page.status, 200);
    assert.ok(page.body.includes('Private profile | Checkpoint'));
    assert.ok(!page.body.includes('Alice Player'));
    assert.ok(!page.body.includes('Member since'));
    assert.ok(!page.body.includes('Log in to follow'));
    const { memberPage } = require('../../lib/member-page');
    const model = memberPage(aliceId, 0);
    assert.deepEqual(model.member, { id: aliceId, name: 'Private member' });
    assert.equal(model.joined, null);
    assert.ok(!JSON.stringify(model).includes('Alice Player'));
  });

  it('still shows the owner their own page and activity', async () => {
    const page = await alice.get(`/members/${aliceId}`);
    assert.ok(page.body.includes('I keep my games to myself.'));
    const profile = await alice.get('/profile');
    assert.ok(profile.body.includes('Private profile'));
  });

  it('keeps their reviews on game pages without their name', async () => {
    const page = await bob.get('/games/elden-ring');
    assert.ok(page.body.includes('A brilliant open world full of secrets.'));
    assert.ok(page.body.includes('Private member'));
    assert.ok(!page.body.includes('Alice Player'));
    const own = await alice.get('/games/elden-ring');
    assert.ok(own.body.includes('Alice Player'), 'the author still sees their own name');
  });

  it('cannot be followed', async () => {
    assert.equal((await bob.post(`/members/${aliceId}/follow`)).status, 404);
  });
});
