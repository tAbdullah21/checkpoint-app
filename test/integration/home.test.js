// The homepage through HTTP: the landing page for guests, the member dashboard and the game picker.
const assert = require('node:assert/strict');
const { after, before, describe, it } = require('node:test');
const { startApp, useTemporaryDatabase } = require('../helpers');

useTemporaryDatabase('home');

let app;
let nada;

before(async () => {
  app = await startApp();
  nada = await app.client().signUp('Nada Player', 'nada@checkpoint.test');
});

after(() => app.close());

// The part of the page from one piece of text to the next, so a check only looks at one section.
function section(body, start, end) {
  const from = body.indexOf(start);
  assert.notEqual(from, -1, `"${start}" is on the page`);
  const to = body.indexOf(end, from);
  return body.slice(from, to === -1 ? undefined : to);
}

// The games in the picker dialog, which the dashboard and the library page share.
function pickerCandidates(body) {
  const list = body.includes('data-picker-candidates') ? section(body, 'data-picker-candidates', '</ul>') : '';
  return [...list.matchAll(/<li data-slug="([^"]+)"[^>]*data-weight="(\d+)"/g)].map((match) => ({
    slug: match[1],
    weight: Number(match[2]),
  }));
}

describe('homepage for guests', () => {
  it('shows the landing page with the poster wall and live community numbers', async () => {
    const { status, body } = await app.client().get('/');
    assert.equal(status, 200);
    assert.ok(body.includes('Every game you play deserves a'));
    assert.ok(body.includes('class="poster-wall"'));
    assert.match(section(body, 'class="landing-stats', '</dl>'), /<dt>Members<\/dt><dd data-count-up="1">1<\/dd>/);
    assert.ok(body.includes('href="/register"'));
    assert.ok(!body.includes('Welcome back'));
    assert.ok(!body.includes('data-picker'), 'the game picker is for members');
  });
});

describe('member dashboard', () => {
  it('starts a new member with first steps instead of a top pick', async () => {
    const { body } = await nada.get('/');
    assert.ok(body.includes('Welcome back, Nada'));
    assert.ok(body.includes('Teach Checkpoint your taste'));
    assert.ok(!body.includes('Your #1 pick today'));
    assert.ok(!body.includes('class="is-done"'), 'no step is done yet');
    assert.ok(body.includes('Nothing in progress yet'));
  });

  it('lets a new member spin the picker over the top picks', async () => {
    const { body } = await nada.get('/');
    assert.ok(body.includes('data-picker-open'));
    assert.ok(body.includes('from your top picks'));
    assert.equal(pickerCandidates(body).length, 8);
  });

  it('shows the #1 pick and puts games being played first in "Continue playing"', async () => {
    await nada.post('/library/elden-ring/add', { status: 'want_to_play', returnTo: '/' });
    await nada.post('/library/subnautica/add', { status: 'want_to_play', returnTo: '/' });
    await nada.post('/library/stardew-valley/add', { status: 'playing', returnTo: '/' });
    await nada.post('/library/it-takes-two/add', { status: 'completed', returnTo: '/' });

    const { body } = await nada.get('/');
    assert.ok(!body.includes('Teach Checkpoint your taste'));
    const top = body.match(/Your #1 pick today[\s\S]*?<h2><a href="\/games\/([a-z0-9-]+)"/);
    assert.ok(top, 'the top pick is shown');
    assert.ok(!['elden-ring', 'subnautica', 'stardew-valley', 'it-takes-two'].includes(top[1]), 'it is a game she has not saved');

    const queue = [...section(body, 'Continue playing', '</section>').matchAll(/class="queue-title" href="\/games\/([a-z0-9-]+)"/g)].map((match) => match[1]);
    assert.equal(queue[0], 'stardew-valley', 'Playing comes first');
    assert.deepEqual([...queue.slice(1)].sort(), ['elden-ring', 'subnautica'], 'then Want to Play; completed games stay out');
  });

  it('spins the picker over the wishlist once it has two games', async () => {
    const { body } = await nada.get('/');
    assert.ok(body.includes('from your wishlist'));
    const candidates = pickerCandidates(body);
    assert.deepEqual(candidates.map((candidate) => candidate.slug).sort(), ['elden-ring', 'subnautica']);
    assert.ok(candidates.every((candidate) => candidate.weight >= 1), 'every game has a chance');
  });

  it('uses the same picker on the library page, which never offers a finished game', async () => {
    const rami = await app.client().signUp('Rami Picker', 'rami@checkpoint.test');
    await rami.post('/library/elden-ring/add', { status: 'completed', returnTo: '/library' });
    await rami.post('/library/subnautica/add', { status: 'want_to_play', returnTo: '/library' });

    const library = (await rami.get('/library')).body;
    assert.ok(library.includes('from your top picks'), 'one game on the wishlist is not enough to spin');
    const candidates = pickerCandidates(library);
    assert.equal(candidates.length, 8);
    assert.deepEqual(candidates, pickerCandidates((await rami.get('/')).body), 'the same games as on the dashboard');
    assert.ok(!candidates.some((candidate) => ['elden-ring', 'subnautica'].includes(candidate.slug)), 'only games not in the library');

    await rami.post('/library/stardew-valley/add', { status: 'want_to_play', returnTo: '/library' });
    const wishlist = (await rami.get('/library')).body;
    assert.ok(wishlist.includes('from your wishlist'));
    assert.deepEqual(pickerCandidates(wishlist).map((candidate) => candidate.slug).sort(), ['stardew-valley', 'subnautica']);
  });

  it('counts the library and shows the level', async () => {
    const { body } = await nada.get('/');
    const numbers = section(body, 'class="dash-stat-row"', '</dl>');
    assert.match(numbers, /<dt>Tracked<\/dt><dd data-count-up="4">/);
    assert.match(numbers, /<dt>Completed<\/dt><dd data-count-up="1">/);
    assert.match(body, /class="level-badge">Lv \d+</);
  });
});
