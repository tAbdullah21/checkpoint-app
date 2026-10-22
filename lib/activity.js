// Turns activity rows into display-ready feed items (sentence parts, links, relative time).
const { calendarDaysBetween, formatDate, isoTime, relativeTime, toDate } = require('./text');

const STATUS_PHRASES = {
  want_to_play: 'wants to play',
  playing: 'started playing',
  played: 'played',
  completed: 'completed',
};

const STATUS_LABELS = {
  want_to_play: 'Want to Play',
  playing: 'Playing',
  played: 'Played',
  completed: 'Completed',
};

// "Today", "Yesterday" or a date, used to group feeds by day. Stored timestamps are UTC; the day follows
// the site's display time zone (lib/text.js), the same one every other date uses.
function dayLabel(value, now = Date.now()) {
  const date = toDate(value);
  if (!date) return 'Earlier';
  const difference = calendarDaysBetween(date, now);
  if (difference <= 0) return 'Today';
  if (difference === 1) return 'Yesterday';
  return formatDate(date, { weekday: 'long', month: 'short', day: 'numeric' });
}

// The name and link of the game or list an activity is about (undefined when it has been deleted).
function about(target) {
  return { object: target?.name, objectUrl: target?.url };
}

// The words for each type of activity: the verb, what it is about, and what comes after it.
const SENTENCES = {
  library_add: ({ row, game }) => ({ verb: 'added', ...about(game), suffix: `to ${STATUS_LABELS[row.detail] || 'their library'}` }),
  status_change: ({ row, game }) => ({ verb: STATUS_PHRASES[row.detail] || 'updated', ...about(game) }),
  review: ({ row, game }) => ({ verb: 'rated', ...about(game), stars: Math.max(0, Math.min(5, Number(row.detail) || 0)) }),
  follow: ({ row }) => ({ verb: 'started following', object: row.target_name, objectUrl: row.target_id ? `/members/${row.target_id}` : null }),
  list_create: ({ list }) => ({ verb: 'created the list', ...about(list) }),
  list_add: ({ game, list }) => ({ verb: 'added', ...about(game), suffix: list ? `to “${list.name}”` : '' }),
};
const UNKNOWN_SENTENCE = () => ({ verb: 'was active' });

function describeActivity(row, now = Date.now()) {
  const game = row.game_slug ? { name: row.game_title, url: `/games/${row.game_slug}` } : null;
  const list = row.list_id ? { name: row.list_title, url: `/lists/${row.list_id}` } : null;
  const sentence = Object.hasOwn(SENTENCES, row.type) ? SENTENCES[row.type] : UNKNOWN_SENTENCE;
  return {
    id: row.id,
    actorId: row.user_id,
    actorName: row.user_name,
    time: relativeTime(row.created_at, now),
    datetime: isoTime(row.created_at),
    day: dayLabel(row.created_at, now),
    image: row.game_image || null,
    verb: '',
    object: null,
    objectUrl: null,
    suffix: '',
    stars: 0,
    ...sentence({ row, game, list }),
  };
}

// Items that carry a `day` label → [{ label: 'Today', items: [...] }, …], keeping the newest-first order.
function groupByDay(items) {
  const days = [];
  for (const item of items) {
    if (days.length === 0 || days[days.length - 1].label !== item.day) days.push({ label: item.day, items: [] });
    days[days.length - 1].items.push(item);
  }
  return days;
}

module.exports = { STATUS_LABELS, dayLabel, describeActivity, groupByDay };
