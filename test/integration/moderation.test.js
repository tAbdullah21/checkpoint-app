// Reports and moderation (FR-28, FR-29): members report reviews and replies, moderators remove or keep them,
// every decision is logged, and the right people are told. Tested through HTTP.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { after, before, describe, it } = require('node:test');
const { memberIdByName, startApp, useTemporaryDatabase } = require('../helpers');

useTemporaryDatabase('moderation');

let app;
let db;
let moderation;
let moderator;
let author;
let reporter;
let secondReporter;
let guest;
let reviewId;
let replyId;

const reviewOf = (slug, client = guest) => client.get(`/games/${slug}`).then((page) => page.body);
const notice = async (client) => (await client.get('/library')).body.match(/<div class="toast[^"]*" data-toast>[\s\S]*?<p>([^<]+)<\/p>/)?.[1] || null;
const inboxText = async (client) => (await client.get('/notifications')).body.replace(/\s+/g, ' ');

function runAdmin(...args) {
  return spawnSync(process.execPath, ['scripts/admin.js', ...args], {
    cwd: path.join(__dirname, '..', '..'),
    env: { ...process.env },
    encoding: 'utf8',
  });
}

before(async () => {
  app = await startApp();
  ({ db } = require('../../database/database'));
  moderation = require('../../database/moderation');
  moderator = await app.client().signUp('Maha Moderator', 'maha@checkpoint.test');
  author = await app.client().signUp('Turki Seller', 'turki@checkpoint.test');
  reporter = await app.client().signUp('Lina Reporter', 'lina@checkpoint.test');
  secondReporter = await app.client().signUp('Omar Reporter', 'omar@checkpoint.test');
  guest = app.client();
  moderation.setRoleByEmail('maha@checkpoint.test', 'admin');

  await author.post('/games/subnautica/review', { rating: '5', reviewText: 'Cheap game keys at my store, message me for the link!' });
  reviewId = Number((await reviewOf('subnautica')).match(/id="review-(\d+)"/)[1]);
  await reporter.post('/games/elden-ring/review', { rating: '5', reviewText: 'Every corner hides something.' });
  const linaReview = Number((await reviewOf('elden-ring')).match(/id="review-(\d+)"/)[1]);
  await author.post(`/reviews/${linaReview}/comments`, { body: 'Anyone selling a used console?' });
  replyId = Number((await reviewOf('elden-ring')).match(/id="comment-(\d+)"/)[1]);
});

after(() => app.close());

describe('reporting a post', () => {
  it('asks guests to log in and shows members a report form on other people\'s posts only', async () => {
    assert.equal((await guest.post(`/reviews/${reviewId}/report`, { reason: 'spam' })).location, '/login');
    assert.ok(!(await reviewOf('subnautica')).includes('report-menu'), 'guests see no report form');
    assert.ok((await reviewOf('subnautica', reporter)).includes(`action="/reviews/${reviewId}/report"`));
    assert.ok(!(await reviewOf('subnautica', author)).includes(`action="/reviews/${reviewId}/report"`), 'not on your own review');
  });

  it('needs one of the listed reasons and a short note', async () => {
    await reporter.post(`/reviews/${reviewId}/report`, { reason: 'boring' });
    assert.equal(await notice(reporter), 'Choose why you are reporting this.');
    await reporter.post(`/reviews/${reviewId}/report`, { reason: 'spam', note: 'x'.repeat(201) });
    assert.equal(await notice(reporter), 'The note can be at most 200 characters.');
    assert.equal(moderation.countOpenReports(), 0);
  });

  it('does not let members report their own posts', async () => {
    const response = await author.post(`/reviews/${reviewId}/report`, { reason: 'spam' });
    assert.equal(response.location, `/games/subnautica#review-${reviewId}`);
    assert.equal(await notice(author), 'You cannot report your own review.');
  });

  it('takes one report per member and post', async () => {
    const response = await reporter.post(`/reviews/${reviewId}/report`, { reason: 'spam', note: '  Same advert   everywhere. ' });
    assert.equal(response.location, `/games/subnautica#review-${reviewId}`);
    assert.match(await notice(reporter), /^Thanks for the report\./);
    await reporter.post(`/reviews/${reviewId}/report`, { reason: 'abuse' });
    assert.equal(await notice(reporter), 'You already reported this review.');
    await secondReporter.post(`/reviews/${reviewId}/report`, { reason: 'off_topic' });
    await reporter.post(`/comments/${replyId}/report`, { reason: 'off_topic' });
    assert.equal(moderation.countOpenReports(), 2, 'two posts are waiting');
    const page = await reviewOf('subnautica', reporter);
    assert.ok(page.includes('class="report-done"'), 'the reporter sees "Reported"');
    assert.equal(db.prepare("SELECT note FROM reports WHERE note <> ''").get().note, 'Same advert everywhere.', 'spaces are tidied');
  });

  it('answers 404 for posts that do not exist', async () => {
    assert.equal((await reporter.post('/reviews/99999/report', { reason: 'spam' })).status, 404);
    assert.equal((await reporter.post('/comments/99999/report', { reason: 'spam' })).status, 404);
  });
});

describe('the moderation queue', () => {
  it('is only for moderators', async () => {
    assert.equal((await guest.get('/moderation')).location, '/login');
    const member = await reporter.get('/moderation');
    assert.equal(member.status, 403);
    assert.ok(member.body.includes('Only moderators can open this page.'));
    assert.equal((await reporter.get('/moderation/log')).status, 403);
    assert.equal((await reporter.post(`/moderation/review/${reviewId}/remove`, { reason: 'spam' })).status, 403);
    assert.ok(!(await reporter.get('/library')).body.includes('href="/moderation"'), 'members have no Moderation link');
  });

  it('lists the reported posts with every reason, most reported first', async () => {
    const page = await moderator.get('/moderation');
    assert.equal(page.status, 200);
    assert.ok(page.body.includes('2 reported posts waiting for a decision'));
    assert.ok(page.body.indexOf(`id="review-${reviewId}"`) < page.body.indexOf(`id="reply-${replyId}"`), 'two reports before one');
    assert.ok(page.body.includes('Spam or advertising') && page.body.includes('Not about the game'));
    assert.ok(page.body.includes('<q>Same advert everywhere.</q>'));
    assert.match(page.body, /href="\/moderation"><svg[^>]*><use href="#i-flag"><\/use><\/svg>Moderation<span class="visually-hidden">, 2 waiting<\/span>/);
  });

  it('removes a review, logs it and tells the author and the reporters, without naming the moderator', async () => {
    const response = await moderator.post(`/moderation/review/${reviewId}/remove`, { reason: 'spam' });
    assert.equal(response.location, '/moderation');
    assert.equal(await notice(moderator), 'The review was removed. The author and 2 reporters were told.');
    assert.ok(!(await reviewOf('subnautica')).includes('Cheap game keys'), 'the review is gone');

    const authorInbox = await inboxText(author);
    assert.ok(authorInbox.includes('A moderator removed your review of <a href="/games/subnautica#reviews">Subnautica</a>'));
    assert.ok(authorInbox.includes('Reason: Spam or advertising.'));
    assert.ok(!authorInbox.includes('Maha'), 'moderators stay anonymous');
    for (const client of [reporter, secondReporter]) {
      assert.ok((await inboxText(client)).includes('The review you reported on <a href="/games/subnautica#reviews">Subnautica</a> was removed.'));
    }

    const log = await moderator.get('/moderation/log');
    assert.ok(log.body.includes('<strong>Removed a review</strong>'));
    assert.ok(log.body.includes('Cheap game keys at my store, message me for the link!'), 'the log keeps a copy');
    assert.ok(log.body.includes('2 reports'));
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM activities WHERE type = 'review' AND detail = '5' AND user_id = (SELECT id FROM users WHERE email = 'turki@checkpoint.test')").get().count, 0, 'the feed entry goes too');
  });

  it('needs the rule a post breaks before removing it', async () => {
    await moderator.post(`/moderation/reply/${replyId}/remove`, { reason: '' });
    assert.equal(await notice(moderator), 'Choose the rule the post breaks before removing it.');
    assert.ok((await reviewOf('elden-ring')).includes('Anyone selling a used console?'));
  });

  it('keeps a reply and tells only the reporter', async () => {
    await moderator.post(`/moderation/reply/${replyId}/keep`);
    assert.equal(await notice(moderator), 'The reply stays up. 1 reporter was told.');
    assert.ok((await reviewOf('elden-ring')).includes('Anyone selling a used console?'));
    assert.ok((await inboxText(reporter)).includes('The reply you reported on <a href="/games/elden-ring#reviews">Elden Ring</a> was checked by a moderator and stays up.'));
    assert.ok(!(await inboxText(author)).includes('stays up'), 'the author never learns about the report');

    await reporter.post(`/comments/${replyId}/report`, { reason: 'spam' });
    assert.equal(await notice(reporter), 'You already reported this reply.');
    await secondReporter.post(`/comments/${replyId}/report`, { reason: 'spam' });
    assert.ok((await moderator.get('/moderation')).body.includes('A moderator kept this reply after earlier reports.'));
  });

  it('says so when another moderator already decided', async () => {
    await moderator.post(`/moderation/reply/${replyId}/keep`);
    await moderator.post(`/moderation/reply/${replyId}/keep`);
    assert.equal(await notice(moderator), 'Another moderator already decided on these reports.');
    assert.equal((await moderator.post('/moderation/review/99999/keep')).status, 404);
    assert.equal((await moderator.post(`/moderation/post/${replyId}/keep`)).status, 404, 'only reviews and replies');
  });

  it('leaves a moderator\'s own posts to another moderator', async () => {
    await moderator.post('/games/stardew-valley/review', { rating: '4', reviewText: 'Calm and kind.' });
    const ownId = Number((await reviewOf('stardew-valley')).match(/id="review-(\d+)"/)[1]);
    await reporter.post(`/reviews/${ownId}/report`, { reason: 'off_topic' });
    const queue = await moderator.get('/moderation');
    assert.ok(queue.body.includes('This is your own review, so another moderator has to decide.'));
    assert.ok(!queue.body.includes(`action="/moderation/review/${ownId}/remove"`));
    assert.equal((await moderator.post(`/moderation/review/${ownId}/remove`, { reason: 'spam' })).status, 403);
  });

  it('reads the role on every request, so taking it away works at once', async () => {
    moderation.setRoleByEmail('maha@checkpoint.test', 'member');
    assert.equal((await moderator.get('/moderation')).status, 403);
    moderation.setRoleByEmail('maha@checkpoint.test', 'admin');
    assert.equal((await moderator.get('/moderation')).status, 200);
  });

  it('forgets the words of an author who deletes their account, but keeps the decision', async () => {
    await author.post('/account/delete', { password: 'Checkpoint123', confirm: 'on' });
    const log = await moderator.get('/moderation/log');
    assert.ok(log.body.includes('The copy of the post was deleted with the author\'s account.'));
    assert.ok(log.body.includes('A deleted account'));
    assert.ok(!log.body.includes('Cheap game keys'));
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM moderation_log WHERE content <> ''").get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM moderation_log').get().count, 3, 'removed, kept and kept again');
  });
});

describe('npm run admin', () => {
  it('grants, lists and revokes the moderator role', async () => {
    const memberId = await memberIdByName(guest, 'Omar Reporter');
    const grant = runAdmin('grant', 'OMAR@checkpoint.test');
    assert.equal(grant.status, 0, grant.stderr);
    assert.match(grant.stdout, /Omar Reporter is now a moderator/);
    assert.equal(db.prepare('SELECT role FROM users WHERE id = ?').get(memberId).role, 'admin');
    assert.match(runAdmin('list').stdout, /Maha Moderator <maha@checkpoint\.test>\nOmar Reporter <omar@checkpoint\.test>/);
    assert.match(runAdmin('revoke', 'omar@checkpoint.test').stdout, /Omar Reporter is no longer a moderator/);
    assert.equal(db.prepare('SELECT role FROM users WHERE id = ?').get(memberId).role, 'member');
  });

  it('fails with a message for unknown addresses and commands', () => {
    const unknown = runAdmin('grant', 'nobody@checkpoint.test');
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /No account uses nobody@checkpoint\.test/);
    const usage = runAdmin('promote');
    assert.equal(usage.status, 1);
    assert.match(usage.stderr, /Usage: npm run admin -- grant <email> \| revoke <email> \| list/);
  });
});
