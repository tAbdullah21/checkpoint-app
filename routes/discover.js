// Discovery controller: AI "For You" recommendations and the Checkpoint Wrapped summary.
const express = require('express');
const { listUserLibrary, findGameBySlug } = require('../database/database');
const { requireLogin } = require('../lib/auth');
const { matchMapFor, recommendationsFor, similarPlayers } = require('../lib/recommendations');
const { playerStats } = require('../lib/player-stats');
const { radarChart } = require('../lib/radar');
const { buildWrapped } = require('../lib/wrapped');

const { dismissGame, restoreGame, dismissedGames } = require('../database/preferences');
const router = express.Router();

// Candidates for the "Pick my next game" spinner: the wishlist when it has a choice, else the top picks.
function pickerFor(userId, picks) {
  const wishlist = listUserLibrary(userId).filter((entry) => entry.status === 'want_to_play');
  if (wishlist.length >= 2) {
    const matches = matchMapFor(userId);
    return { source: 'wishlist', candidates: wishlist.map((game) => ({ ...game, match: matches.get(game.slug) || null })) };
  }
  return { source: 'top picks', candidates: picks.slice(0, 8).map((pick) => ({ ...pick.game, match: pick.match })) };
}

router.get('/for-you', requireLogin('Log in to see games picked for you.'), (req, res, next) => {
  try {
    const userId = req.session.user.id;
    const { picks, dna, isColdStart, knownCount, engine } = recommendationsFor(userId, { limit: 12 });
    const players = isColdStart ? [] : similarPlayers(userId, { limit: 3 });
    const picker = pickerFor(userId, picks);
    return res.render('for-you', {
      title: 'Picked for you',
      matchingUnavailable: engine === 'fallback',
      picks,
      dna,
      radar: isColdStart ? null : radarChart(dna),
      isColdStart,
      knownCount,
      players,
      pickerSource: picker.source,
      pickerCandidates: picker.candidates,
    });
  } catch (error) {
    return next(error);
  }
});


router.get('/for-you/hidden', requireLogin(), (req, res) => {
  return res.render('hidden-games', { title: 'Hidden recommendations', games: dismissedGames(req.session.user.id) });
});
router.post('/for-you/:slug/dismiss', requireLogin(), (req, res) => {
  const game = findGameBySlug(req.session.user.id, req.params.slug);
  if (!game) return res.status(404).render('404', { title: 'Game not found' });
  dismissGame(req.session.user.id, game.id);
  req.session.notice = { type: 'success', message: 'Game hidden from your picks. You can restore it in Hidden games.' };
  return res.redirect('/for-you');
});
router.post('/for-you/:slug/restore', requireLogin(), (req, res) => {
  const game = findGameBySlug(req.session.user.id, req.params.slug);
  if (!game) return res.status(404).render('404', { title: 'Game not found' });
  restoreGame(req.session.user.id, game.id);
  req.session.notice = { type: 'success', message: 'Game restored to recommendation candidates.' };
  return res.redirect('/for-you/hidden');
});

router.get('/wrapped', requireLogin('Log in to see your Checkpoint Wrapped.'), (req, res, next) => {
  try {
    const userId = req.session.user.id;
    const stats = playerStats(userId);
    const { dna } = recommendationsFor(userId, { limit: 1 });
    const wrapped = buildWrapped({ library: stats.library, reviews: stats.reviews, member: stats.member, dna });
    return res.render('wrapped', {
      title: 'Your Checkpoint Wrapped',
      wrapped,
      radar: radarChart(dna),
      progression: stats.progression,
      year: new Date().getFullYear(),
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
