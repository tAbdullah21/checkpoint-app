const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, describe, it } = require('node:test');
const { assetUrl, coverAttributes, thumb, useThumbnails } = require('../../lib/assets');

describe('assetUrl', () => {
  it('adds a version taken from the file, so a changed file gets a new URL', () => {
    assert.match(assetUrl('/css/base.css'), /^\/css\/base\.css\?v=[0-9a-f]{8}$/);
    assert.equal(assetUrl('/css/base.css'), assetUrl('/css/base.css'), 'stable while the file is unchanged');
    assert.notEqual(assetUrl('/css/base.css'), assetUrl('/css/pages.css'));
  });

  it('leaves unknown files alone', () => {
    assert.equal(assetUrl('/css/missing.css'), '/css/missing.css');
  });
});

describe('cover thumbnails', () => {
  let directory;

  before(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'checkpoint-covers-'));
    fs.mkdirSync(path.join(directory, 'thumbs'));
    fs.writeFileSync(path.join(directory, 'big.jpg'), Buffer.alloc(1000));
    fs.writeFileSync(path.join(directory, 'small.jpg'), Buffer.alloc(300));
    fs.writeFileSync(path.join(directory, 'changed.jpg'), Buffer.alloc(999));
    for (const name of ['big', 'small', 'changed']) fs.writeFileSync(path.join(directory, 'thumbs', `${name}.webp`), Buffer.alloc(10));
    useThumbnails({
      'big.jpg': { thumb: '/images/covers/thumbs/big.webp', width: 400, sourceWidth: 1200, sourceBytes: 1000 },
      'small.jpg': { thumb: '/images/covers/thumbs/small.webp', width: 400, sourceWidth: 400, sourceBytes: 300 },
      'changed.jpg': { thumb: '/images/covers/thumbs/changed.webp', width: 400, sourceWidth: 900, sourceBytes: 1234 },
      'missing.jpg': { thumb: '/images/covers/thumbs/missing.webp', width: 400, sourceWidth: 900, sourceBytes: 1 },
    }, directory);
  });

  after(() => {
    fs.rmSync(directory, { recursive: true, force: true });
    useThumbnails(); // back to the real manifest
  });

  it('serves the thumbnail and lets the browser pick the full cover when shown large', () => {
    assert.equal(thumb('/images/covers/big.jpg'), '/images/covers/thumbs/big.webp');
    assert.equal(
      coverAttributes('/images/covers/big.jpg', '(max-width: 560px) 30vw, 200px'),
      'src="/images/covers/thumbs/big.webp" srcset="/images/covers/thumbs/big.webp 400w, /images/covers/big.jpg 1200w" sizes="(max-width: 560px) 30vw, 200px"',
    );
  });

  it('skips srcset when the original is no bigger than the thumbnail', () => {
    assert.equal(coverAttributes('/images/covers/small.jpg', '200px'), 'src="/images/covers/thumbs/small.webp"');
  });

  it('never shows an outdated thumbnail for a replaced or missing cover', () => {
    assert.equal(thumb('/images/covers/changed.jpg'), '/images/covers/changed.jpg');
    assert.equal(thumb('/images/covers/missing.jpg'), '/images/covers/missing.jpg');
    assert.equal(coverAttributes('/images/covers/changed.jpg', '200px'), 'src="/images/covers/changed.jpg"');
  });

  it('escapes attribute values', () => {
    assert.equal(coverAttributes('/images/covers/"onerror="x.jpg', '200px'), 'src="/images/covers/&quot;onerror=&quot;x.jpg"');
  });
});

describe('small cover thumbnails', () => {
  let directory;

  before(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'checkpoint-covers-'));
    fs.mkdirSync(path.join(directory, 'thumbs'));
    fs.writeFileSync(path.join(directory, 'big.jpg'), Buffer.alloc(1000));
    fs.writeFileSync(path.join(directory, 'mid.jpg'), Buffer.alloc(400));
    fs.writeFileSync(path.join(directory, 'lost.jpg'), Buffer.alloc(500));
    for (const name of ['big', 'big-240', 'mid', 'mid-240', 'lost']) fs.writeFileSync(path.join(directory, 'thumbs', `${name}.webp`), Buffer.alloc(10));
    const entry = (name, sourceWidth, sourceBytes) => ({
      thumb: `/images/covers/thumbs/${name}.webp`,
      width: Math.min(400, sourceWidth),
      small: `/images/covers/thumbs/${name}-240.webp`,
      smallWidth: 240,
      sourceWidth,
      sourceBytes,
    });
    useThumbnails({ 'big.jpg': entry('big', 1200, 1000), 'mid.jpg': entry('mid', 400, 400), 'lost.jpg': entry('lost', 900, 500) }, directory);
  });

  after(() => {
    fs.rmSync(directory, { recursive: true, force: true });
    useThumbnails();
  });

  it('lets the browser choose between 240px, 400px and the original', () => {
    assert.equal(
      coverAttributes('/images/covers/big.jpg', '200px'),
      'src="/images/covers/thumbs/big.webp" srcset="/images/covers/thumbs/big-240.webp 240w, /images/covers/thumbs/big.webp 400w, /images/covers/big.jpg 1200w" sizes="200px"',
    );
    assert.equal(
      coverAttributes('/images/covers/mid.jpg', '200px'),
      'src="/images/covers/thumbs/mid.webp" srcset="/images/covers/thumbs/mid-240.webp 240w, /images/covers/thumbs/mid.webp 400w" sizes="200px"',
      'no original in srcset when it is no bigger than the 400px thumbnail',
    );
  });

  it('gives small covers the 240px thumbnail, or the 400px one when the small file is missing', () => {
    assert.equal(thumb('/images/covers/big.jpg', 'small'), '/images/covers/thumbs/big-240.webp');
    assert.equal(thumb('/images/covers/big.jpg'), '/images/covers/thumbs/big.webp');
    assert.equal(thumb('/images/covers/lost.jpg', 'small'), '/images/covers/thumbs/lost.webp');
    assert.equal(coverAttributes('/images/covers/lost.jpg', '200px').includes('-240.webp'), false);
    assert.equal(thumb('/images/covers/unknown.jpg', 'small'), '/images/covers/unknown.jpg');
  });

  it('ships both sizes for every cover in the real manifest', () => {
    useThumbnails();
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'images', 'covers', 'thumbs', 'manifest.json'), 'utf8'));
    // The manifest contains entries only for covers that were downloaded; games without local
    // covers fall back to generated placeholder posters (database.js seeds the full catalogue).
    assert.ok(Object.keys(manifest).length >= 1, 'the cover manifest exists');
    for (const file of Object.keys(manifest)) {
      const image = `/images/covers/${file}`;
      assert.match(thumb(image), /^\/images\/covers\/thumbs\/[a-z0-9-]+\.webp$/, file);
      assert.match(thumb(image, 'small'), /-240\.webp$/, file);
    }
  });
});
