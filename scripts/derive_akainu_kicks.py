"""Derive four Akainu kick poses from the approved local source sprite sheet.

Only the requested output PNG is written. Rectangles, joints and masks use
original source pixels. The runtime atlas generator applies the uniform 3x
nearest-neighbor scale. Copyrighted input/output images remain local assets.
"""

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "public/assets/characters/akainu/source-sheet.png"
DEFAULT_OUTPUT = ROOT / "public/assets/characters/akainu/derived-kicks.png"
SOURCE_SHA256 = "3e24fc1cd2f738a01e7b2b20a533f5d10f9a105abc91c09bd5c091bb7dacc4c6"
OUTPUT_SHA256 = "331bd33d1e394e602c1a916f2bb535956e3faebbff2da9d1b11d74fc7de86aff"

RECTANGLES = {
    "knee": [148, 7378, 210, 7452],
    "stand": [219, 1061, 281, 1162],
    "crouch": [778, 43, 830, 94],
    "donor": [19, 1091, 74, 1162],
}
LONG_LEG = [
    (29, 61), (35, 60), (38, 65), (41, 71), (45, 78), (47, 83),
    (51, 90), (53, 94), (57, 96), (61, 100), (47, 100), (47, 97),
    (44, 94), (41, 88), (38, 82), (36, 78), (32, 72), (30, 67),
]
SHORT_LEG = [
    (37, 39), (42, 39), (47, 43), (53, 48), (54, 52), (51, 56),
    (49, 62), (51, 65), (54, 68), (54, 70), (39, 70), (38, 67),
    (40, 64), (42, 58), (44, 52), (44, 50), (40, 48), (36, 45),
]
OLD_KNEE = [
    (42, 37), (47, 37), (52, 40), (57, 44), (57, 48), (54, 51),
    (52, 57), (51, 63), (44, 63), (43, 58), (40, 56), (43, 51),
    (47, 47), (47, 45), (42, 43),
]
OLD_CROUCH_LEG = [
    (36, 29), (42, 28), (47, 32), (46, 39), (45, 43), (48, 46),
    (51, 47), (51, 51), (37, 51), (37, 46), (38, 40), (38, 35),
]


def _part(image, polygon):
    """Extract original pixels, preserving their existing alpha."""
    mask = Image.new("L", image.size)
    ImageDraw.Draw(mask).polygon(polygon, fill=255)
    result = image.copy()
    result.putalpha(Image.composite(
        image.getchannel("A"), Image.new("L", image.size), mask,
    ))
    return result


def _place_limb(output, limb, source_joint, target_joint, degrees):
    """Rotate about the anatomical joint, never resize its bounding box."""
    canvas = Image.new("RGBA", (256, 256))
    canvas.alpha_composite(limb, (128 - source_joint[0], 128 - source_joint[1]))
    rotated = canvas.rotate(
        degrees, Image.Resampling.NEAREST, center=(128, 128),
    )
    output.alpha_composite(rotated, (target_joint[0] - 128, target_joint[1] - 128))


def derive_akainu_kicks(source_path=DEFAULT_SOURCE, out_path=DEFAULT_OUTPUT):
    """Write one 440x82 RGBA sheet; return its source/atlas metadata.

    The heavy low kick extends the middle of the original trouser leg with
    six copied source scanlines. Head, coat, torso and supporting leg retain
    their original size. Existing front legs are cleared before replacement.
    """
    source_path = Path(source_path).resolve()
    out_path = Path(out_path).resolve()
    if source_path == out_path:
        raise ValueError("Output must not overwrite the source sprite sheet")
    source_hash = hashlib.sha256(source_path.read_bytes()).hexdigest()
    if source_hash != SOURCE_SHA256:
        raise ValueError(f"Unapproved Akainu source sheet: {source_hash}")
    with Image.open(source_path) as image:
        if image.size != (1000, 8218):
            raise ValueError(f"Unexpected source dimensions: {image.size}")
        source = image.convert("RGBA")
    body = {name: source.crop(rect) for name, rect in RECTANGLES.items()}
    long_leg = _part(body["stand"], LONG_LEG)
    short_leg = _part(body["donor"], SHORT_LEG)

    # Lengthen only the middle trouser texture; the original shoe stays intact.
    extended_leg = Image.new("RGBA", (long_leg.width + 3, long_leg.height + 6))
    extended_leg.alpha_composite(long_leg.crop((0, 0, long_leg.width, 80)), (0, 0))
    for row, source_y in enumerate([79, 79, 80, 80, 81, 81]):
        strip = long_leg.crop((0, source_y, long_leg.width, source_y + 1))
        extended_leg.alpha_composite(strip, ((row * 3) // 5, 80 + row))
    extended_leg.alpha_composite(
        long_leg.crop((0, 80, long_leg.width, long_leg.height)), (3, 86),
    )

    frames = {"st_b": (body["knee"], [24, 74])}
    side_kick = Image.new("RGBA", (110, 84))
    side_kick.alpha_composite(body["knee"])
    ImageDraw.Draw(side_kick).polygon(OLD_KNEE, fill=(0, 0, 0, 0))

    # Restore the coat behind the removed knee by copying its source texture.
    patch = body["knee"].crop((19, 36, 26, 43))
    patch_mask = Image.new("L", side_kick.size)
    ImageDraw.Draw(patch_mask).polygon(
        [(39, 40), (44, 40), (49, 44), (49, 47), (45, 50), (40, 50)], fill=255,
    )
    coat = Image.new("RGBA", side_kick.size)
    for x in range(35, 56, 7):
        for y in range(36, 57, 7):
            coat.alpha_composite(patch, (x, y))
    coat.putalpha(patch_mask)
    side_kick.alpha_composite(coat)
    ImageDraw.Draw(side_kick).rectangle((39, 50, 62, 74), fill=(0, 0, 0, 0))
    _place_limb(side_kick, long_leg, (32, 63), (40, 37), 52)
    frames["st_d"] = (side_kick, [24, 74])

    for move, limb, joint, angle, target in [
        ("cr_b", short_leg, (39, 41), 31, (37, 27)),
        ("cr_d", extended_leg, (32, 63), 33, (37, 25)),
    ]:
        low_kick = Image.new("RGBA", (110, 62))
        low_kick.alpha_composite(body["crouch"])
        ImageDraw.Draw(low_kick).polygon(OLD_CROUCH_LEG, fill=(0, 0, 0, 0))
        _place_limb(low_kick, limb, joint, target, angle)
        frames[move] = (low_kick, [23, 51])

    # Pack at original scale. Crop transparent margins and translate the pivot.
    sheet = Image.new("RGBA", (440, 82))
    metadata = {}
    for index, (move, (frame, anchor)) in enumerate(frames.items()):
        bounds = frame.getbbox()
        if bounds is None:
            raise ValueError(f"Empty derived frame: {move}")
        frame = frame.crop(bounds)
        anchor = [anchor[0] - bounds[0], anchor[1] - bounds[1]]
        x, y = index * 110 + 4, 4
        sheet.alpha_composite(frame, (x, y))
        metadata[move] = {
            "rect": [x, y, x + frame.width, y + frame.height],
            "anchor": anchor,
        }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out_path)
    return {
        "path": str(out_path),
        "sha256": hashlib.sha256(out_path.read_bytes()).hexdigest(),
        "size": list(sheet.size),
        "source_sha256": source_hash,
        "frames": metadata,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_path", nargs="?", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("out_path", nargs="?", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    if args.source_path == DEFAULT_SOURCE and not DEFAULT_SOURCE.is_file():
        print("akainu: original source absent; retained derived source")
        raise SystemExit(0)
    result = derive_akainu_kicks(args.source_path, args.out_path)
    print(json.dumps(result, indent=2))
    if result["sha256"] != OUTPUT_SHA256:
        raise SystemExit("Output differs from the approved derived sprite sheet")
