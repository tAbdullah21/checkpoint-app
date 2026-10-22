// Helpers for showing member profiles consistently on public pages.

const PLATFORM_LABELS = {
  steam: 'PC / Steam',
  playstation: 'PlayStation',
  xbox: 'Xbox',
};

function splitGenres(value = '') {
  return String(value || '').split(',').map((genre) => genre.trim()).filter(Boolean);
}

// Only IDs the member filled in and chose to show.
function visibleGamingAccounts(user) {
  return [
    { name: 'Steam', slug: 'steam', id: user.steam_id, visible: user.steam_visible, logo: '/images/platforms/steam.svg' },
    { name: 'PlayStation Network', slug: 'playstation', id: user.psn_id, visible: user.psn_visible, logo: '/images/platforms/playstation.svg' },
    { name: 'Xbox', slug: 'xbox', id: user.xbox_id, visible: user.xbox_visible, logo: '/images/platforms/xbox.svg' },
  ].filter((account) => account.id && account.visible);
}

// Accepts only local paths (no protocol, no "//host"), so redirects can never leave the site.
function safeLocalPath(value, fallback = '/') {
  if (typeof value !== 'string' || value.length > 200) return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  return /^\/[A-Za-z0-9\-._~/?=&#%]*$/.test(value) ? value : fallback;
}

module.exports = { PLATFORM_LABELS, safeLocalPath, splitGenres, visibleGamingAccounts };
