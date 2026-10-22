// Player progression: experience points, levels and achievements, computed from a member's numbers.
// Pure functions (no database access), so the rules are easy to unit test and to explain.

const XP_RULES = {
  tracked: 10, // every game saved to the library
  completed: 30, // every game completed
  reviews: 20, // every review written
  helpful: 5, // every "helpful" vote received on a review
  lists: 15, // every list created
  followers: 10, // every follower
};

const LEVEL_TITLES = ['Rookie', 'Player', 'Adventurer', 'Veteran', 'Hero', 'Legend', 'Mythic'];
const LEVEL_STEP = 40; // XP needed for level n is LEVEL_STEP × (n − 1)²

const ACHIEVEMENTS = [
  { id: 'first-save', icon: '🎮', name: 'First Checkpoint', text: 'Save your first game', metric: 'tracked', goal: 1 },
  { id: 'collector', icon: '📚', name: 'Collector', text: 'Track 10 games', metric: 'tracked', goal: 10 },
  { id: 'finisher', icon: '🏁', name: 'Finisher', text: 'Complete 3 games', metric: 'completed', goal: 3 },
  { id: 'critic', icon: '✍️', name: 'Critic', text: 'Write 3 reviews', metric: 'reviews', goal: 3 },
  { id: 'trusted', icon: '💬', name: 'Trusted Voice', text: 'Get 5 helpful votes', metric: 'helpful', goal: 5 },
  { id: 'curator', icon: '🗂️', name: 'Curator', text: 'Create a list', metric: 'lists', goal: 1 },
  { id: 'crowd', icon: '🤝', name: 'Crowd Favorite', text: 'Reach 3 followers', metric: 'followers', goal: 3 },
  { id: 'explorer', icon: '🧭', name: 'Genre Explorer', text: 'Play 4 different genres', metric: 'genres', goal: 4 },
];

function numberOf(stats, key) {
  const value = Number(stats?.[key]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function experienceFor(stats) {
  return Object.entries(XP_RULES).reduce((total, [key, points]) => total + numberOf(stats, key) * points, 0);
}

function levelFor(xp) {
  const safeXp = Math.max(0, Math.floor(Number(xp) || 0));
  const level = Math.floor(Math.sqrt(safeXp / LEVEL_STEP)) + 1;
  const floor = LEVEL_STEP * (level - 1) ** 2;
  const next = LEVEL_STEP * level ** 2;
  return {
    level,
    title: LEVEL_TITLES[Math.min(level, LEVEL_TITLES.length) - 1],
    xp: safeXp,
    nextLevelXp: next,
    toNext: next - safeXp,
    progress: Math.round(((safeXp - floor) / (next - floor)) * 100),
  };
}

function buildAchievements(stats) {
  const list = ACHIEVEMENTS.map((achievement) => {
    const value = numberOf(stats, achievement.metric);
    return {
      ...achievement,
      value: Math.min(value, achievement.goal),
      unlocked: value >= achievement.goal,
      progress: Math.round((Math.min(value, achievement.goal) / achievement.goal) * 100),
    };
  });
  return { list, unlocked: list.filter((achievement) => achievement.unlocked).length, total: list.length };
}

// Everything the profile, dashboard and Wrapped need in one call.
function progressionFor(stats) {
  return { ...levelFor(experienceFor(stats)), achievements: buildAchievements(stats) };
}

module.exports = { ACHIEVEMENTS, LEVEL_STEP, LEVEL_TITLES, XP_RULES, buildAchievements, experienceFor, levelFor, progressionFor };
