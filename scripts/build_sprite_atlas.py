"""Build local continuous-sprite atlases from the explicit, reviewed manifest.

All source coordinates and foot origins are retained; frames use one character-wide
integer scale. This tool never discovers art by directory contents or downloads art.
Missing local sources preserve existing atlases. Invalid present sources fail closed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import shutil
import tempfile

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "scripts" / "sprite_manifest.json"


def confined_path(relative: str) -> Path:
    path = (ROOT / relative).resolve()
    if not path.is_relative_to(ROOT / "public" / "assets" / "characters"):
        raise ValueError(f"Source must stay under local character assets: {relative}")
    return path


def build_character(char_id: str, config: dict, required: dict, check_only: bool) -> dict:
    source_specs = {"original": config["source"], **config.get("extraSources", {})}
    sources: dict[str, Image.Image] = {}
    digests: dict[str, str] = {}
    for source_id, spec in source_specs.items():
        source_path = confined_path(spec["path"])
        if not source_path.is_file():
            print(f"{char_id}/{source_id}: source absent; retained current atlas (runtime supports legacy fallback)")
            return {"character": char_id, "status": "preserved_missing_source", "missingSource": source_id}
        digest = hashlib.sha256(source_path.read_bytes()).hexdigest()
        if digest != spec["sha256"]:
            raise ValueError(f"{char_id}/{source_id}: source SHA-256 differs from reviewed manifest")
        source = Image.open(source_path).convert("RGBA")
        if list(source.size) != spec["size"]:
            raise ValueError(f"{char_id}/{source_id}: source dimensions differ from reviewed manifest")
        sources[source_id] = source
        digests[source_id] = digest
    digest = digests["original"]
    scale = config["scale"]
    if not isinstance(scale, int) or not 1 <= scale <= 4:
        raise ValueError(f"{char_id}: scale must be an integer between 1 and 4")
    sprites: dict[str, tuple[Image.Image, tuple[float, float]]] = {}
    for clip_id, clip in config["clips"].items():
        rects = clip["rects"]
        anchors = clip["anchors"]
        if len(rects) != len(anchors):
            raise ValueError(f"{char_id}/{clip_id}: every source frame needs a foot origin")
        source_ids = clip.get("sources", ["original"] * len(rects))
        if len(source_ids) != len(rects):
            raise ValueError(f"{char_id}/{clip_id}: every source frame needs a source identifier")
        # A scalar rotates the whole clip; a list explicitly preserves unrotated
        # anticipation/recovery beside a reviewed rotated contact pose. Anchors
        # always describe the final expanded image before the uniform scale.
        rotations = clip.get("rotateDegrees", 0)
        rotations = rotations if isinstance(rotations, list) else [rotations] * len(rects)
        if len(rotations) != len(rects):
            raise ValueError(f"{char_id}/{clip_id}: every frame needs an explicit rotation")
        for index, (rect, anchor) in enumerate(zip(rects, anchors)):
            if source_ids[index] not in sources:
                raise ValueError(f"{char_id}/{clip_id}/{index}: unregistered explicit source")
            source = sources[source_ids[index]]
            x0, y0, x1, y1 = rect
            if not (0 <= x0 < x1 <= source.width and 0 <= y0 < y1 <= source.height):
                raise ValueError(f"{char_id}/{clip_id}/{index}: crop outside source")
            crop = source.crop(rect)
            if not crop.getchannel("A").getbbox():
                raise ValueError(f"{char_id}/{clip_id}/{index}: empty frame")
            rotation = rotations[index]
            if not isinstance(rotation, (int, float)) or not math.isfinite(rotation) or not -180 <= rotation <= 180:
                raise ValueError(f"{char_id}/{clip_id}/{index}: invalid explicit rotation")
            if rotation:
                crop = crop.rotate(rotation, resample=Image.Resampling.NEAREST, expand=True)
            ax, ay = anchor
            if not (0 <= ax <= crop.width and 0 <= ay <= crop.height):
                raise ValueError(f"{char_id}/{clip_id}/{index}: origin outside crop")
            if clip.get("flipX", False):
                crop = crop.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                ax = crop.width - ax
            pivot = (ax / crop.width, ay / crop.height)
            crop = crop.resize((crop.width * scale, crop.height * scale), Image.Resampling.NEAREST)
            sprites[f"{clip_id}/{index}"] = (crop, pivot)

    entries: dict[str, str] = {}
    for kind in ("anims", "moves"):
        maps = config["states" if kind == "anims" else "moves"]
        for anim, info in required[kind].items():
            count = info if kind == "anims" else info["frames"]
            mapping = maps.get(anim)
            if not mapping or not mapping.get("frames"):
                raise ValueError(f"{char_id}/{anim}: explicit frame mapping is missing")
            frames = mapping["frames"]
            if kind == "moves":
                for phase in ("startup", "active", "recovery"):
                    if not mapping.get(phase) or any(not isinstance(i, int) or i < 0 or i >= len(frames) for i in mapping[phase]):
                        raise ValueError(f"{char_id}/{anim}: invalid {phase} visual sequence")
            for i in range(max(count, len(frames))):
                source_index = frames[min(i, len(frames) - 1)]
                key = f"{mapping['clip']}/{source_index}"
                if key not in sprites:
                    raise ValueError(f"{char_id}/{anim}/{i}: unknown source frame {key}")
                entries[f"{char_id}/{anim}/{i}"] = key

    used = sorted(set(entries.values()))
    padding = 2
    atlas_width = 4096
    placements: dict[str, tuple[int, int]] = {}
    x = y = row_height = 0
    for key in used:
        sprite, _ = sprites[key]
        if sprite.width + padding > atlas_width:
            raise ValueError(f"{char_id}/{key}: source frame too wide")
        if x + sprite.width + padding > atlas_width:
            x = 0
            y += row_height + padding
            row_height = 0
        placements[key] = (x, y)
        x += sprite.width + padding
        row_height = max(row_height, sprite.height)
    atlas = Image.new("RGBA", (atlas_width, y + row_height + padding))
    for key, position in placements.items():
        atlas.alpha_composite(sprites[key][0], position)
    frames_json = {}
    for name, key in entries.items():
        sprite, pivot = sprites[key]
        x, y = placements[key]
        width, height = sprite.size
        frames_json[name] = {
            "frame": {"x": x, "y": y, "w": width, "h": height},
            "rotated": False, "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": width, "h": height},
            "sourceSize": {"w": width, "h": height},
            "pivot": {"x": pivot[0], "y": pivot[1]},
        }
    meta = {
        "app": "one-piece-fighter/scripts/build_sprite_atlas.py",
        "image": "atlas.png", "format": "RGBA8888", "size": {"w": atlas.width, "h": atlas.height},
        "scale": "1", "artSource": "reviewed-continuous-sprites", "pixelArt": True,
        "sourceSha256": digest, "sourceHashes": digests, "sourceUrl": config["source"]["url"], "credit": config["source"]["credit"],
    }
    report = {"character": char_id, "status": "checked" if check_only else "generated", "frameNames": len(entries), "uniqueSourceFrames": len(used), "size": list(atlas.size), "sourceSha256": digest}
    if not check_only:
        out = ROOT / "public" / "assets" / "characters" / char_id
        out.mkdir(parents=True, exist_ok=True)
        backup = Path(tempfile.mkdtemp(prefix=f"opf-{char_id}-atlas-backup-0911-"))
        for filename in ("atlas.png", "atlas.json", "poses-preview.png"):
            existing = out / filename
            if existing.is_file():
                shutil.copy2(existing, backup / filename)
        atlas.save(out / "atlas.png", optimize=True)
        (out / "atlas.json").write_text(json.dumps({"frames": frames_json, "meta": meta}, ensure_ascii=False), encoding="utf-8")
        # All frames, with labels and fixed foot origins; contact sheet remains local.
        cell_width, cell_height, cols = 600, 330, 5
        preview = Image.new("RGBA", (cols * cell_width, ((len(used) + cols - 1) // cols) * cell_height), (23, 28, 39, 255))
        draw = ImageDraw.Draw(preview)
        for index, key in enumerate(used):
            sprite, pivot = sprites[key]
            cell_x, cell_y = (index % cols) * cell_width, (index // cols) * cell_height
            draw.text((cell_x + 8, cell_y + 8), key, fill=(245, 245, 245))
            # Fit only the inspection sheet; atlas pixels always retain the uniform scale.
            factor = min(1.0, (cell_width - 24) / sprite.width, (cell_height - 50) / sprite.height)
            shown = sprite.resize((max(1, round(sprite.width * factor)), max(1, round(sprite.height * factor))), Image.Resampling.NEAREST)
            left = cell_x + (cell_width - shown.width) // 2
            top = cell_y + cell_height - 18 - shown.height
            preview.alpha_composite(shown, (left, top))
            ax, ay = left + round(pivot[0] * shown.width), top + round(pivot[1] * shown.height)
            draw.ellipse((ax - 2, ay - 2, ax + 2, ay + 2), fill=(255, 85, 85))
        preview.save(out / "poses-preview.png")
        report["backup"] = str(backup)
    print(json.dumps(report, ensure_ascii=False))
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="Validate and assemble in memory without changing atlases")
    parser.add_argument("characters", nargs="*")
    args = parser.parse_args()
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    required = json.loads((ROOT / "assets-src" / "frames.json").read_text(encoding="utf-8"))
    configured = manifest["characters"]
    for char_id in args.characters or required:
        if char_id not in configured:
            print(f"{char_id}: no reviewed continuous-sprite mapping; retained current atlas")
            continue
        build_character(char_id, configured[char_id], required[char_id], args.check)


if __name__ == "__main__":
    main()
