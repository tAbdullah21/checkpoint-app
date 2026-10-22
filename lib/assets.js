// Static asset helpers for templates: cache-busting URLs for the stylesheets and the script, and WebP thumbnails
// for game covers in two widths (public/images/covers/thumbs, made by scripts/make-thumbnails.py and listed in
// its manifest.json).
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { trailerSources } = require('./steam-media');

const PUBLIC_DIRECTORY = path.join(__dirname, '..', 'public');
const COVERS_DIRECTORY = path.join(PUBLIC_DIRECTORY, 'images', 'covers');

// "/css/pages.css" → "/css/pages.css?v=1a2b3c4d". The version changes whenever the file changes, so browsers
// can keep these files for a year and still get every update immediately.
const versions = new Map();

function assetUrl(urlPath) {
  try {
    const stat = fs.statSync(path.join(PUBLIC_DIRECTORY, urlPath));
    const fingerprint = `${stat.size}:${stat.mtimeMs}`;
    if (versions.get(urlPath)?.fingerprint !== fingerprint) {
      versions.set(urlPath, { fingerprint, version: crypto.createHash('sha1').update(fingerprint).digest('hex').slice(0, 8) });
    }
    return `${urlPath}?v=${versions.get(urlPath).version}`;
  } catch {
    return urlPath;
  }
}

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(path.join(COVERS_DIRECTORY, 'thumbs', 'manifest.json'), 'utf8'));
  } catch {
    return {};
  }
}

// A thumbnail is only used while its source cover is unchanged (same file size as when it was made), so a
// cover replaced later, for example by `npm run covers`, is never shown as an outdated thumbnail.
function loadThumbnails(manifest = readManifest(), coversDirectory = COVERS_DIRECTORY) {
  const thumbnails = new Map();
  for (const [file, entry] of Object.entries(manifest)) {
    try {
      if (fs.statSync(path.join(coversDirectory, file)).size !== entry.sourceBytes) continue;
      const exists = (url) => Boolean(url) && fs.existsSync(path.join(coversDirectory, 'thumbs', path.basename(url)));
      if (!exists(entry.thumb)) continue;
      thumbnails.set(`/images/covers/${file}`, exists(entry.small) ? entry : { ...entry, small: null, smallWidth: null });
    } catch {
      // The cover itself is missing: the app serves a generated placeholder poster instead.
    }
  }
  return thumbnails;
}

let thumbnails = loadThumbnails();

// The WebP version of a cover, or the cover itself when there is no thumbnail. 'small' (240px wide) is for
// covers drawn 120 CSS pixels wide or less and for blurred backdrops; the default is 400px wide.
function thumb(image, size = 'default') {
  const entry = thumbnails.get(image);
  if (!entry) return image;
  return (size === 'small' && entry.small) || entry.thumb;
}

function escapeAttribute(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// src, srcset and sizes for a cover shown at `sizes` CSS pixels: the browser picks the 240px or 400px
// thumbnail for the screen it is on, and the full cover only when it is drawn large on a high-density screen.
function coverAttributes(image, sizes) {
  const entry = thumbnails.get(image);
  if (!entry) return `src="${escapeAttribute(image)}"`;
  const candidates = [];
  if (entry.small && entry.smallWidth < entry.width) candidates.push(`${entry.small} ${entry.smallWidth}w`);
  candidates.push(`${entry.thumb} ${entry.width}w`);
  if (entry.sourceWidth > entry.width) candidates.push(`${image} ${entry.sourceWidth}w`);
  if (candidates.length === 1) return `src="${escapeAttribute(entry.thumb)}"`;
  return `src="${escapeAttribute(entry.thumb)}" srcset="${escapeAttribute(candidates.join(', '))}" sizes="${escapeAttribute(sizes)}"`;
}

// For tests: point the helpers at another manifest.
function useThumbnails(manifest, coversDirectory) {
  thumbnails = loadThumbnails(manifest, coversDirectory);
}

// data-* attributes that let the browser play a game's six-second Steam preview when its card is hovered.
// Empty for games without a known trailer. Nothing is requested until the visitor actually hovers or focuses.
function previewAttributes(game) {
  const sources = trailerSources(game.steam_appid, game.trailer_path);
  if (!sources) return '';
  return `data-preview-webm="${escapeAttribute(sources.previewWebm)}" data-preview-mp4="${escapeAttribute(sources.previewMp4)}"`;
}

module.exports = { assetUrl, coverAttributes, previewAttributes, loadThumbnails, thumb, useThumbnails };
