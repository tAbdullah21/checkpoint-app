// Turns notification rows into display-ready items (sentence, link, icon, relative time) and groups them by
// day. Pure functions, unit tested in test/unit/notifications.test.js.
const { dayLabel, groupByDay } = require('./activity');
const { reasonLabel } = require('./moderation');
const { LOGIN_ATTEMPTS, LOGIN_LOCK_MINUTES } = require('./security');
const { isoTime, relativeTime } = require('./text');

// What a removed or reported item was, as it reads in a sentence before the game title.
const REMOVED_ITEMS = { review: 'review of', reply: 'reply to a review of' };
const REPORTED_ITEMS = { review: 'review', reply: 'reply' };

// Each sentence reads "<actor> <text> <game title> <suffix>", e.g. "Omar found your review of Elden Ring helpful".
// Messages from Checkpoint itself (a moderator's decision, a security alert) have no actor: their words come
// from the row's `detail`, such as "review:spam" (what was removed and why) or "reply:kept".
const KINDS = {
  follow: { icon: 'users', text: 'started following you', suffix: '' },
  review_like: { icon: 'heart', text: 'found your review of', suffix: 'helpful' },
  review_comment: { icon: 'message', text: 'replied to your review of', suffix: '' },
  content_removed: {
    icon: 'flag',
    fromCheckpoint: true,
    words: ([item, reason]) => ({
      text: `A moderator removed your ${REMOVED_ITEMS[item] || 'post on'}`,
      suffix: '',
      note: `Reason: ${reasonLabel(reason)}. It broke the community rules, so other members no longer see it.`,
    }),
  },
  report_resolved: {
    icon: 'shield',
    fromCheckpoint: true,
    words: ([item, outcome]) => ({
      text: `The ${REPORTED_ITEMS[item] || 'post'} you reported on`,
      suffix: outcome === 'removed' ? 'was removed. Thank you for the report.' : 'was checked by a moderator and stays up.',
      note: null,
    }),
  },
  security: {
    icon: 'lock',
    fromCheckpoint: true,
    url: '/account#security',
    words: () => ({
      text: `Sign-ins to your account were paused for ${LOGIN_LOCK_MINUTES} minutes after ${LOGIN_ATTEMPTS} wrong passwords.`,
      suffix: '',
      note: 'If this was not you, check your security activity and change your password.',
    }),
  },
};

function describeCheckpointMessage(row, kind) {
  const words = kind.words(String(row.detail || '').split(':'));
  const gameUrl = row.game_slug ? `/games/${row.game_slug}#reviews` : null;
  return {
    actorName: null,
    actorUrl: null,
    text: words.text,
    object: kind.url ? null : row.game_title || null,
    suffix: words.suffix,
    note: words.note,
    url: kind.url || gameUrl || '/notifications',
    image: kind.url ? null : row.game_image || null,
  };
}

function describeMemberAction(row, kind) {
  // Members with a private profile stay anonymous, as they are everywhere else on Checkpoint.
  const actorVisible = Boolean(row.actor_public);
  const reviewUrl = row.game_slug ? `/games/${row.game_slug}#review-${row.review_id}` : null;
  return {
    actorName: actorVisible ? row.actor_name : 'A private member',
    actorUrl: actorVisible ? `/members/${row.actor_id}` : null,
    text: kind.text,
    object: row.type === 'follow' ? null : row.game_title || null,
    suffix: kind.suffix,
    note: null,
    quote: row.type === 'review_comment' ? row.comment_body || null : null,
    url: row.type === 'follow' ? (actorVisible ? `/members/${row.actor_id}` : '/profile') : reviewUrl || '/notifications',
    image: row.type === 'follow' ? null : row.game_image || null,
  };
}

function describeNotification(row, now = Date.now()) {
  const kind = KINDS[row.type] || { icon: 'bell', text: 'did something', suffix: '' };
  return {
    id: row.id,
    type: row.type,
    unread: !row.read_at,
    icon: kind.icon,
    quote: null,
    ...(kind.fromCheckpoint ? describeCheckpointMessage(row, kind) : describeMemberAction(row, kind)),
    time: relativeTime(row.created_at, now),
    datetime: isoTime(row.created_at),
    day: dayLabel(row.created_at, now),
  };
}

// The number shown on the bell: exact up to 9, then "9+".
function badgeLabel(count) {
  const value = Math.max(0, Number(count) || 0);
  return value > 9 ? '9+' : String(value);
}

module.exports = { KINDS, badgeLabel, describeNotification, groupByDay };
