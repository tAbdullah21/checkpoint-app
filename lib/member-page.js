// Builds everything the player page needs. Used by /members/:id (anyone) and /profile (the owner), so
// both pages are the same template and can never drift apart.
const { findMember, isFollowing, listActivity, listFollowers, listFollowing } = require('../database/community');
const { describeActivity, STATUS_LABELS } = require('./activity');
const { PLATFORM_LABELS, splitGenres, visibleGamingAccounts } = require('./members');
const { playerStats } = require('./player-stats');
const { tasteMatch } = require('./recommendations');
const { formatDate } = require('./text');

function memberPage(memberId, viewerId = 0) {
  const member = findMember(memberId);
  if (!member) return null;

  const isOwner = Boolean(viewerId) && viewerId === member.id;
  // Return only a generic identity for a private profile. The original database row must not reach
  // the template: its title, avatar, metadata or a future component could otherwise reveal the owner.
  if (!member.profile_public && !isOwner) {
    return {
      title: 'Private profile', member: { id: member.id, name: 'Private member' },
      isOwner: false, joined: null, following: false, statusLabels: STATUS_LABELS, isPrivate: true,
    };
  }
  const base = {
    title: isOwner ? `${member.name}'s profile` : `${member.name} on Checkpoint`,
    member,
    isOwner,
    joined: formatDate(member.created_at, { month: 'long', year: 'numeric' }),
    following: isFollowing(viewerId, member.id),
    statusLabels: STATUS_LABELS,
  };

  const stats = playerStats(member.id, { viewerId });
  const library = stats.library;
  const favorites = library.filter((game) => game.is_favorite).slice(0, 4);
  const shelf = library.slice(0, 12);

  return {
    ...base,
    isPrivate: false,
    genres: splitGenres(member.favorite_genres),
    platform: PLATFORM_LABELS[member.preferred_platform] || '',
    accounts: visibleGamingAccounts(member),
    stats: {
      games: library.length,
      completed: stats.counts.completed,
      reviews: stats.numbers.reviews,
      followers: stats.numbers.followers,
      following: stats.numbers.following,
      lists: stats.numbers.lists,
    },
    counts: stats.counts,
    favorites,
    playing: library.filter((game) => game.status === 'playing').slice(0, 4),
    shelf,
    bannerCovers: [...favorites, ...shelf.filter((game) => !game.is_favorite)].slice(0, 6).map((game) => game.image),
    reviews: stats.reviews.slice(0, 4).map((review) => ({ ...review, displayDate: formatDate(review.updated_at) })),
    lists: stats.lists.slice(0, 6),
    activity: listActivity({ viewerId, userId: member.id, limit: 5 }).map((row) => describeActivity(row)),
    followers: listFollowers(member.id, viewerId),
    followingList: listFollowing(member.id, viewerId),
    taste: viewerId && !isOwner ? tasteMatch(viewerId, member.id) : null,
    progression: stats.progression,
  };
}

module.exports = { memberPage };
