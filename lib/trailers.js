// Official trailers as YouTube video IDs. Each was checked to play inside a website (embeddable and
// not age-restricted). Where the publisher's own upload is age-restricted, the same official trailer
// uploaded by IGN or GameSpot is used instead. Games without an entry simply show no trailer.
const trailers = {
  'elden-ring': 'qqiC88f9ogU',
  'cyberpunk-2077': 'nLhWWoAaZ0Q',
  'red-dead-redemption-2': 'gmA6MrX81z4',
  'forza-horizon-5': 'ddGQhJ80pvM',
  'baldurs-gate-3': 'XuCfkgaaa08',
  'subnautica': 'BtP8r8nRfko',
  'ea-sports-fc-27': 'MOclJJ7IpSY',
  'kingdom-come-deliverance-2': 'ju8R8gwD-Vg',
  'clair-obscur-expedition-33': 'ejgW-upPMgk',
  'monster-hunter-wilds': 'a_wNFT4j6qI',
  'split-fiction': '0TlySOphMuo',
  'doom-the-dark-ages': 'WDGJHtV_r-Y',
  'assassins-creed-shadows': '_JzywR97gUs',
  'battlefield-6': 'dbTzsfwv-sc',
  'resident-evil-requiem': 'yClDiMKcPl8',
  'death-stranding-2': 'tIkVRGVjG_Q',
  'the-witcher-3-wild-hunt': 'IGk17XQ7IrQ',
  'grand-theft-auto-v': 'hvoD7ehZPcM',
  'god-of-war-ragnarok': 'LnLqHdoimrE',
  'ghost-of-tsushima': 'RcWk08PBe7k',
  'sekiro-shadows-die-twice': 'aUnEezrBFoA',
  'marvels-spider-man-2': '9fVYKsEmuRo',
  'resident-evil-4': 'j5Xv2lM9wes',
  'hollow-knight-silksong': '6XGeJwsUP9c',
  'it-takes-two': 'GAWHzGNcTEw',
  'stardew-valley': 'ot7uXNQskhs',
};

function trailerFor(slug) {
  return Object.hasOwn(trailers, slug) ? trailers[slug] : null;
}

module.exports = { trailerFor, trailers };
