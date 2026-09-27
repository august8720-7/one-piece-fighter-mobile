"""Reproduce reviewed local sprite edits without changing character proportions.

Copyrighted input/output stay in ignored character asset folders. Each derivation
verifies the unchanged original source before applying recorded pixel operations.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent


def luffy_wind(source: Image.Image) -> Image.Image:
    """Extend only original white wind pixels; the complete body stays intact."""
    sheet = Image.new("RGBA", (260, 72))
    for index, rect in enumerate(([399, 150, 486, 222], [487, 150, 577, 222])):
        original = source.crop(rect)
        frame = Image.new("RGBA", (130, 72))
        frame.alpha_composite(original)
        # Everything right of source-local x55 above y58 is white wind FX.
        # Body, boots and proportions retain every original source pixel.
        effect = original.crop((55, 0, original.width, 58))
        effect = effect.resize((75, 58), Image.Resampling.NEAREST)
        frame.paste(effect, (55, 0))
        sheet.alpha_composite(frame, (index * 130, 0))
    return sheet


def main() -> None:
    manifest = json.loads((ROOT / "scripts" / "sprite_manifest.json").read_text(encoding="utf-8"))
    config = manifest["characters"]["luffy"]
    source_path = ROOT / config["source"]["path"]
    if not source_path.is_file():
        print("luffy: original source absent; retained derived source")
        return
    if hashlib.sha256(source_path.read_bytes()).hexdigest() != config["source"]["sha256"]:
        raise ValueError("luffy: unreviewed original source; derivation stopped")
    output = source_path.with_name("source-derived-wind.png")
    luffy_wind(Image.open(source_path).convert("RGBA")).save(output)
    print(f"luffy: reproduced reviewed wind source {output.name}")


if __name__ == "__main__":
    main()
