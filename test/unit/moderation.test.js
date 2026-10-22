// Reports and moderation decisions in words (lib/moderation.js): the check of the report form, the reason the
// queue suggests, and the items of the moderation queue and log.
const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const {
  NOTE_MAX_LENGTH,
  REPORT_REASONS,
  describeLogEntry,
  describeQueueItem,
  mostReportedReason,
  parseReport,
  reasonLabel,
} = require('../../lib/moderation');

// Noon in Riyadh on 14 October 2026; stored times are UTC.
const now = Date.parse('2026-10-14T09:00:00Z');

describe('parseReport', () => {
  it('accepts a listed reason with an optional note, tidied', () => {
    assert.deepEqual(parseReport({ reason: 'spoilers', note: '  Ending   in the\nfirst line ' }), { reason: 'spoilers', note: 'Ending in the first line', errors: [] });
    assert.deepEqual(parseReport({ reason: 'spam' }), { reason: 'spam', note: '', errors: [] });
  });

  it('refuses reasons that are not on the list, including names every object has', () => {
    for (const reason of ['', 'other', 'SPAM', 'toString', '__proto__', 'constructor', undefined]) {
      assert.deepEqual(parseReport({ reason }).errors, ['Choose why you are reporting this.'], String(reason));
    }
  });

  it(`limits the note to ${NOTE_MAX_LENGTH} characters, an emoji counting as one`, () => {
    assert.deepEqual(parseReport({ reason: 'abuse', note: '😡'.repeat(NOTE_MAX_LENGTH) }).errors, []);
    assert.deepEqual(parseReport({ reason: 'abuse', note: 'x'.repeat(NOTE_MAX_LENGTH + 1) }).errors, [`The note can be at most ${NOTE_MAX_LENGTH} characters.`]);
  });

  it('lists every problem at once, and works without a form', () => {
    assert.equal(parseReport({ note: 'x'.repeat(NOTE_MAX_LENGTH + 1) }).errors.length, 2);
    assert.deepEqual(parseReport(), { reason: '', note: '', errors: ['Choose why you are reporting this.'] });
  });
});

describe('mostReportedReason', () => {
  it('suggests the reason most reporters chose', () => {
    assert.equal(mostReportedReason([{ reason: 'spoilers' }, { reason: 'abuse' }, { reason: 'abuse' }]), 'abuse');
  });

  it('breaks a tie in the order of the report form and ignores unknown reasons', () => {
    assert.equal(mostReportedReason([{ reason: 'off_topic' }, { reason: 'abuse' }]), 'abuse');
    assert.equal(mostReportedReason([{ reason: 'mystery' }, { reason: 'mystery' }, { reason: 'spoilers' }]), 'spoilers');
    assert.equal(mostReportedReason([]), Object.keys(REPORT_REASONS)[0]);
  });
});

describe('describeQueueItem', () => {
  const queueItem = (fields = {}) => ({
    kind: 'review',
    target_id: 42,
    content: 'Cheap coins at gta-coins.example!!!',
    rating: 5,
    author_id: 9,
    author_name: 'Turki Deals',
    author_public: 1,
    game_slug: 'grand-theft-auto-v',
    game_title: 'Grand Theft Auto V',
    game_image: '/images/covers/grand-theft-auto-v.jpg',
    report_count: 3,
    kept_count: 0,
    first_reported_at: '2026-10-14 07:00:00',
    reports: [
      { reason: 'spam', note: 'An advert for a coin shop.', reporter_name: 'Lina Al-Harbi', created_at: '2026-10-14 07:00:00' },
      { reason: 'spam', note: '', reporter_name: 'Omar Al-Qahtani', created_at: '2026-10-14 08:00:00' },
      { reason: 'abuse', note: '', reporter_name: 'Sara Al-Dosari', created_at: '2026-10-14 08:30:00' },
    ],
    ...fields,
  });

  it('sums up the reports about one post, the most common reason first', () => {
    const item = describeQueueItem(queueItem(), now);
    assert.equal(item.kindLabel, 'Review');
    assert.equal(item.url, '/games/grand-theft-auto-v#review-42');
    assert.equal(item.authorUrl, '/members/9');
    assert.equal(item.reportCount, 3);
    assert.deepEqual(item.reasonCounts, [
      { reason: 'spam', label: 'Spam or advertising', count: 2 },
      { reason: 'abuse', label: 'Harassment or hate', count: 1 },
    ]);
    assert.equal(item.suggestedReason, 'spam');
    assert.equal(item.firstReported, '2 h ago');
    assert.equal(item.firstReportedAt, '2026-10-14T07:00:00.000Z');
    assert.equal(item.keptBefore, false);
  });

  it('lists each report with its reason, note and reporter for the moderator', () => {
    const [first, second] = describeQueueItem(queueItem(), now).reports;
    assert.deepEqual(first, { reasonLabel: 'Spam or advertising', note: 'An advert for a coin shop.', reporterName: 'Lina Al-Harbi', time: '2 h ago', datetime: '2026-10-14T07:00:00.000Z' });
    assert.equal(second.note, null, 'an empty note is left out');
  });

  it('links a reply to its place under the review and links no private profile', () => {
    const item = describeQueueItem(queueItem({ kind: 'reply', target_id: 7, author_public: 0, kept_count: 1 }), now);
    assert.equal(item.kindLabel, 'Reply');
    assert.equal(item.url, '/games/grand-theft-auto-v#comment-7');
    assert.equal(item.authorUrl, null);
    assert.equal(item.keptBefore, true, 'the moderator sees that the post was kept once before');
  });
});

describe('describeLogEntry', () => {
  const logRow = (fields = {}) => ({
    id: 3,
    action: 'remove_review',
    reason: 'spam',
    content: 'Cheap coins at gta-coins.example!!!',
    report_count: 3,
    moderator_name: 'Maha Al-Shehri',
    author_id: 9,
    author_name: 'Turki Deals',
    game_title: 'Grand Theft Auto V',
    game_slug: 'grand-theft-auto-v',
    created_at: '2026-10-14 08:00:00',
    ...fields,
  });

  it('records a removal with its reason and a copy of the text', () => {
    const entry = describeLogEntry(logRow(), now);
    assert.equal(entry.actionLabel, 'Removed a review');
    assert.equal(entry.removed, true);
    assert.equal(entry.reasonLabel, 'Spam or advertising');
    assert.equal(entry.content, 'Cheap coins at gta-coins.example!!!');
    assert.equal(entry.reportCount, 3);
    assert.equal(entry.moderatorName, 'Maha Al-Shehri');
    assert.equal(entry.authorUrl, '/members/9');
    assert.equal(entry.gameUrl, '/games/grand-theft-auto-v');
    assert.equal(entry.time, '1 h ago');
  });

  it('records a post that stays up without a reason', () => {
    const entry = describeLogEntry(logRow({ action: 'keep_reply', reason: '' }), now);
    assert.equal(entry.actionLabel, 'Kept a reply');
    assert.equal(entry.removed, false);
    assert.equal(entry.reasonLabel, null);
  });

  it('still reads well after the moderator, the author or the game are gone', () => {
    const entry = describeLogEntry(logRow({ moderator_name: null, author_id: null, author_name: null, game_title: null, game_slug: null, content: '' }), now);
    assert.equal(entry.moderatorName, 'A former moderator');
    assert.equal(entry.authorName, 'A deleted account');
    assert.equal(entry.authorUrl, null);
    assert.equal(entry.gameTitle, 'A removed game');
    assert.equal(entry.gameUrl, null);
    assert.equal(entry.content, null, 'the text is emptied when the author deletes their account');
  });
});

describe('reasonLabel', () => {
  it('names every rule and falls back for anything else', () => {
    assert.deepEqual(Object.keys(REPORT_REASONS).map(reasonLabel), ['Spam or advertising', 'Harassment or hate', 'Unmarked spoilers', 'Not about the game']);
    assert.equal(reasonLabel('nope'), 'Another reason');
    assert.equal(reasonLabel(undefined), 'Another reason');
  });
});
