// Tier lists (FR-35). /tiers is the member's own board: library games wait in a pool and are dragged into the S–D
// rows (with JavaScript) or moved with the menu on each game (without it). /tiers/:id shows a member's list to
// everyone who may see their profile. Changes answer JSON to background requests and redirect plain forms.
const express = require('express');
const { findGameBySlug, searchGamesForUser } = require('../database/database');
const { findMember } = require('../database/community');
const { MAX_TIERED, TIERS, placeInTier, removeFromTiers, saveTierOrder, tierListFor, tierPoolFor } = require('../database/tiers');
const { requireLogin, wantsJson } = require('../lib/auth');
const { bestTitleMatch } = require('../lib/versus');

const router = express.Router();

const TIER_LABELS = { s: 'S', a: 'A', b: 'B', c: 'C', d: 'D' };
const TIER_HINTS = { s: 'All-time greats', a: 'Excellent', b: 'Good', c: 'Fine', d: 'Not for me' };
const MAX_ORDER_LENGTH = 6000;

function respond(req, res, { status = 200, ok = true, message, data = {} }) {
  if (wantsJson(req)) return res.status(status).json({ ok, message, ...data });
  req.session.notice = { type: ok ? 'success' : 'info', message };
  return res.redirect('/tiers');
}

// "s:elden-ring,a:hades,pool:celeste" → [{ slug, tier }] (tier null = back to the pool). Anything else is dropped.
function readOrder(value) {
  return String(value || '').slice(0, MAX_ORDER_LENGTH).split(',')
    .map((part) => /^(s|a|b|c|d|pool):([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(part.trim()))
    .filter(Boolean)
    .map(([, tier, slug]) => ({ slug, tier: tier === 'pool' ? null : tier }));
}

const rowsFor = (tiers) => TIERS.map((tier) => ({ tier, label: TIER_LABELS[tier], hint: TIER_HINTS[tier], games: tiers[tier] }));

router.get('/tiers', requireLogin('Log in to make your tier list.'), (req, res, next) => {
  try {
    const userId = req.session.user.id;
    const { tiers, total } = tierListFor(userId);
    return res.render('tiers', {
      title: 'Tier list',
      owner: findMember(userId) || req.session.user,
      isOwner: true,
      rows: rowsFor(tiers),
      total,
      pool: tierPoolFor(userId),
      maxTiered: MAX_TIERED,
      tierLabels: TIER_LABELS,
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/tiers/:id', (req, res, next) => {
  try {
    const viewerId = req.session.user?.id || 0;
    const member = findMember(Number(req.params.id) || 0);
    if (!member || (!member.profile_public && member.id !== viewerId)) {
      return res.status(404).render('404', { title: 'Tier list not found' });
    }
    if (member.id === viewerId) return res.redirect('/tiers');
    const { tiers, total } = tierListFor(member.id);
    return res.render('tiers', {
      title: `${member.name}'s tier list`,
      owner: member,
      isOwner: false,
      rows: rowsFor(tiers),
      total,
      pool: [],
      maxTiered: MAX_TIERED,
      tierLabels: TIER_LABELS,
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/tiers/place', requireLogin('Log in to make your tier list.'), (req, res, next) => {
  try {
    // A typed name (the "add any game" field) is resolved like on the Versus page.
    const query = String(req.body.query || '').trim().slice(0, 120);
    const slug = String(req.body.slug || '') || (query ? bestTitleMatch(query, searchGamesForUser(req.session.user.id, { query }))?.slug || '' : '');
    const tier = String(req.body.tier || '');
    if (tier === 'pool') {
      removeFromTiers(req.session.user.id, slug);
      return respond(req, res, { message: 'Moved back to the pool.' });
    }
    if (!TIERS.includes(tier)) return respond(req, res, { status: 400, ok: false, message: 'Choose a tier from S to D.' });
    const game = findGameBySlug(req.session.user.id, slug);
    if (!game) return respond(req, res, { status: 404, ok: false, message: 'Game not found.' });
    const result = placeInTier(req.session.user.id, slug, tier);
    if (result === 'full') return respond(req, res, { status: 409, ok: false, message: `A tier list holds up to ${MAX_TIERED} games.` });
    return respond(req, res, { message: `${game.title} is now in tier ${TIER_LABELS[tier]}.`, data: { slug, tier } });
  } catch (error) {
    return next(error);
  }
});

router.post('/tiers/order', requireLogin('Log in to make your tier list.'), (req, res, next) => {
  try {
    const order = readOrder(req.body.order);
    if (order.length === 0) return respond(req, res, { status: 400, ok: false, message: 'Nothing to save.' });
    const total = saveTierOrder(req.session.user.id, order);
    return respond(req, res, { message: 'Tier list saved.', data: { total } });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
