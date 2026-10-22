const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const { parseCatalogLine, readCatalog, starsFromPositive } = require('../../database/catalog');
const { createCoverCache, looksLikeJpeg } = require('../../lib/cover-cache');
const { featuredReel } = require('../../lib/showcase');
const {
  assetUrl, coverCandidates, coverUrlsFor, parseMedia, parseTrailerPath, showcaseFor, trailerSources,
} = require('../../lib/steam-media');

const HASH = 'aa5a28c78f12232e6b6839034550c28b162fad3e';
const GAME = {
  appid: 730,
  slug: 'counter-strike-2',
  name: 'Counter-Strike 2',
  year: 2012,
  reviews: 2636089,
  positive: 87,
  genre: 'First-Person Shooter',
  tags: ['fps', 'shooter', 'multiplayer'],
  description: 'A shooter.',
  trailer: `612468/${HASH}/1748810724`,
  trailerName: 'Launch trailer',
  covers: [`steam/apps/730/${HASH}/library_600x900_2x.jpg`, 'steam/apps/730/library_600x900.jpg'],
  hero: 'steam/apps/730/library_hero.jpg',
  screenshots: ['steam/apps/730/ss_1.jpg', 'https://evil.example/x.jpg'],
  developer: 'Valve',
  publisher: 'Valve',
};
const line = (changes = {}) => JSON.stringify({ ...GAME, ...changes });

describe('Steam media addresses', () => {
  it('builds legacy cover candidates from the store number and cover code', () => {
    assert.equal(coverCandidates(730).length, 3);
    assert.match(coverCandidates(730)[0], /\/apps\/730\/library_600x900_2x\.jpg$/);
    assert.deepEqual(coverCandidates(730, 'H'), ['https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/730/header.jpg']);
    assert.match(coverCandidates(730, `${HASH}~ab`)[0], new RegExp(`/730/${HASH}/library_capsule_2x\\.jpg$`));
    assert.deepEqual(coverCandidates('730'), []);
  });

  it('turns only real Steam asset paths into addresses', () => {
    assert.equal(assetUrl('steam/apps/730/header.jpg'), 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/730/header.jpg');
    assert.equal(assetUrl('../../etc/passwd'), null);
    assert.equal(assetUrl('https://evil.example/a.jpg'), null);
    assert.deepEqual(parseMedia('not json'), {});
    assert.deepEqual(parseMedia('[1,2]'), {});
  });

  it('lists the exact cover files first, then the conventional names', () => {
    const urls = coverUrlsFor({ steam_appid: 730, cover_code: '', media: JSON.stringify({ covers: GAME.covers }) });
    assert.match(urls[0], new RegExp(`/730/${HASH}/library_600x900_2x\\.jpg$`));
    assert.ok(urls.length >= 4);
    assert.equal(new Set(urls).size, urls.length);
    assert.deepEqual(coverUrlsFor({ steam_appid: null, media: '{}' }), []);
  });

  it('builds trailer addresses and refuses malformed paths', () => {
    const sources = trailerSources(730, `612468/${HASH}/1748810724`);
    assert.equal(sources.previewMp4, `https://video.akamai.steamstatic.com/store_trailers/730/612468/${HASH}/1748810724/microtrailer.mp4`);
    assert.ok(sources.hls.endsWith('hls_264_master.m3u8'));
    assert.equal(trailerSources(730, ''), null);
    assert.equal(parseTrailerPath('../../etc/passwd'), null);
  });

  it('shapes the game page showcase and drops foreign addresses', () => {
    const parsed = parseCatalogLine(line());
    const showcase = showcaseFor({ media: JSON.stringify(parsed.media) });
    assert.match(showcase.hero, /library_hero\.jpg$/);
    assert.equal(showcase.screenshots.length, 1);
    assert.equal(showcase.developer, 'Valve');
    assert.equal(showcase.steamPositive, 87);
    assert.equal(showcaseFor({ media: '' }).hero, null);
    assert.equal(showcase.steamYear, null, 'one year when Steam and the first release agree');
  });

  it('keeps the year a game came to Steam and links the source of its first release year', () => {
    const parsed = parseCatalogLine(line({ year: 2021, steamYear: 2026, yearSource: 'wikidata:Q105100327' }));
    assert.equal(parsed.year, 2021);
    const showcase = showcaseFor({ year: 2021, media: JSON.stringify(parsed.media) });
    assert.equal(showcase.steamYear, 2026);
    assert.deepEqual(showcase.yearSource, { label: 'Wikidata', url: 'https://www.wikidata.org/wiki/Q105100327' });
    const steam = parseCatalogLine(line({ year: 2014, steamYear: 2020, yearSource: 'steam' }));
    assert.deepEqual(showcaseFor({ year: 2014, media: JSON.stringify(steam.media) }).yearSource, { label: 'Steam', url: '' });
    const forged = parseCatalogLine(line({ steamYear: 2020, yearSource: 'https://evil.example' }));
    assert.equal(forged.media.yearSource, '', 'only known sources are kept');
  });
});

describe('the catalogue file', () => {
  it('parses a game line and rejects broken ones', () => {
    const game = parseCatalogLine(line());
    assert.equal(game.appid, 730);
    assert.equal(game.rating, 4.4);
    assert.equal(game.tags, 'fps,shooter,multiplayer');
    assert.equal(parseCatalogLine(line({ slug: 'Bad Slug' })), null);
    assert.equal(parseCatalogLine(line({ covers: ['https://evil.example/a.jpg'] })), null, 'a game needs a real cover');
    assert.equal(parseCatalogLine(line({ year: 1850 })), null);
    assert.equal(parseCatalogLine('{not json'), null);
    assert.equal(parseCatalogLine(line({ trailer: '../x' })).trailerPath, '');
  });

  it('turns the share of positive Steam reviews into 1–5 stars', () => {
    assert.equal(starsFromPositive(95), 4.8);
    assert.equal(starsFromPositive(100), 5);
    assert.equal(starsFromPositive(3), 1);
    assert.equal(starsFromPositive('x'), 1);
  });

  it('skips repeated games and slugs in a file', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-')), 'games.jsonl');
    fs.writeFileSync(file, [line(), line(), line({ appid: 731 }), '', line({ appid: 732, slug: 'another' })].join('\n'));
    assert.deepEqual(readCatalog(file).map((game) => game.slug), ['counter-strike-2', 'another']);
    assert.deepEqual(readCatalog(path.join(os.tmpdir(), 'missing-catalogue.jsonl')), []);
  });

  it('ships about a thousand valid, unique games, each with a cover', () => {
    const games = readCatalog();
    assert.ok(games.length >= 900, `${games.length} games`);
    assert.equal(new Set(games.map((game) => game.slug)).size, games.length);
    for (const game of games) {
      assert.ok(game.media.covers.length > 0, game.slug);
      assert.ok(game.description.length <= 600 && game.tags.length <= 200, game.slug);
    }
    const withTrailer = games.filter((game) => game.trailerPath).length;
    assert.ok(withTrailer / games.length > 0.9, `${withTrailer} of ${games.length} have a trailer`);
  });
});

describe('the featured reel', () => {
  const pool = [1, 2, 3, 4, 5, 6, 7].map((n) => ({
    slug: `game-${n}`, title: `Game ${n}`, year: 2020, genre: 'RPG', rating: 4.5, image: `/images/covers/game-${n}.jpg`,
    description: 'Text', steam_appid: n, trailer_path: `1/${HASH}/1748810724`,
    media: JSON.stringify({ hero: `steam/apps/${n}/library_hero.jpg`, developer: 'Studio', steamPositive: 90 }),
  }));

  it('picks games with artwork and a trailer, and changes the selection daily', () => {
    const today = featuredReel(pool, { count: 3, now: 0 });
    assert.deepEqual(today.map((slide) => slide.slug), ['game-1', 'game-2', 'game-3']);
    const tomorrow = featuredReel(pool, { count: 3, now: 24 * 60 * 60 * 1000 });
    assert.deepEqual(tomorrow.map((slide) => slide.slug), ['game-4', 'game-5', 'game-6']);
    assert.match(today[0].hero, /library_hero\.jpg$/);
    assert.ok(today[0].trailer.previewMp4);
  });

  it('leaves out games without artwork or a trailer', () => {
    assert.deepEqual(featuredReel([{ ...pool[0], media: '{}' }, { ...pool[1], trailer_path: '' }]), []);
    assert.equal(featuredReel(pool, { count: 20 }).length, pool.length);
  });
});

describe('the cover cache', () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 1)]);
  const reply = (status, body = jpeg) => ({ ok: status < 400, status, headers: { get: () => null }, arrayBuffer: async () => body });
  const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cover-cache-'));

  it('downloads once, then serves from disk', async () => {
    let calls = 0;
    const cache = createCoverCache({ directory: temp(), fetchImpl: async () => { calls += 1; return reply(200); } });
    const file = await cache.get('some-game', ['https://a/1.jpg']);
    assert.ok(looksLikeJpeg(fs.readFileSync(file)));
    await cache.get('some-game', ['https://a/1.jpg']);
    assert.equal(calls, 1);
  });

  it('notes where a cover came from and refreshes it in the background when the address changes', async () => {
    const directory = temp();
    const served = [];
    const cache = createCoverCache({ directory, fetchImpl: async (url) => { served.push(url); return reply(200, Buffer.concat([jpeg, Buffer.from(url)])); } });
    const file = await cache.get('art', ['https://a/season-1.jpg']);
    assert.equal(fs.readFileSync(path.join(directory, 'art.src'), 'utf8').trim(), 'https://a/season-1.jpg');
    assert.equal(await cache.get('art', ['https://a/season-2.jpg', 'https://a/season-1.jpg']), file, 'an address still listed counts as current');
    assert.equal(served.length, 1);
    assert.equal(await cache.get('art', ['https://a/season-2.jpg']), file, 'the old cover is served at once');
    await cache.settled();
    assert.deepEqual(served, ['https://a/season-1.jpg', 'https://a/season-2.jpg']);
    assert.match(fs.readFileSync(file, 'latin1'), /season-2/);
    fs.writeFileSync(path.join(directory, 'legacy.jpg'), jpeg);
    await cache.get('legacy', ['https://a/legacy.jpg']);
    await cache.settled();
    assert.ok(fs.existsSync(path.join(directory, 'legacy.src')), 'a cover from before 3.8 is refreshed once');
  });

  it('tries the next address after a 404 and remembers a cover that does not exist', async () => {
    const urls = [];
    const cache = createCoverCache({ directory: temp(), fetchImpl: async (url) => { urls.push(url); return reply(url.includes('first') ? 404 : 200); } });
    assert.ok(await cache.get('a-game', ['https://a/first.jpg', 'https://a/second.jpg']));
    assert.deepEqual(urls, ['https://a/first.jpg', 'https://a/second.jpg']);
    let calls = 0;
    const none = createCoverCache({ directory: temp(), fetchImpl: async () => { calls += 1; return reply(404); } });
    assert.equal(await none.get('x', ['https://a/1.jpg']), null);
    assert.equal(await none.get('x', ['https://a/1.jpg']), null);
    assert.equal(calls, 1);
  });

  it('refuses non-JPEG data, bad names, no addresses and a disabled cache, and pauses after repeated failures', async () => {
    const directory = temp();
    const html = createCoverCache({ directory, fetchImpl: async () => reply(200, Buffer.from('<html>'.repeat(400))) });
    assert.equal(await html.get('page', ['https://a/1.jpg']), null);
    assert.equal(await html.get('../evil', ['https://a/1.jpg']), null);
    assert.equal(await html.get('no-urls', []), null);
    assert.equal(await createCoverCache({ directory, enabled: false }).get('off', ['https://a/1.jpg']), null);
    let calls = 0;
    const down = createCoverCache({ directory, fetchImpl: async () => { calls += 1; throw new Error('offline'); } });
    for (let i = 0; i < 8; i += 1) await down.get(`g${i}`, ['https://a/1.jpg']);
    assert.equal(calls, 4);
  });
});
