/*
 * "For You" recommendations: an explainable content-based recommender.
 *
 * 1. Every game becomes a weighted feature vector: its genre, the words inside the genre (e.g. "RPG"),
 *    its gameplay tags (e.g. "open world", "soulslike"), keywords from its description weighted with
 *    TF-IDF, its platforms and its release era.
 * 2. A player's taste profile is the weighted sum of the games they interacted with:
 *    library status, favourites and star ratings (a 1-2 star rating pushes the profile away),
 *    plus the favourite genres and preferred platform from their profile.
 * 3. Each candidate game is scored with cosine similarity to the taste profile, blended with
 *    its community rating, and the strongest link to a game the player already knows is used
 *    as the human-readable reason ("Because you completed Elden Ring").
 *
 * Pure functions only (no database access), so the module is easy to unit test.
 */

const STOPWORDS = new Set(`a about across after against all along also an and any are around as at be because been
before being between both but by can could do does each even every for from further has have he her his how if in
into is it its just like made make many more most much new not now of on once one only or other our out over own
same she should so some such than that the their them then there these they this those through to too under until
up very was way we were what when where which while who why will with within without would you your you're
become becomes build builds choose choosing designed different explore filled latest player players story world
enter take continue switch play lead work follow gather defend rescue climb inherit track reconnect swing investigate
together using three part close draws approaches matter pulling plans`
  .split(/\s+/));

const STATUS_WEIGHTS = { completed: 1.0, playing: 0.8, played: 0.7, want_to_play: 0.35 };
const FAVORITE_BONUS = 0.6;
const PROFILE_GENRE_WEIGHT = 0.8;
const PROFILE_PLATFORM_WEIGHT = 0.5;
const QUALITY_BLEND = 0.18;
const PLATFORM_LABELS = { steam: 'PC', playstation: 'PlayStation', xbox: 'Xbox' };
const TAG_LABELS = { 'co-op': 'Co-op', rpg: 'RPG', 'sci-fi': 'Sci-fi', 'turn-based': 'Turn-based', 'fast-paced': 'Fast-paced' };

function tagWords(genre) {
  return String(genre).toLowerCase().split(/\s+/).filter(Boolean);
}

// Steam and the hand-picked games spell a few tags differently ("souls-like" / "soulslike", "coop" / "co-op");
// each spelling maps to one tag, keyed by the tag without spaces and hyphens.
const TAG_SPELLINGS = { soulslike: 'soulslike', coop: 'co-op', citybuilder: 'city builder' };

// Gameplay tags such as "open world" or "soulslike" (comma-separated in the database), one spelling each.
function gameplayTags(tags) {
  const seen = new Set();
  return String(tags || '').toLowerCase().split(',').map((tag) => tag.trim()).filter(Boolean)
    .map((tag) => TAG_SPELLINGS[tag.replace(/[\s-]+/g, '')] || tag)
    .filter((tag) => !seen.has(tag) && seen.add(tag));
}

function descriptionWords(text) {
  return String(text)
    .toLowerCase()
    .replace(/[’']/g, '')
    .split(/[^a-z0-9-]+/)
    .map((word) => word.replace(/^-+|-+$/g, ''))
    .filter((word) => word.length >= 4 && !STOPWORDS.has(word) && !/^\d+$/.test(word));
}

function eraOf(year) {
  if (year >= 2023) return 'new';
  if (year >= 2018) return 'modern';
  return 'classic';
}

function normalize(vector) {
  let sum = 0;
  for (const value of vector.values()) sum += value * value;
  const length = Math.sqrt(sum);
  if (length === 0) return vector;
  for (const [key, value] of vector) vector.set(key, value / length);
  return vector;
}

function dot(first, second) {
  const [small, large] = first.size <= second.size ? [first, second] : [second, first];
  let total = 0;
  for (const [key, value] of small) {
    const other = large.get(key);
    if (other !== undefined) total += value * other;
  }
  return total;
}

function addTo(vector, key, amount) {
  vector.set(key, (vector.get(key) || 0) + amount);
}

function labelFor(feature) {
  const [kind, value] = feature.split(/:(.*)/s);
  if (kind === 'platform') return PLATFORM_LABELS[value] || value;
  if (kind === 'era') return { new: 'Recent release', modern: 'Modern era', classic: 'Modern classic' }[value];
  if (kind === 'tag') {
    if (TAG_LABELS[value]) return TAG_LABELS[value];
    return value.length <= 3 ? value.toUpperCase() : value.replace(/(^|\s)\w/g, (c) => c.toUpperCase());
  }
  if (kind === 'genre') return value.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bRpg\b/, 'RPG');
  return value;
}

// Display label for a gameplay tag ("open world" → "Open World").
function tagLabel(tag) {
  return labelFor(`tag:${String(tag).toLowerCase()}`);
}

// Normalized feature vectors for the whole catalogue.
function buildVectors(games) {
  const documentFrequency = new Map();
  const wordsByGame = new Map();
  for (const game of games) {
    const words = descriptionWords(game.description || '');
    wordsByGame.set(game.slug, words);
    for (const word of new Set(words)) documentFrequency.set(word, (documentFrequency.get(word) || 0) + 1);
  }

  const total = games.length || 1;
  const vectors = new Map();
  for (const game of games) {
    const vector = new Map();
    addTo(vector, `genre:${String(game.genre).toLowerCase()}`, 2.0);
    for (const word of tagWords(game.genre)) addTo(vector, `tag:${word}`, 1.2);
    for (const tag of gameplayTags(game.tags)) addTo(vector, `tag:${tag}`, 1.0);
    for (const platform of String(game.platforms || '').split(',').filter(Boolean)) addTo(vector, `platform:${platform}`, 0.15);
    addTo(vector, `era:${eraOf(Number(game.year))}`, 0.3);

    const words = wordsByGame.get(game.slug);
    const termFrequency = new Map();
    for (const word of words) termFrequency.set(word, (termFrequency.get(word) || 0) + 1);
    for (const [word, count] of termFrequency) {
      const idf = Math.log(1 + total / documentFrequency.get(word));
      addTo(vector, `kw:${word}`, 0.35 * (count / Math.max(words.length, 1)) * idf * 4);
    }
    vectors.set(game.slug, normalize(vector));
  }
  return vectors;
}

// Every page with match badges needs the vectors, and the catalogue hardly ever changes, so the vectors of the
// last catalogue are reused while every field they are made from stays the same. Nothing changes them later.
let lastVectors = { key: null, vectors: null };

// A fingerprint of every field the vectors are made from: FNV-1a over the text, with the length mixed in. Hashing
// is several times faster than joining a thousand descriptions into one string on every page.
function catalogueKey(games) {
  let hash = 0x811c9dc5;
  let length = 0;
  const add = (value) => {
    const text = String(value ?? '');
    length += text.length + 1;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= 0x1f;
    hash = Math.imul(hash, 0x01000193);
  };
  for (const game of games) {
    add(game.slug);
    add(game.genre);
    add(game.tags);
    add(game.platforms);
    add(game.year);
    add(game.description);
  }
  return `${games.length}:${length}:${(hash >>> 0).toString(16)}`;
}

// The catalogue index: each game's row (with the viewer's library status) and its feature vector.
function buildIndex(games) {
  // Rows from listGamesForUser carry the catalogue version; other callers (tests, scripts) are fingerprinted.
  const key = games.catalogueVersion ? `version:${games.catalogueVersion}` : catalogueKey(games);
  if (lastVectors.key !== key) lastVectors = { key, vectors: buildVectors(games) };
  return { games: new Map(games.map((game) => [game.slug, game])), vectors: lastVectors.vectors, key };
}

function interactionWeight(entry) {
  let weight = STATUS_WEIGHTS[entry.status] || 0;
  if (entry.isFavorite) weight += FAVORITE_BONUS;
  if (Number.isFinite(entry.rating)) weight += ((entry.rating - 3) / 2) * 1.2;
  return weight;
}

/*
 * history: [{ slug, status, isFavorite, rating }] — library entries and/or rated games.
 * favoriteGenres: profile genres such as "RPG"; preferredPlatform: steam | playstation | xbox | ''.
 */
function buildProfile(index, { history = [], favoriteGenres = [], preferredPlatform = '' } = {}) {
  const vector = new Map();
  const contributions = [];
  for (const entry of history) {
    const gameVector = index.vectors.get(entry.slug);
    if (!gameVector) continue;
    const weight = interactionWeight(entry);
    if (weight === 0) continue;
    contributions.push({ ...entry, weight });
    for (const [key, value] of gameVector) addTo(vector, key, weight * value);
  }
  for (const genre of favoriteGenres) addTo(vector, `tag:${String(genre).toLowerCase()}`, PROFILE_GENRE_WEIGHT);
  if (preferredPlatform) addTo(vector, `platform:${preferredPlatform}`, PROFILE_PLATFORM_WEIGHT);

  // Negative weights are only useful for pushing scores down; drop features the player dislikes overall.
  for (const [key, value] of vector) if (value <= 0) vector.delete(key);
  return { vector: normalize(vector), contributions, favoriteGenres, isEmpty: vector.size === 0 };
}

// The concave curve maps raw similarity to an intuitive percentage; it is monotonic, so rankings are unchanged.
function toMatchPercent(score) {
  const clamped = Math.max(0, Math.min(1, score));
  return Math.round(100 * (1 - (1 - clamped) ** 2));
}

// Up to `limit` distinct labels, skipping one whose words overlap a label already chosen
// ("Action RPG" makes a separate "RPG" redundant, and the other way round).
function readableTraits(labels, limit) {
  const chosen = [];
  const words = (label) => label.toLowerCase().split(/\s+/);
  const contains = (outer, inner) => inner.every((word) => outer.includes(word));
  for (const label of labels) {
    if (chosen.length >= limit) break;
    const candidate = words(label);
    const repeats = chosen.some((existing) => contains(words(existing), candidate) || contains(candidate, words(existing)));
    if (!repeats) chosen.push(label);
  }
  return chosen;
}

function reasonFor(contribution) {
  const { title } = contribution;
  if (Number.isFinite(contribution.rating) && contribution.rating >= 4) return `Because you rated ${title} ${contribution.rating}★`;
  if (contribution.isFavorite) return `Because ${title} is one of your favorites`;
  if (contribution.status === 'completed') return `Because you completed ${title}`;
  if (contribution.status === 'playing') return `Because you're playing ${title}`;
  if (contribution.status === 'played') return `Because you played ${title}`;
  return `Similar to ${title} on your wishlist`;
}

// How close a game is to the taste profile, blended with its community rating.
function scoreOf(index, profile, slug) {
  const vector = index.vectors.get(slug);
  const game = index.games.get(slug);
  if (!vector || !game) return null;
  const similarity = dot(profile.vector, vector);
  const quality = Math.max(0, Math.min(5, Number(game.rating) || 0)) / 5;
  return { vector, similarity, score: (1 - QUALITY_BLEND) * similarity + QUALITY_BLEND * quality };
}

// Only the match percentage, for the badges on game cards: the same number scoreGame gives, without the reason.
function matchPercent(index, profile, slug) {
  const scored = scoreOf(index, profile, slug);
  return scored ? toMatchPercent(scored.score) : null;
}

// The game the player already knows that is most like this one, weighted by how much they like it (only
// positive signals explain a match).
function closestKnownGame(index, profile, slug, vector) {
  let closest = null;
  for (const contribution of profile.contributions) {
    if (contribution.weight <= 0 || contribution.slug === slug) continue;
    const similarityToKnown = dot(index.vectors.get(contribution.slug), vector);
    const strength = similarityToKnown * contribution.weight;
    if (!closest || strength > closest.strength) closest = { strength, similarityToKnown, contribution };
  }
  return closest;
}

// The features the game shares with the profile, strongest first: named traits (genres and gameplay tags),
// description keywords and platforms. Eras are never shared out loud.
function sharedFeatures(profile, vector) {
  const shared = [];
  for (const [key, value] of vector) {
    const profileValue = profile.vector.get(key);
    if (profileValue && !key.startsWith('era:')) shared.push({ key, weight: value * profileValue });
  }
  shared.sort((first, second) => second.weight - first.weight);
  return {
    named: shared.filter((item) => item.key.startsWith('genre:') || item.key.startsWith('tag:')),
    keywords: shared.filter((item) => item.key.startsWith('kw:')),
    platforms: shared.filter((item) => item.key.startsWith('platform:')),
  };
}

// The explanation names the strongest signal: a similar game the player knows, then a favorite genre
// when it is the top shared trait, then the two strongest shared traits, then themes and platforms.
function explanation(index, profile, vector, link, { named, keywords, platforms }) {
  if (link) return reasonFor({ ...link.contribution, title: index.games.get(link.contribution.slug)?.title });
  const favoriteGenre = profile.favoriteGenres.find((genre) => vector.has(`tag:${String(genre).toLowerCase()}`));
  const topIsFavorite = favoriteGenre && named.length > 0 && named[0].key === `tag:${String(favoriteGenre).toLowerCase()}`;
  const sharedTraits = readableTraits(named.map((item) => labelFor(item.key)), 2);
  if (topIsFavorite || (favoriteGenre && sharedTraits.length < 2)) return `Matches your favorite genre: ${favoriteGenre}`;
  if (sharedTraits.length === 2) return `Shares ${sharedTraits[0]} and ${sharedTraits[1]} with games you like`;
  if (sharedTraits.length === 1) return `Shares ${sharedTraits[0]} with games you like`;
  if (keywords.length > 0) return `Similar themes: ${labelFor(keywords[0].key)}`;
  if (platforms.length > 0) return 'Fits the platforms you play on';
  return 'Highly rated by Checkpoint players';
}

function scoreGame(index, profile, slug) {
  const scored = scoreOf(index, profile, slug);
  if (!scored) return null;
  const { vector, similarity, score } = scored;
  const closest = closestKnownGame(index, profile, slug, vector);
  // A known game explains the match only when it is clearly similar.
  const link = closest && closest.similarityToKnown >= 0.4 ? closest : null;
  const features = sharedFeatures(profile, vector);
  // Readable traits the game shares with the profile; platforms only fill in when nothing else is shared.
  const traitLabels = [...features.named, ...features.platforms].map((item) => labelFor(item.key));

  return {
    slug,
    score,
    similarity,
    match: toMatchPercent(score),
    reason: explanation(index, profile, vector, link, features),
    traits: readableTraits(traitLabels, features.named.length >= 2 ? 3 : 1),
    basedOn: link ? link.contribution.slug : null,
  };
}

// Returns ranked recommendations; games the player already tracks are excluded unless includeKnown is set.
function recommend(index, profile, { exclude = new Set(), limit = 10 } = {}) {
  if (profile.isEmpty) {
    return [...index.games.values()]
      .filter((game) => !exclude.has(game.slug))
      .sort((first, second) => Number(second.rating) - Number(first.rating) || Number(second.year) - Number(first.year))
      .slice(0, limit)
      .map((game) => ({ slug: game.slug, score: null, match: null, reason: 'Popular with Checkpoint players', traits: [game.genre], basedOn: null }));
  }

  return [...index.games.keys()]
    .filter((slug) => !exclude.has(slug))
    .map((slug) => scoreGame(index, profile, slug))
    .filter(Boolean)
    .sort((first, second) => second.score - first.score || first.slug.localeCompare(second.slug))
    .slice(0, limit);
}

// The player's strongest taste signals, as readable labels with their share of the profile.
function tasteDna(profile, limit = 6) {
  const entries = [...profile.vector].filter(([key]) => key.startsWith('tag:') || key.startsWith('platform:'));
  const total = entries.reduce((sum, [, value]) => sum + value, 0) || 1;
  return entries
    .sort((first, second) => second[1] - first[1])
    .slice(0, limit)
    .map(([key, value]) => ({ label: labelFor(key), share: Math.round((value / total) * 100) }));
}

// "More like this": the catalogue games closest to one game by cosine similarity of their feature vectors.
function similarGames(index, slug, limit = 4) {
  const vector = index.vectors.get(slug);
  if (!vector) return [];
  const ratingOf = (other) => Number(index.games.get(other)?.rating) || 0;
  return [...index.vectors]
    .filter(([other]) => other !== slug)
    .map(([other, otherVector]) => ({ slug: other, similarity: dot(vector, otherVector) }))
    .sort((first, second) => second.similarity - first.similarity
      || ratingOf(second.slug) - ratingOf(first.slug)
      || first.slug.localeCompare(second.slug))
    .slice(0, limit);
}

// How alike two games are (0–1, the cosine of their feature vectors); null when either is unknown.
function pairSimilarity(index, firstSlug, secondSlug) {
  const first = index.vectors.get(firstSlug);
  const second = index.vectors.get(secondSlug);
  return first && second ? dot(first, second) : null;
}

// How similar two players' tastes are, with the traits they share most.
function compareProfiles(first, second) {
  if (first.isEmpty || second.isEmpty) return null;
  const similarity = dot(first.vector, second.vector);
  const shared = [...first.vector]
    .filter(([key]) => (key.startsWith('tag:') || key.startsWith('genre:')) && second.vector.has(key))
    .map(([key, value]) => ({ label: labelFor(key), weight: value * second.vector.get(key) }))
    .sort((a, b) => b.weight - a.weight);
  return {
    similarity,
    match: toMatchPercent(similarity),
    shared: readableTraits(shared.map((item) => item.label), 3),
  };
}

module.exports = {
  buildIndex,
  gameplayTags,
  buildProfile,
  compareProfiles,
  descriptionWords,
  matchPercent,
  pairSimilarity,
  recommend,
  scoreGame,
  similarGames,
  tagLabel,
  tasteDna,
  toMatchPercent,
};
