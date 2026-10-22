// Versus (FR-34): two games head to head. /versus?a=elden-ring&b=dark-souls-iii compares them round by round; a
// name typed into the form instead of a slug is resolved to the most likely game, and the page redirects to the
// clean address so it can be shared. Without both games the page shows the picker and famous match-ups.
const express = require('express');
const { findGameBySlug, searchGamesForUser } = require('../database/database');
const { aspectAverages } = require('../database/review-details');
const { gameInsights } = require('../database/community');
const { gameplayTags, tagLabel } = require('../lib/recommender');
const { gameSimilarity, suggestedMatchups } = require('../lib/recommendations');
const { showcaseFor } = require('../lib/steam-media');
const { bestTitleMatch, duelRadar, versus } = require('../lib/versus');

const router = express.Router();
const MAX_QUERY = 120;

function resolve(userId, value) {
  const text = String(value || '').trim().slice(0, MAX_QUERY);
  if (!text) return null;
  if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(text)) {
    const game = findGameBySlug(userId, text);
    if (game) return game;
  }
  return bestTitleMatch(text, searchGamesForUser(userId, { query: text }));
}

// One side of the fight: the game, its artwork and the numbers the rounds compare.
function contender(game) {
  const showcase = showcaseFor(game);
  const aspects = aspectAverages(game.id)?.aspects || {};
  const aspect = (key) => (aspects[key]?.average === null || aspects[key]?.average === undefined ? null : Math.round(aspects[key].average * 10) / 10);
  return {
    game,
    art: showcase.hero || showcase.screenshots[0] || null,
    stats: {
      title: game.title,
      rating: Number(game.rating),
      steamPositive: showcase.steamPositive,
      steamReviews: showcase.steamReviews || null,
      tracked: gameInsights(game.id).statuses.total,
      memberReviews: Number(game.review_count) || 0,
      gameplay: aspect('gameplay'),
      story: aspect('story'),
      visuals: aspect('visuals'),
      audio: aspect('audio'),
      value: aspect('value'),
      tags: gameplayTags(game.tags),
    },
  };
}

// Everything the page shows for the two resolved games (either may be missing).
function pageFor(query, left, right) {
  const ready = Boolean(left && right && left.slug !== right.slug);
  const sides = ready ? [contender(left), contender(right)] : [];
  const result = ready ? versus(sides[0].stats, sides[1].stats, { similarity: gameSimilarity(left.slug, right.slug) }) : null;
  const typed = (value) => String(value || '').slice(0, MAX_QUERY);
  return {
    title: ready ? `${left.title} vs ${right.title}` : 'Versus',
    left,
    right,
    sides,
    result,
    radar: result ? duelRadar(result) : null,
    sharedLabels: result ? result.shared.map(tagLabel) : [],
    sameGame: Boolean(left && right && left.slug === right.slug),
    notFound: { a: Boolean(query.a) && !left, b: Boolean(query.b) && !right },
    queries: { a: left ? left.title : typed(query.a), b: right ? right.title : typed(query.b) },
    matchups: ready ? [] : suggestedMatchups(6),
  };
}

router.get('/versus', (req, res, next) => {
  try {
    const userId = req.session.user?.id;
    const left = resolve(userId, req.query.a);
    const right = resolve(userId, req.query.b);
    // A typed name becomes the game's address, so the result can be bookmarked and shared.
    if (left && right && (req.query.a !== left.slug || req.query.b !== right.slug)) {
      return res.redirect(`/versus?a=${encodeURIComponent(left.slug)}&b=${encodeURIComponent(right.slug)}`);
    }
    return res.render('versus', pageFor(req.query, left, right));
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
