// The extended catalogue: about a thousand of Steam's most-reviewed games, shipped as a JSON Lines file
// (database/catalog/steam-games.jsonl, one game per line) so the site works without internet and without an API key.
// Each line carries the game's details plus the exact Steam addresses of its cover, wide artwork, screenshots and
// trailer, so nothing has to be guessed at run time. `npm run catalog:check` checks the file.
//
// Line: {"appid","slug","name","year","reviews","positive","genre","tags":[…],"description","trailer","trailerName",
//        "covers":[…],"hero","screenshots":[…],"developer","publisher"}
// "year" is the game's first release on any platform. When that differs from the year the game came to Steam, the
// line also has "steamYear" and "yearSource" ("wikidata:Q…" for Wikidata's earliest publication date, or "steam" for
// Steam's own original release date), so the page can say both and where the first one comes from.
const fs = require('node:fs');
const path = require('node:path');

const CATALOG_FILE = path.join(__dirname, 'catalog', 'steam-games.jsonl');
const CURATED_FILE = path.join(__dirname, 'catalog', 'curated-appids.json');

// Models never use services (test/unit/architecture.test.js), so the small format checks live here.
const isAppId = (value) => Number.isInteger(value) && value > 0 && value < 2 ** 31;
const isTrailerPath = (value) => /^\d{1,12}\/[0-9a-f]{40}\/\d{6,13}$/.test(value);
// A Steam asset path such as "steam/apps/730/library_600x900_2x.jpg" or ".../730/<sha1>/library_capsule_2x.jpg".
const isAssetPath = (value) => typeof value === 'string' && /^steam\/apps\/\d+\/(?:[0-9a-f]{40}\/)?[\w.-]{1,80}\.(?:jpg|png|webp)$/.test(value);

function clip(text, max) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  if ([...value].length <= max) return value;
  return `${[...value].slice(0, max - 1).join('').trimEnd()}…`;
}

// Steam's share of positive reviews as Checkpoint's 1–5 catalogue score (95% → 4.8).
function starsFromPositive(positive) {
  const share = Math.min(100, Math.max(0, Number(positive) || 0));
  return Math.max(1, Math.round((share / 20) * 10) / 10);
}

function hasValidCore(raw) {
  const { appid, slug, name, year, genre } = raw;
  return isAppId(appid)
    && typeof slug === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) && slug.length <= 100
    && typeof name === 'string' && name.trim() !== ''
    && Number.isInteger(year) && year >= 1970 && year <= 2100
    && typeof genre === 'string' && genre.trim() !== '';
}

// Up to 200 characters of comma-separated tags, whole tags only.
function tagText(tags) {
  const kept = [];
  for (const tag of (Array.isArray(tags) ? tags : []).map((value) => String(value).trim().toLowerCase()).filter(Boolean)) {
    if ([...kept, tag].join(',').length > 200) break;
    kept.push(tag);
  }
  return kept.join(',');
}

const assetList = (value, max) => (Array.isArray(value) ? value : []).filter(isAssetPath).slice(0, max);
const wholeNumber = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);
const isYear = (value) => Number.isInteger(value) && value >= 1970 && value <= 2100;
const isYearSource = (value) => typeof value === 'string' && /^(?:steam|wikidata:Q\d{1,12})$/.test(value);

function mediaFrom(raw) {
  return {
    covers: assetList(raw.covers, 3),
    hero: isAssetPath(raw.hero) ? raw.hero : '',
    screenshots: assetList(raw.screenshots, 6),
    trailerName: clip(raw.trailerName, 80),
    developer: clip(raw.developer, 80),
    publisher: clip(raw.publisher, 80),
    steamReviews: wholeNumber(raw.reviews),
    steamPositive: Number.isInteger(raw.positive) ? Math.min(100, Math.max(0, raw.positive)) : null,
    steamYear: isYear(raw.steamYear) && raw.steamYear !== raw.year ? raw.steamYear : null,
    yearSource: isYear(raw.steamYear) && isYearSource(raw.yearSource) ? raw.yearSource : '',
  };
}

function parseCatalogLine(line) {
  let raw;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || !hasValidCore(raw)) return null;
  const media = mediaFrom(raw);
  if (media.covers.length === 0) return null;
  return {
    appid: raw.appid,
    slug: raw.slug,
    title: clip(raw.name, 120),
    year: raw.year,
    rating: starsFromPositive(raw.positive),
    genre: clip(raw.genre, 40),
    tags: tagText(raw.tags),
    description: clip(raw.description, 600),
    trailerPath: typeof raw.trailer === 'string' && isTrailerPath(raw.trailer) ? raw.trailer : '',
    media,
  };
}

function readCatalog(file = CATALOG_FILE) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const seenApps = new Set();
  const seenSlugs = new Set();
  const games = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const game = parseCatalogLine(line);
    if (!game || seenApps.has(game.appid) || seenSlugs.has(game.slug)) continue;
    seenApps.add(game.appid);
    seenSlugs.add(game.slug);
    games.push(game);
  }
  return games;
}

function readCuratedAppIds(file = CURATED_FILE) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

// Links the hand-picked games to their Steam pages (so they get Steam artwork, screenshots and trailers too), then
// adds every other catalogue game that is not already in the database and refreshes the media of the ones that are.
// Hand-picked games keep their own title, text, genre, rating and cover file.
function loadCatalog(db, { file = CATALOG_FILE, curatedFile = CURATED_FILE } = {}) {
  const games = readCatalog(file);
  const curated = readCuratedAppIds(curatedFile);
  const byAppId = new Map(games.map((game) => [game.appid, game]));

  const linkCurated = db.prepare(`
    UPDATE games SET steam_appid = ?, trailer_path = ?, media = ?
    WHERE slug = ? AND (steam_appid IS NULL OR steam_appid = ?)
  `);
  const insert = db.prepare(`
    INSERT INTO games (slug, title, release_year, genre, rating, image, description, platforms, tags, steam_appid, trailer_path, media)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'steam', ?, ?, ?, ?)
    ON CONFLICT(slug) DO NOTHING
  `);
  const known = db.prepare('SELECT 1 FROM games WHERE steam_appid = ?');
  // Catalogue games also take the newest checked title and release year (hand-picked games are linked above and
  // keep their own).
  const refresh = db.prepare('UPDATE games SET title = ?, release_year = ?, trailer_path = ?, media = ? WHERE steam_appid = ?');

  let added = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    const curatedApps = new Set();
    for (const [slug, appid] of Object.entries(curated)) {
      const game = byAppId.get(appid);
      curatedApps.add(appid);
      linkCurated.run(appid, game?.trailerPath || '', JSON.stringify(game?.media || {}), slug, appid);
    }
    for (const game of games) {
      const media = JSON.stringify(game.media);
      if (curatedApps.has(game.appid) || known.get(game.appid)) {
        if (!curatedApps.has(game.appid)) refresh.run(game.title, game.year, game.trailerPath, media, game.appid);
        continue;
      }
      added += Number(insert.run(
        game.slug, game.title, game.year, game.genre, game.rating, `/images/covers/${game.slug}.jpg`,
        game.description, game.tags, game.appid, game.trailerPath, media,
      ).changes);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { total: games.length, added };
}

module.exports = { CATALOG_FILE, isAssetPath, loadCatalog, parseCatalogLine, readCatalog, starsFromPositive };
