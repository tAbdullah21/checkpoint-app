// "Compare tastes": the viewer next to another member. Overlapping taste DNA on one radar, the games both
// track, how often their star ratings agree, and what each player could recommend to the other.
// mergeDna and compareLibraries are pure (unit tested); compareTastes reads the database.
const { listGamesForUser, listUserLibrary } = require('../database/database');
const { listRatingsByUser } = require('../database/community');
const { compareRadar } = require('./radar');
const { profileFor } = require('./recommendations');
const { buildIndex, compareProfiles, tasteDna } = require('./recommender');

// The traits that matter most to the two players together, with each player's share of them.
function mergeDna(firstDna, secondDna, limit = 6) {
  const traits = new Map();
  for (const [key, dna] of [['first', firstDna], ['second', secondDna]]) {
    for (const trait of dna || []) {
      const entry = traits.get(trait.label) || { label: trait.label, first: 0, second: 0 };
      entry[key] = Number(trait.share) || 0;
      traits.set(trait.label, entry);
    }
  }
  return [...traits.values()]
    .sort((a, b) => (b.first + b.second) - (a.first + a.second) || a.label.localeCompare(b.label))
    .slice(0, limit);
}

// A game the player clearly enjoyed: rated 4 or 5 stars, a profile favorite, or finished without a rating.
function lovedBy(entry, rating) {
  if (rating) return rating >= 4;
  return Boolean(entry.is_favorite) || entry.status === 'completed';
}

function loveScore(entry, rating) {
  return (rating || 0) * 2 + (entry.is_favorite ? 3 : 0) + (entry.status === 'completed' ? 1 : 0);
}

function recommendationsBetween(fromLibrary, fromRatings, toSlugs, limit) {
  return fromLibrary
    .filter((entry) => !toSlugs.has(entry.slug) && lovedBy(entry, fromRatings.get(entry.slug)))
    .map((entry) => ({ ...entry, theirRating: fromRatings.get(entry.slug) || null }))
    .sort((a, b) => loveScore(b, b.theirRating) - loveScore(a, a.theirRating) || a.title.localeCompare(b.title))
    .slice(0, limit);
}

function compareLibraries({ mine = [], theirs = [], myRatings = new Map(), theirRatings = new Map(), limit = 4 } = {}) {
  const mySlugs = new Set(mine.map((entry) => entry.slug));
  const theirBySlug = new Map(theirs.map((entry) => [entry.slug, entry]));

  const shared = mine
    .filter((entry) => theirBySlug.has(entry.slug))
    .map((entry) => {
      const other = theirBySlug.get(entry.slug);
      const myRating = myRatings.get(entry.slug) || null;
      const theirRating = theirRatings.get(entry.slug) || null;
      const bothRated = Boolean(myRating && theirRating);
      return {
        ...entry,
        mine: { status: entry.status, rating: myRating, isFavorite: Boolean(entry.is_favorite) },
        theirs: { status: other.status, rating: theirRating, isFavorite: Boolean(other.is_favorite) },
        verdict: bothRated ? (Math.abs(myRating - theirRating) <= 1 ? 'agree' : 'disagree') : null,
      };
    })
    .sort((a, b) => ((b.mine.rating || 0) + (b.theirs.rating || 0)) - ((a.mine.rating || 0) + (a.theirs.rating || 0))
      || a.title.localeCompare(b.title));

  const rated = shared.filter((game) => game.verdict);
  return {
    shared,
    agreement: { agree: rated.filter((game) => game.verdict === 'agree').length, rated: rated.length },
    theyRecommend: recommendationsBetween(theirs, theirRatings, mySlugs, limit),
    youRecommend: recommendationsBetween(mine, myRatings, new Set(theirBySlug.keys()), limit),
  };
}

function ratingMap(userId) {
  return new Map(listRatingsByUser(userId).map((row) => [row.slug, Number(row.rating)]));
}

function compareTastes(viewerId, memberId) {
  const index = buildIndex(listGamesForUser(0));
  const mine = profileFor(viewerId, index).profile;
  const theirs = profileFor(memberId, index).profile;
  const traits = mine.isEmpty || theirs.isEmpty ? [] : mergeDna(tasteDna(mine, 12), tasteDna(theirs, 12));

  return {
    taste: compareProfiles(mine, theirs),
    traits,
    radar: compareRadar(traits),
    ...compareLibraries({
      mine: listUserLibrary(viewerId),
      theirs: listUserLibrary(memberId),
      myRatings: ratingMap(viewerId),
      theirRatings: ratingMap(memberId),
    }),
  };
}

module.exports = { compareLibraries, compareTastes, mergeDna };
