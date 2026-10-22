// Collects a member's numbers (library, reviews, lists, followers) for the dashboard, profile and Wrapped.
const { listUserLibrary } = require('../database/database');
const { findMember, listListsByUser, listReviewsByUser } = require('../database/community');
const { progressionFor } = require('./achievements');

const STATUSES = ['want_to_play', 'playing', 'played', 'completed'];

function countStatuses(library) {
  const counts = { total: library.length };
  for (const status of STATUSES) counts[status] = library.filter((entry) => entry.status === status).length;
  return counts;
}

function playerStats(userId, { viewerId = userId } = {}) {
  const library = listUserLibrary(userId);
  const reviews = listReviewsByUser(userId, 50);
  const member = findMember(userId) || {};
  const lists = listListsByUser(userId, viewerId, 50);
  const counts = countStatuses(library);
  const numbers = {
    tracked: library.length,
    completed: counts.completed,
    reviews: reviews.length,
    helpful: reviews.reduce((sum, review) => sum + Number(review.like_count || 0), 0),
    lists: lists.length,
    followers: Number(member.follower_count || 0),
    following: Number(member.following_count || 0),
    genres: new Set(library.map((entry) => entry.genre)).size,
  };
  return { library, reviews, member, lists, counts, numbers, progression: progressionFor(numbers) };
}

module.exports = { STATUSES, countStatuses, playerStats };
