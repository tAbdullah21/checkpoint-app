// Draws a simple poster in the site's colours. Used whenever a game's cover image file is missing,
// so a fresh clone never shows broken images (run `npm run covers` to download the real artwork).

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character]);
}

function wrapTitle(title, maxCharacters = 13) {
  const lines = [];
  let line = '';
  for (const word of String(title).split(/\s+/)) {
    if (line && `${line} ${word}`.length > maxCharacters) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 5);
}

function placeholderCoverSvg({ title, year, genre }) {
  const lines = wrapTitle(String(title).toUpperCase());
  const firstLineY = 520 - (lines.length - 1) * 33;
  const titleText = lines
    .map((line, index) => `<text x="48" y="${firstLineY + index * 66}" font-size="54" font-weight="800" fill="#edf4f8">${escapeXml(line)}</text>`)
    .join('\n    ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 900" role="img" aria-label="${escapeXml(title)} cover placeholder">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="600" y2="900" gradientUnits="userSpaceOnUse">
      <stop stop-color="#16212b"/>
      <stop offset="1" stop-color="#090e13"/>
    </linearGradient>
    <radialGradient id="glow" cx="470" cy="190" r="360" gradientUnits="userSpaceOnUse">
      <stop stop-color="#5ee7a4" stop-opacity="0.42"/>
      <stop offset="0.55" stop-color="#7dd3fc" stop-opacity="0.12"/>
      <stop offset="1" stop-color="#7dd3fc" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="600" height="900" fill="url(#bg)"/>
  <rect width="600" height="900" fill="url(#glow)"/>
  <rect x="48" y="64" width="64" height="6" rx="3" fill="#5ee7a4"/>
  <text x="48" y="112" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="700" letter-spacing="5" fill="#9baab5">CHECKPOINT</text>
  <g font-family="Arial, Helvetica, sans-serif" letter-spacing="-1">
    ${titleText}
  </g>
  <text x="48" y="820" font-family="Arial, Helvetica, sans-serif" font-size="24" fill="#9baab5">${escapeXml(`${year} · ${genre}`)}</text>
</svg>
`;
}

module.exports = { placeholderCoverSvg, escapeXml };
