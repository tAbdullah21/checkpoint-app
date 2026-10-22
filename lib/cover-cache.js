// A read-through cache for game covers. The first time a cover is asked for, it is fetched from Steam's content
// network and saved in data/covers; every later request is served from disk, so the site works offline once a page
// has been seen. When Steam cannot be reached, callers get null and show a generated poster instead; after a few
// failures in a row the cache stops trying for a while (a circuit breaker) so a page of 48 covers never waits on a
// dead network, and a cover Steam does not have is remembered as missing for an hour. Next to each cover a small
// "<slug>.src" file says which address it came from: when the catalogue points somewhere else (Steam changed the
// art) or the file predates 3.8, the old cover is still served at once while the new one is fetched in the
// background, so a cover never stays out of date and a page never waits for it.
const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 3 * 1024 * 1024;
const MIN_BYTES = 1024;
const REQUEST_TIMEOUT_MS = 6000;
const BREAKER_FAILURES = 4;
const BREAKER_PAUSE_MS = 5 * 60 * 1000;
const MISSING_MS = 60 * 60 * 1000;

function looksLikeJpeg(buffer) {
  return buffer.length >= MIN_BYTES && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function createCoverCache({
  directory = path.join(__dirname, '..', 'data', 'covers'),
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  enabled = process.env.COVER_FETCH !== '0',
} = {}) {
  const pending = new Map();
  const missing = new Map();
  let failures = 0;
  let pausedUntil = 0;

  function fileFor(slug) {
    return path.join(directory, `${slug}.jpg`);
  }

  const sourceFor = (slug) => path.join(directory, `${slug}.src`);
  const sources = new Map();
  function cachedSource(slug) {
    if (!sources.has(slug)) {
      let source = '';
      try {
        source = fs.readFileSync(sourceFor(slug), 'utf8').trim();
      } catch {
        // A cover saved before 3.8 has no source file; it is refreshed once.
      }
      sources.set(slug, source);
    }
    return sources.get(slug);
  }

  async function download(url) {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), redirect: 'follow' });
    if (response.status === 404 || response.status === 403) return { status: 'absent' };
    if (!response.ok) throw new Error(`Steam answered ${response.status}`);
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > MAX_BYTES) return { status: 'absent' };
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_BYTES || !looksLikeJpeg(buffer)) return { status: 'absent' };
    return { status: 'ok', buffer };
  }

  async function fetchCover(slug, urls) {
    for (const url of urls) {
      const result = await download(url);
      if (result.status === 'ok') {
        fs.mkdirSync(directory, { recursive: true });
        const temporary = `${fileFor(slug)}.${process.pid}.tmp`;
        fs.writeFileSync(temporary, result.buffer);
        fs.renameSync(temporary, fileFor(slug));
        fs.writeFileSync(sourceFor(slug), `${url}\n`);
        sources.set(slug, url);
        return fileFor(slug);
      }
    }
    missing.set(slug, now() + MISSING_MS);
    return null;
  }

  return {
    // The path of the cached cover file, fetching it first (from the first of `urls` that answers with a real
    // image) when needed; null when there is none.
    async get(slug, urls = []) {
      if (!/^[a-z0-9-]{1,120}$/.test(slug)) return null;
      if (fs.existsSync(fileFor(slug))) {
        if (urls.length > 0 && !urls.includes(cachedSource(slug))) refresh(slug, urls);
        return fileFor(slug);
      }
      if (urls.length === 0) return null;
      return refresh(slug, urls);
    },
    // Resolves when every download started so far has finished (used by tests and scripts).
    settled: () => Promise.all([...pending.values()]),
    has: (slug) => fs.existsSync(fileFor(slug)),
    directory,
  };

  // One download per cover at a time; failures count toward the circuit breaker. Resolves to the file or null.
  function refresh(slug, urls) {
    if (!enabled || now() < pausedUntil || (missing.get(slug) || 0) > now()) return Promise.resolve(null);
    if (!pending.has(slug)) {
      const job = fetchCover(slug, urls)
        .then((file) => {
          failures = 0;
          return file;
        })
        .catch(() => {
          failures += 1;
          if (failures >= BREAKER_FAILURES) {
            pausedUntil = now() + BREAKER_PAUSE_MS;
            failures = 0;
          }
          return null;
        })
        .finally(() => pending.delete(slug));
      pending.set(slug, job);
    }
    return pending.get(slug);
  }
}

module.exports = { createCoverCache, looksLikeJpeg };
