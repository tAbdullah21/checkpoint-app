// Moderation model: member roles, reports about reviews and replies, and the moderation log.
// A report points at exactly one review or one reply (two foreign keys and a CHECK), so deleting the content
// deletes its reports too. A moderator either removes the content (the author and the reporters are told) or
// keeps it (only the reporters are told); both decisions go to the moderation log with a copy of the text.
const { db, findUserByEmail, transaction } = require('./database');
const { removeGameActivity } = require('./community');
const { notifyFromCheckpoint } = require('./notifications');

const REASONS = ['spam', 'abuse', 'spoilers', 'off_topic'];
const ACTIONS = ['remove_review', 'remove_reply', 'keep_review', 'keep_reply'];
const quoted = (values) => values.map((value) => `'${value}'`).join(', ');

db.exec(`
  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_id INTEGER NOT NULL,
    review_id INTEGER,
    comment_id INTEGER,
    reason TEXT NOT NULL CHECK(reason IN (${quoted(REASONS)})),
    note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 200),
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'kept')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TEXT,
    CHECK ((review_id IS NULL) <> (comment_id IS NULL)),
    FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE,
    FOREIGN KEY (comment_id) REFERENCES review_comments(id) ON DELETE CASCADE
  ) STRICT;

  -- One report per member and item. NULLs never collide in a UNIQUE constraint, hence two partial indexes.
  CREATE UNIQUE INDEX IF NOT EXISTS reports_review_unique ON reports (reporter_id, review_id) WHERE review_id IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS reports_comment_unique ON reports (reporter_id, comment_id) WHERE comment_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS reports_review_idx ON reports (review_id, status) WHERE review_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS reports_comment_idx ON reports (comment_id, status) WHERE comment_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS moderation_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    moderator_id INTEGER,
    action TEXT NOT NULL CHECK(action IN (${quoted(ACTIONS)})),
    author_id INTEGER,
    game_id INTEGER,
    reason TEXT NOT NULL DEFAULT '' CHECK(reason IN ('', ${quoted(REASONS)})),
    content TEXT NOT NULL CHECK(length(content) <= 800),
    report_count INTEGER NOT NULL DEFAULT 0 CHECK(report_count >= 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (moderator_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE SET NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS moderation_log_created_idx ON moderation_log (created_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS moderation_log_moderator_idx ON moderation_log (moderator_id) WHERE moderator_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS moderation_log_author_idx ON moderation_log (author_id) WHERE author_id IS NOT NULL;
`);

// What the queue shows for each reported item, the same columns for reviews and replies.
const openItems = (kind) => {
  const review = kind === 'review';
  return `
    SELECT '${kind}' AS kind, ${review ? 'r.id' : 'c.id'} AS target_id, ${review ? 'r.review_text' : 'c.body'} AS content,
      ${review ? 'r.rating' : 'NULL'} AS rating, ${review ? 'r.updated_at' : 'c.created_at'} AS written_at,
      u.id AS author_id, u.name AS author_name, u.profile_public AS author_public, r.id AS review_id,
      g.slug AS game_slug, g.title AS game_title, g.image AS game_image,
      COUNT(*) AS report_count, MIN(rep.created_at) AS first_reported_at,
      (SELECT COUNT(*) FROM reports k WHERE k.${review ? 'review_id' : 'comment_id'} = rep.${review ? 'review_id' : 'comment_id'} AND k.status = 'kept') AS kept_count
    FROM reports rep
    ${review ? 'JOIN reviews r ON r.id = rep.review_id' : 'JOIN review_comments c ON c.id = rep.comment_id JOIN reviews r ON r.id = c.review_id'}
    JOIN users u ON u.id = ${review ? 'r.user_id' : 'c.user_id'}
    JOIN games g ON g.id = r.game_id
    WHERE rep.status = 'open' AND rep.${review ? 'review_id' : 'comment_id'} IS NOT NULL
    GROUP BY rep.${review ? 'review_id' : 'comment_id'}
  `;
};

const statements = {
  setRole: db.prepare('UPDATE users SET role = ? WHERE id = ?'),
  admins: db.prepare("SELECT id, name, email, created_at FROM users WHERE role = 'admin' ORDER BY name COLLATE NOCASE"),
  reportReview: db.prepare(`
    INSERT INTO reports (reporter_id, review_id, reason, note) VALUES (?, ?, ?, ?)
    ON CONFLICT (reporter_id, review_id) WHERE review_id IS NOT NULL DO NOTHING
  `),
  reportComment: db.prepare(`
    INSERT INTO reports (reporter_id, comment_id, reason, note) VALUES (?, ?, ?, ?)
    ON CONFLICT (reporter_id, comment_id) WHERE comment_id IS NOT NULL DO NOTHING
  `),
  reportedOnGame: db.prepare(`
    SELECT rep.review_id, rep.comment_id FROM reports rep
    LEFT JOIN reviews r ON r.id = rep.review_id
    LEFT JOIN review_comments c ON c.id = rep.comment_id
    LEFT JOIN reviews cr ON cr.id = c.review_id
    WHERE rep.reporter_id = ? AND COALESCE(r.game_id, cr.game_id) = ?
  `),
  openItems: db.prepare(`${openItems('review')} UNION ALL ${openItems('reply')} ORDER BY report_count DESC, first_reported_at ASC, target_id ASC`),
  openReports: db.prepare(`
    SELECT rep.id, CASE WHEN rep.review_id IS NULL THEN 'reply' ELSE 'review' END AS kind,
      COALESCE(rep.review_id, rep.comment_id) AS target_id, rep.reason, rep.note, rep.created_at,
      u.id AS reporter_id, u.name AS reporter_name
    FROM reports rep JOIN users u ON u.id = rep.reporter_id
    WHERE rep.status = 'open'
    ORDER BY rep.created_at ASC, rep.id ASC
  `),
  openCount: db.prepare(`
    SELECT COUNT(DISTINCT COALESCE('review:' || review_id, 'reply:' || comment_id)) AS count FROM reports WHERE status = 'open'
  `),
  review: db.prepare('SELECT r.id, r.user_id, r.game_id, r.review_text AS content, g.title AS game_title FROM reviews r JOIN games g ON g.id = r.game_id WHERE r.id = ?'),
  comment: db.prepare(`
    SELECT c.id, c.user_id, r.game_id, c.body AS content, g.title AS game_title
    FROM review_comments c JOIN reviews r ON r.id = c.review_id JOIN games g ON g.id = r.game_id WHERE c.id = ?
  `),
  reviewReporters: db.prepare("SELECT reporter_id FROM reports WHERE review_id = ? AND status = 'open'"),
  commentReporters: db.prepare("SELECT reporter_id FROM reports WHERE comment_id = ? AND status = 'open'"),
  keepReviewReports: db.prepare("UPDATE reports SET status = 'kept', resolved_at = CURRENT_TIMESTAMP WHERE review_id = ? AND status = 'open'"),
  keepCommentReports: db.prepare("UPDATE reports SET status = 'kept', resolved_at = CURRENT_TIMESTAMP WHERE comment_id = ? AND status = 'open'"),
  deleteReview: db.prepare('DELETE FROM reviews WHERE id = ?'),
  deleteComment: db.prepare('DELETE FROM review_comments WHERE id = ?'),
  log: db.prepare(`
    INSERT INTO moderation_log (moderator_id, action, author_id, game_id, reason, content, report_count)
    VALUES (:moderatorId, :action, :authorId, :gameId, :reason, :content, :reportCount)
  `),
  listLog: db.prepare(`
    SELECT l.id, l.action, l.reason, l.content, l.report_count, l.created_at,
      m.id AS moderator_id, m.name AS moderator_name, a.id AS author_id, a.name AS author_name,
      g.slug AS game_slug, g.title AS game_title
    FROM moderation_log l
    LEFT JOIN users m ON m.id = l.moderator_id
    LEFT JOIN users a ON a.id = l.author_id
    LEFT JOIN games g ON g.id = l.game_id
    ORDER BY l.created_at DESC, l.id DESC
    LIMIT ?
  `),
};

// Gives or takes away the administrator role; returns the member, or null when no account has that email.
function setRoleByEmail(email, role) {
  const member = findUserByEmail(String(email || '').trim().toLowerCase());
  if (!member) return null;
  statements.setRole.run(role, member.id);
  return { ...member, role };
}

function listAdmins() {
  return statements.admins.all();
}

// Returns true for a new report, false when the member had already reported the item.
function reportContent({ reporterId, reviewId = null, commentId = null, reason, note = '' }) {
  const statement = reviewId ? statements.reportReview : statements.reportComment;
  return statement.run(reporterId, reviewId || commentId, reason, note).changes > 0;
}

// The reviews and replies on one game page that the viewer has already reported.
function reportedByMember(reporterId, gameId) {
  const reviews = new Set();
  const comments = new Set();
  for (const row of statements.reportedOnGame.all(reporterId, gameId)) {
    if (row.review_id) reviews.add(row.review_id);
    else comments.add(row.comment_id);
  }
  return { reviews, comments };
}

// The moderation queue: one entry per reported item with its open reports, most reported first.
function listOpenReports() {
  const reports = statements.openReports.all();
  return statements.openItems.all().map((item) => ({
    ...item,
    reports: reports.filter((report) => report.kind === item.kind && report.target_id === item.target_id),
  }));
}

function countOpenReports() {
  return Number(statements.openCount.get().count);
}

// The reported review or reply ('review' or 'reply' and its ID) with its author and game, or null.
function findReportTarget(kind, id) {
  const statement = kind === 'review' ? statements.review : statements.comment;
  return statement.get(Number(id) || 0) || null;
}

function openReporters(kind, targetId) {
  return (kind === 'review' ? statements.reviewReporters : statements.commentReporters).all(targetId).map((row) => row.reporter_id);
}

// Removes a reported review or reply (its likes, replies, reports and notifications go with it), writes the
// decision to the log and tells the author and every member who reported it. Returns null when the item does not
// exist, and `decided: false` when it has no open reports (another moderator decided first).
function removeContent({ kind, id, moderatorId, reason }) {
  return transaction(() => {
    const target = findReportTarget(kind, id);
    if (!target) return null;
    const review = kind === 'review';
    const reporters = openReporters(kind, target.id);
    if (reporters.length === 0) return { ...target, kind, reporters, decided: false };
    statements.log.run({
      moderatorId, action: review ? 'remove_review' : 'remove_reply', authorId: target.user_id, gameId: target.game_id,
      reason, content: target.content, reportCount: reporters.length,
    });
    (review ? statements.deleteReview : statements.deleteComment).run(target.id);
    if (review) removeGameActivity({ userId: target.user_id, type: 'review', gameId: target.game_id });
    notifyFromCheckpoint({ userId: target.user_id, type: 'content_removed', key: `removed:${kind}:${target.id}`, gameId: target.game_id, detail: `${kind}:${reason}` });
    for (const reporterId of reporters) {
      notifyFromCheckpoint({ userId: reporterId, type: 'report_resolved', key: `report:${kind}:${target.id}`, gameId: target.game_id, detail: `${kind}:removed` });
    }
    return { ...target, kind, reporters, decided: true };
  });
}

// Keeps a reported review or reply: its open reports are closed as "kept" (the same members cannot report it
// again, others can), the decision is logged and the reporters are told. The author is not told: they never
// learn that their post was reported.
function keepContent({ kind, id, moderatorId }) {
  return transaction(() => {
    const target = findReportTarget(kind, id);
    if (!target) return null;
    const review = kind === 'review';
    const reporters = openReporters(kind, target.id);
    if (reporters.length === 0) return { ...target, kind, reporters, decided: false };
    (review ? statements.keepReviewReports : statements.keepCommentReports).run(target.id);
    statements.log.run({
      moderatorId, action: review ? 'keep_review' : 'keep_reply', authorId: target.user_id, gameId: target.game_id,
      reason: '', content: target.content, reportCount: reporters.length,
    });
    for (const reporterId of reporters) {
      notifyFromCheckpoint({ userId: reporterId, type: 'report_resolved', key: `report:${kind}:${target.id}`, gameId: target.game_id, detail: `${kind}:kept` });
    }
    return { ...target, kind, reporters, decided: true };
  });
}

function listModerationLog(limit = 50) {
  return statements.listLog.all(Math.max(1, Math.min(Number(limit) || 50, 200)));
}

module.exports = {
  MODERATION_ACTIONS: ACTIONS,
  REPORT_REASON_VALUES: REASONS,
  countOpenReports,
  findReportTarget,
  keepContent,
  listAdmins,
  listModerationLog,
  listOpenReports,
  removeContent,
  reportContent,
  reportedByMember,
  setRoleByEmail,
};
