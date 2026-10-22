// Tier list model (FR-35): every member can sort games into the five classic tiers, S (the best) to D, in their own
// order inside each tier. One row per member and game; removing a game from the list deletes its row, and deleting
// an account or a game deletes its rows. A list holds at most MAX_TIERED games.
const { db, transaction } = require('./database');

const TIERS = ['s', 'a', 'b', 'c', 'd'];
const MAX_TIERED = 100;

db.exec(`
  CREATE TABLE IF NOT EXISTS tier_entries (
    user_id INTEGER NOT NULL,
    game_id INTEGER NOT NULL,
    tier TEXT NOT NULL CHECK(tier IN (${TIERS.map((tier) => `'${tier}'`).join(', ')})),
    position INTEGER NOT NULL DEFAULT 0 CHECK(position BETWEEN 0 AND 9999),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, game_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
  ) STRICT;

  CREATE INDEX IF NOT EXISTS tier_entries_user_idx ON tier_entries (user_id, tier, position);
`);

const statements = {
  list: db.prepare(`
    SELECT t.tier, t.position, g.slug, g.title, g.release_year AS year, g.genre, g.image
    FROM tier_entries t
    JOIN games g ON g.id = t.game_id
    WHERE t.user_id = ?
    ORDER BY t.tier, t.position, g.title COLLATE NOCASE
  `),
  count: db.prepare('SELECT COUNT(*) AS count FROM tier_entries WHERE user_id = ?'),
  gameId: db.prepare('SELECT id FROM games WHERE slug = ?'),
  existing: db.prepare('SELECT tier FROM tier_entries WHERE user_id = ? AND game_id = ?'),
  lastPosition: db.prepare('SELECT COALESCE(MAX(position), -1) AS position FROM tier_entries WHERE user_id = ? AND tier = ?'),
  upsert: db.prepare(`
    INSERT INTO tier_entries (user_id, game_id, tier, position) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, game_id) DO UPDATE SET tier = excluded.tier, position = excluded.position, updated_at = CURRENT_TIMESTAMP
  `),
  remove: db.prepare('DELETE FROM tier_entries WHERE user_id = ? AND game_id = ?'),
  clear: db.prepare('DELETE FROM tier_entries WHERE user_id = ?'),
  // Library games that are not in the tier list yet, most recently changed first.
  pool: db.prepare(`
    SELECT g.slug, g.title, g.release_year AS year, g.genre, g.image
    FROM user_library ul
    JOIN games g ON g.id = ul.game_id
    LEFT JOIN tier_entries t ON t.user_id = ul.user_id AND t.game_id = ul.game_id
    WHERE ul.user_id = ? AND t.game_id IS NULL
    ORDER BY ul.updated_at DESC, g.title COLLATE NOCASE
    LIMIT 60
  `),
};

const isTier = (value) => TIERS.includes(value);

// The member's list as { s: [games], a: [...], … } plus the total.
function tierListFor(userId) {
  const tiers = Object.fromEntries(TIERS.map((tier) => [tier, []]));
  const rows = statements.list.all(userId);
  for (const row of rows) tiers[row.tier].push(row);
  return { tiers, total: rows.length };
}

function tierPoolFor(userId) {
  return statements.pool.all(userId);
}

// Puts a game at the end of a tier (or moves it there). Returns 'placed', 'moved', 'full' or 'missing'.
function placeInTier(userId, slug, tier) {
  if (!isTier(tier)) throw new Error(`Unknown tier "${tier}".`);
  const game = statements.gameId.get(slug);
  if (!game) return 'missing';
  const existing = statements.existing.get(userId, game.id);
  if (!existing && statements.count.get(userId).count >= MAX_TIERED) return 'full';
  if (existing?.tier === tier) return 'moved';
  const position = Math.min(9999, statements.lastPosition.get(userId, tier).position + 1);
  statements.upsert.run(userId, game.id, tier, position);
  return existing ? 'moved' : 'placed';
}

function removeFromTiers(userId, slug) {
  const game = statements.gameId.get(slug);
  return game ? Number(statements.remove.run(userId, game.id).changes) > 0 : false;
}

/*
 * Saves the whole board after a drag: `order` is [{ slug, tier }] in display order (tier null = back to the pool).
 * Games not listed keep their place. Unknown games are skipped; the limit still applies. Returns the new total.
 */
function saveTierOrder(userId, order) {
  return transaction(() => {
    const positions = Object.fromEntries(TIERS.map((tier) => [tier, 0]));
    for (const { slug, tier } of order) {
      const game = statements.gameId.get(slug);
      if (!game) continue;
      if (tier === null) {
        statements.remove.run(userId, game.id);
        continue;
      }
      if (!isTier(tier)) continue;
      const existing = statements.existing.get(userId, game.id);
      if (!existing && statements.count.get(userId).count >= MAX_TIERED) continue;
      statements.upsert.run(userId, game.id, tier, Math.min(9999, positions[tier]));
      positions[tier] += 1;
    }
    return statements.count.get(userId).count;
  });
}

function clearTiers(userId) {
  return Number(statements.clear.run(userId).changes);
}

module.exports = { MAX_TIERED, TIERS, clearTiers, placeInTier, removeFromTiers, saveTierOrder, tierListFor, tierPoolFor };
