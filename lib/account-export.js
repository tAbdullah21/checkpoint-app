// Shapes the "Download my data" file from the rows in database/account.js: readable keys, ISO 8601 dates,
// links instead of internal IDs, never the password hash or a reset link, and members with a private profile,
// reporters and moderators stay anonymous.
const { STATUS_LABELS } = require('./activity');
const { describeDevice } = require('./devices');
const { isoTime } = require('./text');

// Version 2 (Checkpoint 2.4) added securityActivity, reportsMade and moderationOfYourPosts; version 3 (3.8) added
// review details and the tier list.
const EXPORT_FORMAT = 'checkpoint-account-export/3';

const reviewLink = (slug, reviewId) => `/games/${slug}#review-${reviewId}`;


// The optional review details (3.8): aspect scores, hours played, platform and the spoiler warning; null when the
// member added none.
function reviewDetails(review) {
  const aspects = Object.fromEntries(['gameplay', 'story', 'visuals', 'audio', 'value']
    .filter((key) => review[key] !== null && review[key] !== undefined).map((key) => [key, review[key]]));
  const hasAny = Object.keys(aspects).length > 0 || review.hours !== null && review.hours !== undefined || Boolean(review.platform) || Boolean(review.spoiler);
  if (!hasAny) return null;
  return { aspects, hoursPlayed: review.hours ?? null, platform: review.platform || null, spoiler: Boolean(review.spoiler) };
}

function buildAccountExport(rows, now = new Date()) {
  const { account } = rows;
  const gamesByList = new Map();
  for (const item of rows.listItems) {
    if (!gamesByList.has(item.list_id)) gamesByList.set(item.list_id, []);
    gamesByList.get(item.list_id).push(item.slug);
  }

  return {
    format: EXPORT_FORMAT,
    exportedAt: now.toISOString(),
    account: {
      recommendationSetupCompleted: Boolean(rows.setupCompleted),
      name: account.name,
      email: account.email,
      memberSince: isoTime(account.created_at),
      bio: account.bio,
      preferredPlatform: account.preferred_platform || null,
      favoriteGenres: String(account.favorite_genres || '').split(',').filter(Boolean),
      profilePublic: Boolean(account.profile_public),
      gamingAccounts: {
        steam: { id: account.steam_id, shownOnProfile: Boolean(account.steam_visible) },
        playstation: { id: account.psn_id, shownOnProfile: Boolean(account.psn_visible) },
        xbox: { id: account.xbox_id, shownOnProfile: Boolean(account.xbox_visible) },
      },
    },
    dismissedRecommendations: (rows.dismissedGames || []).map((game) => ({ slug: game.slug, title: game.title, hiddenAt: isoTime(game.created_at) })),
    library: rows.library.map((entry) => ({
      game: entry.title,
      slug: entry.slug,
      status: STATUS_LABELS[entry.status] || entry.status,
      favorite: Boolean(entry.is_favorite),
      added: isoTime(entry.added_at),
      updated: isoTime(entry.updated_at),
    })),
    reviews: rows.reviews.map((review) => ({
      game: review.title,
      rating: review.rating,
      text: review.review_text,
      written: isoTime(review.created_at),
      updated: isoTime(review.updated_at),
      helpfulVotes: Number(review.helpful_votes),
      details: reviewDetails(review),
      link: reviewLink(review.slug, review.id),
    })),
    tierList: (rows.tiers || []).map((entry) => ({
      tier: entry.tier.toUpperCase(),
      game: entry.title,
      slug: entry.slug,
      position: entry.position + 1,
      updated: isoTime(entry.updated_at),
    })),
    replies: rows.replies.map((reply) => ({
      game: reply.title,
      text: reply.body,
      written: isoTime(reply.created_at),
      onReview: reviewLink(reply.slug, reply.review_id),
    })),
    helpfulVotesGiven: rows.votes.map((vote) => ({
      game: vote.title,
      review: reviewLink(vote.slug, vote.review_id),
      given: isoTime(vote.created_at),
    })),
    lists: rows.lists.map((list) => ({
      title: list.title,
      description: list.description,
      games: gamesByList.get(list.id) || [],
      created: isoTime(list.created_at),
      updated: isoTime(list.updated_at),
    })),
    following: rows.following.map((member) => ({
      name: member.profile_public ? member.name : 'Private member',
      since: isoTime(member.created_at),
    })),
    followerCount: rows.followerCount,
    activity: rows.activity.map((item) => ({
      type: item.type,
      game: item.slug || null,
      list: item.list_title || null,
      detail: item.detail || null,
      at: isoTime(item.created_at),
    })),
    securityActivity: rows.securityEvents.map((event) => ({
      event: event.type,
      browser: describeDevice(event.user_agent).label,
      userAgent: event.user_agent,
      at: isoTime(event.created_at),
    })),
    reportsMade: rows.reports.map((report) => ({
      about: report.kind,
      link: report.kind === 'review' ? reviewLink(report.slug, report.review_id) : `/games/${report.slug}#comment-${report.comment_id}`,
      reason: report.reason,
      note: report.note || null,
      status: report.status,
      reported: isoTime(report.created_at),
      decided: isoTime(report.resolved_at) || null,
    })),
    moderationOfYourPosts: rows.moderation.map((entry) => ({
      decision: entry.action.startsWith('remove_') ? 'removed' : 'kept',
      post: entry.action.endsWith('_review') ? 'review' : 'reply',
      game: entry.title || null,
      reason: entry.reason || null,
      text: entry.content,
      decided: isoTime(entry.created_at),
    })),
  };
}

// "checkpoint-data-2026-10-16.json"
function exportFileName(now = new Date()) {
  return `checkpoint-data-${now.toISOString().slice(0, 10)}.json`;
}

module.exports = { EXPORT_FORMAT, buildAccountExport, exportFileName };
