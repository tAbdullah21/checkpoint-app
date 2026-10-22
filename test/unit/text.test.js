const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { calendarDaysBetween, characterLength, cleanText, firstCharacters, formatDate, initial, isoTime, relativeTime, resolveTimeZone, toDate } = require('../../lib/text');

describe('characterLength', () => {
  it('counts an emoji as one character, like SQLite length()', () => {
    assert.equal(characterLength('👍👍'), 2);
    assert.equal('👍👍'.length, 4, 'JavaScript string length would count 4');
    assert.equal(characterLength('Saleh'), 5);
  });

  it('treats missing values as empty', () => {
    assert.equal(characterLength(null), 0);
    assert.equal(characterLength(undefined), 0);
  });
});

describe('initial', () => {
  it('uses the first visible character', () => {
    assert.equal(initial('  saleh'), 'S');
    assert.equal(initial('😀 Saleh'), '😀');
    assert.equal(initial('عبدالله'), 'ع');
  });

  it('falls back to a question mark', () => {
    assert.equal(initial(''), '?');
    assert.equal(initial(null), '?');
  });
});

describe('dates', () => {
  it('reads SQLite UTC timestamps', () => {
    assert.equal(toDate('2026-10-14 10:00:00').toISOString(), '2026-10-14T10:00:00.000Z');
    assert.equal(toDate('not a date'), null);
    assert.equal(toDate(''), null);
  });

  it('formats dates and falls back gracefully', () => {
    assert.equal(formatDate('2026-10-14 10:00:00'), 'Oct 14, 2026');
    assert.equal(formatDate('2026-10-14 22:30:00'), 'Oct 15, 2026', '01:30 on the 15th in Saudi time');
    assert.equal(formatDate('2026-10-14 10:00:00', { month: 'long', year: 'numeric' }), 'October 2026');
    assert.equal(formatDate(null), 'Recently');
  });

  it('describes how long ago something happened', () => {
    const now = Date.parse('2026-10-14T12:00:00Z');
    assert.equal(relativeTime('2026-10-14 11:59:30', now), 'just now');
    assert.equal(relativeTime('2026-10-14 11:35:00', now), '25 min ago');
    assert.equal(relativeTime('2026-10-14 07:00:00', now), '5 h ago');
    assert.equal(relativeTime('2026-10-13 10:00:00', now), 'yesterday');
    assert.equal(relativeTime('2026-10-12 22:00:00', now), 'yesterday', '38 hours, but only one calendar day');
    assert.equal(relativeTime('2026-10-12 20:00:00', now), '2 days ago', '40 hours and two calendar days');
    assert.equal(relativeTime('2026-10-10 12:00:00', now), '4 days ago');
    assert.equal(relativeTime('2026-09-01 12:00:00', now), 'Sep 1');
    assert.equal(relativeTime('garbage', now), 'recently');
  });
});

describe('display time zone', () => {
  it('counts calendar days in Saudi time', () => {
    const now = Date.parse('2026-10-14T09:00:00Z');
    assert.equal(calendarDaysBetween(Date.parse('2026-10-13T21:30:00Z'), now), 0, '00:30 on the 14th in Riyadh');
    assert.equal(calendarDaysBetween(Date.parse('2026-10-13T20:30:00Z'), now), 1, '23:30 on the 13th in Riyadh');
    assert.equal(calendarDaysBetween(Date.parse('2026-10-07T09:00:00Z'), now), 7);
  });

  it('accepts IANA names and falls back to Saudi time for anything else', (t) => {
    t.mock.method(console, 'warn', () => {});
    assert.equal(resolveTimeZone('Europe/London'), 'Europe/London');
    assert.equal(resolveTimeZone(''), 'Asia/Riyadh');
    assert.equal(resolveTimeZone('Mars/Olympus_Mons'), 'Asia/Riyadh');
    assert.equal(console.warn.mock.callCount(), 1);
  });
});

describe('cleanText and isoTime', () => {
  it('trims, collapses whitespace and shortens input', () => {
    assert.equal(cleanText('  Elden    Ring \n '), 'Elden Ring');
    assert.equal(cleanText('x'.repeat(100)).length, 80);
    assert.equal(cleanText('abcdef', 3), 'abc');
    assert.equal(cleanText(null), '');
  });

  it('shortens by whole characters, so an emoji is never cut in half', () => {
    assert.equal(firstCharacters('🏆🏆🏆', 2), '🏆🏆');
    assert.equal('🏆🏆🏆'.slice(0, 3), '🏆\ud83c', 'slice() would leave half an emoji');
    assert.equal(cleanText('🏆'.repeat(61), 120), '🏆'.repeat(61), '61 characters are kept, so the 60-character limit refuses them');
    assert.equal(firstCharacters(undefined, 5), '');
  });

  it('gives <time> elements a machine-readable UTC timestamp', () => {
    assert.equal(isoTime('2026-10-14 10:00:00'), '2026-10-14T10:00:00.000Z');
    assert.equal(isoTime(''), '');
    assert.equal(isoTime('garbage'), '');
  });
});
