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

const router = express.Router();

const statusOptions = [
  { value: 'want_to_play', label: 'Want to Play' },
  { value: 'playing', label: 'Playing' },
  { value: 'played', label: 'Played' },
  { value: 'completed', label: 'Completed' },
];
const validStatuses = new Set(statusOptions.map((option) => option.value));

function requireAuthentication(req, res, next) {
  if (req.session.user) {
    return next();
  }

  req.session.notice = {
    type: 'info',
    message: 'Log in to start building your game library.',
  };
  return res.redirect('/login');
}

function safeReturnPath(value) {
  if (['/', '/library', '/profile'].includes(value)) {
    return value;
  }

  if (typeof value === 'string' && /^\/games(?:\?.*)?$/.test(value)) {
    return value;
  }

  if (typeof value === 'string' && /^\/games\/[a-z0-9-]+(?:#reviews)?$/.test(value)) {
    return value;
  }

  return '/library';
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

router.use('/library', requireAuthentication);

router.get('/library', (req, res, next) => {
  try {
    const entries = listUserLibrary(req.session.user.id);
    const librarySlugs = new Set(entries.map((entry) => entry.slug));
    const availableGames = listGamesForUser(req.session.user.id).filter(
      (game) => !librarySlugs.has(game.slug),
    );

    return res.render('library', {
      title: 'Your game library',
      entries,
      availableGames,
      counts: libraryCounts(entries),
      statusOptions,
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
    const added = addLibraryGame(req.session.user.id, req.params.slug, status);

    if (!game || !added) {
      return res.status(404).render('404', { title: 'Game not found' });
    }

    const statusLabel = statusOptions.find((option) => option.value === status).label;
    req.session.notice = {
      type: 'success',
      message: `${game.title} was saved as ${statusLabel}.`,
    };
    return res.redirect(returnTo);
  } catch (error) {
    return next(error);
  }
});

router.post('/library/:slug/update', (req, res, next) => {
  const status = req.body?.status;
  const isFavorite = req.body?.isFavorite === 'on';
  const returnTo = safeReturnPath(req.body?.returnTo);

  if (!validStatuses.has(status)) {
    req.session.notice = { type: 'info', message: 'Choose a valid library status.' };
    return res.redirect(returnTo);
  }

  try {
    const currentGame = findLibraryGame(req.session.user.id, req.params.slug);

    if (!currentGame) {
      return res.status(404).render('404', { title: 'Library game not found' });
    }

    if (!currentGame.is_favorite && isFavorite && countFavoriteGames(req.session.user.id) >= 4) {
      req.session.notice = {
        type: 'info',
        message: 'You can choose up to four favorite games. Remove one before adding another.',
      };
      return res.redirect(returnTo);
    }

    const game = findGameBySlug(req.session.user.id, req.params.slug);
    updateLibraryGame(req.session.user.id, req.params.slug, status, isFavorite);
    const statusLabel = statusOptions.find((option) => option.value === status).label;
    req.session.notice = {
      type: 'success',
      message: `${game.title} is now marked as ${statusLabel}.`,
    };
    return res.redirect(returnTo);
  } catch (error) {
    return next(error);
  }
});

router.post('/library/:slug/remove', (req, res, next) => {
  const returnTo = safeReturnPath(req.body?.returnTo);

  try {
    const game = findGameBySlug(req.session.user.id, req.params.slug);
    const removed = removeLibraryGame(req.session.user.id, req.params.slug);

    if (!game || !removed) {
      return res.status(404).render('404', { title: 'Library game not found' });
    }

    req.session.notice = { type: 'success', message: `${game.title} was removed from your library.` };
    return res.redirect(returnTo);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
