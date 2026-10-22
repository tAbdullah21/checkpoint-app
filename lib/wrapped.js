// "Checkpoint Wrapped": a player's story in numbers, computed from their library and reviews.

const ARCHETYPES = {
  critic: { name: 'The Critic', icon: '🎯', text: 'High standards. Every star you give is earned.' },
  completionist: { name: 'The Completionist', icon: '🏆', text: 'You see games through to the credits.' },
  dreamer: { name: 'The Dreamer', icon: '🌙', text: 'A big backlog full of worlds waiting for you.' },
  specialist: { name: 'The Specialist', icon: '🧭', text: 'You know exactly what you love.' },
  explorer: { name: 'The Explorer', icon: '🗺️', text: 'You jump between genres and try a bit of everything.' },
  social: { name: 'The Social Player', icon: '🤝', text: 'Players follow your taste.' },
  rising: { name: 'The Rising Player', icon: '🚀', text: 'Your Checkpoint story is just getting started.' },
};

function round1(value) {
  return Math.round(value * 10) / 10;
}

function pickArchetype({ tracked, counts, reviews, averageRating, topGenre, distinctGenres, followers }) {
  if (reviews >= 3 && averageRating !== null && averageRating <= 3.2) return { ...ARCHETYPES.critic };
  if (counts.completed >= 3 && counts.completed / Math.max(tracked, 1) >= 0.5) return { ...ARCHETYPES.completionist };
  if (counts.want_to_play >= 3 && counts.want_to_play > counts.completed + counts.playing) return { ...ARCHETYPES.dreamer };
  if (tracked >= 3 && topGenre && topGenre.share >= 50) {
    return { ...ARCHETYPES.specialist, name: `The ${topGenre.name} Specialist` };
  }
  if (distinctGenres >= 4) return { ...ARCHETYPES.explorer };
  if (followers >= 3) return { ...ARCHETYPES.social };
  return { ...ARCHETYPES.rising };
}

// The genres of the library, most tracked first, with their share of it.
function genreBreakdown(library) {
  const genreCounts = new Map();
  for (const entry of library) genreCounts.set(entry.genre, (genreCounts.get(entry.genre) || 0) + 1);
  const genres = [...genreCounts]
    .sort((first, second) => second[1] - first[1] || first[0].localeCompare(second[0]))
    .map(([name, count]) => ({ name, count, share: Math.round((count / Math.max(library.length, 1)) * 100) }));
  // Bars are drawn relative to the most played genre, so the top genre always fills its bar.
  for (const genre of genres) genre.width = Math.round((genre.count / (genres[0]?.count || 1)) * 100);
  return genres;
}

// The star ratings of the reviews: their average, how many of each, the best-rated review and the votes.
function ratingSummary(reviews) {
  const ratings = reviews.map((review) => Number(review.rating));
  const distribution = [5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5].map((stars) => ({ stars, count: ratings.filter((value) => value === stars).length }));
  const maxBucket = Math.max(1, ...distribution.map((bucket) => bucket.count));
  return {
    averageRating: ratings.length ? round1(ratings.reduce((sum, value) => sum + value, 0) / ratings.length) : null,
    distribution: distribution.map((bucket) => ({ ...bucket, width: Math.round((bucket.count / maxBucket) * 100) })),
    topRated: [...reviews].sort((first, second) => second.rating - first.rating)[0] || null,
    likesReceived: reviews.reduce((sum, review) => sum + Number(review.like_count || 0), 0),
  };
}

function buildWrapped({ library = [], reviews = [], member = {}, dna = [] }) {
  const counts = { want_to_play: 0, playing: 0, played: 0, completed: 0 };
  for (const entry of library) if (counts[entry.status] !== undefined) counts[entry.status] += 1;
  const tracked = library.length;
  const genres = genreBreakdown(library);
  const topGenre = genres[0] || null;
  const { averageRating, distribution, topRated, likesReceived } = ratingSummary(reviews);
  const followers = Number(member.follower_count || 0);

  const archetype = pickArchetype({
    tracked,
    counts,
    reviews: reviews.length,
    averageRating,
    topGenre,
    distinctGenres: genres.length,
    followers,
  });

  return {
    tracked,
    counts,
    completionRate: tracked ? Math.round((counts.completed / tracked) * 100) : 0,
    genres: genres.slice(0, 5),
    topGenre,
    reviewCount: reviews.length,
    averageRating,
    distribution,
    topRated,
    likesReceived,
    followers,
    following: Number(member.following_count || 0),
    favorites: library.filter((entry) => entry.is_favorite).slice(0, 4),
    archetype,
    dna,
    isEmpty: tracked === 0 && reviews.length === 0,
  };
}

module.exports = { ARCHETYPES, buildWrapped };
