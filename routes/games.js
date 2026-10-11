const express = require('express');
const {
  deleteReview,
  findGameBySlug,
  findUserReview,
  listGameGenres,
  listGamesForUser,
  listReviewsByGame,
  searchGamesForUser,
  upsertReview,
} = require('../database/database');

const router = express.Router();

const statusOptions = [
  { value: 'want_to_play', label: 'Want to Play' },
  { value: 'playing', label: 'Playing' },
  { value: 'played', label: 'Played' },
  { value: 'completed', label: 'Completed' },
];

const libraryStatusLabels = Object.fromEntries(
  statusOptions.map((option) => [option.value, option.label]),
);

const platformDetails = {
  steam: {
    slug: 'steam',
    name: 'Steam',
    logo: '/images/platforms/steam.svg',
  },
  playstation: {
    slug: 'playstation',
    name: 'PlayStation',
    logo: '/images/platforms/playstation.svg',
  },
  xbox: {
    slug: 'xbox',
    name: 'Xbox',
    logo: '/images/platforms/xbox.svg',
  },
};

function requireAuthentication(req, res, next) {
  if (req.session.user) {
    return next();
  }

  req.session.notice = {
    type: 'info',
    message: 'Log in to rate and review games.',
  };
  return res.redirect('/login');
}

function cleanSearchValue(value, maxLength = 80) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function formatReviewDate(value) {
  const timestamp = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return 'Recently';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function getPlatforms(value = '') {
  return value
    .split(',')
    .map((platform) => platform.trim())
    .filter((platform) => Object.hasOwn(platformDetails, platform))
    .map((platform) => platformDetails[platform]);
}

router.get('/games', (req, res, next) => {
  const query = cleanSearchValue(req.query.query);
  const submittedGenre = cleanSearchValue(req.query.genre, 60);

  try {
    const genres = listGameGenres();
    const genre = genres.includes(submittedGenre) ? submittedGenre : '';
    const games = searchGamesForUser(req.session.user?.id, { query, genre });

    return res.render('games', {
      title: query || genre ? 'Search games' : 'Browse games',
      games,
      genres,
      query,
      selectedGenre: genre,
      libraryStatusLabels,
      pageReturnTo: req.originalUrl,
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/games/:slug', (req, res, next) => {
  try {
    const game = findGameBySlug(req.session.user?.id, req.params.slug);

    if (!game) {
      return res.status(404).render('404', { title: 'Game not found' });
    }

    const reviews = listReviewsByGame(game.id).map((review) => ({
      ...review,
      displayDate: formatReviewDate(review.updated_at),
    }));
    const userReview = req.session.user
      ? findUserReview(req.session.user.id, game.slug)
      : null;
    const relatedGames = listGamesForUser(req.session.user?.id)
      .filter((candidate) => candidate.slug !== game.slug && candidate.genre === game.genre)
      .slice(0, 4);

    return res.render('game', {
      title: game.title,
      game,
      platforms: getPlatforms(game.platforms),
      reviews,
      userReview,
      relatedGames,
      statusOptions,
      libraryStatusLabels,
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/games/:slug/review', requireAuthentication, (req, res, next) => {
  const rating = Number.parseInt(req.body.rating, 10);
  const reviewText = String(req.body.reviewText || '').trim().replace(/\s+/g, ' ');
  const redirectPath = `/games/${req.params.slug}`;

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    req.session.notice = { type: 'info', message: 'Choose a rating from 1 to 5 stars.' };
    return res.redirect(redirectPath);
  }

  if (reviewText.length < 3 || reviewText.length > 800) {
    req.session.notice = {
      type: 'info',
      message: 'Your review must be between 3 and 800 characters.',
    };
    return res.redirect(redirectPath);
  }

  try {
    const game = findGameBySlug(req.session.user.id, req.params.slug);

    if (!game) {
      return res.status(404).render('404', { title: 'Game not found' });
    }

    const previousReview = findUserReview(req.session.user.id, game.slug);
    upsertReview(req.session.user.id, game.slug, rating, reviewText);
    req.session.notice = {
      type: 'success',
      message: previousReview
        ? `Your review of ${game.title} was updated.`
        : `Your review of ${game.title} was published.`,
    };
    return res.redirect(`${redirectPath}#reviews`);
  } catch (error) {
    return next(error);
  }
});

router.post('/games/:slug/review/delete', requireAuthentication, (req, res, next) => {
  try {
    const game = findGameBySlug(req.session.user.id, req.params.slug);

    if (!game) {
      return res.status(404).render('404', { title: 'Game not found' });
    }

    const removed = deleteReview(req.session.user.id, game.slug);
    req.session.notice = {
      type: removed ? 'success' : 'info',
      message: removed ? `Your review of ${game.title} was deleted.` : 'No review was found to delete.',
    };
    return res.redirect(`/games/${game.slug}#reviews`);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
