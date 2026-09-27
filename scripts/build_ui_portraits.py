"""Crop verified anime identity art at original density for menus and HUD.

This does not create combat frames or repaint the source. The portrait is an
overlapping atlas region of the full-body drawing, with no duplicated pixels.
"""
from __future__ import annotations

import io
import json
from pathlib import Path

from build_anime_atlas import digest, load_sources, rectangle, remove_border_key, require

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    config = json.loads((ROOT / "scripts/ui_portrait_manifest.json").read_text(encoding="utf-8"))
    require(config.get("schemaVersion") == 1, "UI crop manifest schema invalid")
    source = load_sources({"master_0912": config["source"]})["master_0912"]
    require(set(config["characters"]) == {"luffy", "akainu"}, "UI character identity mismatch")
    output = {"schemaVersion": 1, "characters": {}}
    pending = []
    for char_id, spec in config["characters"].items():
        x, y, w, h = rectangle(spec["crop"], *source.size, f"{char_id} body crop")
        require(max(w, h) <= 4096, "UI texture exceeds 4096")
        body, stats = remove_border_key(source.crop((x, y, x + w, y + h)), spec["transparency"])
        px, py, pw, ph = rectangle(spec["portrait"], w, h, f"{char_id} portrait")
        require(pw == ph, "HUD portrait must be square")
        require(body.getchannel("A").getbbox() is not None, "Empty UI body")
        require(body.crop((px, py, px + pw, py + ph)).getchannel("A").getbbox() is not None, "Empty UI portrait")
        buffer = io.BytesIO()
        body.save(buffer, format="PNG", optimize=True)
        data = buffer.getvalue()
        image_path = f"public/assets/characters/{char_id}/anime/ui-0913.png"
        output["characters"][char_id] = {
            "image": image_path.removeprefix("public/"), "sha256": digest(data), "width": w, "height": h,
            "frames": {"body": {"x": 0, "y": 0, "w": w, "h": h}, "portrait": {"x": px, "y": py, "w": pw, "h": ph}},
            "source": {"file": config["source"]["file"], "sha256": config["source"]["sha256"], "crop": spec["crop"]},
            "processing": {"scale": 1, "method": "crop + recorded connected-background key only", **stats},
        }
        pending.append((ROOT / image_path, data))
    # Verify every declared input before writing any output; no combat build call.
    for path, data in pending:
        require(path.parent.is_dir(), "Existing anime output directory required")
        path.write_bytes(data)
    (ROOT / "src/render/anime/uiArtManifest.json").write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: {name: record[name] for name in ("image", "width", "height", "sha256")} for key, record in output["characters"].items()}, indent=2))


if __name__ == "__main__":
    main()
