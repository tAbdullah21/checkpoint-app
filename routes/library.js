const express = require('express');
const {
  addLibraryGame,
  countFavoriteGames,
  findGameBySlug,
  findLibraryGame,
  listGamesForUser,
  listUserLibrary,
  removeLibraryGame,
  updateLibraryGame,
} = require('../database/database');
const { recordActivity } = require('../database/community');
const { requireLogin, wantsJson } = require('../lib/auth');
const { safeLocalPath } = require('../lib/members');
const { gamePickerFor, matchMapFor } = require('../lib/recommendations');
const { STATUS_META, STATUS_OPTIONS } = require('../lib/view-helpers');

const router = express.Router();

const statusOptions = STATUS_OPTIONS;
const validStatuses = new Set(statusOptions.map((option) => option.value));

// Where to go back after a library change: any local page (never another site), else the library.
function safeReturnPath(value) {
  return safeLocalPath(value, '/library');
}

// The board, the + buttons and the home page send these requests in the background and ask for JSON
// (see wantsJson in lib/auth.js); plain forms (no JavaScript) get the usual redirect with a notice.
function respond(req, res, { status = 200, ok = true, message, returnTo, data = {} }) {
  if (wantsJson(req)) {
    return res.status(status).json({ ok, message, ...data });
  }
  req.session.notice = { type: ok ? 'success' : 'info', message };
  return res.redirect(returnTo);
}

function statusData(slug, status, isFavorite) {
  return {
    slug,
    status,
    statusLabel: STATUS_META[status].label,
    statusClass: STATUS_META[status].className,
    isFavorite: Boolean(isFavorite),
  };
}

function libraryCounts(entries) {
  return statusOptions.reduce(
    (counts, option) => ({
      ...counts,
      [option.value]: entries.filter((game) => game.status === option.value).length,
    }),
    { total: entries.length },
  );
}

router.use('/library', requireLogin('Log in to start building your game library.'));

router.get('/library', (req, res, next) => {
  try {
    const entries = listUserLibrary(req.session.user.id);
    const librarySlugs = new Set(entries.map((entry) => entry.slug));
    const matches = matchMapFor(req.session.user.id);
    const availableGames = listGamesForUser(req.session.user.id)
      .filter((game) => !librarySlugs.has(game.slug))
      .sort((first, second) => (matches.get(second.slug) || 0) - (matches.get(first.slug) || 0) || second.rating - first.rating)
      // The best two dozen are enough for a rail (the catalogue has a thousand games).
      .slice(0, 24);
    const picker = gamePickerFor(req.session.user.id, { wishlist: entries.filter((entry) => entry.status === 'want_to_play'), matches });

    return res.render('library', {
      title: 'Your game library',
      entries,
      columns: statusOptions.map((option) => ({
        ...option,
        className: STATUS_META[option.value].className,
        games: entries.filter((entry) => entry.status === option.value),
      })),
      availableGames,
      counts: libraryCounts(entries),
      statusOptions,
      matches,
      pickerSource: picker.source,
      pickerCandidates: picker.candidates,
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/library/:slug/add', (req, res, next) => {
  const status = validStatuses.has(req.body?.status) ? req.body.status : 'want_to_play';
  const returnTo = safeReturnPath(req.body?.returnTo);

  try {
    const game = findGameBySlug(req.session.user.id, req.params.slug);
    const added = game ? addLibraryGame(req.session.user.id, req.params.slug, status) : false;

    if (!game || !added) {
      if (wantsJson(req)) return res.status(404).json({ ok: false, message: 'Game not found.' });
      return res.status(404).render('404', { title: 'Game not found' });
    }

    recordActivity({
      userId: req.session.user.id,
      type: game.status ? 'status_change' : 'library_add',
      gameId: game.id,
      detail: status,
    });
    return respond(req, res, {
      message: `${game.title} was saved as ${STATUS_META[status].label}.`,
      returnTo,
      data: statusData(game.slug, status, game.is_favorite),
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/library/:slug/update', (req, res, next) => {
  const status = req.body?.status;
  const isFavorite = req.body?.isFavorite === 'on';
  const returnTo = safeReturnPath(req.body?.returnTo);

  if (!validStatuses.has(status)) {
    return respond(req, res, { status: 400, ok: false, message: 'Choose a valid library status.', returnTo });
  }

  try {
    const currentGame = findLibraryGame(req.session.user.id, req.params.slug);

    if (!currentGame) {
      if (wantsJson(req)) return res.status(404).json({ ok: false, message: 'This game is not in your library.' });
      return res.status(404).render('404', { title: 'Library game not found' });
    }

    if (!currentGame.is_favorite && isFavorite && countFavoriteGames(req.session.user.id) >= 4) {
      return respond(req, res, {
        status: 409,
        ok: false,
        message: 'You can choose up to four favorite games. Remove one before adding another.',
        returnTo,
      });
    }

    const game = findGameBySlug(req.session.user.id, req.params.slug);
    updateLibraryGame(req.session.user.id, req.params.slug, status, isFavorite);
    if (currentGame.status !== status) {
      recordActivity({ userId: req.session.user.id, type: 'status_change', gameId: game.id, detail: status });
    }

    let message = `${game.title} is now marked as ${STATUS_META[status].label}.`;
    if (currentGame.status === status && Boolean(currentGame.is_favorite) !== isFavorite) {
      message = isFavorite ? `${game.title} is now one of your profile favorites.` : `${game.title} was removed from your favorites.`;
    }
    return respond(req, res, { message, returnTo, data: statusData(game.slug, status, isFavorite) });
  } catch (error) {
    return next(error);
  }
});

router.post('/library/:slug/remove', (req, res, next) => {
  const returnTo = safeReturnPath(req.body?.returnTo);

  try {
    const game = findGameBySlug(req.session.user.id, req.params.slug);
    const removed = game ? removeLibraryGame(req.session.user.id, req.params.slug) : false;

    if (!game || !removed) {
      if (wantsJson(req)) return res.status(404).json({ ok: false, message: 'This game is not in your library.' });
      return res.status(404).render('404', { title: 'Library game not found' });
    }

    return respond(req, res, { message: `${game.title} was removed from your library.`, returnTo, data: { slug: game.slug } });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
