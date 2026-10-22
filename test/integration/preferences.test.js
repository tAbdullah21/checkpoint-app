const assert = require('node:assert/strict');
const { before, after, it } = require('node:test');
const { startApp, useTemporaryDatabase } = require('../helpers');
useTemporaryDatabase('preferences');
let app, player, other;
before(async () => {
  app = await startApp();
  player = await app.client().signUp('Preference Tester', 'preferences@checkpoint.test');
  other = await app.client().signUp('Other Tester', 'otherpreferences@checkpoint.test');
});
after(() => app.close());
it('opens first-visit setup after registration and preserves the intended destination', async () => {
  const guest = app.client();
  const response = await guest.post('/register', { name:'New Player', email:'newpref@checkpoint.test', password:'Checkpoint123', confirmPassword:'Checkpoint123', next:'/library' });
  assert.equal(response.location, '/welcome?next=%2Flibrary');
  assert.equal((await guest.get(response.location)).status, 200);
  assert.equal((await guest.post('/welcome', { action:'skip', next:'/library' })).location, '/library');
});
it('validates preferences and ratings atomically and accepts optional half-star ratings', async () => {
  let response = await player.post('/welcome', { genres:'Unknown', game0:'elden-ring', rating0:'4.5' });
  assert.equal(response.status,422);
  response = await player.post('/welcome', { genres:'RPG', platform:'steam', game0:'elden-ring', rating0:'4.5' });
  assert.equal(response.location,'/for-you');
  const page = await player.get('/for-you');
  assert.ok(page.body.includes('Because you rated Elden Ring 4.5★'));
  assert.ok(!page.body.includes('action="/for-you/elden-ring/dismiss"'));
  assert.equal((await player.post('/welcome',{ game0:'hades',rating0:'4.2' })).status,422);
  assert.equal((await player.post('/welcome',{game0:'hades',rating0:'4',game1:'hades',rating1:'5'})).status,422);
});
it('persists private dismissal, removes the pick, and lets only its owner restore it', async () => {
  const page = await player.get('/for-you');
  const slug = page.body.match(/action="\/for-you\/([^/]+)\/dismiss"/)[1];
  assert.equal((await player.post(`/for-you/${slug}/dismiss`,{})).status,302);
  assert.equal((await player.post(`/for-you/${slug}/dismiss`,{})).status,302);
  assert.ok(!(await player.get('/for-you')).body.includes(`action="/for-you/${slug}/dismiss"`));
  assert.ok((await player.get('/for-you/hidden')).body.includes(`/for-you/${slug}/restore`));
  assert.ok(!(await other.get('/for-you/hidden')).body.includes(`/for-you/${slug}/restore`));
  const exported = (await player.get('/account/export')).json();
  assert.ok(exported.dismissedRecommendations.some((game) => game.slug === slug));
  await other.post(`/for-you/${slug}/restore`,{});
  assert.ok((await player.get('/for-you/hidden')).body.includes(`/for-you/${slug}/restore`));
  await player.post(`/for-you/${slug}/restore`,{});
  assert.ok(!(await player.get('/for-you/hidden')).body.includes(`/for-you/${slug}/restore`));
  assert.equal((await app.client().post(`/for-you/${slug}/dismiss`,{})).status,302);
});
it('combines catalogue filters and retains them in navigation', async () => {
  const page = await player.get('/games?platform=steam&yearFrom=2020&yearTo=2025&minRating=4.5');
  assert.equal(page.status,200);
  assert.ok(page.body.includes('value="2020"'));
  assert.ok(page.body.includes('value="2025"'));
  assert.ok(page.body.includes('4.5+ stars'));
  const cards = [...page.body.matchAll(/<article class="game-card">([\s\S]*?)<\/article>/g)].map((match) => match[1]);
  assert.ok(cards.length > 0);
  for (const card of cards) {
    const year = Number(card.match(/<p>(\d{4}) ·/)[1]);
    const rating = Number(card.match(/title="Checkpoint rating">[\s\S]*?<\/svg>([\d.]+)/)[1]);
    assert.ok(year >= 2020 && year <= 2025);
    assert.ok(rating >= 4.5);
  }
  assert.ok(page.body.includes('yearFrom=2020&amp;yearTo=2025&amp;minRating=4.5'));
  const invalid = await player.get('/games?yearFrom=2025&yearTo=2020');
  assert.ok(invalid.body.includes('The start year must be before'));
  assert.equal((await player.get('/games?yearFrom=evil&minRating=NaN')).status,200);
});
