"""Makes the WebP cover thumbnails in public/images/covers/thumbs and their manifest.json.

Run it after adding or replacing a cover (for example after `npm run covers`):

    python3 scripts/make-thumbnails.py          (Windows: py scripts\\make-thumbnails.py)

It needs Python 3 and Pillow (python3 -m pip install Pillow). The app itself never needs Python: it reads
manifest.json, and a cover whose thumbnails are missing or older than the cover is served in full
(lib/assets.js), so forgetting to run this only makes pages heavier, never broken.

Two sizes are made for every cover, and the browser picks one with srcset:
  - <slug>.webp      400 px wide, for posters and cards;
  - <slug>-240.webp  240 px wide, for small covers (feeds, lists, the board) and blurred backdrops.
"""
import json
from pathlib import Path

from PIL import Image

COVERS = Path(__file__).resolve().parent.parent / 'public' / 'images' / 'covers'
THUMBS = COVERS / 'thumbs'
LARGE_WIDTH = 400
SMALL_WIDTH = 240
QUALITY = 80


def save_webp(image, width, path):
    """Saves `image` scaled down to `width` (never up) and returns the width it was saved at."""
    if image.width > width:
        height = round(image.height * width / image.width)
        image = image.resize((width, height), Image.LANCZOS)
    image.save(path, 'WEBP', quality=QUALITY, method=6)
    return image.width


def main():
    THUMBS.mkdir(exist_ok=True)
    manifest = {}
    before = after = 0
    for cover in sorted(COVERS.iterdir()):
        if not cover.is_file() or cover.suffix.lower() not in {'.jpg', '.jpeg', '.png', '.webp'}:
            continue
        image = Image.open(cover).convert('RGB')
        large = THUMBS / f'{cover.stem}.webp'
        small = THUMBS / f'{cover.stem}-{SMALL_WIDTH}.webp'
        width = save_webp(image, LARGE_WIDTH, large)
        small_width = save_webp(image, SMALL_WIDTH, small)
        manifest[cover.name] = {
            'thumb': f'/images/covers/thumbs/{large.name}',
            'width': width,
            'height': round(image.height * width / image.width),
            'small': f'/images/covers/thumbs/{small.name}',
            'smallWidth': small_width,
            'sourceWidth': image.width,
            # lib/assets.js compares this with the cover on disk to notice a replaced cover.
            'sourceBytes': cover.stat().st_size,
        }
        before += cover.stat().st_size
        after += large.stat().st_size
        print(f'{cover.name}: {image.width} px, {cover.stat().st_size // 1024} KB -> '
              f'{large.stat().st_size // 1024} KB ({width} px) and {small.stat().st_size // 1024} KB ({small_width} px)')
    (THUMBS / 'manifest.json').write_text(json.dumps(manifest, indent=2, sort_keys=True) + '\n')
    print(f'{len(manifest)} covers: {before // 1024} KB of originals, {after // 1024} KB of 400 px thumbnails.')


if __name__ == '__main__':
    main()
