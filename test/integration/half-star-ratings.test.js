const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { after, before, describe, it } = require('node:test');
const { startApp, useTemporaryDatabase } = require('../helpers');

const file = useTemporaryDatabase('half-star-ratings');
let app;
let member;
let db;

before(async () => {
  // An actual old INTEGER schema, with dependent rows that a careless DROP would cascade away.
  const old = new DatabaseSync(file, { enableForeignKeyConstraints: true });
  old.exec(fs.readFileSync(path.join(__dirname, '../fixtures/checkpoint-2.3-schema.sql'), 'utf8'));
  old.exec(`
    INSERT INTO users(id,name,email,password_hash) VALUES(1,'Original Member','original@checkpoint.test','hash'),(2,'Other Member','other@checkpoint.test','hash');
    INSERT INTO games(id,slug,title,release_year,genre,rating,image) VALUES(1,'elden-ring','Elden Ring',2022,'RPG',4.8,'/images/covers/elden-ring.jpg');
    INSERT INTO reviews(id,user_id,game_id,rating,review_text) VALUES(7,1,1,4,'Keep this original review.');
    INSERT INTO review_likes(user_id,review_id) VALUES(2,7);
    INSERT INTO review_comments(id,review_id,user_id,body) VALUES(9,7,2,'Keep this reply.');
    CREATE TABLE review_details (
      review_id INTEGER PRIMARY KEY, spoiler INTEGER NOT NULL DEFAULT 0 CHECK(spoiler IN (0,1)),
      hours INTEGER CHECK(hours IS NULL OR hours BETWEEN 0 AND 9999), platform TEXT NOT NULL DEFAULT '',
      gameplay INTEGER CHECK(gameplay IS NULL OR gameplay BETWEEN 1 AND 5),
      story INTEGER CHECK(story IS NULL OR story BETWEEN 1 AND 5),
      visuals INTEGER CHECK(visuals IS NULL OR visuals BETWEEN 1 AND 5),
      audio INTEGER CHECK(audio IS NULL OR audio BETWEEN 1 AND 5),
      value INTEGER CHECK(value IS NULL OR value BETWEEN 1 AND 5),
      FOREIGN KEY(review_id) REFERENCES reviews(id) ON DELETE CASCADE
    ) STRICT;
    INSERT INTO review_details(review_id,gameplay,hours) VALUES(7,4,42);
  `);
  old.close();
  app = await startApp();
  db = require('../../database/database').db;
  member = await app.client().signUp('Half Star Tester', 'half@checkpoint.test');
});
after(() => app.close());

const myRating = () => db.prepare("SELECT r.* FROM reviews r JOIN users u ON u.id=r.user_id WHERE u.email='half@checkpoint.test'").get();

describe('half-star ratings and optional review text', () => {
  it('migrates old scores without deleting dependent data and runs only once', () => {
    assert.equal(db.prepare('SELECT review_text FROM reviews WHERE id=7').get().review_text, 'Keep this original review.');
    assert.equal(db.prepare('SELECT count(*) AS n FROM review_likes WHERE review_id=7').get().n, 1);
    assert.equal(db.prepare('SELECT body FROM review_comments WHERE id=9').get().body, 'Keep this reply.');
    assert.equal(db.prepare('SELECT gameplay FROM review_details WHERE review_id=7').get().gameplay, 4);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.equal(require('../../database/database').upgradeRatingTable('reviews', (sql) => sql), false);
  });

  it('saves all ten choices without review text, including omitted and whitespace-only fields', async () => {
    for (const rating of [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]) {
      const response = await member.post('/games/elden-ring/review', { rating: String(rating) });
      assert.equal(response.location, '/games/elden-ring#reviews');
      assert.equal(myRating().rating, rating);
      assert.equal(myRating().review_text, '');
    }
    await member.post('/games/elden-ring/review', { rating: '3.5', reviewText: '   \n ' });
    assert.equal(myRating().review_text, '');
    assert.equal(db.prepare("SELECT count(*) AS n FROM reviews WHERE user_id=?").get(myRating().user_id).n, 1);
  });

  it('keeps written reviews optional and permits adding and removing text later', async () => {
    await member.post('/games/elden-ring/review', { rating: '4.5', reviewText: 'A thoughtful half-star review.', aspect_story: '3.5' });
    assert.equal(myRating().review_text, 'A thoughtful half-star review.');
    assert.equal(db.prepare('SELECT story FROM review_details WHERE review_id=?').get(myRating().id).story, 3.5);
    await member.post('/games/elden-ring/review', { rating: '0.5', reviewText: '' });
    assert.equal(myRating().rating, 0.5);
    assert.equal(myRating().review_text, '');
    const page = (await member.get('/games/elden-ring')).body;
    assert.ok(page.includes('Rated without a written review.'));
    assert.ok(page.includes('value="0.5"'));
    assert.ok(page.includes('value="4.5"'));
    assert.ok(!/textarea[^>]*name="reviewText"[^>]*\brequired\b/.test(page));
  });

  it('refuses off-step values at both the route and database without changing saved data', async () => {
    for (const rating of ['0', '-0.5', '0.25', '3.7', '5.5', 'NaN', 'Infinity', '4 stars', '']) {
      await member.post('/games/elden-ring/review', { rating, reviewText: '' });
      assert.equal(myRating().rating, 0.5);
    }
    assert.throws(() => db.prepare('UPDATE reviews SET rating=3.7 WHERE id=?').run(myRating().id), /CHECK/);
    assert.throws(() => db.prepare('UPDATE review_details SET story=3.7 WHERE review_id=7').run(), /CHECK/);
  });

  it('counts rating-only entries in scores and half-star filters and histograms', async () => {
    const page = await member.get('/reviews?stars=0.5');
    assert.ok(page.body.includes('Rated without a written review.'));
    const { gameInsights } = require('../../database/community');
    const insights = gameInsights(1);
    assert.equal(insights.ratings.find((row) => row.stars === 0.5).count, 1);
    assert.equal(insights.ratings.reduce((sum, row) => sum + row.count, 0), insights.ratingTotal);
  });
});
