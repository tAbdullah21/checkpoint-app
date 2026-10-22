const express = require('express');
const {
  deleteReview,
  findGameBySlug,
  findUserReview,
  listFeaturedGames,
  listGameGenres,
  searchGamesForUser,
  transaction,
  upsertReview,
} = require('../database/database');
const {
  aspectAverages, detailsForGame, findReviewDetails, overallAspectAverages, saveReviewDetails,
} = require('../database/review-details');
const {
  gameInsights,
  listCommentsForGame,
  listGamePlayers,
  listListsForGame,
  listReviewsForGame,
  listsFeaturingGame,
  recordActivity,
  removeGameActivity,
} = require('../database/community');
const { reportedByMember } = require('../database/moderation');
const { requireLogin } = require('../lib/auth');
const { REPORT_REASONS } = require('../lib/moderation');
const { gameplayTags, tagLabel } = require('../lib/recommender');
const { matchFor, matchMapFor, similarTo } = require('../lib/recommendations');
const { characterLength, cleanText, formatDate, isoTime, relativeTime } = require('../lib/text');
const {
  ASPECTS, PLATFORMS, aspectBreakdown, describeDetails, formValues, readReviewDetails, scoreComparison,
} = require('../lib/review-insights');
const { featuredReel } = require('../lib/showcase');
const { showcaseFor, storePage, trailerSources } = require('../lib/steam-media');
const { trailerFor } = require('../lib/trailers');
const { duelRadar } = require('../lib/versus');
const { STATUS_OPTIONS } = require('../lib/view-helpers');

const router = express.Router();

// The catalogue holds hundreds of games, so /games shows it a page at a time.
const PAGE_SIZE = 60;

// The featured reel only tops the plain first page, not search results or later pages.
function reelFor({ query, genre, platform, page }) {
  return query || genre || platform || page > 1 ? [] : featuredReel(listFeaturedGames(30));
}

const statusOptions = STATUS_OPTIONS;
const libraryStatusLabels = Object.fromEntries(STATUS_OPTIONS.map((option) => [option.value, option.label]));

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

const requireReviewer = requireLogin('Log in to rate and review games.');

function getPlatforms(value = '') {
  return value
    .split(',')
    .map((platform) => platform.trim())
    .filter((platform) => Object.hasOwn(platformDetails, platform))
    .map((platform) => platformDetails[platform]);
}

const sortOptions = {
  popular: { label: 'Most popular', compare: (first, second) => second.steam_reviews - first.steam_reviews || second.rating - first.rating },
  new: { label: 'Newest first', compare: (first, second) => second.year - first.year || first.title.localeCompare(second.title) },
  rating: { label: 'Top rated', compare: (first, second) => second.rating - first.rating || second.review_count - first.review_count },
  title: { label: 'A to Z', compare: (first, second) => first.title.localeCompare(second.title) },
  match: { label: 'Best match for you', compare: null },
};

function yearFilter(value) {
  return typeof value === 'string' && /^\d{4}$/.test(value) && Number(value) >= 1950 && Number(value) <= new Date().getFullYear() + 3 ? value : '';
}

function readCatalogueFilters(query) {
  const yearFrom = yearFilter(query.yearFrom);
  const yearTo = yearFilter(query.yearTo);
  const minRating = typeof query.minRating === 'string' && /^(?:[0-4]\.5|[1-5](?:\.0)?)$/.test(query.minRating) ? query.minRating : '';
  const filterError = yearFrom && yearTo && Number(yearFrom) > Number(yearTo) ? 'The start year must be before or equal to the end year.' : '';
  return { yearFrom, yearTo, minRating, filterError };
}
function filterCatalogue(games, filters) {
  if (filters.filterError) return [];
  return games.filter((game) => (!filters.yearFrom || Number(game.year) >= Number(filters.yearFrom))
    && (!filters.yearTo || Number(game.year) <= Number(filters.yearTo))
    && (!filters.minRating || Number(game.rating) >= Number(filters.minRating)));
}
function filteredReel(options, filters) {
  return filters.yearFrom || filters.yearTo || filters.minRating ? [] : reelFor(options);
}

router.get('/games', (req, res, next) => {
  const query = cleanText(req.query.query, 80);
  const submittedGenre = cleanText(req.query.genre, 60);
  const platform = Object.hasOwn(platformDetails, req.query.platform) ? req.query.platform : '';
  const viewerId = req.session.user?.id;
  const filters = readCatalogueFilters(req.query);

  try {
    const genres = listGameGenres();
    const genre = genres.includes(submittedGenre) ? submittedGenre : '';
    const matches = matchMapFor(viewerId);
    const canSortByMatch = matches.size > 0;
    const sort = Object.hasOwn(sortOptions, req.query.sort) && (req.query.sort !== 'match' || canSortByMatch)
      ? req.query.sort
      : 'popular';

    let games = searchGamesForUser(viewerId, { query, genre });
    if (platform) games = games.filter((game) => String(game.platforms || '').split(',').includes(platform));
    games = filterCatalogue(games, filters);
    games = sort === 'match'
      ? [...games].sort((first, second) => (matches.get(second.slug) || 0) - (matches.get(first.slug) || 0))
      : [...games].sort(sortOptions[sort].compare);

    const pageCount = Math.max(1, Math.ceil(games.length / PAGE_SIZE));
    const requestedPage = Number.parseInt(req.query.page, 10);
    const page = Number.isInteger(requestedPage) ? Math.min(Math.max(requestedPage, 1), pageCount) : 1;

    return res.render('games', {
      title: query || genre || platform ? 'Search games' : 'Browse games',
      reel: filteredReel({ query, genre, platform, page }, filters),
      ...filters, maxFilterYear: new Date().getFullYear() + 3,
      total: games.length,
      page,
      pageCount,
      games: games.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
      genres,
      query,
      selectedGenre: genre,
      platform,
      platforms: Object.values(platformDetails),
      sort,
      sortOptions: Object.entries(sortOptions)
        .filter(([value]) => value !== 'match' || canSortByMatch)
        .map(([value, option]) => ({ value, label: option.label })),
      libraryStatusLabels,
      pageReturnTo: req.originalUrl,
      matches,
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

    const viewerId = req.session.user?.id || 0;
    const comments = listCommentsForGame(game.id);
    const reviewDetails = detailsForGame(game.id);
    // What the viewer already reported here shows as "Reported" instead of the report form.
    const reported = viewerId ? reportedByMember(viewerId, game.id) : { reviews: new Set(), comments: new Set() };
    const reviews = listReviewsForGame(game.id, viewerId).map((review) => {
      const visible = Boolean(review.profile_public) || review.user_id === viewerId;
      return {
        ...review,
        // Members with a private profile keep their reviews, but not their name, on public pages.
        user_name: visible ? review.user_name : 'Private member',
        displayDate: formatDate(review.updated_at),
        authorLinked: visible,
        reported: reported.reviews.has(review.id),
        details: describeDetails(reviewDetails.get(review.id)),
        comments: (comments.get(review.id) || []).map((comment) => {
          const commentVisible = Boolean(comment.profile_public) || comment.user_id === viewerId;
          return {
            ...comment,
            user_name: commentVisible ? comment.user_name : 'Private member',
            authorLinked: commentVisible,
            time: relativeTime(comment.created_at),
            datetime: isoTime(comment.created_at),
            canDelete: Boolean(viewerId) && (comment.user_id === viewerId || review.user_id === viewerId),
            canReport: Boolean(viewerId) && comment.user_id !== viewerId,
            reported: reported.comments.has(comment.id),
          };
        }),
      };
    });
    const userReview = req.session.user
      ? findUserReview(req.session.user.id, game.slug)
      : null;
    const showcase = showcaseFor(game);
    const breakdown = aspectBreakdown(aspectAverages(game.id));
    // The game's aspect scores against the average of every review on the site, as a radar (three aspects or more).
    const overall = overallAspectAverages().aspects;
    const aspectRadar = duelRadar({
      rounds: breakdown.rows
        .filter((row) => row.average !== null && overall[row.key].average !== null)
        .map((row) => ({ aspect: true, label: row.label, left: { value: row.average }, right: { value: overall[row.key].average } })),
    }, { size: 260, padding: 52 });
    // Content-based similarity (genre, themes from the description, platforms, era), not just the same genre.
    const relatedGames = similarTo(req.session.user?.id, game.slug, 8);

    return res.render('game', {
      title: game.title,
      game,
      platforms: getPlatforms(game.platforms),
      reviews,
      userReview,
      relatedGames,
      statusOptions,
      libraryStatusLabels,
      tags: gameplayTags(game.tags).map((tag) => ({ label: tagLabel(tag), query: tag })),
      match: matchFor(viewerId, game.slug),
      myLists: viewerId ? listListsForGame(viewerId, game.slug) : [],
      trailerId: trailerFor(game.slug),
      steamTrailer: trailerSources(game.steam_appid, game.trailer_path),
      showcase,
      aspects: ASPECTS,
      reviewPlatforms: PLATFORMS,
      userDetails: formValues(userReview ? findReviewDetails(req.session.user.id, game.slug) : null),
      breakdown,
      aspectRadar,
      comparison: scoreComparison({
        steamPositive: showcase.steamPositive,
        steamReviews: showcase.steamReviews,
        memberRating: game.rating,
        memberCount: Number(game.review_count),
      }),
      steamPage: storePage(game.steam_appid),
      insights: gameInsights(game.id),
      players: listGamePlayers(game.id, viewerId),
      featuredLists: listsFeaturingGame(game.id, viewerId, 3),
      matches: matchMapFor(viewerId),
      reportReasons: REPORT_REASONS,
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/games/:slug/review', requireReviewer, (req, res, next) => {
  // Accept only the ten exact half-star values; malformed numbers are never rounded.
  const rating = /^(?:[0-4]\.5|[1-5](?:\.0)?)$/.test(String(req.body.rating ?? '')) ? Number(req.body.rating) : null;
  const reviewText = String(req.body.reviewText || '').trim().replace(/\s+/g, ' ');
  const redirectPath = `/games/${req.params.slug}`;

  if (rating === null) {
    req.session.notice = { type: 'info', message: 'Choose a rating from 0.5 to 5 stars in half-star steps.' };
    return res.redirect(redirectPath);
  }

  if (reviewText !== '' && (characterLength(reviewText) < 3 || characterLength(reviewText) > 800)) {
    req.session.notice = {
      type: 'info',
      message: 'Leave the review blank, or write between 3 and 800 characters.',
    };
    return res.redirect(redirectPath);
  }

  try {
    const game = findGameBySlug(req.session.user.id, req.params.slug);

    if (!game) {
      return res.status(404).render('404', { title: 'Game not found' });
    }

    const { details, errors } = readReviewDetails(req.body);
    if (errors.length > 0) {
      req.session.notice = { type: 'info', message: errors[0] };
      return res.redirect(`${redirectPath}#reviews`);
    }
    const previousReview = findUserReview(req.session.user.id, game.slug);
    transaction(() => {
      upsertReview(req.session.user.id, game.slug, rating, reviewText);
      saveReviewDetails(req.session.user.id, game.slug, details);
    });
    recordActivity({ userId: req.session.user.id, type: 'review', gameId: game.id, detail: String(rating) });
    req.session.notice = {
      type: 'success',
      message: reviewText
        ? (previousReview ? `Your review of ${game.title} was updated.` : `Your review of ${game.title} was published.`)
        : `Your ${rating}-star rating of ${game.title} was saved.`,
    };
    return res.redirect(`${redirectPath}#reviews`);
  } catch (error) {
    return next(error);
  }
});

router.post('/games/:slug/review/delete', requireReviewer, (req, res, next) => {
  try {
    const game = findGameBySlug(req.session.user.id, req.params.slug);

    if (!game) {
      return res.status(404).render('404', { title: 'Game not found' });
    }

    const removed = deleteReview(req.session.user.id, game.slug);
    if (removed) removeGameActivity({ userId: req.session.user.id, type: 'review', gameId: game.id });
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
