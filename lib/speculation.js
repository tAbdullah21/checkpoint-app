// Instant page changes. Every page announces a small rule file (the Speculation-Rules header); browsers that
// support it fetch a page in the background as soon as the pointer rests on a link to it ("moderate" eagerness),
// so the click shows the page without waiting for the server. Only pages that change nothing when they are read
// are listed, and links can opt out with data-no-prefetch. Browsers without the feature ignore the header.
const RULES_PATH = '/speculation-rules.json';

// Pages that are safe to fetch early: [path, also the pages under it].
const SAFE_PAGES = [
  ['/', false], ['/games', true], ['/reviews', false], ['/members', true], ['/lists', true], ['/activity', false],
  ['/for-you', false], ['/library', false], ['/wrapped', false], ['/versus', false], ['/tiers', true],
];

// URL patterns for one page: with and without a query, and the pages under it when asked.
function patternsFor([path, nested]) {
  const bases = nested ? [path, `${path}/*`] : [path];
  return bases.flatMap((base) => [base, `${base}\\?*`]);
}

const SPECULATION_RULES = Object.freeze({
  prefetch: [{
    source: 'document',
    where: {
      and: [
        { href_matches: SAFE_PAGES.flatMap(patternsFor) },
        { not: { selector_matches: '[data-no-prefetch], [download], [target="_blank"]' } },
      ],
    },
    eagerness: 'moderate',
  }],
});

const RULES_BODY = JSON.stringify(SPECULATION_RULES);

// Announces the rules on page responses.
function announceSpeculationRules(req, res, next) {
  if (req.method === 'GET') res.set('Speculation-Rules', `"${RULES_PATH}"`);
  next();
}

// Serves the rule file with the media type browsers require.
function serveSpeculationRules(req, res) {
  res.type('application/speculationrules+json').set('Cache-Control', 'public, max-age=3600').send(RULES_BODY);
}

module.exports = { RULES_PATH, SAFE_PAGES, SPECULATION_RULES, announceSpeculationRules, patternsFor, serveSpeculationRules };
