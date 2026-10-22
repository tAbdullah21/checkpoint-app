// Community controller: member directory, public profiles, follows, review likes, lists and the feed.
const express = require('express');
const { findGameBySlug, listGamesForUser } = require('../database/database');
const {
  addGameToList,
  addReviewComment,
  createList,
  deleteComment,
  deleteList,
  findComment,
  findList,
  findMember,
  findReview,
  followMember,
  isFollowing,
  listActivity,
  listGamesInList,
  listListsByUser,
  listMembers,
  listPublicLists,
  listTrendingGames,
  moveGameInList,
  recordActivity,
  removeGameFromList,
  toggleReviewLike,
  unfollowMember,
  updateList,
} = require('../database/community');
const { notify, withdrawNotification } = require('../database/notifications');
const { describeActivity, groupByDay } = require('../lib/activity');
const { requireLogin, wantsJson } = require('../lib/auth');
const { compareTastes } = require('../lib/compare');
const { PLATFORM_LABELS, safeLocalPath, splitGenres } = require('../lib/members');
const { memberPage } = require('../lib/member-page');
const { tasteMatchesFor } = require('../lib/recommendations');
const { characterLength, cleanText, firstCharacters, formatDate } = require('../lib/text');

const router = express.Router();
const compareTitles = new Intl.Collator('en', { sensitivity: 'base' }).compare;

function notFound(res, title = 'Page not found') {
  return res.status(404).render('404', { title });
}

// Members ---------------------------------------------------------------------------------

router.get('/members', (req, res, next) => {
  try {
    const query = cleanText(req.query.q, 40);
    const viewerId = req.session.user?.id || 0;
    const rows = listMembers({ viewerId, query });
    const matches = tasteMatchesFor(viewerId, rows.map((member) => member.id));
    const members = rows.map((member) => ({
      ...member,
      genres: splitGenres(member.favorite_genres).slice(0, 3),
      platform: PLATFORM_LABELS[member.preferred_platform] || '',
      joined: formatDate(member.created_at, { month: 'long', year: 'numeric' }),
      isSelf: member.id === viewerId,
      taste: matches.get(member.id) || null,
      covers: member.preview_images ? member.preview_images.split('|') : [],
    }));
    return res.render('members', { title: 'Members', members, query });
  } catch (error) {
    return next(error);
  }
});

router.get('/members/:id', (req, res, next) => {
  try {
    const page = memberPage(Number(req.params.id) || 0, req.session.user?.id || 0);
    if (!page) return notFound(res, 'Member not found');
    return res.render('member', page);
  } catch (error) {
    return next(error);
  }
});

// Compare tastes: the logged-in player next to another public member.
router.get('/members/:id/compare', requireLogin('Log in to compare your taste with other players.'), (req, res, next) => {
  try {
    const viewerId = req.session.user.id;
    const member = findMember(Number(req.params.id) || 0);
    if (!member || (!member.profile_public && member.id !== viewerId)) return notFound(res, 'Member not found');
    if (member.id === viewerId) return res.redirect('/profile');

    const viewer = findMember(viewerId);
    return res.render('compare', {
      title: `You and ${member.name}`,
      member,
      viewer,
      following: isFollowing(viewerId, member.id),
      ...compareTastes(viewerId, member.id),
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/members/:id/follow', requireLogin('Log in to follow players.'), (req, res, next) => {
  try {
    const target = findMember(req.params.id);
    if (!target || (!target.profile_public && target.id !== req.session.user.id)) return notFound(res, 'Member not found');
    const returnTo = safeLocalPath(req.body.returnTo, `/members/${target.id}`);
    if (target.id === req.session.user.id) {
      req.session.notice = { type: 'info', message: 'You cannot follow yourself.' };
      return res.redirect(returnTo);
    }
    if (followMember(req.session.user.id, target.id)) {
      recordActivity({ userId: req.session.user.id, type: 'follow', targetUserId: target.id });
      notify({ userId: target.id, actorId: req.session.user.id, type: 'follow', key: `follow:${req.session.user.id}` });
    }
    req.session.notice = { type: 'success', message: `You are now following ${target.name}.` };
    return res.redirect(returnTo);
  } catch (error) {
    return next(error);
  }
});

router.post('/members/:id/unfollow', requireLogin('Log in to manage who you follow.'), (req, res, next) => {
  try {
    const target = findMember(req.params.id);
    if (!target) return notFound(res, 'Member not found');
    if (unfollowMember(req.session.user.id, target.id)) withdrawNotification(target.id, `follow:${req.session.user.id}`);
    req.session.notice = { type: 'info', message: `You unfollowed ${target.name}.` };
    return res.redirect(safeLocalPath(req.body.returnTo, `/members/${target.id}`));
  } catch (error) {
    return next(error);
  }
});

// Review likes ------------------------------------------------------------------------------

router.post('/reviews/:id/like', requireLogin('Log in to mark reviews as helpful.'), (req, res, next) => {
  try {
    const review = findReview(req.params.id);
    if (!review) return notFound(res, 'Review not found');
    const anchor = `/games/${review.game_slug}#review-${review.id}`;
    if (review.user_id === req.session.user.id) {
      req.session.notice = { type: 'info', message: 'You cannot like your own review.' };
      return res.redirect(anchor);
    }
    const key = `like:${review.id}:${req.session.user.id}`;
    if (toggleReviewLike(req.session.user.id, review.id)) {
      notify({ userId: review.user_id, actorId: req.session.user.id, type: 'review_like', key, reviewId: review.id });
    } else {
      withdrawNotification(review.user_id, key);
    }
    return res.redirect(anchor);
  } catch (error) {
    return next(error);
  }
});

// Replies under reviews ---------------------------------------------------------------------

const REPLY_MAX_LENGTH = 300;

router.post('/reviews/:id/comments', requireLogin('Log in to reply to reviews.'), (req, res, next) => {
  try {
    const review = findReview(req.params.id);
    if (!review) return notFound(res, 'Review not found');
    const body = String(req.body.body || '').trim().replace(/\s+/g, ' ');
    if (characterLength(body) < 1 || characterLength(body) > REPLY_MAX_LENGTH) {
      req.session.notice = { type: 'info', message: `A reply must be between 1 and ${REPLY_MAX_LENGTH} characters.` };
      return res.redirect(`/games/${review.game_slug}#review-${review.id}`);
    }

    const commentId = addReviewComment(review.id, req.session.user.id, body);
    notify({
      userId: review.user_id,
      actorId: req.session.user.id,
      type: 'review_comment',
      key: `comment:${commentId}`,
      reviewId: review.id,
      commentId,
    });
    req.session.notice = { type: 'success', message: 'Your reply was posted.' };
    return res.redirect(`/games/${review.game_slug}#comment-${commentId}`);
  } catch (error) {
    return next(error);
  }
});

// The author of a reply can delete it, and so can the author of the review it answers (moderation of
// their own thread). Nobody else can.
router.post('/comments/:id/delete', requireLogin('Log in to manage replies.'), (req, res, next) => {
  try {
    const comment = findComment(req.params.id);
    if (!comment) return notFound(res, 'Reply not found');
    const viewerId = req.session.user.id;
    if (comment.user_id !== viewerId && comment.review_user_id !== viewerId) {
      return res.status(403).render('error', {
        title: 'Not allowed',
        status: 403,
        message: 'You can only delete your own replies or replies to your own reviews.',
      });
    }
    deleteComment(comment.id);
    req.session.notice = { type: 'success', message: 'The reply was deleted.' };
    return res.redirect(`/games/${comment.game_slug}#review-${comment.review_id}`);
  } catch (error) {
    return next(error);
  }
});

// Activity feed -----------------------------------------------------------------------------

router.get('/activity', (req, res, next) => {
  try {
    const viewerId = req.session.user?.id || 0;
    const tab = viewerId && req.query.tab === 'following' ? 'following' : 'all';
    const items = listActivity({ viewerId, followingOnly: tab === 'following', limit: 40 }).map((row) => describeActivity(row));

    // Feed grouped by day ("Today", "Yesterday", …), keeping the newest-first order.
    const days = groupByDay(items);

    // Sidebar: who to follow (closest taste first when the viewer has a profile) and trending games.
    const candidates = listMembers({ viewerId }).filter((member) => member.id !== viewerId && !member.is_following);
    const matches = tasteMatchesFor(viewerId, candidates.map((member) => member.id));
    const suggestions = candidates
      .map((member) => ({ ...member, taste: matches.get(member.id) || null }))
      .sort((first, second) => (second.taste?.match || 0) - (first.taste?.match || 0) || second.follower_count - first.follower_count)
      .slice(0, 3);

    return res.render('activity', {
      title: 'Community activity',
      items,
      days,
      tab,
      suggestions,
      trending: listTrendingGames({ viewerId, limit: 4 }),
    });
  } catch (error) {
    return next(error);
  }
});

// Lists -------------------------------------------------------------------------------------

function validateList({ title, description }) {
  const errors = [];
  if (characterLength(title) < 3 || characterLength(title) > 60) errors.push('List title must be between 3 and 60 characters.');
  if (characterLength(description) > 280) errors.push('Description must be 280 characters or fewer.');
  return errors;
}

// Somebody else's list answers 404, as if it did not exist; background requests get the answer in JSON.
function loadOwnList(req, res) {
  const list = findList(req.params.id);
  if (!list || list.user_id !== req.session.user.id) {
    if (wantsJson(req)) res.status(404).json({ ok: false, message: 'List not found.' });
    else notFound(res, 'List not found');
    return null;
  }
  return list;
}

// Suggestions that fill the empty spots next to your own lists ("Start this list" cards).
const LIST_IDEAS = [
  { icon: '🎮', title: 'Best co-op nights', text: 'Games to play with a friend on the couch or online.' },
  { icon: '🏁', title: 'Finish this year', text: 'Your backlog, ranked by what you want to finish first.' },
  { icon: '💎', title: 'Hidden gems', text: 'Games more players should know about.' },
  { icon: '🌙', title: 'Late-night comfort games', text: 'Low stress, high cozy.' },
];

router.get('/lists', (req, res, next) => {
  try {
    const viewerId = req.session.user?.id || 0;
    return res.render('lists', {
      title: 'Player lists',
      publicLists: listPublicLists({ viewerId, limit: 30 }),
      myLists: viewerId ? listListsByUser(viewerId, viewerId) : [],
      listIdeas: LIST_IDEAS,
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/lists/new', requireLogin('Log in to create a list.'), (req, res) => {
  const game = req.query.game ? findGameBySlug(req.session.user.id, String(req.query.game)) : null;
  res.render('list-form', {
    title: 'Create a list',
    mode: 'create',
    errors: [],
    values: { title: cleanText(req.query.title, 60), description: '' },
    game,
  });
});

router.post('/lists', requireLogin('Log in to create a list.'), (req, res, next) => {
  try {
    const values = { title: cleanText(req.body.title, 120), description: firstCharacters(String(req.body.description || '').trim(), 600) };
    const game = req.body.game ? findGameBySlug(req.session.user.id, String(req.body.game)) : null;
    const errors = validateList(values);
    if (errors.length > 0) {
      return res.status(422).render('list-form', { title: 'Create a list', mode: 'create', errors, values, game });
    }

    const listId = createList(req.session.user.id, values.title, values.description);
    recordActivity({ userId: req.session.user.id, type: 'list_create', listId });
    if (game && addGameToList(listId, game.slug)) {
      recordActivity({ userId: req.session.user.id, type: 'list_add', gameId: game.id, listId });
    }
    req.session.notice = { type: 'success', message: `Your list “${values.title}” was created.` };
    return res.redirect(`/lists/${listId}`);
  } catch (error) {
    return next(error);
  }
});

router.get('/lists/:id', (req, res, next) => {
  try {
    const list = findList(req.params.id);
    const viewerId = req.session.user?.id || 0;
    if (!list || (!list.owner_public && list.user_id !== viewerId)) return notFound(res, 'List not found');
    const games = listGamesInList(list.id);
    const isOwner = list.user_id === viewerId;
    const inList = new Set(games.map((game) => game.slug));
    return res.render('list', {
      title: list.title,
      list,
      games,
      isOwner,
      updated: formatDate(list.updated_at),
      // The owner can add more games from a dropdown (games that are not in the list yet).
      // Alphabetical, so a game is easy to find in a list of a thousand.
      addableGames: isOwner ? listGamesForUser(viewerId).filter((game) => !inList.has(game.slug)).sort((first, second) => compareTitles(first.title, second.title)) : [],
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/lists/:id/edit', requireLogin('Log in to edit your list.'), (req, res) => {
  const list = loadOwnList(req, res);
  if (!list) return undefined;
  return res.render('list-form', {
    title: 'Edit list',
    mode: 'edit',
    errors: [],
    values: { title: list.title, description: list.description },
    list,
    game: null,
  });
});

router.post('/lists/:id/edit', requireLogin('Log in to edit your list.'), (req, res, next) => {
  try {
    const list = loadOwnList(req, res);
    if (!list) return undefined;
    const values = { title: cleanText(req.body.title, 120), description: firstCharacters(String(req.body.description || '').trim(), 600) };
    const errors = validateList(values);
    if (errors.length > 0) {
      return res.status(422).render('list-form', { title: 'Edit list', mode: 'edit', errors, values, list, game: null });
    }
    updateList(list.id, req.session.user.id, values.title, values.description);
    req.session.notice = { type: 'success', message: 'Your list was updated.' };
    return res.redirect(`/lists/${list.id}`);
  } catch (error) {
    return next(error);
  }
});

router.post('/lists/:id/delete', requireLogin('Log in to manage your lists.'), (req, res, next) => {
  try {
    const list = loadOwnList(req, res);
    if (!list) return undefined;
    deleteList(list.id, req.session.user.id);
    req.session.notice = { type: 'success', message: `“${list.title}” was deleted.` };
    return res.redirect('/lists');
  } catch (error) {
    return next(error);
  }
});

function addToOwnList(req, res, next) {
  try {
    const list = loadOwnList(req, res);
    if (!list) return undefined;
    const game = findGameBySlug(req.session.user.id, String(req.body.slug || ''));
    if (!game) return notFound(res, 'Game not found');
    const returnTo = safeLocalPath(req.body.returnTo, `/lists/${list.id}`);
    if (addGameToList(list.id, game.slug)) {
      recordActivity({ userId: req.session.user.id, type: 'list_add', gameId: game.id, listId: list.id });
      req.session.notice = { type: 'success', message: `${game.title} was added to “${list.title}”.` };
    } else {
      req.session.notice = { type: 'info', message: `${game.title} is already in “${list.title}”.` };
    }
    return res.redirect(returnTo);
  } catch (error) {
    return next(error);
  }
}

router.post('/lists/:id/items', requireLogin('Log in to add games to a list.'), addToOwnList);

// Same action for the game page form, which picks the list from a dropdown.
router.post('/lists/add', requireLogin('Log in to add games to a list.'), (req, res, next) => {
  req.params.id = String(req.body.listId || '');
  return addToOwnList(req, res, next);
});

router.post('/lists/:id/items/:slug/remove', requireLogin('Log in to manage your lists.'), (req, res, next) => {
  try {
    const list = loadOwnList(req, res);
    if (!list) return undefined;
    removeGameFromList(list.id, req.params.slug);
    req.session.notice = { type: 'success', message: 'The game was removed from your list.' };
    return res.redirect(`/lists/${list.id}`);
  } catch (error) {
    return next(error);
  }
});

// Ranked lists: move a game one place up or down. The list page does this in place with JavaScript (JSON);
// without it, the form posts and the page reloads at the moved game.
router.post('/lists/:id/items/:slug/move', requireLogin('Log in to manage your lists.'), (req, res, next) => {
  try {
    const list = loadOwnList(req, res);
    if (!list) return undefined;
    const direction = req.body.direction;
    if (direction !== 'up' && direction !== 'down') {
      return wantsJson(req) ? res.status(400).json({ ok: false, message: 'Choose up or down.' }) : res.redirect(`/lists/${list.id}`);
    }
    const moved = moveGameInList(list.id, req.params.slug, direction);
    if (wantsJson(req)) {
      return moved
        ? res.json({ ok: true, ...moved })
        : res.status(409).json({ ok: false, message: 'That game cannot move further.' });
    }
    return res.redirect(`/lists/${list.id}#rank-${req.params.slug}`);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
