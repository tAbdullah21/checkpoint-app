/*
 * Downloads missing cover images for the catalogue from Steam.
 *
 *   npm run covers
 *
 * Only games whose cover file is missing (or smaller than 600px wide) are downloaded, so it is safe
 * to run again. Until a cover exists, the app serves a generated placeholder poster at the same URL.
 * The script only writes image files in public/images/covers/ and never touches the database.
 */
const fs = require('node:fs');
const path = require('node:path');

const coversDirectory = path.join(__dirname, '..', 'public', 'images', 'covers');
const targetWidth = 600; // the catalogue's covers are 600x900

// Steam app IDs for catalogue games whose covers are not shipped in the repository.
const steamAppIds = {
  'the-witcher-3-wild-hunt': [292030],
  'grand-theft-auto-v': [271590, 3240220],
  'god-of-war-ragnarok': [2322010],
  'ghost-of-tsushima': [2215430],
  'sekiro-shadows-die-twice': [814380],
  'marvels-spider-man-2': [2651280],
  'resident-evil-4': [2050650],
  'hollow-knight-silksong': [1030300],
  'it-takes-two': [1426210],
  'stardew-valley': [413150],
};

function isJpeg(bytes) {
  return bytes.length > 5000 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function jpegWidth(bytes) {
  let offset = 2;
  while (offset + 9 < bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return bytes.readUInt16BE(offset + 7);
    }
    offset += 2 + bytes.readUInt16BE(offset + 2);
  }
  return 0;
}

async function fetchBytes(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) return null;
  return Buffer.from(await response.arrayBuffer());
}

// Asks Steam's store service for the exact (possibly versioned) location of the library cover.
async function apiCoverUrls(appId) {
  try {
    const input = { ids: [{ appid: appId }], context: { language: 'english', country_code: 'US' }, data_request: { include_assets: true } };
    const response = await fetch(
      `https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`,
      { signal: AbortSignal.timeout(15000) },
    );
    if (!response.ok) return [];
    const assets = (await response.json())?.response?.store_items?.[0]?.assets;
    if (!assets || typeof assets.asset_url_format !== 'string') return [];
    return [assets.library_capsule_2x, assets.library_capsule]
      .filter((name) => typeof name === 'string' && name)
      .map((name) => `https://shared.akamai.steamstatic.com/store_item_assets/${assets.asset_url_format.replace('${FILENAME}', name)}`);
  } catch {
    return [];
  }
}

function plainCoverUrls(appId) {
  return [
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900_2x.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`,
  ];
}

async function bestCover(appIds) {
  let best = null;
  for (const appId of appIds) {
    for (const url of new Set([...(await apiCoverUrls(appId)), ...plainCoverUrls(appId)])) {
      try {
        const bytes = await fetchBytes(url);
        if (!bytes || !isJpeg(bytes)) continue;
        const width = jpegWidth(bytes);
        if (!best || width > best.width) best = { bytes, width };
        if (width >= targetWidth) return best;
      } catch {
        // Try the next address.
      }
    }
  }
  return best;
}

async function main() {
  fs.mkdirSync(coversDirectory, { recursive: true });
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const [slug, appIds] of Object.entries(steamAppIds)) {
    const file = path.join(coversDirectory, `${slug}.jpg`);
    const currentWidth = fs.existsSync(file) ? jpegWidth(fs.readFileSync(file)) : 0;
    if (currentWidth >= targetWidth) {
      skipped += 1;
      continue;
    }
    const cover = await bestCover(appIds);
    if (cover && cover.width > currentWidth) {
      fs.writeFileSync(file, cover.bytes);
      downloaded += 1;
      console.log(`  ✓ ${slug.padEnd(28)} ${cover.width}px`);
    } else {
      failed += 1;
      console.log(`  - ${slug.padEnd(28)} not downloaded (placeholder poster stays)`);
    }
  }

  console.log(`\nCovers: ${downloaded} downloaded, ${skipped} already present, ${failed} unavailable.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
