// Moderation controller: members report reviews and replies that break the community rules, and
// administrators decide in the moderation queue whether to remove the post or keep it. Every decision is
// written to the moderation log. The author never learns who reported a post, and members never learn which
// moderator decided.
const express = require('express');
const { findComment, findReview } = require('../database/community');
const { findReportTarget, keepContent, listModerationLog, listOpenReports, removeContent, reportContent } = require('../database/moderation');
const { requireAdmin, requireLogin } = require('../lib/auth');
const { REPORT_REASONS, describeLogEntry, describeQueueItem, parseReport } = require('../lib/moderation');
const { plural } = require('../lib/view-helpers');

const router = express.Router();
const KINDS = new Set(['review', 'reply']);

// Reports -------------------------------------------------------------------------------------------------

function reportHandler(kind) {
  return (req, res, next) => {
    try {
      const target = kind === 'review' ? findReview(req.params.id) : findComment(req.params.id);
      if (!target) return res.status(404).render('404', { title: kind === 'review' ? 'Review not found' : 'Reply not found' });
      const anchor = `/games/${target.game_slug}#${kind === 'review' ? 'review' : 'comment'}-${target.id}`;
      if (target.user_id === req.session.user.id) {
        req.session.notice = { type: 'info', message: `You cannot report your own ${kind}.` };
        return res.redirect(anchor);
      }

      const { reason, note, errors } = parseReport(req.body);
      if (errors.length > 0) {
        req.session.notice = { type: 'info', message: errors.join(' ') };
        return res.redirect(anchor);
      }

      const created = reportContent({
        reporterId: req.session.user.id,
        reviewId: kind === 'review' ? target.id : null,
        commentId: kind === 'reply' ? target.id : null,
        reason,
        note,
      });
      req.session.notice = created
        ? { type: 'success', message: `Thanks for the report. A moderator will look at this ${kind}, and you will get a notification with the decision.` }
        : { type: 'info', message: `You already reported this ${kind}.` };
      return res.redirect(anchor);
    } catch (error) {
      return next(error);
    }
  };
}

router.post('/reviews/:id/report', requireLogin('Log in to report reviews.'), reportHandler('review'));
router.post('/comments/:id/report', requireLogin('Log in to report replies.'), reportHandler('reply'));

// Moderation queue and log (administrators only) ----------------------------------------------------------

router.use('/moderation', requireAdmin);

router.get('/moderation', (req, res, next) => {
  try {
    const items = listOpenReports().map((item) => ({ ...describeQueueItem(item), own: item.author_id === req.session.user.id }));
    return res.render('moderation', {
      title: 'Moderation',
      items,
      reasons: REPORT_REASONS,
      recent: listModerationLog(5).map((row) => describeLogEntry(row)),
    });
  } catch (error) {
    return next(error);
  }
});

function decide(decision) {
  return (req, res, next) => {
    try {
      const { kind } = req.params;
      const target = KINDS.has(kind) ? findReportTarget(kind, req.params.id) : null;
      if (!target) return res.status(404).render('404', { title: 'Post not found' });
      // A moderator does not judge their own posts; another moderator has to.
      if (target.user_id === req.session.user.id) {
        return res.status(403).render('error', { title: 'Not allowed', status: 403, message: 'Another moderator has to decide on reports about your own posts.' });
      }

      let result;
      if (decision === 'remove') {
        const reason = Object.hasOwn(REPORT_REASONS, req.body.reason) ? req.body.reason : '';
        if (!reason) {
          req.session.notice = { type: 'info', message: 'Choose the rule the post breaks before removing it.' };
          return res.redirect(`/moderation#${kind}-${target.id}`);
        }
        result = removeContent({ kind, id: target.id, moderatorId: req.session.user.id, reason });
      } else {
        result = keepContent({ kind, id: target.id, moderatorId: req.session.user.id });
      }

      const told = plural(result.reporters.length, 'reporter');
      let message = `The ${kind} stays up. ${told} ${result.reporters.length === 1 ? 'was' : 'were'} told.`;
      if (!result.decided) message = 'Another moderator already decided on these reports.';
      else if (decision === 'remove') message = `The ${kind} was removed. The author and ${told} were told.`;
      req.session.notice = { type: result.decided ? 'success' : 'info', message };
      return res.redirect('/moderation');
    } catch (error) {
      return next(error);
    }
  };
}

router.post('/moderation/:kind/:id/remove', decide('remove'));
router.post('/moderation/:kind/:id/keep', decide('keep'));

router.get('/moderation/log', (req, res, next) => {
  try {
    return res.render('moderation-log', {
      title: 'Moderation log',
      entries: listModerationLog(100).map((row) => describeLogEntry(row)),
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
