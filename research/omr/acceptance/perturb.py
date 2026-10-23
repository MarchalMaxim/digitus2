"""The small capture changes the photos:perturbed route recognises (issue 163).

One upright photo in, four JPEGs out: the photo re-encoded at JPEG quality 95 and 80, cropped by 3%
on each side, and rotated by 0.5 degrees (bicubic, white corners, same size). A phone camera never
gives the same bytes twice; these are the proxies for that, small enough that the page is the same
page to a reader. The crop and the turn are saved at quality 95.

Usage: python -I research/omr/acceptance/perturb.py INPUT OUTPUT_DIR STEM
Writes OUTPUT_DIR/STEM-{q95,q80,crop3,rot05}.jpg (a file that exists is kept, so the bytes, and
with them the gate's cache keys, stay put) and prints {"variant": "path", ...} as JSON.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image

#: (variant, JPEG quality) in the order the gate lists them.
VARIANTS = (("q95", 95), ("q80", 80), ("crop3", 95), ("rot05", 95))
CROP = 0.03
TURN_DEGREES = 0.5


def variant_image(image: Image.Image, variant: str) -> Image.Image:
    width, height = image.size
    if variant == "crop3":
        return image.crop((round(width * CROP), round(height * CROP), round(width * (1 - CROP)), round(height * (1 - CROP))))
    if variant == "rot05":
        return image.rotate(TURN_DEGREES, resample=Image.BICUBIC, expand=False, fillcolor=(255, 255, 255))
    return image


def main() -> int:
    source, out_dir, stem = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
    out_dir.mkdir(parents=True, exist_ok=True)
    image = Image.open(source).convert("RGB")
    written = {}
    for variant, quality in VARIANTS:
        target = out_dir / f"{stem}-{variant}.jpg"
        if not target.exists():
            partial = target.with_name(target.name + ".part")
            variant_image(image, variant).save(partial, format="JPEG", quality=quality)
            partial.replace(target)
        written[variant] = str(target)
    print(json.dumps(written))
    return 0


if __name__ == "__main__":
    sys.exit(main())
