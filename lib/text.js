// Small text and date helpers shared by routes and views.

// Every date on the site is shown in one time zone, so "Today", "yesterday" and "Oct 14" always agree with
// each other wherever the server runs. Saudi time by default; DISPLAY_TIME_ZONE (an IANA name such as
// "Europe/London") changes it.
const DEFAULT_TIME_ZONE = 'Asia/Riyadh';

function resolveTimeZone(name) {
  if (!name) return DEFAULT_TIME_ZONE;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: name }).resolvedOptions().timeZone;
  } catch {
    console.warn(`DISPLAY_TIME_ZONE "${name}" is not a time zone name; showing dates in ${DEFAULT_TIME_ZONE}.`);
    return DEFAULT_TIME_ZONE;
  }
}

const DISPLAY_TIME_ZONE = resolveTimeZone(process.env.DISPLAY_TIME_ZONE);
const calendarFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: DISPLAY_TIME_ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});

// Counts characters the way SQLite's length() does (Unicode code points), so "👍👍" is 2, not 4.
function characterLength(value) {
  return [...String(value ?? '')].length;
}

// The first `count` code points, but never splitting a grapheme cluster (so flags/emoji stay intact).
// Uses Intl.Segmenter for grapheme boundaries, then stops when adding the next cluster would exceed `count` code points.
// This matches SQLite's length() which counts code points, while keeping graphemes whole.
function firstCharacters(value, count) {
  const segmenter = new Intl.Segmenter('ar', { granularity: 'grapheme' });
  const segments = [...segmenter.segment(String(value ?? ''))];
  let codePointCount = 0;
  let result = '';
  for (const seg of segments) {
    const clusterCodePoints = [...seg.segment].length;
    if (codePointCount + clusterCodePoints > count) break;
    result += seg.segment;
    codePointCount += clusterCodePoints;
  }
  return result;
}

// Trims, collapses inner whitespace and shortens user input (search boxes, titles, query strings).
function cleanText(value, maxLength = 80) {
  const collapsed = String(value ?? '').trim().replace(/\s+/g, ' ');
  return firstCharacters(collapsed, maxLength).trimEnd();
}

// SQLite CURRENT_TIMESTAMP values are UTC "YYYY-MM-DD HH:MM:SS" strings.
function toDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (!value) return null;
  const text = String(value);
  const date = new Date(text.includes('T') ? text : `${text.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Machine-readable timestamp for <time datetime="…"> ("2026-10-15T18:30:00.000Z"), or '' when unknown.
function isoTime(value) {
  return toDate(value)?.toISOString() || '';
}

// Creating an Intl.DateTimeFormat is slow and a page formats many dates, so each set of options gets one.
const dateFormats = new Map();

function formatDate(value, options = { month: 'short', day: 'numeric', year: 'numeric' }) {
  const date = toDate(value);
  if (!date) return 'Recently';
  const key = JSON.stringify(options);
  if (!dateFormats.has(key)) dateFormats.set(key, new Intl.DateTimeFormat('en-US', { ...options, timeZone: DISPLAY_TIME_ZONE }));
  return dateFormats.get(key).format(date);
}

// Whole calendar days from `earlier` to `later` in the display time zone: 0 is the same day, 1 the day before.
function calendarDaysBetween(earlier, later) {
  const dayNumber = (time) => {
    const parts = Object.fromEntries(calendarFormat.formatToParts(new Date(time)).map(({ type, value }) => [type, value]));
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) / 86400000;
  };
  return Math.round(dayNumber(later) - dayNumber(earlier));
}

function relativeTime(value, now = Date.now()) {
  const date = toDate(value);
  if (!date) return 'recently';
  const seconds = Math.max(0, Math.round((now - date.getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  // Beyond a day, count calendar days, so 26 hours ago at 1 a.m. is "2 days ago", not "yesterday".
  const days = calendarDaysBetween(date, now);
  if (hours < 24 || days === 0) return `${hours} h ago`;
  if (days < 7) return days === 1 ? 'yesterday' : `${days} days ago`;
  return formatDate(value, { month: 'short', day: 'numeric' });
}

function initial(name) {
  return [...String(name || '?').trim()][0]?.toUpperCase() || '?';
}

module.exports = {
  DISPLAY_TIME_ZONE,
  calendarDaysBetween,
  characterLength,
  cleanText,
  firstCharacters,
  formatDate,
  initial,
  isoTime,
  relativeTime,
  resolveTimeZone,
  toDate,
};
