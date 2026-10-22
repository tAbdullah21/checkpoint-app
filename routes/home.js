// Home controller: the landing page for guests and the dashboard for members.
const express = require('express');
const { findUserById, listFeaturedGames, listGamesForUser, listRecentReviews } = require('../database/database');
const { communityStats, findCommunityPick, listActivity, listPublicLists } = require('../database/community');
const { describeActivity } = require('../lib/activity');
const { playerStats } = require('../lib/player-stats');
const { gamePickerFor, matchMapFor, recommendationsFor } = require('../lib/recommendations');
const { featuredReel } = require('../lib/showcase');
const { formatDate } = require('../lib/text');

const router = express.Router();

// How well known a game is: Steam's review count (on a log scale, so a few giants do not crowd out the rest) with
// its rating. Hand-picked games without Steam numbers count as moderately known.
function popularity(game) {
  const reviews = Number(game.steam_reviews) || 20000;
  return Math.log10(reviews + 10) + Number(game.rating);
}

// Covers for the animated poster wall on the guest homepage: five columns of the best-known games.
function posterWall(games, columns = 5, perColumn = 4) {
  const ranked = [...games].sort((first, second) => popularity(second) - popularity(first));
  return Array.from({ length: columns }, (_, column) => ranked
    .filter((game, index) => index % columns === column)
    .slice(0, perColumn)
    .map((game) => game.image));
}

// The member dashboard: top pick, "continue playing" queue, numbers, level and the game picker.
function dashboardFor(userId, forYou, matches) {
  const stats = playerStats(userId);
  const user = findUserById(userId);
  const playing = stats.library.filter((entry) => entry.status === 'playing');
  const wishlist = stats.library.filter((entry) => entry.status === 'want_to_play');
  const picker = gamePickerFor(userId, { wishlist, matches, topPicks: forYou.picks });
  return {
    queue: [...playing, ...wishlist].slice(0, 3),
    counts: { total: stats.counts.total, completed: stats.counts.completed, reviews: stats.numbers.reviews },
    level: stats.progression,
    steps: {
      library: stats.library.length > 0,
      rating: stats.numbers.reviews > 0,
      genres: Boolean(user?.favorite_genres),
    },
    pickerSource: picker.source,
    pickerCandidates: picker.candidates,
  };
}

router.get('/', (req, res, next) => {
  try {
    const viewerId = req.session.user?.id || 0;
    const allGames = listGamesForUser(viewerId);
    const newReleases = allGames.slice(0, 12);
    const popularGames = [...allGames]
      .sort((first, second) => popularity(second) - popularity(first) || second.year - first.year)
      .slice(0, 12);
    const recentReviews = listRecentReviews(3).map((review) => ({
      ...review,
      // Reviews of members with a private profile still count, but without their name.
      user_name: review.profile_public || review.user_id === viewerId ? review.user_name : 'Private member',
      authorLinked: Boolean(review.profile_public) || review.user_id === viewerId,
      displayDate: formatDate(review.updated_at, { month: 'short', day: 'numeric' }),
    }));

    // The community pick is the best-rated game by members (two reviews or more), else the catalogue's best.
    const memberPick = findCommunityPick();
    const pick = memberPick
      ? { ...memberPick, label: 'COMMUNITY PICK', note: `${memberPick.review_count} member ratings` }
      : { ...popularGames[0], label: 'TOP RATED', note: 'Catalogue rating' };
    const forYou = viewerId ? recommendationsFor(viewerId, { limit: 13 }) : null;
    const matches = matchMapFor(viewerId);
    // The newest community moments: the first five in the activity panel, all of them in the live ticker.
    const ticker = listActivity({ viewerId, limit: 14 }).map((row) => describeActivity(row));

    return res.render('index', {
      title: 'Track, rate, and discover games',
      newReleases,
      popularGames,
      recentReviews,
      pick,
      stats: communityStats(),
      activity: ticker.slice(0, 5),
      ticker,
      lists: listPublicLists({ viewerId, limit: 3 }),
      forYou,
      dashboard: viewerId ? dashboardFor(viewerId, forYou, matches) : null,
      wallColumns: viewerId ? [] : posterWall(allGames),
      reel: featuredReel(listFeaturedGames(30), { count: 5 }),
      matches,
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
