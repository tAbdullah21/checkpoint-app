// Private recommendation feedback and optional first-visit setup progress.
const { db } = require('./database');
db.exec(`
  CREATE TABLE IF NOT EXISTS preference_setup (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) STRICT;
  CREATE TABLE IF NOT EXISTS dismissed_games (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, game_id)
  ) STRICT;
`);
const statements = {
  finish: db.prepare('INSERT OR IGNORE INTO preference_setup (user_id) VALUES (?)'),
  done: db.prepare('SELECT 1 FROM preference_setup WHERE user_id = ?'),
  preferences: db.prepare('UPDATE users SET favorite_genres = ?, preferred_platform = ? WHERE id = ?'),
  dismiss: db.prepare('INSERT OR IGNORE INTO dismissed_games (user_id, game_id) VALUES (?, ?)'),
  restore: db.prepare('DELETE FROM dismissed_games WHERE user_id = ? AND game_id = ?'),
  hidden: db.prepare('SELECT g.slug, g.title, g.image, d.created_at FROM dismissed_games d JOIN games g ON g.id = d.game_id WHERE d.user_id = ? ORDER BY d.created_at DESC, g.slug'),
};
module.exports = {
  finishSetup: (id) => statements.finish.run(id),
  setupCompleted: (id) => Boolean(statements.done.get(id)),
  savePreferences: (id, genres, platform) => statements.preferences.run(genres.join(','), platform, id),
  dismissGame: (id, gameId) => statements.dismiss.run(id, gameId),
  restoreGame: (id, gameId) => statements.restore.run(id, gameId),
  dismissedGames: (id) => id ? statements.hidden.all(id) : [],
};
