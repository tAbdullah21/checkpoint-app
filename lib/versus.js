// Versus: two games head to head, round by round. Each round compares one measured number (Checkpoint score,
// Steam players' approval, how many people reviewed it on Steam, members tracking it, member reviews, and the five
// review aspects); the game with the better number takes the round, a gap smaller than the round's margin is a
// draw, and a round without data for both games is left out instead of guessed. Pure functions only.

const ROUNDS = [
  { key: 'rating', label: 'Checkpoint score', max: 5, margin: 0.05, format: (value) => value.toFixed(1) },
  { key: 'steamPositive', label: 'Steam players who recommend it', max: 100, margin: 1, format: (value) => `${Math.round(value)}%` },
  { key: 'steamReviews', label: 'Reviews on Steam', log: true, margin: 0, format: (value) => compactNumber(value) },
  { key: 'tracked', label: 'Members tracking it', margin: 0, format: (value) => String(value) },
  { key: 'memberReviews', label: 'Member reviews', margin: 0, format: (value) => String(value) },
  { key: 'gameplay', label: 'Gameplay', aspect: true, max: 5, margin: 0.05, format: (value) => value.toFixed(1) },
  { key: 'story', label: 'Story', aspect: true, max: 5, margin: 0.05, format: (value) => value.toFixed(1) },
  { key: 'visuals', label: 'Visuals', aspect: true, max: 5, margin: 0.05, format: (value) => value.toFixed(1) },
  { key: 'audio', label: 'Audio', aspect: true, max: 5, margin: 0.05, format: (value) => value.toFixed(1) },
  { key: 'value', label: 'Value', aspect: true, max: 5, margin: 0.05, format: (value) => value.toFixed(1) },
];

function compactNumber(value) {
  if (value >= 1e6) return `${(value / 1e6).toFixed(value >= 1e7 ? 0 : 1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(value >= 1e4 ? 0 : 1)}K`;
  return String(Math.round(value));
}

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

// How long each bar is, from 0 to 100: against the round's maximum, or (for counts) against the larger of the two,
// on a log scale when the counts can differ by thousands.
function barPercent(value, other, round) {
  if (!isNumber(value) || value <= 0) return 0;
  if (round.max) return Math.min(100, Math.round((value / round.max) * 100));
  const top = Math.max(value, isNumber(other) ? other : 0);
  if (round.log) return Math.max(6, Math.round((Math.log10(value + 1) / Math.log10(top + 1)) * 100));
  return Math.max(6, Math.round((value / top) * 100));
}

function playRound(round, left, right) {
  const a = left[round.key];
  const b = right[round.key];
  if (!isNumber(a) || !isNumber(b) || (a === 0 && b === 0 && !round.max)) return null;
  const gap = a - b;
  let winner = 'draw';
  if (gap > round.margin) winner = 'left';
  else if (gap < -round.margin) winner = 'right';
  return {
    key: round.key,
    label: round.label,
    aspect: Boolean(round.aspect),
    winner,
    left: { value: a, display: round.format(a), percent: barPercent(a, b, round) },
    right: { value: b, display: round.format(b), percent: barPercent(b, a, round) },
  };
}

// Words both games share (tags), at most five, in the left game's order.
function sharedTags(leftTags = [], rightTags = []) {
  const right = new Set(rightTags.map((tag) => String(tag).toLowerCase()));
  return leftTags.filter((tag) => right.has(String(tag).toLowerCase())).slice(0, 5);
}

function verdictFor(score, left, right, rounds) {
  if (rounds === 0) return { winner: 'draw', text: 'Not enough data to call it yet' };
  if (score.left === score.right) return { winner: 'draw', text: 'Too close to call: a draw' };
  const [winner, name, wins, losses] = score.left > score.right
    ? ['left', left.title, score.left, score.right]
    : ['right', right.title, score.right, score.left];
  const style = wins - losses >= 4 ? 'wins by a knockout' : wins - losses >= 2 ? 'wins on points' : 'edges it';
  return { winner, text: `${name} ${style}, ${wins}–${losses}` };
}

/*
 * left / right: { title, rating, steamPositive, steamReviews, tracked, memberReviews, gameplay … value, tags }
 * (missing numbers are null). similarity: 0–1 from the recommender, or null.
 */
function versus(left, right, { similarity = null } = {}) {
  const rounds = ROUNDS.map((round) => playRound(round, left, right)).filter(Boolean);
  const score = {
    left: rounds.filter((round) => round.winner === 'left').length,
    right: rounds.filter((round) => round.winner === 'right').length,
    draws: rounds.filter((round) => round.winner === 'draw').length,
  };
  return {
    rounds,
    score,
    verdict: verdictFor(score, left, right, rounds.length),
    shared: sharedTags(left.tags, right.tags),
    similarity: isNumber(similarity) ? Math.max(0, Math.min(100, Math.round(similarity * 100))) : null,
  };
}

// The five review aspects as two overlapping shapes (left and right) on one radar, when at least three aspects
// have member scores for both games; null otherwise.
function duelRadar(result, { size = 300, padding = 58 } = {}) {
  const aspects = result.rounds.filter((round) => round.aspect);
  if (aspects.length < 3) return null;
  const center = size / 2;
  const radius = center - padding;
  const point = (index, level) => {
    const angle = -Math.PI / 2 + (index / aspects.length) * Math.PI * 2;
    return [center + radius * level * Math.cos(angle), center + radius * level * Math.sin(angle)];
  };
  const pair = ([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`;
  const shape = (side) => aspects.map((round, index) => pair(point(index, round[side].value / 5))).join(' ');
  return {
    size,
    center,
    rings: [0.25, 0.5, 0.75, 1].map((level) => aspects.map((_, index) => pair(point(index, level))).join(' ')),
    axes: aspects.map((_, index) => {
      const [x, y] = point(index, 1);
      return { x: x.toFixed(1), y: y.toFixed(1) };
    }),
    left: shape('left'),
    right: shape('right'),
    labels: aspects.map((round, index) => {
      const [x, y] = point(index, 1.2);
      const anchor = x < center - 4 ? 'end' : x > center + 4 ? 'start' : 'middle';
      return { label: round.label, x: x.toFixed(1), y: y.toFixed(1), anchor };
    }),
  };
}

// The game a typed name most likely means: the same title, then a title that starts with it, then one that
// contains it (the most reviewed on Steam first), then the first search result.
function bestTitleMatch(query, games) {
  const wanted = String(query || '').trim().toLowerCase();
  if (!wanted || games.length === 0) return null;
  const popular = [...games].sort((first, second) => (Number(second.steam_reviews) || 0) - (Number(first.steam_reviews) || 0));
  const title = (game) => String(game.title).toLowerCase();
  return popular.find((game) => title(game) === wanted)
    || popular.find((game) => title(game).startsWith(wanted))
    || popular.find((game) => title(game).includes(wanted))
    || popular[0];
}

module.exports = { ROUNDS, barPercent, bestTitleMatch, compactNumber, duelRadar, sharedTags, versus };
