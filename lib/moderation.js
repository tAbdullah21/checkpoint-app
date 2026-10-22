// Reports and moderation decisions in words: the report reasons members choose from, the check of a report
// form, and display-ready items for the moderation queue and log. Pure functions, unit tested in
// test/unit/moderation.test.js.
const { characterLength, isoTime, relativeTime } = require('./text');

// The community rules, in the order the report form lists them.
const REPORT_REASONS = {
  spam: { label: 'Spam or advertising', hint: 'Links, promotion or the same text posted again and again.' },
  abuse: { label: 'Harassment or hate', hint: 'Insults, threats or attacks on a person or a group.' },
  spoilers: { label: 'Unmarked spoilers', hint: 'Gives away the story or the ending without a warning.' },
  off_topic: { label: 'Not about the game', hint: 'Has nothing to do with the game it is posted on.' },
};
const NOTE_MAX_LENGTH = 200;
const KIND_LABELS = { review: 'Review', reply: 'Reply' };
const ACTION_LABELS = {
  remove_review: 'Removed a review',
  remove_reply: 'Removed a reply',
  keep_review: 'Kept a review',
  keep_reply: 'Kept a reply',
};

function reasonLabel(reason) {
  return REPORT_REASONS[reason]?.label || 'Another reason';
}

// The report form: a reason from the list and an optional note for the moderator.
function parseReport(body = {}) {
  const reason = Object.hasOwn(REPORT_REASONS, body.reason) ? body.reason : '';
  const note = String(body.note || '').trim().replace(/\s+/g, ' ');
  const errors = [];
  if (!reason) errors.push('Choose why you are reporting this.');
  if (characterLength(note) > NOTE_MAX_LENGTH) errors.push(`The note can be at most ${NOTE_MAX_LENGTH} characters.`);
  return { reason, note, errors };
}

// The reason most reporters chose; ties go to the reason listed first. A moderator can pick another one.
function mostReportedReason(reports) {
  const counts = new Map(Object.keys(REPORT_REASONS).map((reason) => [reason, 0]));
  for (const report of reports) if (counts.has(report.reason)) counts.set(report.reason, counts.get(report.reason) + 1);
  let best = 'spam';
  for (const [reason, count] of counts) if (count > counts.get(best)) best = reason;
  return best;
}

// One reported review or reply in the moderation queue, with every open report about it.
function describeQueueItem(item, now = Date.now()) {
  const anchor = item.kind === 'review' ? `review-${item.target_id}` : `comment-${item.target_id}`;
  const reasonCounts = Object.keys(REPORT_REASONS)
    .map((reason) => ({ reason, label: reasonLabel(reason), count: item.reports.filter((report) => report.reason === reason).length }))
    .filter((entry) => entry.count > 0)
    .sort((first, second) => second.count - first.count);
  return {
    kind: item.kind,
    kindLabel: KIND_LABELS[item.kind],
    targetId: item.target_id,
    content: item.content,
    rating: item.rating,
    authorId: item.author_id,
    authorName: item.author_name,
    authorUrl: item.author_public ? `/members/${item.author_id}` : null,
    gameTitle: item.game_title,
    gameImage: item.game_image,
    url: `/games/${item.game_slug}#${anchor}`,
    reportCount: Number(item.report_count),
    keptBefore: Number(item.kept_count) > 0,
    reasonCounts,
    suggestedReason: mostReportedReason(item.reports),
    firstReported: relativeTime(item.first_reported_at, now),
    firstReportedAt: isoTime(item.first_reported_at),
    reports: item.reports.map((report) => ({
      reasonLabel: reasonLabel(report.reason),
      note: report.note || null,
      reporterName: report.reporter_name,
      time: relativeTime(report.created_at, now),
      datetime: isoTime(report.created_at),
    })),
  };
}

// One decision in the moderation log. The text is a copy, kept so the decision can be checked later; it is
// emptied when the author deletes their account.
function describeLogEntry(row, now = Date.now()) {
  return {
    id: row.id,
    action: row.action,
    removed: row.action.startsWith('remove_'),
    actionLabel: ACTION_LABELS[row.action] || row.action,
    reasonLabel: row.reason ? reasonLabel(row.reason) : null,
    content: row.content || null,
    reportCount: Number(row.report_count),
    moderatorName: row.moderator_name || 'A former moderator',
    authorName: row.author_name || 'A deleted account',
    authorUrl: row.author_id ? `/members/${row.author_id}` : null,
    gameTitle: row.game_title || 'A removed game',
    gameUrl: row.game_slug ? `/games/${row.game_slug}` : null,
    time: relativeTime(row.created_at, now),
    datetime: isoTime(row.created_at),
  };
}

module.exports = {
  NOTE_MAX_LENGTH,
  REPORT_REASONS,
  describeLogEntry,
  describeQueueItem,
  mostReportedReason,
  parseReport,
  reasonLabel,
};
