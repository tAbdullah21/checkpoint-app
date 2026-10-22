// Connects the pure recommender to the database: builds a player's taste profile from their
// library, ratings and profile preferences, then ranks the catalogue for them.
const { catalogueVersion, findUserById, listGamesForUser, listUserLibrary } = require('../database/database');
const { listMembers, listRatingsByUser } = require('../database/community');
const { buildIndex, buildProfile, compareProfiles, pairSimilarity, similarGames } = require('./recommender');

const { dismissedGames } = require('../database/preferences');
const { pythonMatching } = require('./python-matching');

function splitGenres(value = '') {
  return String(value || '').split(',').map((genre) => genre.trim()).filter(Boolean);
}

// A member's taste profile on a prebuilt catalogue index: library statuses, favourites, star ratings,
// favourite genres and preferred platform.
function profileFor(userId, index) {
  const user = userId ? findUserById(userId) : null;
  const ratings = new Map(userId ? listRatingsByUser(userId).map((row) => [row.slug, Number(row.rating)]) : []);
  const history = [];
  const known = new Set();

  for (const entry of userId ? listUserLibrary(userId) : []) {
    known.add(entry.slug);
    history.push({ slug: entry.slug, status: entry.status, isFavorite: Boolean(entry.is_favorite), rating: ratings.get(entry.slug) });
  }
  // Games the member rated without keeping them in the library still count.
  for (const [slug, rating] of ratings) {
    if (!known.has(slug)) {
      known.add(slug);
      history.push({ slug, status: null, isFavorite: false, rating });
    }
  }

  const favoriteGenres = splitGenres(user?.favorite_genres);
  const preferredPlatform = user?.preferred_platform || '';
  const profile = buildProfile(index, { history, favoriteGenres, preferredPlatform });
  // Everything the profile is made from, so results built on it can be reused while it stays the same.
  const dismissed = dismissedGames(userId).map((game) => game.slug);
  const signature = JSON.stringify([history, favoriteGenres, preferredPlatform, dismissed]);
  return { profile, known, signature, taste: { history, favoriteGenres, preferredPlatform, dismissed } };
}

function loadContext(userId) {
  const games = listGamesForUser(userId);
  const index = buildIndex(games);
  return { games, index, ...profileFor(userId, index) };
}

// Results per member, reused while the catalogue, the ratings and the member's own taste inputs are unchanged
// (a page often asks for the same matches several times, and every page with game cards asks for them).
const MEMO_LIMIT = 300;
const contextKey = (context) => `${context.games.catalogueVersion || catalogueVersion()}|${context.index.key}|${context.signature}`;

// One Python calculation supplies picks, badge scores and taste traits. Results are
// reused for unchanged taste/catalogue inputs, so repeated cards do not spawn processes.
const pythonMemo = new Map();
function matchingFor(userId) {
  const context = loadContext(userId);
  const key = contextKey(context);
  const slot = userId || 0;
  const cached = pythonMemo.get(slot);
  if (cached && cached.key === key && Date.now() < cached.expires) return { ...cached.data, context };
  const data = pythonMatching(context.games, context.taste);
  pythonMemo.delete(slot);
  pythonMemo.set(slot, { key, data, expires: data.engine === 'fallback' ? Date.now() + 30000 : Infinity });
  if (pythonMemo.size > MEMO_LIMIT) pythonMemo.delete(pythonMemo.keys().next().value);
  return { ...data, context };
}

function recommendationsFor(userId, { limit = 12 } = {}) {
  const { context, picks, dna, isColdStart, knownCount, engine } = matchingFor(userId);
  return {
    picks: picks.slice(0, limit).map((pick) => ({ ...pick, game: context.index.games.get(pick.slug), basedOnTitle: pick.basedOn ? context.index.games.get(pick.basedOn)?.title : null })),
    dna, isColdStart, knownCount, engine,
  };
}

function matchFor(userId, slug) {
  if (!userId) return null;
  const data = matchingFor(userId);
  if (data.isColdStart) return null;
  return data.scores.find((item) => item.slug === slug) || null;
}

function matchMapFor(userId) {
  if (!userId) return new Map();
  const data = matchingFor(userId);
  return new Map(data.isColdStart ? [] : data.scores.map((item) => [item.slug, item.match]));
}

// The games the picker spins over (FR-23): the wishlist once it has two games, otherwise the top picks, so it
// never offers a game the member has already finished. The dashboard passes the picks it has already loaded.
const PICKER_SIZE = 8;

function gamePickerFor(userId, { wishlist, matches, topPicks = null }) {
  if (wishlist.length >= 2) {
    return { source: 'wishlist', candidates: wishlist.map((game) => ({ ...game, match: matches.get(game.slug) || null })) };
  }
  const picks = topPicks || recommendationsFor(userId, { limit: PICKER_SIZE }).picks;
  return { source: 'top picks', candidates: picks.slice(0, PICKER_SIZE).map((pick) => ({ ...pick.game, match: pick.match })) };
}

// Games most similar to one game, with the viewer's library status for the game cards.
function similarTo(userId, slug, limit = 4) {
  const index = buildIndex(listGamesForUser(userId || 0));
  return similarGames(index, slug, limit).map((item) => ({ ...index.games.get(item.slug), similarity: item.similarity }));
}

// How alike two games are, for Versus (0–1), or null.
function gameSimilarity(firstSlug, secondSlug) {
  return pairSimilarity(buildIndex(listGamesForUser(0)), firstSlug, secondSlug);
}

// Famous match-ups for the Versus picker: popular games paired with the popular game most like them.
function suggestedMatchups(limit = 6) {
  const games = listGamesForUser(0);
  const index = buildIndex(games);
  const popular = [...games].sort((first, second) => Number(second.steam_reviews) - Number(first.steam_reviews));
  const contenders = new Set(popular.slice(0, 150).map((game) => game.slug));
  const used = new Set();
  const pairs = [];
  for (const game of popular) {
    if (pairs.length >= limit) break;
    if (used.has(game.slug)) continue;
    const rival = similarGames(index, game.slug, 30).find((item) => contenders.has(item.slug) && !used.has(item.slug));
    if (!rival) continue;
    used.add(game.slug);
    used.add(rival.slug);
    pairs.push([game, index.games.get(rival.slug)]);
  }
  return pairs;
}

// Taste compatibility between two members ("You and Lina: 82% taste match").
function tasteMatch(firstUserId, secondUserId) {
  if (!firstUserId || !secondUserId || firstUserId === secondUserId) return null;
  const index = buildIndex(listGamesForUser(0));
  return compareProfiles(profileFor(firstUserId, index).profile, profileFor(secondUserId, index).profile);
}

// Taste match with several members at once (the catalogue index and the viewer's profile are built once).
function tasteMatchesFor(viewerId, memberIds) {
  const matches = new Map();
  if (!viewerId) return matches;
  const index = buildIndex(listGamesForUser(0));
  const viewer = profileFor(viewerId, index).profile;
  if (viewer.isEmpty) return matches;
  for (const memberId of memberIds) {
    if (memberId === viewerId) continue;
    const comparison = compareProfiles(viewer, profileFor(memberId, index).profile);
    if (comparison) matches.set(memberId, comparison);
  }
  return matches;
}

// Public members whose taste is closest to the viewer's, for "Players like you".
function similarPlayers(viewerId, { limit = 3, minimumMatch = 40 } = {}) {
  if (!viewerId) return [];
  const members = listMembers({ viewerId }).filter((member) => member.id !== viewerId);
  const matches = tasteMatchesFor(viewerId, members.map((member) => member.id));
  return members
    .filter((member) => matches.has(member.id) && matches.get(member.id).match >= minimumMatch)
    .map((member) => ({ ...member, taste: matches.get(member.id) }))
    .sort((first, second) => second.taste.similarity - first.taste.similarity)
    .slice(0, limit);
}

module.exports = {
  gamePickerFor, gameSimilarity, matchFor, matchMapFor, profileFor, recommendationsFor, similarPlayers, similarTo, suggestedMatchups, tasteMatch,
  tasteMatchesFor,
};
