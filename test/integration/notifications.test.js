// Replies under reviews and the notifications inbox, tested through HTTP.
const assert = require('node:assert/strict');
const { after, before, describe, it } = require('node:test');
const { memberIdByName, startApp, useTemporaryDatabase } = require('../helpers');

useTemporaryDatabase('notifications');

let app;
let rana;
let tariq;
let hidden;
let guest;
let ranaId;
let reviewId;

const unreadBadge = (body) => body.match(/<span class="notif-badge" aria-hidden="true">([^<]+)<\/span>/)?.[1] || null;

// The id of the reply that contains `text` on a game page (the last reply anchor before the text).
function commentIdFor(body, text) {
  const before = body.slice(0, body.indexOf(text));
  const ids = [...before.matchAll(/id="comment-(\d+)"/g)];
  if (ids.length === 0) throw new Error(`No reply contains "${text}"`);
  return Number(ids[ids.length - 1][1]);
}

before(async () => {
  app = await startApp();
  rana = await app.client().signUp('Rana Reviewer', 'rana@checkpoint.test');
  tariq = await app.client().signUp('Tariq Talker', 'tariq@checkpoint.test');
  hidden = await app.client().signUp('Huda Hidden', 'huda@checkpoint.test');
  guest = app.client();
  ranaId = await memberIdByName(guest, 'Rana');

  // Huda keeps her profile private: she should stay anonymous in other members' notifications.
  await hidden.post('/profile/edit', { name: 'Huda Hidden', bio: '', favoriteGenres: [] });

  await rana.post('/games/elden-ring/review', { rating: '5', reviewText: 'A world that keeps surprising you.' });
  const page = await guest.get('/games/elden-ring');
  reviewId = Number(page.body.match(/id="review-(\d+)"/)[1]);
});

after(() => app.close());

describe('replies under reviews', () => {
  it('asks guests to log in instead of showing the reply form', async () => {
    const page = await guest.get('/games/elden-ring');
    assert.ok(!page.body.includes('reply-composer'));
    const response = await guest.post(`/reviews/${reviewId}/comments`, { body: 'Hello' });
    assert.equal(response.status, 302);
    assert.equal(response.location, '/login');
  });

  it('posts a reply and links straight to it', async () => {
    const response = await tariq.post(`/reviews/${reviewId}/comments`, { body: '  Which boss   took you longest?  ' });
    assert.equal(response.status, 302);
    assert.match(response.location, new RegExp(`^/games/elden-ring#comment-\\d+$`));
    const page = await guest.get('/games/elden-ring');
    assert.ok(page.body.includes('Which boss took you longest?'), 'spaces are tidied');
    assert.ok(page.body.includes('1 reply to Rana Reviewer'));
  });

  it('refuses empty and over-long replies', async () => {
    for (const body of ['   ', 'x'.repeat(301)]) {
      const response = await tariq.post(`/reviews/${reviewId}/comments`, { body });
      assert.equal(response.status, 302);
      assert.equal(response.location, `/games/elden-ring#review-${reviewId}`);
      const page = await tariq.get('/games/elden-ring');
      assert.ok(page.body.includes('A reply must be between 1 and 300 characters.'));
    }
  });

  it('counts an emoji as one character, like the database does', async () => {
    const response = await tariq.post(`/reviews/${reviewId}/comments`, { body: '🔥'.repeat(300) });
    assert.match(response.location, /#comment-\d+$/);
    const page = await guest.get('/games/elden-ring');
    assert.ok(page.body.includes('🔥'.repeat(300)));
  });

  it('tags the review author when they answer', async () => {
    await rana.post(`/reviews/${reviewId}/comments`, { body: 'Malenia, easily.' });
    const page = await guest.get('/games/elden-ring');
    assert.match(page.body, /Rana Reviewer<\/strong><\/a>\s*<span class="reply-tag">Reviewer<\/span>/);
  });

  it('answers 404 for a review that does not exist', async () => {
    assert.equal((await tariq.post('/reviews/99999/comments', { body: 'Hi' })).status, 404);
  });

  it('lets the reply author and the review author delete a reply, and nobody else', async () => {
    await tariq.post(`/reviews/${reviewId}/comments`, { body: 'Delete me later' });
    let page = await guest.get('/games/elden-ring');
    const commentId = commentIdFor(page.body, 'Delete me later');

    const stranger = await app.client().signUp('Sara Stranger', 'sara@checkpoint.test');
    const refused = await stranger.post(`/comments/${commentId}/delete`);
    assert.equal(refused.status, 403);

    const removed = await rana.post(`/comments/${commentId}/delete`);
    assert.equal(removed.status, 302);
    page = await guest.get('/games/elden-ring');
    assert.ok(!page.body.includes('Delete me later'));
    assert.equal((await tariq.post(`/comments/${commentId}/delete`)).status, 404);
  });
});

describe('notifications', () => {
  it('needs an account', async () => {
    const response = await guest.get('/notifications');
    assert.equal(response.status, 302);
    assert.equal(response.location, '/login');
  });

  it('tells the review author about replies, with the reply text', async () => {
    const home = await rana.get('/');
    assert.ok(Number(unreadBadge(home.body)) >= 2, 'the bell shows the unread count');
    const inbox = await rana.get('/notifications');
    assert.equal(inbox.status, 200);
    assert.ok(inbox.body.includes('replied to your review of'));
    assert.ok(inbox.body.includes('Which boss took you longest?'));
    assert.ok(inbox.body.includes(`href="/games/elden-ring#review-${reviewId}"`));
    assert.match(inbox.body, /new notifications? since your last visit/);
  });

  it('marks everything as read once the inbox is opened', async () => {
    const home = await rana.get('/');
    assert.equal(unreadBadge(home.body), null);
    const inbox = await rana.get('/notifications');
    assert.ok(inbox.body.includes('You are all caught up.'));
    assert.ok(!inbox.body.includes('notif-new'));
  });

  it('does not notify members about their own actions', async () => {
    const inbox = await rana.get('/notifications');
    assert.ok(!/notif-actor"[^>]*>Rana Reviewer/.test(inbox.body), 'Rana answering her own review is not news to her');
  });

  it('notifies about a follow and takes it back after an unfollow', async () => {
    await tariq.post(`/members/${ranaId}/follow`);
    let inbox = await rana.get('/notifications');
    assert.match(inbox.body, /Tariq Talker<\/a>\s*started following you/);
    await tariq.post(`/members/${ranaId}/unfollow`);
    inbox = await rana.get('/notifications');
    assert.ok(!inbox.body.includes('started following you'));
  });

  it('notifies about a helpful vote and takes it back when the vote is removed', async () => {
    await tariq.post(`/reviews/${reviewId}/like`);
    let inbox = await rana.get('/notifications');
    assert.match(inbox.body, /found your review of\s*<a href="[^"]+">Elden Ring<\/a>\s*helpful/);
    await tariq.post(`/reviews/${reviewId}/like`);
    inbox = await rana.get('/notifications');
    assert.ok(!inbox.body.includes('found your review of'));
  });

  it('keeps one notification when the same action is repeated', async () => {
    await tariq.post(`/members/${ranaId}/follow`);
    await tariq.post(`/members/${ranaId}/unfollow`);
    await tariq.post(`/members/${ranaId}/follow`);
    const inbox = await rana.get('/notifications');
    assert.equal(inbox.body.match(/started following you/g).length, 1);
  });

  it('keeps members with a private profile anonymous', async () => {
    await hidden.post(`/members/${ranaId}/follow`);
    const inbox = await rana.get('/notifications');
    assert.ok(inbox.body.includes('A private member'));
    assert.ok(!inbox.body.includes('Huda Hidden'));
  });

  it('removes notifications about a reply when the reply is deleted', async () => {
    await tariq.post(`/reviews/${reviewId}/comments`, { body: 'Short-lived reply' });
    let inbox = await rana.get('/notifications');
    assert.ok(inbox.body.includes('Short-lived reply'));
    const page = await guest.get('/games/elden-ring');
    const commentId = commentIdFor(page.body, 'Short-lived reply');
    await tariq.post(`/comments/${commentId}/delete`);
    inbox = await rana.get('/notifications');
    assert.ok(!inbox.body.includes('Short-lived reply'));
  });

  it('shows an empty inbox with suggestions', async () => {
    const inbox = await tariq.get('/notifications');
    assert.ok(inbox.body.includes('No notifications yet'));
  });
});
