// The featured reel: a few well-known games shown big, with their wide Steam artwork and a muted trailer, at the
// top of the catalogue and the home page. The pool comes from the database (listFeaturedGames); this module picks
// today's slides and shapes them for the template. It never touches the database itself.
const { showcaseFor, trailerSources } = require('./steam-media');

const DAY_MS = 24 * 60 * 60 * 1000;

// `count` games from the pool, starting at an offset that moves every day, so the reel changes daily but stays the
// same for everyone on the same day (and in tests, for a fixed `now`).
function featuredReel(pool, { count = 6, now = Date.now() } = {}) {
  const usable = pool
    .map((game) => ({ game, media: showcaseFor(game), trailer: trailerSources(game.steam_appid, game.trailer_path) }))
    .filter((entry) => entry.media.hero && entry.trailer);
  if (usable.length === 0) return [];
  const take = Math.min(count, usable.length);
  const start = (Math.floor(now / DAY_MS) * take) % usable.length;
  return Array.from({ length: take }, (_, index) => {
    const { game, media, trailer } = usable[(start + index) % usable.length];
    return {
      slug: game.slug,
      title: game.title,
      year: game.year,
      genre: game.genre,
      rating: Number(game.rating),
      image: game.image,
      description: game.description,
      hero: media.hero,
      developer: media.developer,
      steamPositive: media.steamPositive,
      trailer,
    };
  });
}

module.exports = { featuredReel };
