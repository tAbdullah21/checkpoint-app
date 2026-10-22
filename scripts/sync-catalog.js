/*
 * Rebuilds the extended catalogue (database/catalog/steam-games.jsonl) from Steam's public store, with no API key.
 *
 *   npm run catalog:sync            # about a thousand of the most-reviewed games (internet needed, ~10 minutes)
 *   npm run catalog:sync -- --size 500
 *
 * Steps: 1) candidate games from the store search (most reviewed, then top sellers), 2) details in batches of 50
 * from IStoreBrowseService/GetItems (assets, trailers, screenshots, tags, reviews, release), 3) the filters and the
 * genre mapping below, 4) the most-reviewed games are kept, 5) each game's first release year is checked against
 * Wikidata (the earliest publication date of the item that carries the game's Steam app id), and 6) the games are
 * written one JSON object per line. The 3.7 file was made with exactly these steps from a browser (the years in
 * 3.8); this script repeats them from Node so the list can be refreshed. If Wikidata cannot be reached, Steam's own
 * dates are kept and the summary says so.
 * The hand-picked games (database/catalog/curated-appids.json) are always kept. Only the catalogue file is written.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUTPUT = path.join(ROOT, 'database', 'catalog', 'steam-games.jsonl');
const CURATED = path.join(ROOT, 'database', 'catalog', 'curated-appids.json');
const STORE = 'https://store.steampowered.com';
const API = 'https://api.steampowered.com/IStoreBrowseService/GetItems/v1/';
const WIKIDATA = 'https://query.wikidata.org/sparql';

// Two store pages where the rule "earliest date wins" is wrong, checked by hand: app 730 is the Counter-Strike:
// Global Offensive page (2012) that now sells Counter-Strike 2 (2023), and Wikidata links app 470220 (Ubisoft's
// 2016 UNO) to the 2006 Xbox game.
const YEAR_RULES = { 730: 'wikidata', 470220: 'steam' };

// The first matching tag (by weight) decides the genre shown on the site.
const GENRE_BY_TAG = {
  'Souls-like': 'Soulslike', 'Battle Royale': 'Battle Royale', MOBA: 'MOBA', Racing: 'Racing', Driving: 'Racing',
  'Automobile Sim': 'Racing', Sports: 'Sports', 'Football (Soccer)': 'Sports', Basketball: 'Sports', Golf: 'Sports',
  Skateboarding: 'Sports', Fighting: 'Fighting', '2D Fighter': 'Fighting', '3D Fighter': 'Fighting', Horror: 'Horror',
  'Survival Horror': 'Horror', 'Psychological Horror': 'Horror', 'City Builder': 'City Builder', 'Colony Sim': 'Strategy',
  'Base Building': 'Survival', 'Card Game': 'Card Game', Deckbuilding: 'Card Game', 'Card Battler': 'Card Game',
  Roguelike: 'Roguelike', Roguelite: 'Roguelike', 'Action Roguelike': 'Roguelike', 'Roguelike Deckbuilder': 'Card Game',
  'Bullet Hell': 'Roguelike', Puzzle: 'Puzzle', 'Puzzle Platformer': 'Puzzle', Metroidvania: 'Metroidvania',
  Platformer: 'Platformer', '2D Platformer': 'Platformer', '3D Platformer': 'Platformer', 'Precision Platformer': 'Platformer',
  Survival: 'Survival', 'Open World Survival Craft': 'Survival', Sandbox: 'Sandbox', Crafting: 'Sandbox', Building: 'Sandbox',
  'Grand Strategy': 'Strategy', RTS: 'Strategy', 'Turn-Based Strategy': 'Strategy', '4X': 'Strategy', Strategy: 'Strategy',
  'Tower Defense': 'Strategy', 'Auto Battler': 'Strategy', 'Turn-Based Tactics': 'Strategy', 'Tactical RPG': 'Strategy',
  Simulation: 'Simulation', 'Farming Sim': 'Simulation', 'Life Sim': 'Simulation', Management: 'Simulation',
  Flight: 'Simulation', 'Space Sim': 'Simulation', 'Immersive Sim': 'Action Adventure', FPS: 'First-Person Shooter',
  'Hero Shooter': 'Shooter', 'Looter Shooter': 'Shooter', 'Third-Person Shooter': 'Shooter', Shooter: 'Shooter',
  Tactical: 'Shooter', JRPG: 'RPG', CRPG: 'RPG', 'Party-Based RPG': 'RPG', 'Action RPG': 'Action RPG',
  'Hack and Slash': 'Action RPG', RPG: 'RPG', MMORPG: 'MMO', 'Massively Multiplayer': 'MMO', 'Open World': 'Open World',
  'Party Game': 'Party', 'Social Deduction': 'Party', Party: 'Party', 'Visual Novel': 'Visual Novel', Rhythm: 'Rhythm',
  Stealth: 'Action Adventure', 'Action-Adventure': 'Action Adventure', Adventure: 'Adventure', 'Point & Click': 'Adventure',
  'Walking Simulator': 'Adventure', 'Interactive Fiction': 'Adventure', Action: 'Action', Arcade: 'Action',
  "Beat 'em up": 'Action',
};
const SOFTWARE_TAGS = new Set(['Software', 'Utilities', 'Video Production', 'Audio Production', 'Game Development',
  'Animation & Modeling', 'Design & Illustration', 'Photo Editing']);
const HIDDEN_TAGS = new Set(['Indie', 'Singleplayer', 'Multiplayer', 'Steam Achievements', 'Nudity', 'Sexual Content', 'Mature',
  'Gore', 'Violent', 'Blood', 'Free to Play', 'Early Access']);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(text) {
  return String(text || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const value = code[1].toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(value) ? String.fromCodePoint(value) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

const cleanName = (name) => decodeEntities(name).replace(/[™®©]/g, '').replace(/\s+/g, ' ').trim();
const slugify = (name) => cleanName(name).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90).replace(/-+$/, '');
const assetPath = (assets, file) => (file ? assets.asset_url_format.replace('${FILENAME}', file).split('?')[0] : null);

const isAdultTag = (tag) => tag === 'Sexual Content' || tag === 'Nudity';

function isAdult(item, tagNames, forced) {
  if (tagNames.some((tag) => tag === 'Hentai' || tag === 'NSFW')) return true;
  if (forced) return false;
  return (item.content_descriptorids || []).some((id) => id === 3 || id === 4) || tagNames.slice(0, 5).some(isAdultTag);
}

function hasArtwork(assets) {
  return Boolean(assets?.asset_url_format && (assets.library_capsule_2x || assets.library_capsule || assets.header));
}

// Why a store item is left out, or null when it belongs in the catalogue. Each check is [reason, failed?].
function exclusion(item, tagNames, { forced = false } = {}) {
  const checks = [
    ['not a game', !forced && (item.type !== 0 || !item.visible)],
    ['adult', isAdult(item, tagNames, forced)],
    ['software', tagNames.slice(0, 3).some((tag) => SOFTWARE_TAGS.has(tag))],
    ['not a game', /soundtrack|dedicated server|playtest|\bdemo\b|benchmark|\bsdk\b|wallpaper/i.test(item.name || '')],
    ['no reviews', !item.reviews?.summary_filtered?.review_count],
    ['no release date', !(item.release?.steam_release_date || item.release?.original_release_date)],
    ['no artwork', !hasArtwork(item.assets)],
  ];
  return checks.find(([, failed]) => failed)?.[0] ?? null;
}

function firstTrailer(item) {
  const trailers = [...(item.trailers?.highlights || []), ...(item.trailers?.other_trailers || [])];
  const trailer = trailers.find((entry) => entry.all_ages !== false && entry.microtrailer?.length);
  if (!trailer) return { trailer: '', trailerName: '' };
  const match = /^(\d+)\/(\d+)\/([0-9a-f]{40})\/(\d+)\//.exec(trailer.microtrailer[0].filename || '');
  if (!match || Number(match[1]) !== item.appid) return { trailer: '', trailerName: '' };
  return { trailer: `${match[2]}/${match[3]}/${match[4]}`, trailerName: decodeEntities(trailer.trailer_name).trim() };
}

// One GetItems store item as a catalogue record (without slug), or { reason } when it is left out.
function toRecord(item, tagNamesById, options = {}) {
  const tagNames = [...(item.tags || [])].sort((first, second) => second.weight - first.weight)
    .map((tag) => tagNamesById[tag.tagid]).filter(Boolean);
  const reason = exclusion(item, tagNames, options);
  if (reason) return { reason };
  const visibleTags = tagNames.filter((tag) => !(options.forced && isAdultTag(tag)));
  const genre = visibleTags.slice(0, 8).map((tag) => GENRE_BY_TAG[tag]).find(Boolean) || 'Action';
  const assets = item.assets;
  const reviews = item.reviews.summary_filtered;
  const yearOf = (seconds) => (seconds ? new Date(seconds * 1000).getUTCFullYear() : null);
  const steamYear = yearOf(item.release.steam_release_date) || yearOf(item.release.original_release_date);
  const originalYear = yearOf(item.release.original_release_date);
  const year = originalYear && originalYear < steamYear ? originalYear : steamYear;
  const names = (list) => (list || []).map((entry) => decodeEntities(entry.name).trim()).slice(0, 2).join(', ');
  return {
    appid: item.appid,
    name: cleanName(item.name),
    year,
    ...(year !== steamYear ? { steamYear, yearSource: 'steam' } : {}),
    reviews: reviews.review_count,
    positive: reviews.percent_positive,
    genre,
    tags: visibleTags.filter((tag) => !HIDDEN_TAGS.has(tag)).slice(0, 7).map((tag) => tag.toLowerCase()),
    description: decodeEntities(item.basic_info?.short_description).replace(/\s+/g, ' ').trim(),
    ...firstTrailer(item),
    covers: [assetPath(assets, assets.library_capsule_2x), assetPath(assets, assets.library_capsule)].filter(Boolean),
    header: assetPath(assets, assets.header),
    hero: assetPath(assets, assets.library_hero) || '',
    screenshots: (item.screenshots?.all_ages_screenshots || []).slice(0, 6).map((shot) => shot.filename.split('?')[0]),
    developer: names(item.basic_info?.developers),
    publisher: names(item.basic_info?.publishers),
  };
}

// Most-reviewed first, every hand-picked game kept, unique slugs; the header image is the last-resort cover.
function selectRecords(records, { size, curatedIds }) {
  const sorted = [...records].sort((first, second) => second.reviews - first.reviews);
  const chosen = [];
  let others = 0;
  for (const record of sorted) {
    if (curatedIds.has(record.appid)) chosen.push(record);
    else if (others < size) {
      chosen.push(record);
      others += 1;
    }
  }
  const used = new Set();
  return chosen.map(({ header, ...record }) => {
    let slug = slugify(record.name) || `app-${record.appid}`;
    if (used.has(slug)) slug = `${slug}-${record.year}`;
    if (used.has(slug)) slug = `${slug}-${record.appid}`;
    used.add(slug);
    const covers = record.covers.length ? record.covers : [header].filter(Boolean);
    return { appid: record.appid, slug, ...record, covers };
  });
}

// How well two names match, from 0 to 1: shared words over the shorter name, ignoring edition words; names with
// different numbers ("Counter-Strike 2" and "Counter-Strike: Source 1.6") never match.
const NAME_NOISE = new Set(['the', 'of', 'a', 'edition', 'definitive', 'remastered', 'goty', 'game', 'year', 'complete',
  'enhanced', 'directors', 'cut', 'deluxe', 'ultimate', 'anniversary', 'steam', 'pc', 'collection', 'hd', 'classic',
  'remake', 'reloaded']);
const nameWords = (name) => new Set(cleanName(name).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/['’]/g, '').split(/[^a-z0-9]+/).filter((word) => word && !NAME_NOISE.has(word)));

function nameScore(first, second) {
  const a = nameWords(first);
  const b = nameWords(second);
  if (a.size === 0 || b.size === 0) return 0;
  const numbers = (words) => [...words].filter((word) => /^\d+$/.test(word));
  const [numbersA, numbersB] = [numbers(a), numbers(b)];
  if (numbersA.length && numbersB.length && !numbersA.some((number) => numbersB.includes(number))) return 0;
  const shared = [...a].filter((word) => b.has(word)).length;
  return shared / Math.min(a.size, b.size);
}

// The record with its first release year: the earliest of Steam's dates and the date of the best-matching Wikidata
// item (`candidates`: [{ q, label, year }]), unless YEAR_RULES says otherwise. Keys stay in the file's order.
function withFirstRelease(record, candidates = []) {
  const steamYear = record.steamYear || record.year;
  const match = candidates
    .filter((candidate) => Number.isInteger(candidate.year) && candidate.year > 1950)
    .map((candidate) => ({ ...candidate, score: nameScore(record.name, candidate.label) }))
    .filter((candidate) => candidate.score >= 0.6)
    .sort((first, second) => second.score - first.score || first.year - second.year)[0];
  let year = record.year;
  let source = record.yearSource || '';
  const rule = YEAR_RULES[record.appid];
  if (match && rule !== 'steam' && (match.year < year || rule === 'wikidata')) {
    year = match.year;
    source = `wikidata:${match.q}`;
  }
  const rest = { ...record };
  for (const key of ['appid', 'slug', 'name', 'year', 'steamYear', 'yearSource']) delete rest[key];
  const result = { appid: record.appid, slug: record.slug, name: record.name, year };
  if (year !== steamYear) Object.assign(result, { steamYear, yearSource: source });
  return { ...result, ...rest };
}

const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function getJson(url, attempt = 1) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'Checkpoint catalog sync (student project)' } });
  if (response.status === 429 && attempt <= 4) {
    await pause(15000 * attempt);
    return getJson(url, attempt + 1);
  }
  if (!response.ok) throw new Error(`${response.status} from ${url}`);
  return response.json();
}

async function searchAppIds(filter, pages) {
  const ids = [];
  for (let start = 0; start < pages * 100; start += 100) {
    const query = `query&start=${start}&count=100&${filter}&category1=998&infinite=1&cc=us&l=english&ndl=1`;
    const data = await getJson(`${STORE}/search/results/?${query}`);
    for (const match of String(data.results_html || '').matchAll(/data-ds-appid="(\d+)/g)) ids.push(Number(match[1]));
    process.stdout.write(`.`);
    await pause(900);
  }
  return ids;
}

async function storeItems(appids) {
  const items = [];
  for (let index = 0; index < appids.length; index += 50) {
    const input = {
      ids: appids.slice(index, index + 50).map((appid) => ({ appid })),
      context: { language: 'english', country_code: 'US' },
      data_request: {
        include_assets: true, include_release: true, include_basic_info: true, include_trailers: true,
        include_tag_count: 20, include_reviews: true, include_screenshots: true,
      },
    };
    const data = await getJson(`${API}?input_json=${encodeURIComponent(JSON.stringify(input))}`);
    items.push(...(data.response?.store_items || []).filter((item) => item.appid));
    process.stdout.write(`\r  details: ${Math.min(index + 50, appids.length)} / ${appids.length}`);
    await pause(300);
  }
  process.stdout.write('\n');
  return items;
}

// The Wikidata items that carry these Steam app ids (P1733), with their English (or multilingual) label and their
// earliest publication date (P577): Map(appid → [{ q, label, year }]).
async function wikidataYears(appids) {
  const found = new Map();
  for (let index = 0; index < appids.length; index += 150) {
    const values = appids.slice(index, index + 150).map((appid) => `"${appid}"`).join(' ');
    const query = `SELECT ?appid ?item ?label (MIN(?date) AS ?first) WHERE { VALUES ?appid { ${values} }
      ?item wdt:P1733 ?appid . ?item wdt:P577 ?date .
      OPTIONAL { ?item rdfs:label ?en FILTER(lang(?en) = 'en') } OPTIONAL { ?item rdfs:label ?mul FILTER(lang(?mul) = 'mul') }
      BIND(COALESCE(?en, ?mul, '') AS ?label) } GROUP BY ?appid ?item ?label`;
    const response = await fetch(WIKIDATA, {
      method: 'POST',
      signal: AbortSignal.timeout(60000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json', 'User-Agent': 'Checkpoint catalog sync (student project)' },
      body: new URLSearchParams({ query }).toString(),
    });
    if (!response.ok) throw new Error(`${response.status} from Wikidata`);
    const data = await response.json();
    for (const row of data.results.bindings) {
      const appid = Number(row.appid.value);
      const entry = { q: row.item.value.split('/').pop(), label: row.label?.value || '', year: Number(String(row.first?.value || '').slice(0, 4)) };
      found.set(appid, [...(found.get(appid) || []), entry]);
    }
    process.stdout.write(`\r  release years: ${Math.min(index + 150, appids.length)} / ${appids.length}`);
    await pause(1000);
  }
  process.stdout.write('\n');
  return found;
}

async function main() {
  const sizeIndex = process.argv.indexOf('--size');
  const size = sizeIndex > 0 ? Math.max(50, Number(process.argv[sizeIndex + 1]) || 960) : 960;
  const curatedIds = new Set(Object.values(JSON.parse(fs.readFileSync(CURATED, 'utf8'))));

  console.log('Checkpoint catalogue sync');
  process.stdout.write('  most reviewed ');
  const mostReviewed = await searchAppIds('sort_by=Reviews_DESC', 16);
  process.stdout.write('\n  top sellers ');
  const topSellers = await searchAppIds('filter=topsellers', 30);
  process.stdout.write('\n');
  const candidates = [...new Set([...curatedIds, ...mostReviewed, ...topSellers])];
  const tagNamesById = Object.fromEntries((await getJson(`${STORE}/tagdata/populartags/english`)).map((tag) => [tag.tagid, tag.name]));
  const items = await storeItems(candidates);

  const reasons = {};
  const records = [];
  for (const item of items) {
    const record = toRecord(item, tagNamesById, { forced: curatedIds.has(item.appid) });
    if (record.reason) reasons[record.reason] = (reasons[record.reason] || 0) + 1;
    else records.push(record);
  }
  let chosen = selectRecords(records, { size, curatedIds });
  try {
    const years = await wikidataYears(chosen.map((record) => record.appid));
    chosen = chosen.map((record) => withFirstRelease(record, years.get(record.appid)));
  } catch (error) {
    console.log(`  Wikidata could not be reached (${error.message}); Steam's release dates are kept.`);
  }
  fs.writeFileSync(OUTPUT, `${chosen.map((record) => JSON.stringify(record)).join('\n')}\n`);
  console.log(`  ${candidates.length} candidates, ${records.length} usable, ${chosen.length} written to ${path.relative(ROOT, OUTPUT)}`);
  console.log(`  left out: ${JSON.stringify(reasons)}`);
  console.log('  Next: npm run catalog:check, then restart the app (new games are added on start).');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Catalogue sync failed: ${error.message}`);
    console.error('Nothing was written unless the summary above says so. Check the internet connection and try again.');
    process.exitCode = 1;
  });
}

module.exports = { YEAR_RULES, decodeEntities, exclusion, nameScore, selectRecords, slugify, toRecord, withFirstRelease };
