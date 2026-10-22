// Where Steam keeps a game's cover, artwork, screenshots and trailer. All of it lives on Steam's public content
// network: the catalogue (database/catalog/steam-games.jsonl) stores the exact asset paths, and this module turns
// them into addresses. No API key and no copy of the media is shipped with the project.

const IMAGE_HOST = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps';
const VIDEO_HOST = 'https://video.akamai.steamstatic.com/store_trailers';
const ASSET_ROOT = 'https://shared.akamai.steamstatic.com/store_item_assets';
const ASSET_PATH = /^steam\/apps\/\d+\/(?:[0-9a-f]{40}\/)?[\w.-]{1,80}\.(?:jpg|png|webp)$/;

// Cover codes: '' = the standard portrait cover, 'H' = only the wide header image exists, otherwise
// "<sha1>~<letters>": a versioned folder plus the file names to try, in order of preference.
const VERSIONED_FILES = { a: 'library_capsule_2x.jpg', b: 'library_600x900_2x.jpg', c: 'library_capsule.jpg', d: 'library_600x900.jpg' };
const DEFAULT_FILES = ['library_600x900_2x.jpg', 'library_600x900.jpg', 'header.jpg'];

function isAppId(value) {
  return Number.isInteger(value) && value > 0 && value < 2 ** 31;
}

// Every address that may hold this game's cover, best first. The cover cache tries them one after the other.
function coverCandidates(appid, coverCode = '') {
  if (!isAppId(appid)) return [];
  const base = `${IMAGE_HOST}/${appid}`;
  if (coverCode === 'H') return [`${base}/header.jpg`];
  const [hash, letters] = String(coverCode).split('~');
  if (/^[0-9a-f]{40}$/.test(hash || '') && /^[a-d]{1,4}$/.test(letters || '')) {
    const versioned = [...letters].map((letter) => `${base}/${hash}/${VERSIONED_FILES[letter]}`);
    return [...versioned, ...DEFAULT_FILES.map((file) => `${base}/${file}`)];
  }
  return DEFAULT_FILES.map((file) => `${base}/${file}`);
}

// A trailer path is "<trailerId>/<sha1>/<timestamp>", exactly what Steam puts in its trailer addresses.
function parseTrailerPath(path) {
  const match = /^(\d{1,12})\/([0-9a-f]{40})\/(\d{6,13})$/.exec(String(path || ''));
  return match ? { id: match[1], hash: match[2], stamp: match[3] } : null;
}

// The short looping preview (about six seconds, muted) used for hover previews, in two formats, and the full
// streaming trailer (HLS; plays natively in Safari and Chromium browsers).
function trailerSources(appid, trailerPath) {
  const parsed = parseTrailerPath(trailerPath);
  if (!isAppId(appid) || !parsed) return null;
  const base = `${VIDEO_HOST}/${appid}/${parsed.id}/${parsed.hash}/${parsed.stamp}`;
  return {
    previewMp4: `${base}/microtrailer.mp4`,
    previewWebm: `${base}/microtrailer.webm`,
    hls: `${base}/hls_264_master.m3u8`,
  };
}

function assetUrl(assetPath) {
  return typeof assetPath === 'string' && ASSET_PATH.test(assetPath) ? `${ASSET_ROOT}/${assetPath}` : null;
}

// The media column (JSON written by database/catalog.js) as an object; anything unreadable counts as empty.
function parseMedia(value) {
  if (value && typeof value === 'object') return value;
  try {
    const media = JSON.parse(value || '{}');
    return media && typeof media === 'object' && !Array.isArray(media) ? media : {};
  } catch {
    return {};
  }
}

// Every address that may hold this game's portrait cover, best first: the exact files listed in the catalogue,
// then the conventional file names (older catalogue rows without media).
function coverUrlsFor(game) {
  const media = parseMedia(game.media);
  const exact = (Array.isArray(media.covers) ? media.covers : []).map(assetUrl).filter(Boolean);
  const legacy = coverCandidates(game.steam_appid, game.cover_code || '');
  return [...new Set([...exact, ...legacy])];
}

// Everything a game page shows from Steam: wide artwork, screenshots, developer and publisher, review numbers.
function showcaseFor(game) {
  const media = parseMedia(game.media);
  return {
    hero: assetUrl(media.hero),
    screenshots: (Array.isArray(media.screenshots) ? media.screenshots : []).map(assetUrl).filter(Boolean).slice(0, 6),
    developer: typeof media.developer === 'string' ? media.developer : '',
    publisher: typeof media.publisher === 'string' ? media.publisher : '',
    // Some trailer names are raw upload file names ("07【RE4】_Launch_PV.mp4"); those are not shown.
    trailerName: typeof media.trailerName === 'string' && !/_|\.(?:mp4|mov|webm)$/i.test(media.trailerName) ? media.trailerName : '',
    steamReviews: Number.isInteger(media.steamReviews) ? media.steamReviews : 0,
    steamPositive: Number.isInteger(media.steamPositive) ? media.steamPositive : null,
    // The year the game came to Steam when it differs from its first release, and where that first year comes from.
    steamYear: Number.isInteger(media.steamYear) && media.steamYear !== Number(game.year) ? media.steamYear : null,
    yearSource: yearSourceFor(media.yearSource),
  };
}

// "wikidata:Q105100327" → a link to the Wikidata item; "steam" → Steam's own original release date.
function yearSourceFor(value) {
  const match = /^wikidata:(Q\d{1,12})$/.exec(typeof value === 'string' ? value : '');
  if (match) return { label: 'Wikidata', url: `https://www.wikidata.org/wiki/${match[1]}` };
  return value === 'steam' ? { label: 'Steam', url: '' } : null;
}

function storePage(appid) {
  return isAppId(appid) ? `https://store.steampowered.com/app/${appid}/` : null;
}

module.exports = {
  ASSET_ROOT, IMAGE_HOST, VIDEO_HOST, assetUrl, coverCandidates, coverUrlsFor, isAppId, parseMedia, parseTrailerPath, showcaseFor,
  storePage, trailerSources,
};
