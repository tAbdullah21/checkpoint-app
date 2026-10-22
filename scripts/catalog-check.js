/*
 * Checks the extended catalogue file (database/catalog/steam-games.jsonl) without the internet:
 *
 *   npm run catalog:check
 *
 * Reports how many lines are valid games, and lists every game the site would show without a cover, without a
 * trailer or without wide artwork. Exits with code 1 when a line is broken or a game has no cover at all.
 */
const fs = require('node:fs');
const { CATALOG_FILE, parseCatalogLine } = require('../database/catalog');

function checkCatalog(text) {
  const report = { lines: 0, games: 0, broken: [], duplicates: [], noTrailer: [], noHero: [], noScreenshots: [], genres: {}, yearsFromWikidata: 0, yearsFromSteam: 0 };
  const apps = new Set();
  const slugs = new Set();
  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    report.lines += 1;
    const game = parseCatalogLine(line);
    if (!game) {
      report.broken.push(index + 1);
      return;
    }
    if (apps.has(game.appid) || slugs.has(game.slug)) {
      report.duplicates.push(game.slug);
      return;
    }
    apps.add(game.appid);
    slugs.add(game.slug);
    report.games += 1;
    report.genres[game.genre] = (report.genres[game.genre] || 0) + 1;
    if (!game.trailerPath) report.noTrailer.push(game.title);
    if (!game.media.hero) report.noHero.push(game.title);
    if (game.media.screenshots.length === 0) report.noScreenshots.push(game.title);
    if (game.media.yearSource.startsWith('wikidata:')) report.yearsFromWikidata += 1;
    else if (game.media.yearSource === 'steam') report.yearsFromSteam += 1;
  });
  return report;
}

if (require.main === module) {
  const report = checkCatalog(fs.readFileSync(CATALOG_FILE, 'utf8'));
  const list = (names) => (names.length ? `: ${names.join(', ')}` : '');
  console.log(`${report.games} games in ${report.lines} lines (every game has a cover; the parser refuses lines without one).`);
  console.log(`Broken lines: ${report.broken.length}${list(report.broken)}`);
  console.log(`Repeated games: ${report.duplicates.length}${list(report.duplicates)}`);
  console.log(`Without a trailer: ${report.noTrailer.length}${list(report.noTrailer)}`);
  console.log(`Without wide artwork: ${report.noHero.length}${list(report.noHero)}`);
  console.log(`Without screenshots: ${report.noScreenshots.length}${list(report.noScreenshots)}`);
  console.log(`First release earlier than the Steam page: ${report.yearsFromWikidata + report.yearsFromSteam} (${report.yearsFromWikidata} from Wikidata, ${report.yearsFromSteam} from Steam's original date).`);
  console.log(`Genres: ${Object.entries(report.genres).sort((a, b) => b[1] - a[1]).map(([genre, count]) => `${genre} ${count}`).join(', ')}`);
  if (report.broken.length > 0) process.exitCode = 1;
}

module.exports = { checkCatalog };
