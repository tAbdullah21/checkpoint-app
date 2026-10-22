// Small presentation helpers shared by every template (registered as app.locals in app.js).

const ICON_NAMES = new Set([
  'home', 'gamepad', 'sparkles', 'users', 'list', 'library', 'activity', 'search', 'plus', 'check', 'star', 'heart',
  'heart-fill', 'chevron-right', 'chevron-left', 'chevron-down', 'arrow-right', 'arrow-left', 'x', 'menu', 'user', 'edit',
  'logout', 'trophy', 'dice', 'play', 'lock', 'globe', 'fire', 'clock', 'grip', 'filter', 'share', 'eye', 'calendar',
  'layers', 'bolt', 'message', 'bookmark', 'trash', 'more', 'trend', 'target', 'flag', 'crown', 'gauge', 'cpu', 'steam',
  'sort', 'grid', 'columns', 'info', 'alert', 'quote', 'command', 'bell', 'arrow-up', 'arrow-down', 'key', 'download',
  'shield', 'reply', 'monitor', 'phone', 'mail', 'pause', 'volume', 'mute', 'image', 'expand',
]);

// An icon from the SVG sprite in partials/icon-sprite.ejs. Names are checked against a fixed list, so a
// template can never inject markup through this helper.
function icon(name, className = '') {
  if (!ICON_NAMES.has(name)) throw new Error(`Unknown icon "${name}"`);
  const classes = className ? `icon ${className}` : 'icon';
  return `<svg class="${classes}" aria-hidden="true" focusable="false"><use href="#i-${name}"></use></svg>`;
}

// A stable hue (0-359) for a member's avatar, so every player keeps the same colour everywhere.
function hueFor(seed) {
  let hash = 2166136261;
  for (const character of String(seed || '')) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % 360;
}

// Controlled HTML for five stars, with a clipped half-star. Never includes user-supplied markup.
function starString(rating) {
  const rounded = Math.max(0, Math.min(5, Math.round((Number(rating) || 0) * 2) / 2));
  const full = Math.floor(rounded);
  const half = rounded > full ? '<span class="star-half" aria-hidden="true"><span>☆</span><span>★</span></span>' : '';
  return '★'.repeat(full) + half + '☆'.repeat(5 - full - (half ? 1 : 0));
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${Number(count) === 1 ? singular : pluralForm}`;
}

const STATUS_META = {
  want_to_play: { label: 'Want to Play', short: 'Wishlist', className: 'status-want' },
  playing: { label: 'Playing', short: 'Playing', className: 'status-playing' },
  played: { label: 'Played', short: 'Played', className: 'status-played' },
  completed: { label: 'Completed', short: 'Completed', className: 'status-completed' },
};

// The four library columns in board order, as { value, label } pairs for forms and menus.
const STATUS_OPTIONS = Object.entries(STATUS_META).map(([value, meta]) => ({ value, label: meta.label }));

function statusMeta(status) {
  return STATUS_META[status] || null;
}

module.exports = { ICON_NAMES, STATUS_META, STATUS_OPTIONS, hueFor, icon, plural, starString, statusMeta };
