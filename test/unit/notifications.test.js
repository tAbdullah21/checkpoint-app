const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { badgeLabel, describeNotification } = require('../../lib/notifications');

// Noon in Riyadh on 14 October 2026; stored times are UTC.
const now = Date.parse('2026-10-14T09:00:00Z');

const row = (fields) => ({
  id: 1,
  type: 'follow',
  read_at: null,
  created_at: '2026-10-14 08:00:00',
  actor_id: 7,
  actor_name: 'Omar Al-Qahtani',
  actor_public: 1,
  game_slug: null,
  game_title: null,
  game_image: null,
  review_id: null,
  comment_body: null,
  ...fields,
});

describe('describeNotification', () => {
  it('links a follow to the follower', () => {
    const item = describeNotification(row({}), now);
    assert.equal(item.actorName, 'Omar Al-Qahtani');
    assert.equal(item.actorUrl, '/members/7');
    assert.equal(item.text, 'started following you');
    assert.equal(item.object, null);
    assert.equal(item.url, '/members/7');
    assert.equal(item.unread, true);
    assert.equal(item.time, '1 h ago');
    assert.equal(item.day, 'Today');
    assert.equal(item.datetime, '2026-10-14T08:00:00.000Z');
  });

  it('builds the helpful vote sentence around the game title', () => {
    const item = describeNotification(row({
      type: 'review_like',
      game_slug: 'elden-ring',
      game_title: 'Elden Ring',
      game_image: '/images/covers/elden-ring.jpg',
      review_id: 42,
      read_at: '2026-10-14 08:30:00',
    }), now);
    assert.equal(`${item.text} ${item.object} ${item.suffix}`, 'found your review of Elden Ring helpful');
    assert.equal(item.url, '/games/elden-ring#review-42');
    assert.equal(item.icon, 'heart');
    assert.equal(item.unread, false);
    assert.equal(item.image, '/images/covers/elden-ring.jpg');
  });

  it('quotes the reply text', () => {
    const item = describeNotification(row({
      type: 'review_comment',
      game_slug: 'elden-ring',
      game_title: 'Elden Ring',
      review_id: 42,
      comment_body: 'Which boss took you longest?',
    }), now);
    assert.equal(item.text, 'replied to your review of');
    assert.equal(item.quote, 'Which boss took you longest?');
    assert.equal(item.suffix, '');
  });

  it('keeps members with a private profile anonymous', () => {
    const follow = describeNotification(row({ actor_public: 0 }), now);
    assert.equal(follow.actorName, 'A private member');
    assert.equal(follow.actorUrl, null);
    assert.equal(follow.url, '/profile', 'no link to a hidden profile');
    const vote = describeNotification(row({ type: 'review_like', actor_public: 0, game_slug: 'subnautica', game_title: 'Subnautica', review_id: 3 }), now);
    assert.equal(vote.actorName, 'A private member');
    assert.equal(vote.url, '/games/subnautica#review-3');
  });

  it('tells an author, without naming the moderator, that their review was removed and why', () => {
    const item = describeNotification(row({
      type: 'content_removed',
      actor_id: null,
      actor_name: null,
      detail: 'review:spam',
      game_slug: 'grand-theft-auto-v',
      game_title: 'Grand Theft Auto V',
      game_image: '/images/covers/grand-theft-auto-v.jpg',
    }), now);
    assert.equal(item.actorName, null);
    assert.equal(item.actorUrl, null);
    assert.equal(`${item.text} ${item.object}`, 'A moderator removed your review of Grand Theft Auto V');
    assert.equal(item.note, 'Reason: Spam or advertising. It broke the community rules, so other members no longer see it.');
    assert.equal(item.url, '/games/grand-theft-auto-v#reviews');
    assert.equal(item.icon, 'flag');
    const reply = describeNotification(row({ type: 'content_removed', actor_id: null, detail: 'reply:spoilers', game_title: 'Elden Ring', game_slug: 'elden-ring' }), now);
    assert.equal(`${reply.text} ${reply.object}`, 'A moderator removed your reply to a review of Elden Ring');
    assert.match(reply.note, /^Reason: Unmarked spoilers\./);
  });

  it('tells a reporter what was decided', () => {
    const removed = describeNotification(row({ type: 'report_resolved', actor_id: null, detail: 'review:removed', game_title: 'Grand Theft Auto V', game_slug: 'grand-theft-auto-v' }), now);
    assert.equal(`${removed.text} ${removed.object} ${removed.suffix}`, 'The review you reported on Grand Theft Auto V was removed. Thank you for the report.');
    const kept = describeNotification(row({ type: 'report_resolved', actor_id: null, detail: 'reply:kept', game_title: 'EA Sports FC 27', game_slug: 'ea-sports-fc-27' }), now);
    assert.equal(`${kept.text} ${kept.object} ${kept.suffix}`, 'The reply you reported on EA Sports FC 27 was checked by a moderator and stays up.');
    assert.equal(kept.icon, 'shield');
  });

  it('links a security alert to the security activity, without a game', () => {
    const item = describeNotification(row({ type: 'security', actor_id: null, detail: 'locked' }), now);
    assert.equal(item.text, 'Sign-ins to your account were paused for 15 minutes after 5 wrong passwords.');
    assert.equal(item.object, null);
    assert.equal(item.url, '/account#security');
    assert.equal(item.note, 'If this was not you, check your security activity and change your password.');
    assert.equal(item.icon, 'lock');
  });

  it('still reads well when the post or its game is gone', () => {
    const item = describeNotification(row({ type: 'content_removed', actor_id: null, detail: '' }), now);
    assert.equal(item.text, 'A moderator removed your post on');
    assert.match(item.note, /^Reason: Another reason\./);
    assert.equal(item.url, '/notifications');
  });

  it('falls back safely for unknown types', () => {
    const item = describeNotification(row({ type: 'mystery' }), now);
    assert.equal(item.icon, 'bell');
    assert.equal(item.url, '/notifications');
  });
});

describe('badgeLabel', () => {
  it('shows exact counts up to nine', () => {
    assert.equal(badgeLabel(1), '1');
    assert.equal(badgeLabel(9), '9');
    assert.equal(badgeLabel(10), '9+');
    assert.equal(badgeLabel(250), '9+');
  });

  it('never shows a negative or broken number', () => {
    assert.equal(badgeLabel(-3), '0');
    assert.equal(badgeLabel('x'), '0');
    assert.equal(badgeLabel(undefined), '0');
  });
});
