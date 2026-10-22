// The catalogue sync and check scripts, on store items shaped like Steam's GetItems answers (no network).
const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { checkCatalog } = require('../../scripts/catalog-check');
const { decodeEntities, nameScore, selectRecords, slugify, toRecord, withFirstRelease } = require('../../scripts/sync-catalog');

const HASH = '7a6be00f78fb0fd8b419e92cea72cc4a19ec45f8';
const TAGS = { 1: 'Souls-like', 2: 'Open World', 3: 'Sexual Content', 4: 'Software', 5: 'Indie', 6: 'Hentai' };
const item = (changes = {}) => ({
  appid: 1245620,
  type: 0,
  visible: true,
  name: 'ELDEN RING™',
  content_descriptorids: [2, 5],
  tags: [{ tagid: 2, weight: 500 }, { tagid: 1, weight: 900 }, { tagid: 5, weight: 100 }],
  reviews: { summary_filtered: { review_count: 834397, percent_positive: 93 } },
  release: { steam_release_date: 1645744078 },
  basic_info: { short_description: 'Rise, Tarnished &amp; be guided.', developers: [{ name: 'FromSoftware, Inc.' }], publishers: [{ name: 'Bandai Namco' }] },
  assets: { asset_url_format: 'steam/apps/1245620/${FILENAME}?t=1', library_capsule_2x: 'library_600x900_2x.jpg', library_capsule: 'library_600x900.jpg', header: 'header.jpg', library_hero: 'library_hero.jpg' },
  trailers: { highlights: [{ trailer_name: 'Accolades', all_ages: true, microtrailer: [{ filename: `1245620/468143/${HASH}/1750650501/microtrailer.webm` }] }] },
  screenshots: { all_ages_screenshots: [{ filename: 'steam/apps/1245620/ss_1.jpg?t=1' }] },
  ...changes,
});

describe('catalogue sync', () => {
  it('turns a store item into a catalogue record', () => {
    const record = toRecord(item(), TAGS);
    assert.equal(record.name, 'ELDEN RING');
    assert.equal(record.genre, 'Soulslike', 'the heaviest tag with a genre decides');
    assert.equal(record.year, 2022);
    assert.equal(record.trailer, `468143/${HASH}/1750650501`);
    assert.deepEqual(record.covers, ['steam/apps/1245620/library_600x900_2x.jpg', 'steam/apps/1245620/library_600x900.jpg']);
    assert.deepEqual(record.screenshots, ['steam/apps/1245620/ss_1.jpg']);
    assert.equal(record.description, 'Rise, Tarnished & be guided.');
    assert.ok(!record.tags.includes('indie'));
  });

  it('leaves out adult games, software, DLC and items without reviews or artwork', () => {
    assert.equal(toRecord(item({ content_descriptorids: [3] }), TAGS).reason, 'adult');
    assert.equal(toRecord(item({ tags: [{ tagid: 3, weight: 999 }, { tagid: 1, weight: 1 }] }), TAGS).reason, 'adult');
    assert.equal(toRecord(item({ tags: [{ tagid: 6, weight: 1 }] }), TAGS).reason, 'adult');
    assert.equal(toRecord(item({ tags: [{ tagid: 4, weight: 999 }] }), TAGS).reason, 'software');
    assert.equal(toRecord(item({ type: 4 }), TAGS).reason, 'not a game');
    assert.equal(toRecord(item({ name: 'Elden Ring Soundtrack' }), TAGS).reason, 'not a game');
    assert.equal(toRecord(item({ reviews: {} }), TAGS).reason, 'no reviews');
    assert.equal(toRecord(item({ assets: {} }), TAGS).reason, 'no artwork');
  });

  it('keeps a hand-picked game even when it is tagged for mature content, without showing that tag', () => {
    const tagged = item({ type: 4, tags: [{ tagid: 3, weight: 999 }, { tagid: 2, weight: 10 }] });
    const record = toRecord(tagged, TAGS, { forced: true });
    assert.equal(record.genre, 'Open World');
    assert.deepEqual(record.tags, ['open world']);
  });

  it('skips trailers made for adults only and trailers of another game', () => {
    assert.equal(toRecord(item({ trailers: { highlights: [{ all_ages: false, microtrailer: [{ filename: `1245620/1/${HASH}/1750650501/m.webm` }] }] } }), TAGS).trailer, '');
    assert.equal(toRecord(item({ trailers: { highlights: [{ microtrailer: [{ filename: `999/1/${HASH}/1750650501/m.webm` }] }] } }), TAGS).trailer, '');
  });

  it('keeps the most-reviewed games and every hand-picked one, with unique slugs', () => {
    const base = toRecord(item(), TAGS);
    const records = [
      { ...base, appid: 1, name: 'Doom', reviews: 10 },
      { ...base, appid: 2, name: 'DOOM', year: 2016, reviews: 500 },
      { ...base, appid: 3, name: 'Quiet', reviews: 1, covers: [], header: 'steam/apps/3/header.jpg' },
      { ...base, appid: 4, name: 'Big', reviews: 900 },
    ];
    const chosen = selectRecords(records, { size: 2, curatedIds: new Set([3]) });
    assert.deepEqual(chosen.map((record) => record.slug), ['big', 'doom', 'quiet']);
    assert.deepEqual(chosen[2].covers, ['steam/apps/3/header.jpg'], 'the header is the last-resort cover');
    assert.ok(!('header' in chosen[0]));
    const twins = selectRecords([{ ...base, appid: 7, name: 'Twin' }, { ...base, appid: 8, name: 'Twin' }], { size: 5, curatedIds: new Set() });
    assert.deepEqual(twins.map((record) => record.slug), ['twin', 'twin-2022']);
  });

  it('cleans names into slugs and decodes HTML entities', () => {
    assert.equal(slugify('Sid Meier’s Civilization® VI'), 'sid-meiers-civilization-vi');
    assert.equal(slugify('HELLDIVERS™ 2'), 'helldivers-2');
    assert.equal(slugify('God of War Ragnarök'), 'god-of-war-ragnarok');
    assert.equal(decodeEntities('Tom &amp; Jerry &#39;s &#x41; &bogus;'), "Tom & Jerry 's A &bogus;");
  });
});

describe('first release years', () => {
  it('takes Steam\'s original date when the store page came later', () => {
    const record = toRecord(item({ release: { steam_release_date: 1594252800, original_release_date: 1416960000 } }), TAGS);
    assert.equal(record.year, 2014);
    assert.equal(record.steamYear, 2020);
    assert.equal(record.yearSource, 'steam');
    assert.equal(toRecord(item(), TAGS).steamYear, undefined, 'no second year when both agree');
  });

  it('matches names word by word, ignoring edition words and refusing other numbers', () => {
    assert.equal(nameScore('ELDEN RING', 'Elden Ring'), 1);
    assert.equal(nameScore('Batman: Arkham City - Game of the Year Edition', 'Batman: Arkham City'), 1);
    assert.equal(nameScore('Counter-Strike 2', 'Counter-Strike 1.6'), 0);
    assert.ok(nameScore('Valheim', 'Terraria') < 0.6);
  });

  it('uses the earliest matching Wikidata date and says where it comes from', () => {
    const valheim = withFirstRelease({ appid: 892970, slug: 'valheim', name: 'Valheim', year: 2026, reviews: 1 }, [{ q: 'Q105100327', label: 'Valheim', year: 2021 }]);
    assert.deepEqual(Object.keys(valheim).slice(0, 6), ['appid', 'slug', 'name', 'year', 'steamYear', 'yearSource']);
    assert.equal(valheim.year, 2021);
    assert.equal(valheim.steamYear, 2026);
    assert.equal(valheim.yearSource, 'wikidata:Q105100327');
    const other = withFirstRelease({ appid: 892970, slug: 'valheim', name: 'Valheim', year: 2026 }, [{ q: 'Q1', label: 'Another Game', year: 1999 }]);
    assert.equal(other.year, 2026, 'an item with another name is not used');
    assert.equal(other.steamYear, undefined);
  });

  it('follows the hand-checked rules for reused store pages and wrong links', () => {
    const cs2 = withFirstRelease({ appid: 730, slug: 'counter-strike-2', name: 'Counter-Strike 2', year: 2012 }, [
      { q: 'Q1', label: 'Counter-Strike: Global Offensive', year: 2012 }, { q: 'Q111165107', label: 'Counter-Strike 2', year: 2023 }]);
    assert.equal(cs2.year, 2023);
    assert.equal(cs2.steamYear, 2012);
    const uno = withFirstRelease({ appid: 470220, slug: 'uno', name: 'UNO', year: 2016, steamYear: 2017, yearSource: 'steam' }, [{ q: 'Q7897207', label: 'Uno', year: 2006 }]);
    assert.equal(uno.year, 2016);
    assert.equal(uno.yearSource, 'steam');
  });
});

describe('catalogue check', () => {
  it('counts games and lists what is missing', () => {
    const line = (changes) => JSON.stringify({
      appid: 10, slug: 'one', name: 'One', year: 2020, genre: 'RPG', positive: 90, covers: ['steam/apps/10/library_600x900.jpg'],
      trailer: `1/${HASH}/1750650501`, hero: 'steam/apps/10/library_hero.jpg', screenshots: ['steam/apps/10/ss_1.jpg'], ...changes,
    });
    const report = checkCatalog([line(), line(), line({ appid: 11, slug: 'two', name: 'Two', trailer: '', hero: '' }), 'oops', ''].join('\n'));
    assert.equal(report.games, 2);
    assert.equal(report.lines, 4);
    assert.deepEqual(report.broken, [4]);
    assert.deepEqual(report.duplicates, ['one']);
    assert.deepEqual(report.noTrailer, ['Two']);
    assert.deepEqual(report.noHero, ['Two']);
    assert.deepEqual(report.genres, { RPG: 2 });
  });
});
