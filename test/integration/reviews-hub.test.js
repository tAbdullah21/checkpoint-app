// 3.8 features through HTTP: review details (aspect scores, hours, platform, spoilers), the reviews hub with the
// top reviewers, and the game assistant (/ask and /api/ask).
const assert = require('node:assert/strict');
const { after, before, describe, it } = require('node:test');
const { startApp, useTemporaryDatabase } = require('../helpers');

useTemporaryDatabase('reviews-hub');

let app;
let rana;
let sami;
let hidden;

before(async () => {
  app = await startApp();
  rana = await app.client().signUp('Rana Critic', 'rana@checkpoint.test');
  sami = await app.client().signUp('Sami Reader', 'sami@checkpoint.test');
  hidden = await app.client().signUp('Hidden Member', 'hidden@checkpoint.test');
  const { db } = require('../../database/database');
  db.prepare('UPDATE users SET profile_public = 0 WHERE email = ?').run('hidden@checkpoint.test');
});

after(() => app.close());

const details = {
  aspect_gameplay: '5', aspect_story: '4', aspect_visuals: '', aspect_audio: '3', aspect_value: '5',
  hours: '42', platform: 'playstation', spoiler: 'on',
};

describe('review details', () => {
  it('saves aspect scores, hours, platform and a spoiler warning with the review', async () => {
    const response = await rana.post('/games/elden-ring/review', { rating: '5', reviewText: 'The ending twist is wild.', ...details });
    assert.equal(response.location, '/games/elden-ring#reviews');
    const { body } = await sami.get('/games/elden-ring');
    assert.ok(body.includes('Spoiler warning: show the review'), 'the text sits behind a spoiler warning');
    assert.match(body, /<details class="spoiler-review">[\s\S]*The ending twist is wild\./);
    assert.ok(body.includes('42 hours played'));
    assert.ok(body.includes('PlayStation</span>'));
    assert.match(body, /aria-label="5 out of 5"/);
    assert.ok(body.includes('Player breakdown'), 'the game shows the per-aspect breakdown');
    assert.match(body, /Gameplay<\/span>[\s\S]*?<b>5\.0<\/b>/);
  });

  it('pre-fills the form when the member edits the review', async () => {
    const { body } = await rana.get('/games/elden-ring');
    assert.match(body, /id="aspect-story-4" type="radio" name="aspect_story" value="4" checked/);
    assert.match(body, /id="review-hours"[^>]*value="42"/);
    assert.match(body, /<option value="playstation" selected>/);
    assert.match(body, /name="spoiler" value="on" checked/);
  });

  it('refuses a tampered aspect score and changes nothing', async () => {
    const response = await rana.post('/games/elden-ring/review', { rating: '1', reviewText: 'Changed my mind.', aspect_story: '9' });
    const { body } = await rana.get(response.location.replace(/#.*$/, ''));
    assert.ok(body.includes('Story must be scored from 0.5 to 5 in half-star steps.'));
    assert.ok(!body.includes('Changed my mind.'));
  });

  it('clears the details when the member removes them', async () => {
    await rana.post('/games/elden-ring/review', { rating: '5', reviewText: 'The ending twist is wild.' });
    const { body } = await sami.get('/games/elden-ring');
    assert.ok(!body.includes('Spoiler warning: show the review'));
    assert.ok(!body.includes('42 hours played'));
  });

  it('deletes the details with the review', async () => {
    await sami.post('/games/hades/review', { rating: '4', reviewText: 'Fast and fun.', hours: '12' });
    await sami.post('/games/hades/review/delete');
    const { db } = require('../../database/database');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM review_details d LEFT JOIN reviews r ON r.id = d.review_id WHERE r.id IS NULL').get().count, 0);
  });
});

describe('the reviews hub', () => {
  before(async () => {
    await sami.post('/games/subnautica/review', { rating: '3', reviewText: 'Scary depths, slow middle.', spoiler: 'on' });
    await hidden.post('/games/stardew-valley/review', { rating: '5', reviewText: 'Cosy forever.' });
    await sami.post(`/reviews/${await reviewId('elden-ring')}/like`);
  });

  async function reviewId(slug) {
    const { db } = require('../../database/database');
    return db.prepare('SELECT r.id FROM reviews r JOIN games g ON g.id = r.game_id WHERE g.slug = ? ORDER BY r.id LIMIT 1').get(slug).id;
  }

  it('lists every review with its game, author and details', async () => {
    const { status, body } = await app.client().get('/reviews');
    assert.equal(status, 200);
    assert.ok(body.includes('What players are saying'));
    assert.ok(body.includes('The ending twist is wild.'));
    assert.ok(body.includes('Scary depths, slow middle.'));
    assert.ok(body.includes('Cosy forever.'));
    assert.ok(body.includes('Private member'), 'a private member keeps their review but not their name');
    assert.ok(!body.includes('Hidden Member'));
  });

  it('filters by stars and can hide spoilers', async () => {
    let { body } = await app.client().get('/reviews?stars=3');
    assert.ok(body.includes('Scary depths, slow middle.'));
    assert.ok(!body.includes('Cosy forever.'));
    ({ body } = await app.client().get('/reviews?spoilers=hide'));
    assert.ok(!body.includes('Scary depths, slow middle.'));
    assert.ok(body.includes('Cosy forever.'));
  });

  it('sorts by helpful votes and ignores unknown sorts and filters', async () => {
    const { body } = await app.client().get('/reviews?sort=helpful');
    assert.ok(body.indexOf('The ending twist is wild.') < body.indexOf('Cosy forever.'));
    const odd = await app.client().get('/reviews?sort=drop&stars=9&page=-3');
    assert.equal(odd.status, 200);
    assert.ok(odd.body.includes('<option value="newest" selected>'));
  });

  it('ranks top reviewers by helpful votes and keeps private members off the board', async () => {
    const { body } = await app.client().get('/reviews');
    const board = body.slice(body.indexOf('Top reviewers'));
    assert.ok(board.indexOf('Rana Critic') < board.indexOf('Sami Reader'));
    assert.ok(board.includes('Top critic'));
    assert.ok(!board.includes('Hidden Member') && !board.includes('Private member'));
  });
});

describe('removed Ask AI feature', () => {
  it('has no chat button or reachable assistant endpoints', async () => {
    assert.equal((await app.client().get('/ask')).status, 404);
    assert.equal((await app.client().get('/api/ask?q=rpg')).status, 404);
    assert.ok(!(await app.client().get('/games')).body.includes('data-assistant-open'));
  });
});
