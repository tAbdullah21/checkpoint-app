const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const defaultDataDirectory = path.join(__dirname, '..', 'data');
const databasePath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(defaultDataDirectory, 'checkpoint.db');

fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const db = new DatabaseSync(databasePath, {
  timeout: 5000,
  enableForeignKeyConstraints: true,
});

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL CHECK(length(name) BETWEEN 2 AND 60),
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) STRICT;
`);

const userColumns = new Set(
  db.prepare('PRAGMA table_info(users)').all().map((column) => column.name),
);

const userMigrations = [
  ['bio', "ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT '' CHECK(length(bio) <= 280)"],
  ['steam_id', "ALTER TABLE users ADD COLUMN steam_id TEXT NOT NULL DEFAULT '' CHECK(length(steam_id) <= 64)"],
  ['psn_id', "ALTER TABLE users ADD COLUMN psn_id TEXT NOT NULL DEFAULT '' CHECK(length(psn_id) <= 32)"],
  ['xbox_id', "ALTER TABLE users ADD COLUMN xbox_id TEXT NOT NULL DEFAULT '' CHECK(length(xbox_id) <= 32)"],
  ['steam_visible', 'ALTER TABLE users ADD COLUMN steam_visible INTEGER NOT NULL DEFAULT 1 CHECK(steam_visible IN (0, 1))'],
  ['psn_visible', 'ALTER TABLE users ADD COLUMN psn_visible INTEGER NOT NULL DEFAULT 1 CHECK(psn_visible IN (0, 1))'],
  ['xbox_visible', 'ALTER TABLE users ADD COLUMN xbox_visible INTEGER NOT NULL DEFAULT 1 CHECK(xbox_visible IN (0, 1))'],
  ['preferred_platform', "ALTER TABLE users ADD COLUMN preferred_platform TEXT NOT NULL DEFAULT '' CHECK(preferred_platform IN ('', 'steam', 'playstation', 'xbox'))"],
  ['favorite_genres', "ALTER TABLE users ADD COLUMN favorite_genres TEXT NOT NULL DEFAULT '' CHECK(length(favorite_genres) <= 250)"],
];

for (const [column, statement] of userMigrations) {
  if (!userColumns.has(column)) {
    db.exec(statement);
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    release_year INTEGER NOT NULL,
    genre TEXT NOT NULL,
    rating REAL NOT NULL,
    image TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS user_library (
    user_id INTEGER NOT NULL,
    game_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'want_to_play'
      CHECK(status IN ('want_to_play', 'playing', 'played', 'completed')),
    is_favorite INTEGER NOT NULL DEFAULT 0 CHECK(is_favorite IN (0, 1)),
    added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, game_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
  ) STRICT;
`);

const gameColumns = new Set(
  db.prepare('PRAGMA table_info(games)').all().map((column) => column.name),
);

const gameMigrations = [
  ['description', "ALTER TABLE games ADD COLUMN description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 600)"],
  ['platforms', "ALTER TABLE games ADD COLUMN platforms TEXT NOT NULL DEFAULT '' CHECK(length(platforms) <= 100)"],
];

for (const [column, statement] of gameMigrations) {
  if (!gameColumns.has(column)) {
    db.exec(statement);
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    game_id INTEGER NOT NULL,
    rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
    review_text TEXT NOT NULL CHECK(length(review_text) BETWEEN 3 AND 800),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, game_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
  ) STRICT;

  CREATE INDEX IF NOT EXISTS reviews_game_updated_idx
    ON reviews (game_id, updated_at DESC);
`);

const seedGameStatement = db.prepare(`
  INSERT INTO games (slug, title, release_year, genre, rating, image, description, platforms)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(slug) DO UPDATE SET
    title = excluded.title,
    release_year = excluded.release_year,
    genre = excluded.genre,
    rating = excluded.rating,
    image = excluded.image,
    description = excluded.description,
    platforms = excluded.platforms
`);

const gameSeeds = [
  ['elden-ring', 'Elden Ring', 2022, 'Action RPG', 4.8, '/images/covers/elden-ring.jpg', 'Explore a vast dark-fantasy world, build your own warrior, and overcome demanding enemies across the Lands Between.', 'steam,playstation,xbox'],
  ['cyberpunk-2077', 'Cyberpunk 2077', 2020, 'Action RPG', 4.3, '/images/covers/cyberpunk-2077.jpg', 'Enter Night City as a customizable mercenary and shape a story filled with dangerous jobs, powerful technology, and difficult choices.', 'steam,playstation,xbox'],
  ['red-dead-redemption-2', 'Red Dead Redemption 2', 2018, 'Open World', 4.9, '/images/covers/red-dead-redemption-2.jpg', 'Follow outlaw Arthur Morgan through a detailed open world as his gang struggles to survive the closing years of the American frontier.', 'steam,playstation,xbox'],
  ['forza-horizon-5', 'Forza Horizon 5', 2021, 'Racing', 4.4, '/images/covers/forza-horizon-5.jpg', 'Drive hundreds of cars through a colorful open-world celebration of racing, exploration, and online events set across Mexico.', 'steam,xbox'],
  ['baldurs-gate-3', "Baldur's Gate 3", 2023, 'Fantasy RPG', 4.8, '/images/covers/baldurs-gate-3.jpg', 'Gather a party, make meaningful choices, and explore a reactive fantasy world built around tactical combat and character-driven storytelling.', 'steam,playstation,xbox'],
  ['subnautica', 'Subnautica', 2018, 'Survival Adventure', 4.6, '/images/covers/subnautica.jpg', 'Survive on an alien ocean planet by gathering resources, building underwater bases, and discovering what waits in the depths.', 'steam,playstation,xbox'],
  ['ea-sports-fc-27', 'EA Sports FC 27', 2026, 'Sports', 4.3, '/images/covers/ea-sports-fc-27.webp', 'Build a squad, compete across major football modes, and take control of clubs and players in the latest FC season.', 'steam,playstation,xbox'],
  ['kingdom-come-deliverance-2', 'Kingdom Come: Deliverance II', 2025, 'Action RPG', 4.7, '/images/covers/kingdom-come-deliverance-2.jpg', 'Continue Henry’s story through a grounded medieval world shaped by sword fighting, exploration, dialogue, and player choice.', 'steam,playstation,xbox'],
  ['clair-obscur-expedition-33', 'Clair Obscur: Expedition 33', 2025, 'Turn-Based RPG', 4.9, '/images/covers/clair-obscur-expedition-33.jpg', 'Lead Expedition 33 through a surreal fantasy world in a story-focused role-playing adventure with reactive turn-based battles.', 'steam,playstation,xbox'],
  ['monster-hunter-wilds', 'Monster Hunter Wilds', 2025, 'Action RPG', 4.4, '/images/covers/monster-hunter-wilds.jpg', 'Track enormous creatures across changing environments, craft stronger equipment, and hunt alone or with other players.', 'steam,playstation,xbox'],
  ['split-fiction', 'Split Fiction', 2025, 'Co-op Adventure', 4.8, '/images/covers/split-fiction.jpg', 'Work together through imaginative science-fiction and fantasy worlds in a cooperative adventure designed for two players.', 'steam,playstation,xbox'],
  ['doom-the-dark-ages', 'DOOM: The Dark Ages', 2025, 'First-Person Shooter', 4.5, '/images/covers/doom-the-dark-ages.jpg', 'Fight through a dark medieval war as the Doom Slayer using heavy weapons, aggressive movement, and powerful new equipment.', 'steam,playstation,xbox'],
  ['assassins-creed-shadows', "Assassin's Creed Shadows", 2025, 'Action Adventure', 4.2, '/images/covers/assassins-creed-shadows.jpg', 'Explore feudal Japan through the different abilities of a stealth-focused shinobi and a powerful samurai warrior.', 'steam,playstation,xbox'],
  ['battlefield-6', 'Battlefield 6', 2025, 'First-Person Shooter', 4.4, '/images/covers/battlefield-6.png', 'Enter large-scale modern battles featuring class-based teamwork, vehicles, destruction, and cinematic multiplayer action.', 'steam,playstation,xbox'],
  ['resident-evil-requiem', 'Resident Evil Requiem', 2026, 'Survival Horror', 4.6, '/images/covers/resident-evil-requiem.jpg', 'Investigate a frightening new mystery where careful exploration, limited resources, and dangerous encounters drive the tension.', 'steam,playstation,xbox'],
  ['death-stranding-2', 'Death Stranding 2: On the Beach', 2025, 'Action Adventure', 4.7, '/images/covers/death-stranding-2.jpg', 'Reconnect a fractured world as Sam journeys through dangerous landscapes with new companions, tools, and threats.', 'playstation'],
];

for (const game of gameSeeds) {
  seedGameStatement.run(...game);
}

const findUserByEmailStatement = db.prepare(`
  SELECT id, name, email, password_hash, bio, steam_id, psn_id, xbox_id,
    steam_visible, psn_visible, xbox_visible, preferred_platform, favorite_genres, created_at
  FROM users
  WHERE email = ?
`);

const findUserByIdStatement = db.prepare(`
  SELECT id, name, email, bio, steam_id, psn_id, xbox_id,
    steam_visible, psn_visible, xbox_visible, preferred_platform, favorite_genres, created_at
  FROM users
  WHERE id = ?
`);

const createUserStatement = db.prepare(`
  INSERT INTO users (name, email, password_hash)
  VALUES (?, ?, ?)
`);

const updateUserProfileStatement = db.prepare(`
  UPDATE users
  SET name = ?, bio = ?, steam_id = ?, psn_id = ?, xbox_id = ?,
    steam_visible = ?, psn_visible = ?, xbox_visible = ?, preferred_platform = ?, favorite_genres = ?
  WHERE id = ?
`);

const listGamesForUserStatement = db.prepare(`
  SELECT g.id, g.slug, g.title, g.release_year AS year, g.genre,
    CASE WHEN COUNT(r.id) > 0 THEN ROUND(AVG(r.rating), 1) ELSE g.rating END AS rating,
    g.rating AS catalogue_rating, COUNT(r.id) AS review_count, g.image, g.description, g.platforms,
    ul.status, ul.is_favorite
  FROM games g
  LEFT JOIN user_library ul ON ul.game_id = g.id AND ul.user_id = ?
  LEFT JOIN reviews r ON r.game_id = g.id
  GROUP BY g.id, ul.status, ul.is_favorite
  ORDER BY g.release_year DESC, g.id ASC
`);

const searchGamesForUserStatement = db.prepare(`
  SELECT g.id, g.slug, g.title, g.release_year AS year, g.genre,
    CASE WHEN COUNT(r.id) > 0 THEN ROUND(AVG(r.rating), 1) ELSE g.rating END AS rating,
    g.rating AS catalogue_rating, COUNT(r.id) AS review_count, g.image, g.description, g.platforms,
    ul.status, ul.is_favorite
  FROM games g
  LEFT JOIN user_library ul ON ul.game_id = g.id AND ul.user_id = ?
  LEFT JOIN reviews r ON r.game_id = g.id
  WHERE (? = '' OR g.title LIKE '%' || ? || '%' COLLATE NOCASE
    OR g.genre LIKE '%' || ? || '%' COLLATE NOCASE)
    AND (? = '' OR g.genre = ? COLLATE NOCASE)
  GROUP BY g.id, ul.status, ul.is_favorite
  ORDER BY g.release_year DESC, g.title COLLATE NOCASE
`);

const findGameBySlugStatement = db.prepare(`
  SELECT g.id, g.slug, g.title, g.release_year AS year, g.genre,
    CASE WHEN COUNT(r.id) > 0 THEN ROUND(AVG(r.rating), 1) ELSE g.rating END AS rating,
    g.rating AS catalogue_rating, COUNT(r.id) AS review_count, g.image, g.description, g.platforms,
    ul.status, ul.is_favorite
  FROM games g
  LEFT JOIN user_library ul ON ul.game_id = g.id AND ul.user_id = ?
  LEFT JOIN reviews r ON r.game_id = g.id
  WHERE g.slug = ?
  GROUP BY g.id, ul.status, ul.is_favorite
`);

const listGameGenresStatement = db.prepare(`
  SELECT DISTINCT genre
  FROM games
  ORDER BY genre COLLATE NOCASE
`);

const listUserLibraryStatement = db.prepare(`
  SELECT g.id, g.slug, g.title, g.release_year AS year, g.genre, g.rating, g.image,
    ul.status, ul.is_favorite, ul.added_at, ul.updated_at
  FROM user_library ul
  JOIN games g ON g.id = ul.game_id
  WHERE ul.user_id = ?
  ORDER BY ul.is_favorite DESC, ul.updated_at DESC, g.title COLLATE NOCASE
`);

const addLibraryGameStatement = db.prepare(`
  INSERT INTO user_library (user_id, game_id, status)
  SELECT ?, id, ? FROM games WHERE slug = ?
  ON CONFLICT(user_id, game_id) DO UPDATE SET
    status = excluded.status,
    updated_at = CURRENT_TIMESTAMP
`);

const updateLibraryGameStatement = db.prepare(`
  UPDATE user_library
  SET status = ?, is_favorite = ?, updated_at = CURRENT_TIMESTAMP
  WHERE user_id = ? AND game_id = (SELECT id FROM games WHERE slug = ?)
`);

const removeLibraryGameStatement = db.prepare(`
  DELETE FROM user_library
  WHERE user_id = ? AND game_id = (SELECT id FROM games WHERE slug = ?)
`);

const countFavoriteGamesStatement = db.prepare(`
  SELECT COUNT(*) AS count
  FROM user_library
  WHERE user_id = ? AND is_favorite = 1
`);

const findLibraryGameStatement = db.prepare(`
  SELECT g.slug, ul.status, ul.is_favorite
  FROM user_library ul
  JOIN games g ON g.id = ul.game_id
  WHERE ul.user_id = ? AND g.slug = ?
`);

const listReviewsByGameStatement = db.prepare(`
  SELECT r.id, r.rating, r.review_text, r.created_at, r.updated_at,
    u.id AS user_id, u.name AS user_name
  FROM reviews r
  JOIN users u ON u.id = r.user_id
  WHERE r.game_id = ?
  ORDER BY r.updated_at DESC, r.id DESC
`);

const findUserReviewStatement = db.prepare(`
  SELECT r.id, r.rating, r.review_text, r.created_at, r.updated_at
  FROM reviews r
  JOIN games g ON g.id = r.game_id
  WHERE r.user_id = ? AND g.slug = ?
`);

const upsertReviewStatement = db.prepare(`
  INSERT INTO reviews (user_id, game_id, rating, review_text)
  SELECT ?, id, ?, ? FROM games WHERE slug = ?
  ON CONFLICT(user_id, game_id) DO UPDATE SET
    rating = excluded.rating,
    review_text = excluded.review_text,
    updated_at = CURRENT_TIMESTAMP
`);

const deleteReviewStatement = db.prepare(`
  DELETE FROM reviews
  WHERE user_id = ? AND game_id = (SELECT id FROM games WHERE slug = ?)
`);

const listRecentReviewsStatement = db.prepare(`
  SELECT r.id, r.rating, r.review_text, r.updated_at,
    u.name AS user_name, g.slug, g.title, g.image
  FROM reviews r
  JOIN users u ON u.id = r.user_id
  JOIN games g ON g.id = r.game_id
  ORDER BY r.updated_at DESC, r.id DESC
  LIMIT ?
`);

function findUserByEmail(email) {
  return findUserByEmailStatement.get(email);
}

function findUserById(id) {
  return findUserByIdStatement.get(id);
}

function createUser({ name, email, passwordHash }) {
  const result = createUserStatement.run(name, email, passwordHash);
  return findUserById(result.lastInsertRowid);
}

function updateUserProfile({
  id,
  name,
  bio,
  steamId,
  psnId,
  xboxId,
  steamVisible,
  psnVisible,
  xboxVisible,
  preferredPlatform,
  favoriteGenres,
}) {
  updateUserProfileStatement.run(
    name,
    bio,
    steamId,
    psnId,
    xboxId,
    steamVisible ? 1 : 0,
    psnVisible ? 1 : 0,
    xboxVisible ? 1 : 0,
    preferredPlatform,
    favoriteGenres,
    id,
  );
  return findUserById(id);
}

function listGamesForUser(userId) {
  return listGamesForUserStatement.all(userId || -1);
}

function searchGamesForUser(userId, { query = '', genre = '' } = {}) {
  return searchGamesForUserStatement.all(
    userId || -1,
    query,
    query,
    query,
    genre,
    genre,
  );
}

function findGameBySlug(userId, slug) {
  return findGameBySlugStatement.get(userId || -1, slug);
}

function listGameGenres() {
  return listGameGenresStatement.all().map((row) => row.genre);
}

function listUserLibrary(userId) {
  return listUserLibraryStatement.all(userId);
}

function addLibraryGame(userId, slug, status) {
  return addLibraryGameStatement.run(userId, status, slug).changes > 0;
}

function updateLibraryGame(userId, slug, status, isFavorite) {
  return updateLibraryGameStatement.run(status, isFavorite ? 1 : 0, userId, slug).changes > 0;
}

function removeLibraryGame(userId, slug) {
  return removeLibraryGameStatement.run(userId, slug).changes > 0;
}

function countFavoriteGames(userId) {
  return Number(countFavoriteGamesStatement.get(userId).count);
}

function findLibraryGame(userId, slug) {
  return findLibraryGameStatement.get(userId, slug);
}

function listReviewsByGame(gameId) {
  return listReviewsByGameStatement.all(gameId);
}

function findUserReview(userId, slug) {
  return findUserReviewStatement.get(userId, slug);
}

function upsertReview(userId, slug, rating, reviewText) {
  return upsertReviewStatement.run(userId, rating, reviewText, slug).changes > 0;
}

function deleteReview(userId, slug) {
  return deleteReviewStatement.run(userId, slug).changes > 0;
}

function listRecentReviews(limit = 3) {
  return listRecentReviewsStatement.all(Math.max(1, Math.min(Number(limit) || 3, 10)));
}

function closeDatabase() {
  db.close();
}

module.exports = {
  addLibraryGame,
  closeDatabase,
  countFavoriteGames,
  createUser,
  deleteReview,
  findGameBySlug,
  findLibraryGame,
  findUserReview,
  findUserByEmail,
  findUserById,
  listGameGenres,
  listGamesForUser,
  listRecentReviews,
  listReviewsByGame,
  listUserLibrary,
  removeLibraryGame,
  searchGamesForUser,
  upsertReview,
  updateLibraryGame,
  updateUserProfile,
};
