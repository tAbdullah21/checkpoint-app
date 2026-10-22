// Read-only JSON API. Used by the instant search in the navigation bar and documented in docs/API.md.
const express = require('express');
const { findGameBySlug, listGameGenres, searchGamesForUser } = require('../database/database');
const { communityStats, listReviewsForGame } = require('../database/community');
const { gameplayTags } = require('../lib/recommender');
const { recommendationsFor } = require('../lib/recommendations');
const { thumb } = require('../lib/assets');
const { cleanText } = require('../lib/text');
const { trailerFor } = require('../lib/trailers');

const router = express.Router();

function summary(game) {
  return {
    slug: game.slug,
    title: game.title,
    year: game.year,
    genre: game.genre,
    rating: Number(game.rating),
    reviewCount: Number(game.review_count || 0),
    image: game.image,
    thumbnail: thumb(game.image),
    url: `/games/${game.slug}`,
  };
}

router.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

router.get('/api/games', (req, res, next) => {
  try {
    const query = cleanText(req.query.query, 80);
    const submittedGenre = cleanText(req.query.genre, 60);
    const genre = listGameGenres().includes(submittedGenre) ? submittedGenre : '';
    const games = searchGamesForUser(req.session.user?.id, { query, genre }).map(summary);
    res.json({ count: games.length, games });
  } catch (error) {
    next(error);
  }
});

router.get('/api/search', (req, res, next) => {
  try {
    const query = cleanText(req.query.q, 80);
    if (query.length < 2) return res.json({ query, results: [] });
    const results = searchGamesForUser(req.session.user?.id, { query, genre: '' }).slice(0, 6).map(summary);
    return res.json({ query, results });
  } catch (error) {
    return next(error);
  }
});

router.get('/api/games/:slug', (req, res, next) => {
  try {
    const game = findGameBySlug(req.session.user?.id, req.params.slug);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    const reviews = listReviewsForGame(game.id).map((review) => ({
      id: review.id,
      rating: review.rating,
      text: review.review_text,
      author: review.profile_public ? review.user_name : 'Private member',
      likes: Number(review.like_count),
      updatedAt: review.updated_at,
    }));
    return res.json({
      ...summary(game),
      description: game.description,
      platforms: String(game.platforms || '').split(',').filter(Boolean),
      tags: gameplayTags(game.tags),
      trailer: trailerFor(game.slug) ? `https://www.youtube-nocookie.com/embed/${trailerFor(game.slug)}` : null,
      reviews,
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/api/stats', (req, res, next) => {
  try {
    res.json(communityStats());
  } catch (error) {
    next(error);
  }
});

router.get('/api/me/recommendations', (req, res, next) => {
  try {
    if (!req.session.user) return res.status(401).json({ error: 'Log in to get recommendations' });
    const { picks, dna, isColdStart } = recommendationsFor(req.session.user.id, { limit: 12 });
    return res.json({
      coldStart: isColdStart,
      tasteDna: dna,
      recommendations: picks.map((pick) => ({
        ...summary(pick.game),
        match: pick.match,
        reason: pick.reason,
        traits: pick.traits,
      })),
    });
  } catch (error) {
    return next(error);
  }
});

// Unknown API routes answer in JSON instead of the HTML 404 page.
router.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

module.exports = router;
