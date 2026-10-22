// "Chrome on Windows", "Safari on iPhone": a readable name for a signed-in browser on the account page.
// Only the browser family and the operating system are read from the User-Agent; nothing else is kept.

// Order matters: Edge, Opera and Samsung Internet also say "Chrome", and Chrome also says "Safari".
const BROWSERS = [
  ['Edge', /\bEdg(?:e|A|iOS)?\//],
  ['Opera', /\b(?:OPR|Opera)\//],
  ['Samsung Internet', /\bSamsungBrowser\//],
  ['Firefox', /\b(?:Firefox|FxiOS)\//],
  ['Chrome', /\b(?:Chrome|CriOS)\//],
  ['Safari', /\bVersion\/[\d.]+.*\bSafari\//],
];

// iPhone and iPad user agents also contain "Mac OS X", and Android ones contain "Linux".
const SYSTEMS = [
  ['iPhone', /\biPhone\b/],
  ['iPad', /\biPad\b/],
  ['Android', /\bAndroid\b/],
  ['Windows', /\bWindows\b/],
  ['ChromeOS', /\bCrOS\b/],
  ['macOS', /\bMac OS X\b|\bMacintosh\b/],
  ['Linux', /\bLinux\b/],
];

const MOBILE_SYSTEMS = new Set(['iPhone', 'Android']);

function firstMatch(table, text) {
  return table.find(([, pattern]) => pattern.test(text))?.[0] || null;
}

function describeDevice(userAgent) {
  const text = String(userAgent || '').slice(0, 300);
  const browser = firstMatch(BROWSERS, text);
  const system = firstMatch(SYSTEMS, text);
  let label = 'Unknown browser';
  if (browser && system) label = `${browser} on ${system}`;
  else if (browser) label = browser;
  else if (system) label = `A browser on ${system}`;
  return { browser, system, label, mobile: MOBILE_SYSTEMS.has(system) };
}

module.exports = { describeDevice };
