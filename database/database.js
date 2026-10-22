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

// WAL lets pages read while a write is running. synchronous = NORMAL is the setting SQLite recommends with WAL:
// a commit no longer waits for the disk to confirm every write (only checkpoints do), and the database cannot be
// corrupted by a crash; at worst a power cut loses the last few seconds of changes.
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;

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
  ['profile_public', 'ALTER TABLE users ADD COLUMN profile_public INTEGER NOT NULL DEFAULT 1 CHECK(profile_public IN (0, 1))'],
  // Administrators moderate reported reviews and replies (2.4); `npm run admin` grants the role.
  ['role', "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member', 'admin'))"],
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
  ['tags', "ALTER TABLE games ADD COLUMN tags TEXT NOT NULL DEFAULT '' CHECK(length(tags) <= 200)"],
  // 3.5: the Steam store number behind a game's real cover and trailer (see lib/steam-media.js), and the compact
  // codes that say which cover file and trailer Steam serves for it. NULL / '' mean "no Steam media known".
  ['steam_appid', 'ALTER TABLE games ADD COLUMN steam_appid INTEGER CHECK(steam_appid IS NULL OR steam_appid > 0)'],
  ['trailer_path', "ALTER TABLE games ADD COLUMN trailer_path TEXT NOT NULL DEFAULT '' CHECK(length(trailer_path) <= 120)"],
  ['cover_code', "ALTER TABLE games ADD COLUMN cover_code TEXT NOT NULL DEFAULT '' CHECK(length(cover_code) <= 60)"],
  // 3.7: exact Steam addresses of the cover files, wide artwork and screenshots, plus developer, publisher and the
  // Steam review numbers, as one small JSON object (database/catalog.js writes it, lib/steam-media.js reads it).
  ['media', "ALTER TABLE games ADD COLUMN media TEXT NOT NULL DEFAULT '{}' CHECK(length(media) <= 4000)"],
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
    rating REAL NOT NULL CHECK(rating BETWEEN 0.5 AND 5 AND rating * 2 = CAST(rating * 2 AS INTEGER)),
    review_text TEXT NOT NULL DEFAULT '' CHECK(length(review_text) = 0 OR length(review_text) BETWEEN 3 AND 800),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, game_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
  ) STRICT;

  CREATE INDEX IF NOT EXISTS reviews_game_updated_idx
    ON reviews (game_id, updated_at DESC);
`);

// SQLite cannot change a column type or CHECK in place. Rebuild with foreign-key actions disabled only
// during this transaction, preserving primary keys, dependent rows, timestamps and explicit indexes.
function upgradeRatingTable(table, transform) {
  const original = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql;
  if (!original) return false;
  const updated = transform(original);
  if (updated === original) return false;
  const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL").all(table);
  const temporary = `${table}_half_star_upgrade`;
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(updated.replace(/^CREATE TABLE\s+(?:"[^"]+"|[^\s(]+)/, `CREATE TABLE ${temporary}`));
    db.exec(`INSERT INTO ${temporary} SELECT * FROM ${table}`);
    db.exec(`DROP TABLE ${table}`);
    db.exec(`ALTER TABLE ${temporary} RENAME TO ${table}`);
    for (const index of indexes) db.exec(index.sql);
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Rating migration failed its foreign-key check.');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
  return true;
}

upgradeRatingTable('reviews', (sql) => sql
  .replace('rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5)', 'rating REAL NOT NULL CHECK(rating BETWEEN 0.5 AND 5 AND rating * 2 = CAST(rating * 2 AS INTEGER))')
  .replace('review_text TEXT NOT NULL CHECK(length(review_text) BETWEEN 3 AND 800)', "review_text TEXT NOT NULL DEFAULT '' CHECK(length(review_text) = 0 OR length(review_text) BETWEEN 3 AND 800)"));

const seedGameStatement = db.prepare(`
  INSERT INTO games (slug, title, release_year, genre, rating, image, description, platforms, tags)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(slug) DO UPDATE SET
    title = excluded.title,
    release_year = excluded.release_year,
    genre = excluded.genre,
    rating = excluded.rating,
    image = excluded.image,
    description = excluded.description,
    platforms = excluded.platforms,
    tags = excluded.tags
`);

const gameSeeds = [
  ['elden-ring', 'Elden Ring', 2022, 'Action RPG', 4.8, '/images/covers/elden-ring.jpg', 'Explore a vast dark-fantasy world, build your own warrior, and overcome demanding enemies across the Lands Between.', 'steam,playstation,xbox', 'open world,soulslike,fantasy,difficult,exploration'],
  ['cyberpunk-2077', 'Cyberpunk 2077', 2020, 'Action RPG', 4.3, '/images/covers/cyberpunk-2077.jpg', 'Enter Night City as a customizable mercenary and shape a story filled with dangerous jobs, powerful technology, and difficult choices.', 'steam,playstation,xbox', 'open world,sci-fi,story rich,choices matter,shooter'],
  ['red-dead-redemption-2', 'Red Dead Redemption 2', 2018, 'Open World', 4.9, '/images/covers/red-dead-redemption-2.jpg', 'Follow outlaw Arthur Morgan through a detailed open world as his gang struggles to survive the closing years of the American frontier.', 'steam,playstation,xbox', 'open world,western,story rich,exploration'],
  ['forza-horizon-5', 'Forza Horizon 5', 2021, 'Racing', 4.4, '/images/covers/forza-horizon-5.jpg', 'Drive hundreds of cars through a colorful open-world celebration of racing, exploration, and online events set across Mexico.', 'steam,xbox', 'open world,driving,multiplayer,exploration'],
  ['baldurs-gate-3', "Baldur's Gate 3", 2023, 'Fantasy RPG', 4.8, '/images/covers/baldurs-gate-3.jpg', 'Gather a party, make meaningful choices, and explore a reactive fantasy world built around tactical combat and character-driven storytelling.', 'steam,playstation,xbox', 'fantasy,strategy,turn-based,choices matter,story rich,co-op'],
  ['subnautica', 'Subnautica', 2018, 'Survival Adventure', 4.6, '/images/covers/subnautica.jpg', 'Survive on an alien ocean planet by gathering resources, building underwater bases, and discovering what waits in the depths.', 'steam,playstation,xbox', 'survival,crafting,exploration,indie,atmospheric,sci-fi'],
  ['ea-sports-fc-27', 'EA Sports FC 27', 2026, 'Sports', 4.3, '/images/covers/ea-sports-fc-27.webp', 'Build a squad, compete across major football modes, and take control of clubs and players in the latest FC season.', 'steam,playstation,xbox', 'football,multiplayer,competitive'],
  ['kingdom-come-deliverance-2', 'Kingdom Come: Deliverance II', 2025, 'Action RPG', 4.7, '/images/covers/kingdom-come-deliverance-2.jpg', 'Continue Henry’s story through a grounded medieval world shaped by sword fighting, exploration, dialogue, and player choice.', 'steam,playstation,xbox', 'medieval,open world,story rich,choices matter,realistic'],
  ['clair-obscur-expedition-33', 'Clair Obscur: Expedition 33', 2025, 'Turn-Based RPG', 4.9, '/images/covers/clair-obscur-expedition-33.jpg', 'Lead Expedition 33 through a surreal fantasy world in a story-focused role-playing adventure with reactive turn-based battles.', 'steam,playstation,xbox', 'turn-based,fantasy,story rich,atmospheric'],
  ['monster-hunter-wilds', 'Monster Hunter Wilds', 2025, 'Action RPG', 4.4, '/images/covers/monster-hunter-wilds.jpg', 'Track enormous creatures across changing environments, craft stronger equipment, and hunt alone or with other players.', 'steam,playstation,xbox', 'co-op,crafting,fantasy,multiplayer,difficult'],
  ['split-fiction', 'Split Fiction', 2025, 'Co-op Adventure', 4.8, '/images/covers/split-fiction.jpg', 'Work together through imaginative science-fiction and fantasy worlds in a cooperative adventure designed for two players.', 'steam,playstation,xbox', 'co-op,sci-fi,fantasy,story rich,platformer'],
  ['doom-the-dark-ages', 'DOOM: The Dark Ages', 2025, 'First-Person Shooter', 4.5, '/images/covers/doom-the-dark-ages.jpg', 'Fight through a dark medieval war as the Doom Slayer using heavy weapons, aggressive movement, and powerful new equipment.', 'steam,playstation,xbox', 'shooter,medieval,fast-paced,dark fantasy'],
  ['assassins-creed-shadows', "Assassin's Creed Shadows", 2025, 'Action Adventure', 4.2, '/images/covers/assassins-creed-shadows.jpg', 'Explore feudal Japan through the different abilities of a stealth-focused shinobi and a powerful samurai warrior.', 'steam,playstation,xbox', 'open world,stealth,japan,story rich'],
  ['battlefield-6', 'Battlefield 6', 2025, 'First-Person Shooter', 4.4, '/images/covers/battlefield-6.png', 'Enter large-scale modern battles featuring class-based teamwork, vehicles, destruction, and cinematic multiplayer action.', 'steam,playstation,xbox', 'shooter,multiplayer,competitive,military'],
  ['resident-evil-requiem', 'Resident Evil Requiem', 2026, 'Survival Horror', 4.6, '/images/covers/resident-evil-requiem.jpg', 'Investigate a frightening new mystery where careful exploration, limited resources, and dangerous encounters drive the tension.', 'steam,playstation,xbox', 'horror,survival,atmospheric,story rich'],
  ['death-stranding-2', 'Death Stranding 2: On the Beach', 2025, 'Action Adventure', 4.7, '/images/covers/death-stranding-2.jpg', 'Reconnect a fractured world as Sam journeys through dangerous landscapes with new companions, tools, and threats.', 'playstation', 'open world,sci-fi,exploration,story rich,atmospheric'],
  ['the-witcher-3-wild-hunt', 'The Witcher 3: Wild Hunt', 2015, 'Action RPG', 4.7, '/images/covers/the-witcher-3-wild-hunt.jpg', 'Hunt monsters for coin as Geralt of Rivia while searching a war-torn open world for Ciri, the child of prophecy.', 'steam,playstation,xbox', 'open world,fantasy,story rich,choices matter'],
  ['grand-theft-auto-v', 'Grand Theft Auto V', 2013, 'Open World', 4.8, '/images/covers/grand-theft-auto-v.jpg', 'Switch between three very different criminals as their plans collide in Los Santos, pulling off daring heists across a sprawling satirical city.', 'steam,playstation,xbox', 'open world,crime,multiplayer,driving,story rich'],
  ['god-of-war-ragnarok', 'God of War Ragnarök', 2022, 'Action Adventure', 4.7, '/images/covers/god-of-war-ragnarok.jpg', 'Journey through the Nine Realms with Kratos and Atreus as Fimbulwinter draws to a close and the prophesied battle of Ragnarök approaches.', 'steam,playstation', 'mythology,story rich,fantasy,cinematic'],
  ['ghost-of-tsushima', 'Ghost of Tsushima', 2020, 'Action Adventure', 4.5, '/images/covers/ghost-of-tsushima.jpg', "Defend Tsushima Island from the 1274 Mongol invasion as the samurai Jin Sakai, choosing between the warrior's code and the way of the Ghost.", 'steam,playstation', 'open world,japan,stealth,story rich,cinematic'],
  ['sekiro-shadows-die-twice', 'Sekiro: Shadows Die Twice', 2019, 'Action Adventure', 4.5, '/images/covers/sekiro-shadows-die-twice.jpg', 'Take revenge as a one-armed shinobi in late-1500s Sengoku Japan, mastering tense sword duels where precise deflections matter most.', 'steam,playstation,xbox', 'soulslike,japan,difficult,stealth'],
  ['marvels-spider-man-2', "Marvel's Spider-Man 2", 2023, 'Action Adventure', 4.5, '/images/covers/marvels-spider-man-2.jpg', 'Swing across an expanded New York as Peter Parker and Miles Morales, balancing their lives while facing Kraven and the Venom symbiote.', 'steam,playstation', 'open world,superhero,story rich,cinematic'],
  ['resident-evil-4', 'Resident Evil 4', 2023, 'Survival Horror', 4.7, '/images/covers/resident-evil-4.jpg', "Rescue the president's daughter as Leon S. Kennedy in a reimagined survival-horror classic set in a sinister rural village.", 'steam,playstation,xbox', 'horror,survival,shooter,atmospheric'],
  ['hollow-knight-silksong', 'Hollow Knight: Silksong', 2025, 'Metroidvania', 4.6, '/images/covers/hollow-knight-silksong.jpg', 'Climb a haunted kingdom of silk and song as Hornet, battling deadly foes with fast, acrobatic needle-and-thread combat.', 'steam,playstation,xbox', 'indie,platformer,difficult,atmospheric,exploration'],
  ['it-takes-two', 'It Takes Two', 2021, 'Co-op Adventure', 4.5, '/images/covers/it-takes-two.jpg', 'Play as a couple turned into handmade dolls, working together through a fantastical world in a cooperative adventure built for two players.', 'steam,playstation,xbox', 'co-op,platformer,story rich,fantasy'],
  ['stardew-valley', 'Stardew Valley', 2016, 'Simulation', 4.5, '/images/covers/stardew-valley.jpg', "Inherit your grandfather's old farm, grow crops, raise animals, and become part of a friendly small-town community.", 'steam,playstation,xbox', 'indie,relaxing,farming,crafting,co-op'],
  ['the-last-of-us-part-ii', 'The Last of Us Part II', 2020, 'Action Adventure', 4.6, '/images/covers/the-last-of-us-part-ii.jpg', 'The sequel to the acclaimed original follows Ellie five years after the first game, as she seeks vengeance in a world ruled by infected and ruthless human factions.', 'playstation', 'story rich,cinematic,survival,horror,action'],
  ['the-last-of-us-part-i', 'The Last of Us', 2013, 'Action Adventure', 4.8, '/images/covers/the-last-of-us-part-i.jpg', "A smuggler is hired to smuggle a teenage girl out of a quarantine zone. What follows is a journey across a post-apocalyptic United States.", 'playstation,steam', 'story rich,cinematic,survival,horror,action'],
  ['resident-evil-village', 'Resident Evil Village', 2021, 'Survival Horror', 4.4, '/images/covers/resident-evil-village.jpg', 'Five years after the events of Resident Evil 7, Ethan Winters is living peacefully with his wife Mia and their newborn daughter Rosemary.', 'steam,playstation,xbox', 'horror,survival,shooter,atmospheric'],
  ['dead-space', 'Dead Space', 2023, 'Survival Horror', 4.5, '/images/covers/dead-space.jpg', 'Ignited by a desperate quest to rescue his girlfriend, aerospace engineer Isaac Clarke descends on the USG Ishimura only to discover the crew is dead or worse.', 'steam,playstation,xbox', 'horror,sci-fi,survival,atmospheric'],
  ['silent-hill-2-remake', 'Silent Hill 2 Remake', 2024, 'Survival Horror', 4.6, '/images/covers/silent-hill-2-remake.jpg', "James Sunderland arrives in the town of Silent Hill two years after receiving a letter from his deceased wife telling him to meet her at their favorite place.", 'steam,playstation', 'horror,survival,atmospheric,story rich'],
  ['alan-wake-2', 'Alan Wake 2', 2023, 'Survival Horror', 4.5, '/images/covers/alan-wake-2.jpg', 'Agent Angela Black hunts a serial killer while using her skills and knowledge of the supernatural case of Saga Anderson.', 'steam,playstation,xbox', 'horror,survival,story rich,atmospheric,psychological'],
  ['star-wars-outlaws', 'Star Wars Outlaws', 2024, 'Action Adventure', 4.2, '/images/covers/star-wars-outlaws.jpg', "Become the most sought-after scoundrel in the galaxy and live life on the run as you travel to lawless worlds.", 'steam,playstation,xbox', 'open world,sci-fi,adventure,story rich'],
  ['avatar-frontiers-of-pandora', 'Avatar: Frontiers of Pandora', 2023, 'Action Adventure', 4.1, '/images/covers/avatar-frontiers-of-pandora.jpg', "Step into the role of a Na'vi warrior set in the lush, expansive uncharted territories of the frontier regions of Pandora.", 'steam,playstation,xbox', 'open world,sci-fi,adventure,exploration'],
  ['skyrim-special-edition', 'The Elder Scrolls V: Skyrim Special Edition', 2016, 'Action RPG', 4.7, '/images/covers/skyrim-special-edition.jpg', "As the Dragonborn, a prophesied hero, you must confront Alduin, the World-Eater, a dragon who is devouring the world.", 'steam,playstation,xbox,switch', 'open world,rpg,fantasy,exploration,story rich'],
  ['divinity-original-sin-2', 'Divinity: Original Sin 2', 2017, 'RPG', 4.6, '/images/covers/divinity-original-sin-2.jpg', "The Source runs deep in you, making you a Divine, a god in the making. The Godwoken have risen, and they will claim what is theirs.", 'steam,playstation,xbox,switch', 'rpg,strategy,turn-based,co-op,choices matter'],
  ['outer-wilds', 'Outer Wilds', 2019, 'Adventure', 4.7, '/images/covers/outer-wilds.jpg', 'Welcome to the Solar System. Time is not on your side as you explore a tiny solar system caught in an endless time loop.', 'steam,playstation,xbox,switch', 'exploration,space,indie,puzzle,atmospheric'],
  ['horizon-zero-dawn-complete', 'Horizon Zero Dawn Complete Edition', 2017, 'Action RPG', 4.5, '/images/covers/horizon-zero-dawn-complete.jpg', "Experience Aloy's legendary quest to unravel the mysteries of a future Earth ruled by Machines.", 'steam,playstation', 'open world,rpg,sci-fi,exploration'],
  ['horizon-forbidden-west', 'Horizon Forbidden West', 2022, 'Action RPG', 4.3, '/images/covers/horizon-forbidden-west.jpg', "From the makers of the post-apocalyptic open-world RPG Horizon Zero Dawn comes the highly anticipated sequel.", 'playstation,steam', 'open world,rpg,sci-fi,exploration'],
  ['ghostwire-tokyo', 'Ghostwire: Tokyo', 2022, 'Action Adventure', 4.2, '/images/covers/ghostwire-tokyo.jpg', 'Tokyo is plagued by a terrifying phenomenon which causes tens of thousands of people to vanish and supernatural creatures roam the streets.', 'steam,playstation', 'open world,horror,action,japan'],
  ['control-ultimate-edition', 'Control: Ultimate Edition', 2019, 'Action Adventure', 4.4, '/images/covers/control-ultimate-edition.jpg', "After a secret organization attacks the US government building known as the Oldest House, you take on the role of its new Director, Jesse Faden.", 'steam,playstation,xbox,switch', 'story rich,action,atmospheric,mystery'],
  ['hades', 'Hades', 2020, 'Roguelike', 4.8, '/images/covers/hades.jpg', 'Defy the god of the dead as you hack and slash out of the Underworld in this rogue-like dungeon crawler.', 'steam,playstation,xbox,switch', 'roguelike,indie,action,rpg,mythology'],
  ['tchia', 'Tchia', 2023, 'Adventure', 4.3, '/images/covers/tchia.jpg', 'Play as Tchia, a young islander with the magical ability to possess and control animals.', 'steam,playstation,xbox,switch', 'open world,adventure,exploration,indie,relaxing'],
  ['return-moss', 'Return Moss', 2025, 'Platformer', 4.4, '/images/covers/return-moss.jpg', 'Help Moss return home in this beautiful platformer inspired by classic adventure games.', 'steam', 'platformer,indie,adventure,exploration'],
  ['frostpunk-2', 'Frostpunk 2', 2024, 'City Builder', 4.3, '/images/covers/frostpunk-2.jpg', 'Frostpunk 2 expands on the genre-defining city-building survival game and its critically acclaimed narrative engine.', 'steam', 'city-builder,survival,strategy,sci-fi'],
  ['total-war-pharaoh', 'Total War: PHARAOH', 2023, 'Strategy', 4.1, '/images/covers/total-war-pharaoh.jpg', 'Build your dynasty and forge an empire in the ancient world. Lead your armies across the Near East and North Africa.', 'steam', 'strategy,war,historical,empire-builder'],
  ['age-of-empires-iv', 'Age of Empires IV', 2021, 'Strategy', 4.2, '/images/covers/age-of-empires-iv.jpg', 'Return to the series that defined the real-time strategy genre and lead civilizations through the ages in epic battles.', 'steam,xbox', 'strategy,real-time,war,historical'],
  ['diablo-iv', 'Diablo IV', 2023, 'Action RPG', 4.3, '/images/covers/diablo-iv.jpg', 'Journey through the dark fantasy world of Sanctuary in the latest installment of the acclaimed action RPG series.', 'steam,playstation,xbox', 'action,rpg,dark,fantasy,coop'],
  ['path-of-exile-2', 'Path of Exile 2', 2024, 'Action RPG', 4.5, '/images/covers/path-of-exile-2.jpg', 'Forge a new path through an ever-changing dark fantasy world in the next chapter of the award-winning action RPG.', 'steam,playstation,xbox', 'action,rpg,dark,fantasy,coop'],
  ['deep-rock-galactic-survivor', 'Deep Rock Galactic: Survivor', 2024, 'Action', 4.4, '/images/covers/deep-rock-galactic-survivor.jpg', 'Rock and Stone! Survival shooter set in a procedurally-generated galaxy of destructible caverns.', 'steam,playstation,xbox', 'coop,shooter,indie,mining'],
  ['palworld', 'Palworld', 2024, 'Survival', 4.2, '/images/covers/palworld.jpg', 'Fight, farm, build and work alongside mysterious creatures called Pals in this completely new multiplayer, open world survival and crafting game!', 'steam,xbox', 'survival,crafting,coop,indie'],
  ['ark-survival-evolved', 'ARK: Survival Evolved', 2017, 'Survival', 4.0, '/images/covers/ark-survival-evolved.jpg', "Stranded on the shores of a mysterious island, you must learn to survive, tame and breed nearly any dinosaur or creature.", 'steam,playstation,xbox,switch', 'survival,crafting,open world,coop'],
  ['valheim', 'Valheim', 2021, 'Survival', 4.5, '/images/covers/valheim.jpg', "A brutal exploration and survival game for 1-10 players, set in a procedurally-generated purgatory inspired by viking culture.", 'steam', 'survival,crafting,co-op,building,vikings'],
  ['no-mans-sky', 'No Man\'s Sky', 2016, 'Survival', 4.4, '/images/covers/no-mans-sky.jpg', "Inspired by the adventure and imagination that we love from science fiction, No Man's Sky takes you on an endless journey across 18 quintillion planets.", 'steam,playstation,xbox,switch', 'open world,sci-fi,exploration,space,survival'],
  ['cyberpunk-2077-phantom-liberty', 'Cyberpunk 2077: Phantom Liberty', 2023, 'Action RPG', 4.5, '/images/covers/cyberpunk-2077-phantom-liberty.jpg', 'Return as cybernetically enhanced mercenary V to the open-world megalopolis of Night City, obsessed with survival and customization.', 'steam,playstation,xbox', 'open world,sci-fi,story rich,choices matter,shooter'],
  ['witcher-3-complete-edition', 'The Witcher 3: Wild Hunt Complete Edition', 2016, 'Action RPG', 4.8, '/images/covers/witcher-3-complete-edition.jpg', 'Included is the base game plus both expansions, offering over 100 hours of gameplay and a massive expansion universe.', 'steam,playstation,xbox,switch', 'open world,fantasy,story rich,choices matter,rpg'],
  ['god-of-war', 'God of War', 2018, 'Action Adventure', 4.7, '/images/covers/god-of-war.jpg', "His vengeance against the gods of Olympus years behind him, Kratos now lives as a man in the realm of Norse mythology.", 'playstation,steam', 'mythology,story rich,fantasy,cinematic,action'],
  ['uncharted-4-a-thiefs-end', "Uncharted 4: A Thief's End", 2016, 'Action Adventure', 4.6, '/images/covers/uncharted-4-a-thiefs-end.jpg', "Four years after the events of Uncharted 3, Nate is living a somewhat quiet life away from the world of treasure hunting.", 'playstation,steam', 'story rich,adventure,cinematic,exploration'],
  ['uncharted-the-lost-legacy', "Uncharted: The Lost Legacy", 2017, 'Action Adventure', 4.4, '/images/covers/uncharted-the-lost-legacy.jpg', "Nathan Drake's sister Chloe Frazer teams up with mercenary Nadine Ross to recover an ancient artifact in the Western Ghats of India.", 'playstation,steam', 'story rich,adventure,cinematic,exploration'],
  ['red-dead-redemption', 'Red Dead Redemption', 2010, 'Open World', 4.8, '/images/covers/red-dead-redemption.jpg', "The epic tale of life in America's unforgiving heartland. The game's vast world will reveal the thrill of the outlaw's life.", 'steam,playstation,xbox', 'open world,western,story rich,exploration'],
];

for (const game of gameSeeds) {
  seedGameStatement.run(...game);
}

// The extended catalogue of popular Steam games (database/catalog.js). CATALOG_EXTENDED=0 keeps only the 60
// hand-picked games; the tests do that so their counts stay exact.
if (process.env.CATALOG_EXTENDED !== '0') {
  require('./catalog').loadCatalog(db);
}

const findUserByEmailStatement = db.prepare(`
  SELECT id, name, email, password_hash, bio, steam_id, psn_id, xbox_id,
    steam_visible, psn_visible, xbox_visible, preferred_platform, favorite_genres, profile_public, role, created_at
  FROM users
  WHERE email = ?
`);

const findUserByIdStatement = db.prepare(`
  SELECT id, name, email, bio, steam_id, psn_id, xbox_id,
    steam_visible, psn_visible, xbox_visible, preferred_platform, favorite_genres, profile_public, role, created_at
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
    steam_visible = ?, psn_visible = ?, xbox_visible = ?, preferred_platform = ?, favorite_genres = ?,
    profile_public = ?
  WHERE id = ?
`);

// Bayesian weighted rating: (v / (v + m)) * R + (m / (v + m)) * C
// v = review count for this game, R = average rating for this game
// m = minimum reviews to qualify (tunable, using 3 as a reasonable default for small dataset)
// C = global average rating across all games
// This prevents games with 1-2 reviews from dominating "top rated" lists
const BAYESIAN_M = 3; // minimum review count threshold

const listGamesForUserStatement = db.prepare(`
  SELECT g.id, g.slug, g.title, g.release_year AS year, g.genre,
    CASE
      WHEN COUNT(r.id) > 0 THEN
        ROUND(
          (COUNT(r.id) * 1.0 / (COUNT(r.id) + ${BAYESIAN_M})) * AVG(r.rating) +
          (${BAYESIAN_M} * 1.0 / (COUNT(r.id) + ${BAYESIAN_M})) * (SELECT AVG(rating) FROM reviews),
          1
        )
      ELSE g.rating
    END AS rating,
    g.rating AS catalogue_rating, COUNT(r.id) AS review_count, g.image, g.description, g.platforms, g.tags,
    g.steam_appid, g.trailer_path, COALESCE(json_extract(g.media, '$.steamReviews'), 0) AS steam_reviews,
    ul.status, ul.is_favorite
  FROM games g
  LEFT JOIN user_library ul ON ul.game_id = g.id AND ul.user_id = ?
  LEFT JOIN reviews r ON r.game_id = g.id
  GROUP BY g.id, ul.status, ul.is_favorite
  ORDER BY g.release_year DESC, g.id ASC
`);

const searchGamesForUserStatement = db.prepare(`
  SELECT g.id, g.slug, g.title, g.release_year AS year, g.genre,
    CASE
      WHEN COUNT(r.id) > 0 THEN
        ROUND(
          (COUNT(r.id) * 1.0 / (COUNT(r.id) + ${BAYESIAN_M})) * AVG(r.rating) +
          (${BAYESIAN_M} * 1.0 / (COUNT(r.id) + ${BAYESIAN_M})) * (SELECT AVG(rating) FROM reviews),
          1
        )
      ELSE g.rating
    END AS rating,
    g.rating AS catalogue_rating, COUNT(r.id) AS review_count, g.image, g.description, g.platforms, g.tags,
    g.steam_appid, g.trailer_path, COALESCE(json_extract(g.media, '$.steamReviews'), 0) AS steam_reviews,
    ul.status, ul.is_favorite
  FROM games g
  LEFT JOIN user_library ul ON ul.game_id = g.id AND ul.user_id = ?
  LEFT JOIN reviews r ON r.game_id = g.id
  WHERE (? = '' OR g.title LIKE '%' || ? || '%' COLLATE NOCASE
    OR g.genre LIKE '%' || ? || '%' COLLATE NOCASE
    OR g.tags LIKE '%' || ? || '%' COLLATE NOCASE)
    AND (? = '' OR g.genre = ? COLLATE NOCASE)
  GROUP BY g.id, ul.status, ul.is_favorite
  ORDER BY g.release_year DESC, g.title COLLATE NOCASE
`);

const findGameBySlugStatement = db.prepare(`
  SELECT g.id, g.slug, g.title, g.release_year AS year, g.genre,
    CASE
      WHEN COUNT(r.id) > 0 THEN
        ROUND(
          (COUNT(r.id) * 1.0 / (COUNT(r.id) + ${BAYESIAN_M})) * AVG(r.rating) +
          (${BAYESIAN_M} * 1.0 / (COUNT(r.id) + ${BAYESIAN_M})) * (SELECT AVG(rating) FROM reviews),
          1
        )
      ELSE g.rating
    END AS rating,
    g.rating AS catalogue_rating, COUNT(r.id) AS review_count, g.image, g.description, g.platforms, g.tags,
    g.steam_appid, g.trailer_path, g.cover_code, g.media,
    ul.status, ul.is_favorite
  FROM games g
  LEFT JOIN user_library ul ON ul.game_id = g.id AND ul.user_id = ?
  LEFT JOIN reviews r ON r.game_id = g.id
  WHERE g.slug = ?
  GROUP BY g.id, ul.status, ul.is_favorite
`);

// The featured reel (catalogue and home pages): well-known games that have wide artwork and a trailer, most-reviewed
// on Steam first.
const listFeaturedGamesStatement = db.prepare(`
  SELECT slug, title, release_year AS year, genre, rating, image, description, steam_appid, trailer_path, media
  FROM games
  WHERE trailer_path <> '' AND json_extract(media, '$.hero') <> ''
  ORDER BY COALESCE(json_extract(media, '$.steamReviews'), 0) DESC, id
  LIMIT ?
`);

const listGameGenresStatement = db.prepare(`
  SELECT DISTINCT genre
  FROM games
  ORDER BY genre COLLATE NOCASE
`);

const listUserLibraryStatement = db.prepare(`
  SELECT g.id, g.slug, g.title, g.release_year AS year, g.genre,
    CASE
      WHEN COUNT(r.id) > 0 THEN
        ROUND(
          (COUNT(r.id) * 1.0 / (COUNT(r.id) + ${BAYESIAN_M})) * AVG(r.rating) +
          (${BAYESIAN_M} * 1.0 / (COUNT(r.id) + ${BAYESIAN_M})) * (SELECT AVG(rating) FROM reviews),
          1
        )
      ELSE g.rating
    END AS rating,
    g.image, ul.status, ul.is_favorite, ul.added_at, ul.updated_at
  FROM user_library ul
  JOIN games g ON g.id = ul.game_id
  LEFT JOIN reviews r ON r.game_id = g.id
  WHERE ul.user_id = ?
  GROUP BY g.id, ul.status, ul.is_favorite, ul.added_at, ul.updated_at
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
    u.id AS user_id, u.name AS user_name, u.profile_public, g.slug, g.title, g.image
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
  profilePublic = true,
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
    profilePublic ? 1 : 0,
    id,
  );
  return findUserById(id);
}

// The catalogue with ratings changes only when games or reviews change, but almost every page reads it, so the rows
// for "no viewer" are kept and reused while this version stays the same; the viewer's library statuses are merged
// in from one small query. Any review written, edited or deleted changes the version.
const catalogueVersionStatement = db.prepare(`
  SELECT (SELECT COUNT(*) FROM games) || ':' || (SELECT COUNT(*) FROM reviews) || ':' ||
    (SELECT COALESCE(MAX(id), 0) FROM reviews) || ':' || (SELECT COALESCE(SUM(rating), 0) FROM reviews) || ':' ||
    (SELECT COALESCE(MAX(updated_at), '') FROM reviews) AS version
`);
const libraryStatusesStatement = db.prepare('SELECT game_id, status, is_favorite FROM user_library WHERE user_id = ?');
let catalogueCache = { version: null, rows: [] };

function catalogueVersion() {
  return catalogueVersionStatement.get().version;
}

function listGamesForUser(userId) {
  const version = catalogueVersion();
  if (catalogueCache.version !== version) {
    // Shared, read-only rows: games the viewer has not saved are passed out as they are, without a copy.
    catalogueCache = { version, rows: listGamesForUserStatement.all(-1).map((row) => Object.freeze({ ...row })) };
  }
  const statuses = new Map(userId ? libraryStatusesStatement.all(userId).map((row) => [row.game_id, row]) : []);
  const rows = statuses.size === 0 ? [...catalogueCache.rows] : catalogueCache.rows.map((row) => {
    const entry = statuses.get(row.id);
    return entry ? { ...row, status: entry.status, is_favorite: entry.is_favorite } : row;
  });
  // The version travels with the rows, so the recommender can tell an unchanged catalogue without rereading it.
  Object.defineProperty(rows, 'catalogueVersion', { value: version });
  return rows;
}

function searchGamesForUser(userId, { query = '', genre = '' } = {}) {
  // No search and no genre: the whole catalogue, which is already cached (callers sort it themselves).
  if (!query && !genre) return listGamesForUser(userId);
  return searchGamesForUserStatement.all(
    userId || -1,
    query,
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

let featuredCache = { key: null, rows: [] };

function listFeaturedGames(limit = 24) {
  const size = Math.max(1, Math.min(Number(limit) || 24, 60));
  const key = `${catalogueVersion()}|${size}`;
  if (featuredCache.key !== key) featuredCache = { key, rows: listFeaturedGamesStatement.all(size) };
  return featuredCache.rows;
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

// Runs fn inside one SQLite transaction: every change is saved together, or none is. Inside another
// transaction, fn simply becomes part of it, and the outer transaction decides.
function transaction(fn) {
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

// Safe to call twice: a stop signal can arrive after the tests or a script already closed the database.
function closeDatabase() {
  if (db.isOpen) db.close();
}

// The health check (GET /health): true while the database file can still be read.
function checkDatabase() {
  try {
    db.prepare('SELECT COUNT(*) AS count FROM games').get();
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  db,
  addLibraryGame,
  checkDatabase,
  closeDatabase,
  countFavoriteGames,
  createUser,
  deleteReview,
  findGameBySlug,
  findLibraryGame,
  findUserReview,
  findUserByEmail,
  findUserById,
  catalogueVersion,
  listFeaturedGames,
  listGameGenres,
  listGamesForUser,
  listRecentReviews,
  listReviewsByGame,
  listUserLibrary,
  removeLibraryGame,
  searchGamesForUser,
  transaction,
  upgradeRatingTable,
  upsertReview,
  updateLibraryGame,
  updateUserProfile,
};
