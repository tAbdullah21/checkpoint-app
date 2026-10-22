// Star ratings and reviews through HTTP: the rules for writing one, editing, deleting, the member average
// and the order reviews are listed in.
const assert = require('node:assert/strict');
const { after, before, describe, it } = require('node:test');
const { startApp, useTemporaryDatabase } = require('../helpers');

useTemporaryDatabase('reviews');

let app;
let rami;
let dana;
let omar;

before(async () => {
  app = await startApp();
  rami = await app.client().signUp('Rami Reviewer', 'rami@checkpoint.test');
  dana = await app.client().signUp('Dana Critic', 'dana@checkpoint.test');
  omar = await app.client().signUp('Omar Reader', 'omar@checkpoint.test');
});

after(() => app.close());

// Posts a review and returns the page the member is sent back to, where the notice is shown.
async function review(client, slug, rating, reviewText) {
  const response = await client.post(`/games/${slug}/review`, { rating: String(rating), reviewText });
  assert.equal(response.status, 302);
  const page = await client.get(response.location.replace(/#.*$/, ''));
  return { location: response.location, body: page.body };
}

describe('writing a review', () => {
  it('asks guests to log in first and saves nothing', async () => {
    const response = await app.client().post('/games/subnautica/review', { rating: '5', reviewText: 'Guest review.' });
    assert.equal(response.status, 302);
    assert.equal(response.location, '/login');
    assert.ok(!(await app.client().get('/games/subnautica')).body.includes('Guest review.'));
  });

  it('publishes a review with a star rating and returns to the reviews', async () => {
    const { location, body } = await review(rami, 'subnautica', 5, 'The deep sea is terrifying and beautiful.');
    assert.equal(location, '/games/subnautica#reviews');
    assert.ok(body.includes('Your review of Subnautica was published.'));
    assert.ok(body.includes('The deep sea is terrifying and beautiful.'));
  });

  it('rejects ratings outside the half-star scale', async () => {
    for (const rating of ['0', '6', 'five', '']) {
      const { body } = await review(dana, 'subnautica', rating, 'Rating outside the scale.');
      assert.ok(body.includes('Choose a rating from 0.5 to 5 stars in half-star steps.'), `rating "${rating}"`);
      assert.ok(!body.includes('Rating outside the scale.'));
    }
  });

  it('needs 3 to 800 characters, counting an emoji as one', async () => {
    let { body } = await review(dana, 'subnautica', 4, 'ok');
    assert.ok(body.includes('Leave the review blank, or write between 3 and 800 characters.'));
    ({ body } = await review(dana, 'subnautica', 4, 'x'.repeat(801)));
    assert.ok(body.includes('Leave the review blank, or write between 3 and 800 characters.'));
    ({ body } = await review(dana, 'subnautica', 4, '🐠'.repeat(800)));
    assert.ok(body.includes('Your review of Subnautica was published.'), '800 emoji are 800 characters');
  });
});

describe('editing and deleting', () => {
  it('keeps one review per member and game: posting again updates it', async () => {
    const { body } = await review(rami, 'subnautica', 4, 'Second dive: still great, a bit long at the end.');
    assert.ok(body.includes('Your review of Subnautica was updated.'));
    assert.ok(body.includes('Second dive: still great'));
    assert.ok(!body.includes('The deep sea is terrifying and beautiful.'), 'the old text is replaced');
    assert.ok(body.includes('2 member ratings'), 'Rami still counts once');
  });

  it('replaces the catalogue score with the member average', async () => {
    const page = await app.client().get('/games/subnautica');
    assert.match(page.body, /4\.0[\s\S]{0,400}2 member ratings/, 'Rami 4★ and Dana 4★');
  });

  it('lists the most helpful reviews first', async () => {
    // Without votes the newest review is first; which one that is depends on the clock, so vote for the last one.
    const reviewIds = (body) => [...body.matchAll(/id="review-(\d+)"/g)].map((match) => match[1]);
    const before = reviewIds((await omar.get('/games/subnautica')).body);
    assert.equal(before.length, 2);
    await omar.post(`/reviews/${before[1]}/like`);
    const after = reviewIds((await app.client().get('/games/subnautica')).body);
    assert.deepEqual(after, [before[1], before[0]], 'the review with a helpful vote moves to the top');
  });

  it('lets the author delete their review, which removes it from the average', async () => {
    let response = await dana.post('/games/subnautica/review/delete');
    assert.equal(response.location, '/games/subnautica#reviews');
    let page = await dana.get('/games/subnautica');
    assert.ok(page.body.includes('Your review of Subnautica was deleted.'));
    assert.ok(!page.body.includes('🐠🐠🐠'));
    assert.ok(page.body.includes('1 member rating'));

    response = await dana.post('/games/subnautica/review/delete');
    assert.equal(response.location, '/games/subnautica#reviews', 'deleting again is not an error');
    page = await dana.get('/games/subnautica');
    assert.ok(page.body.includes('No review was found to delete.'));
  });

  it('answers 404 for a game that does not exist', async () => {
    const response = await rami.post('/games/no-such-game/review', { rating: '3', reviewText: 'Nothing to review.' });
    assert.equal(response.status, 404);
  });
});
