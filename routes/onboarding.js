const express = require('express');
const { findUserById, listFeaturedGames, findGameBySlug, findUserReview, upsertReview, transaction } = require('../database/database');
const { finishSetup, savePreferences } = require('../database/preferences');
const { requireLogin } = require('../lib/auth');
const { safeLocalPath } = require('../lib/members');
const router = express.Router();
const genres = ['Action', 'Adventure', 'RPG', 'Strategy', 'Racing', 'Sports', 'Simulation', 'Horror', 'Indie'];
const platforms = { steam: 'PC / Steam', playstation: 'PlayStation', xbox: 'Xbox' };
const ratingPattern = /^(?:[0-4]\.5|[1-5](?:\.0)?)$/;
function formPage(res, id, next, errors = [], submitted = null) {
  const user = findUserById(id);
  return res.status(errors.length ? 422 : 200).render('welcome', {
    title: 'Find your next favorite', genres, platforms, next, errors,
    games: listFeaturedGames(40),
    values: submitted || { genres: String(user.favorite_genres || '').split(',').filter(Boolean), platform: user.preferred_platform || '', ratings: [] },
  });
}
function readRatings(body) {
  const ratings = [];
  const errors = [];
  const seen = new Set();
  for (let index = 0; index < 3; index += 1) {
    const slug = typeof body[`game${index}`] === 'string' ? body[`game${index}`] : '';
    const rating = typeof body[`rating${index}`] === 'string' ? body[`rating${index}`] : '';
    ratings.push({ slug, rating });
    if (!slug && !rating) continue;
    if (!findGameBySlug(0, slug) || !ratingPattern.test(rating)) errors.push(`Choose a game and a 0.5–5 star rating for selection ${index + 1}, or leave both blank.`);
    if (seen.has(slug)) errors.push('Choose each game only once.');
    seen.add(slug);
  }
  return { ratings, errors };
}
router.use('/welcome', requireLogin('Log in to set up your preferences.'));
router.get('/welcome', (req, res) => formPage(res, req.session.user.id, safeLocalPath(req.query.next, '/for-you')));
router.post('/welcome', (req, res) => {
  const id = req.session.user.id;
  const next = safeLocalPath(req.body.next, '/for-you');
  if (req.body.action === 'skip') {
    finishSetup(id);
    return res.redirect(next);
  }
  const selected = [].concat(req.body.genres || []);
  const platform = typeof req.body.platform === 'string' ? req.body.platform : '';
  const { ratings, errors } = readRatings(req.body);
  if (selected.length > 5 || selected.some((genre) => !genres.includes(genre))) errors.push('Choose up to five genres from the list.');
  if (platform && !Object.hasOwn(platforms, platform)) errors.push('Choose a platform from the list.');
  if (errors.length) return formPage(res, id, next, errors, { genres: selected, platform, ratings });
  transaction(() => {
    savePreferences(id, [...new Set(selected)], platform);
    for (const entry of ratings.filter((item) => item.slug)) {
      const previous = findUserReview(id, entry.slug);
      upsertReview(id, entry.slug, Number(entry.rating), previous?.review_text || '');
    }
    finishSetup(id);
  });
  req.session.notice = { type: 'success', message: 'Your preferences are saved. Your picks are ready.' };
  return res.redirect(next);
});
module.exports = router;
