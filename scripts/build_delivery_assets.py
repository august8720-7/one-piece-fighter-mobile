"""Encode verified runtime masters for the web without changing animation geometry.

Original PNG/WAV files stay untouched. Only content-addressed delivery files,
their runtime map, and an explicit processing report are written.
"""
from pathlib import Path
import argparse
import copy
import hashlib
import io
import json
import subprocess
import tempfile

from PIL import Image
import numpy as np
from build_anime_atlas import pack_frames

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
OUTPUT = PUBLIC / "assets/delivery"
DEFAULT_AUTHOR_MANIFEST = ROOT / "scripts/anime_manifest.json"
DEFAULT_REPORT_DIR = ROOT / ".local-releases/加载提速-0915/acceptance"
DEFAULT_MANIFEST_OUTPUT = ROOT / "src/render/deliveryManifest.json"
DEFAULT_CHARACTERS = ("luffy", "akainu")
CHARACTER_FX = {
    "luffy": ("assets/fx/luffy.png", "assets/fx/luffy.json"),
    "akainu": ("assets/fx/akainu.png", "assets/fx/akainu.json"),
    "labubu": ("assets/fx/labubu/atlas.png", "assets/fx/labubu/atlas.json"),
    "twinkle": ("assets/fx/twinkle/atlas.png", "assets/fx/twinkle/atlas.json"),
}
COMMON_FX = ("assets/fx/common/atlas.png", "assets/fx/common/atlas.json")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encode_json(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def immutable_file(label, suffix, data, write=True):
    name = f"{label}-{digest(data)[:20]}.{suffix}"
    path = OUTPUT / name
    if path.exists() and path.read_bytes() != data:
        raise ValueError(f"Content-address collision: {name}")
    if write and not path.exists():
        path.write_bytes(data)
    return f"assets/delivery/{name}"


def verify_authoring_provenance(manifest, manifest_path, root=ROOT):
    fields = ("sourceManifest", "sourceCatalog", "generator")
    present = [field for field in fields if field in manifest]
    if manifest_path.name.endswith(".resolved.json") or present:
        if set(present) != set(fields):
            raise ValueError(f"Resolved authoring manifest requires sourceManifest/sourceCatalog/generator receipts: {manifest_path}")
    verified = {}
    for field in present:
        record = manifest[field]
        if not isinstance(record, dict) or not isinstance(record.get("file"), str) or not isinstance(record.get("sha256"), str):
            raise ValueError(f"Invalid {field} receipt: {manifest_path}")
        relative = Path(record["file"])
        if relative.is_absolute():
            raise ValueError(f"{field} must be repository-relative: {record['file']}")
        target = (Path(root).resolve() / relative).resolve()
        if not target.is_relative_to(Path(root).resolve()) or not target.is_file() or digest(target.read_bytes()) != record["sha256"].lower():
            raise ValueError(f"{field} receipt mismatch: {record['file']}")
        verified[field] = {"file": relative.as_posix(), "sha256": record["sha256"].lower()}
    return verified


def load_authoring_ownership(manifest_paths, root=ROOT):
    owners, receipts = {}, []
    for manifest_path in manifest_paths:
        path = Path(manifest_path).resolve()
        raw = path.read_bytes()
        manifest = json.loads(raw)
        if manifest.get("schemaVersion") != 1 or not isinstance(manifest.get("characters"), dict):
            raise ValueError(f"Unsupported authoring manifest: {path}")
        provenance = verify_authoring_provenance(manifest, path, root)
        owned = []
        for character, config in manifest["characters"].items():
            if not isinstance(config, dict):
                raise ValueError(f"Invalid character authoring config: {character}")
            if character in owners:
                raise ValueError(f"Character has multiple authoring manifests: {character}")
            owners[character] = {"path": path, "sha256": digest(raw), "config": config, "provenance": provenance}
            owned.append(character)
        try:
            display_path = path.relative_to(ROOT).as_posix()
        except ValueError:
            display_path = path.as_posix()
        receipts.append({"file": display_path, "sha256": digest(raw), "characters": sorted(owned), "provenance": provenance})
    return owners, receipts


def resolve_build_plan(characters, manifest_paths, ui_manifest_path=None):
    selected = list(dict.fromkeys(characters))
    if not selected or any(character not in CHARACTER_FX for character in selected):
        raise ValueError("Characters must be an explicit non-empty subset of luffy, akainu, labubu, twinkle")
    owners, receipts = load_authoring_ownership(manifest_paths)
    ui_path = Path(ui_manifest_path or ROOT / "src/render/anime/uiArtManifest.json")
    ui_characters = read_json(ui_path).get("characters", {})
    plan = []
    for character in selected:
        owner, ui = owners.get(character), ui_characters.get(character)
        if not owner:
            raise ValueError(f"Missing authoring manifest for character: {character}")
        if not isinstance(ui, dict) or not ui.get("image") or not ui.get("sha256"):
            raise ValueError(f"Missing explicit UI identity for character: {character}")
        if ui.get("enabled") is False:
            raise ValueError(f"Disabled character art cannot be encoded: {character} ({ui.get('reviewStatus', 'review blocked')})")
        plan.append({"id": character, "manifest": owner, "ui": ui, "fx": CHARACTER_FX[character]})
    return plan, receipts


def audio_banks(cues, selected_characters):
    selected = set(selected_characters)
    menu_ids = {"menu_move", "menu_confirm"}
    owners, menu_files, included = {}, set(), set()
    for cue_id, cue in cues.items():
        owner = cue.get("characterId")
        if owner and owner not in selected:
            continue
        for source in cue.get("files", []):
            included.add(source)
            # AudioEngine.preloadMenu also needs the tiny selection responses.
            # A shared attack/select clip belongs here once, not in a whole fighter bank.
            if cue_id in menu_ids or (cue_id.startswith("voice.") and cue_id.endswith(".select")):
                menu_files.add(source)
            if owner:
                previous = owners.setdefault(source, owner)
                if previous != owner:
                    raise ValueError(f"Audio file assigned to multiple characters: {source}")
    banks = {}
    for source in sorted(included):
        group = "menu" if source in menu_files else f"character-{owners[source]}" if source in owners else "effects"
        banks.setdefault(group, []).append(source)
    return banks


def encode_avif_image(original, quality=70):
    """Ordinary atlas alternative only; alpha must remain sample-exact."""
    if not isinstance(quality, int) or not 65 <= quality <= 100:
        raise ValueError("Reviewed AVIF candidate quality must be between 65 and 100")
    target = io.BytesIO()
    settings = {"quality": quality, "speed": 4, "subsampling": "4:4:4", "max_threads": 2,
                "codec": "aom", "advanced": {"alpha:lossless": "1"}}
    original.save(target, "AVIF", **settings)
    data = target.getvalue()
    decoded = Image.open(io.BytesIO(data)).convert("RGBA")
    if decoded.size != original.size or not np.array_equal(np.asarray(original)[:, :, 3], np.asarray(decoded)[:, :, 3]):
        raise ValueError("AVIF atlas dimensions or alpha changed")
    return data, {"settings": settings, "exactAlpha": True, "size": list(decoded.size)}


def build(ffmpeg=None, quality=95, characters=DEFAULT_CHARACTERS, author_manifests=(DEFAULT_AUTHOR_MANIFEST,),
          report_dir=DEFAULT_REPORT_DIR, manifest_output=DEFAULT_MANIFEST_OUTPUT, check=False,
          avif_quality=None, avif_characters=()):
    plan, author_receipts = resolve_build_plan(characters, author_manifests)
    avif_ids = set(avif_characters)
    if avif_ids - {item["id"] for item in plan} or bool(avif_ids) != (avif_quality is not None):
        raise ValueError("AVIF requires an explicit quality and non-empty subset of the selected characters")
    if avif_quality is not None and (not isinstance(avif_quality, int) or not 65 <= avif_quality <= 100):
        raise ValueError("AVIF candidate quality must be between 65 and 100")
    report_dir, manifest_output = Path(report_dir).resolve(), Path(manifest_output).resolve()
    if (len(plan) > 2 or len(author_receipts) > 1) and report_dir == DEFAULT_REPORT_DIR.resolve():
        raise ValueError("Expanded delivery builds require an independent --report-dir; refusing to overwrite the 0915 report area")
    if not check:
        OUTPUT.mkdir(parents=True, exist_ok=True)
    records, images_report, audio_report = {}, [], []

    def add(logical, label, suffix, data, mime, source, **extra):
        records[logical] = {
            "file": immutable_file(label, suffix, data, not check), "sha256": digest(data),
            "bytes": len(data), "contentType": mime,
            "source": source, "sourceSha256": digest((PUBLIC / source).read_bytes()), **extra,
        }

    def image(logical, label, original, source, lossless=False, protected_names=None, avif=False):
        if avif and (lossless or protected_names):
            raise ValueError("Protected foreground/body pages must keep their exact lossless WebP")
        target = io.BytesIO()
        original.save(target, "WEBP", lossless=lossless, quality=100 if lossless else quality, method=6, exact=True)
        data = target.getvalue()
        decoded = Image.open(io.BytesIO(data)).convert("RGBA")
        before, after = np.asarray(original), np.asarray(decoded)
        alpha_equal = bool(np.array_equal(before[:, :, 3], after[:, :, 3]))
        rgba_equal = bool(np.array_equal(before, after))
        if not alpha_equal or (lossless and not rgba_equal):
            raise ValueError(f"Pixel protection failed: {logical}")
        add(logical, label, "webp", data, "image/webp", source)
        if protected_names:
            records[logical]["preserveRgba"] = True
        images_report.append({"logical": logical, "source": source, "size": list(original.size),
                              "bytes": len(data), "quality": 100 if lossless else quality, "lossless": lossless, "exactAlpha": alpha_equal,
                              "exactRgba": rgba_equal, "protectedFrames": protected_names or []})
        if avif:
            alternative, checks = encode_avif_image(original, avif_quality)
            records[logical]["avif"] = {
                "file": immutable_file(label + "-avif", "avif", alternative, not check),
                "sha256": digest(alternative), "bytes": len(alternative), "contentType": "image/avif",
                "source": source, "sourceSha256": records[logical]["sourceSha256"],
            }
            images_report[-1]["avif"] = {**checks, "bytes": len(alternative), "sha256": digest(alternative),
                                         "packedRgbaSha256": digest(original.tobytes()), "visualAcceptance": "pending"}

    for character_plan in plan:
        character = character_plan["id"]
        manifest_hash = character_plan["manifest"]["sha256"]
        base = f"assets/characters/{character}/anime/"
        source_runtime = base + "runtime.json"
        runtime = read_json(PUBLIC / source_runtime)
        source_report = read_json(PUBLIC / base / "build-report.json")
        for name in ["runtime.json", *[p[field] for p in runtime["pages"] for field in ("image", "data")]]:
            actual = digest((PUBLIC / base / name).read_bytes())
            if source_report["outputHashes"].get(name) != actual:
                raise ValueError(f"Runtime master differs from its build record: {base}{name}")
        original_runtime = copy.deepcopy(runtime)
        crop_images, entries, aliases, origins = {}, {}, {}, {}
        original_rgba_bytes = 0
        for page in runtime["pages"]:
            source = base + page["image"]
            sheet = Image.open(PUBLIC / source).convert("RGBA")
            original_rgba_bytes += sheet.width * sheet.height * 4
            atlas = read_json(PUBLIC / base / page["data"])
            if atlas.get("meta", {}).get("manifestSha256") != manifest_hash:
                raise ValueError(f"Runtime atlas belongs to a different authoring manifest: {base}{page['data']}")
            for name, entry in atlas["frames"].items():
                f = entry["frame"]
                x, y, w, h = (f[key] for key in ("x", "y", "w", "h"))
                key = f'{page["id"]}:{x}:{y}:{w}:{h}'
                if key not in crop_images:
                    crop_images[key] = sheet.crop((x, y, x + w, y + h))
                    origins[key] = source
                entries[name], aliases[name] = copy.deepcopy(entry), key
        protected = {aliases[name] for pair in runtime.get("foregroundFrames", {}).items() for name in pair}
        groups = []
        for page in runtime["pages"]:
            keys = [key for key in crop_images if key.startswith(page["id"] + ":") and key not in protected]
            if keys:
                groups.append((keys, False))
        if protected:
            groups.append((sorted(protected), True))
        runtime["pages"], runtime["framePages"] = [], {}
        delivery_rgba_bytes = 0
        for index, (keys, lossless) in enumerate(groups):
            selected = {key: crop_images[key] for key in keys}
            packed, positions = pack_frames(selected, 4096)
            # Paste RGBA directly: alpha-compositing can discard transparent RGB.
            packed = Image.new("RGBA", packed.size)
            for key, position in positions.items():
                packed.paste(selected[key], position)
            page_id = f"p{index}"
            stem = "atlas" if index == 0 else f"atlas-{page_id}"
            page = {"id": page_id, "image": stem + ".webp", "data": stem + ".json",
                    "width": packed.width, "height": packed.height}
            frames = {}
            for name, key in aliases.items():
                if key not in positions:
                    continue
                entry = copy.deepcopy(entries[name])
                entry["frame"]["x"], entry["frame"]["y"] = positions[key]
                frames[name] = entry
                runtime["framePages"][name] = page_id
            sources = {origins[key] for key in keys}
            if len(sources) != 1:
                raise ValueError("Delivery groups must retain one explicit original page")
            source = sources.pop()
            image(base + page["image"], character + "-" + stem, packed, source, lossless,
                  list(frames) if lossless else [], avif=character in avif_ids and not lossless)
            metadata = {"frames": frames, "meta": {"image": page["image"],
                        "size": {"w": packed.width, "h": packed.height}, "scale": "1",
                        "textureDensity": runtime["textureDensity"], "page": page_id}}
            add(base + page["data"], character + "-" + stem, "json", encode_json(metadata), "application/json",
                base + original_runtime["pages"][int(keys[0].split(":")[0][1:])]["data"])
            runtime["pages"].append(page)
            delivery_rgba_bytes += packed.width * packed.height * 4
        runtime["atlas"] = {"image": "atlas.webp", "data": "atlas.json"}
        if runtime["anims"] != original_runtime["anims"] or runtime["attachments"] != original_runtime["attachments"]:
            raise ValueError("Delivery packaging changed animation or attachment geometry")
        if set(runtime["framePages"]) != set(original_runtime["framePages"]):
            raise ValueError("Delivery packaging changed frame coverage")
        if delivery_rgba_bytes > original_rgba_bytes * 1.2:
            raise ValueError(f"Delivery texture memory grew beyond 20%: {character}")
        add(source_runtime, character + "-runtime", "json", encode_json(runtime), "application/json", source_runtime)
        ui = character_plan["ui"]
        if digest((PUBLIC / ui["image"]).read_bytes()) != ui["sha256"]:
            raise ValueError(f"UI master content mismatch: {character}")
        image(ui["image"], character + "-ui", Image.open(PUBLIC / ui["image"]).convert("RGBA"), ui["image"])
        fx, fx_meta = character_plan["fx"]
        image(fx, character + "-fx", Image.open(PUBLIC / fx).convert("RGBA"), fx)
        add(fx_meta, character + "-fx", "json", (PUBLIC / fx_meta).read_bytes(), "application/json", fx_meta)

    if any(item["id"] in ("labubu", "twinkle") for item in plan):
        fx, fx_meta = COMMON_FX
        image(fx, "common-fx", Image.open(PUBLIC / fx).convert("RGBA"), fx, lossless=True)
        add(fx_meta, "common-fx", "json", (PUBLIC / fx_meta).read_bytes(), "application/json", fx_meta)

    for name in ("backdrop", "floor"):
        source = f"assets/stages/marineford/{name}.webp"
        add(source, name, "webp", (PUBLIC / source).read_bytes(), "image/webp", source)

    # Pack independently decodable clips together. Offsets cut original encoded
    # files, not a continuous audio stream, so no cue timing or encoder delay leaks.
    cues = read_json(ROOT / "src/audio/sampleManifest.json")["cues"]
    banks = audio_banks(cues, [item["id"] for item in plan])
    # Keep these task-owned intermediates for audio comparison; no cleanup or
    # permission-changing retry touches previous runs' temporary files.
    with tempfile.TemporaryDirectory(prefix="opf-audio-delivery-", delete=False) as temporary:
        for group, sources in banks.items():
            payload, slices = bytearray(), []
            for index, source in enumerate(sources):
                original = (PUBLIC / source).read_bytes()
                data, mime = original, "audio/wav"
                if ffmpeg:
                    target = Path(temporary) / f"{group}-{index}.ogg"
                    subprocess.run([str(ffmpeg), "-nostdin", "-v", "error", "-i", str(PUBLIC / source),
                                    "-c:a", "libopus", "-b:a", "96k", "-vbr", "on", "-application", "audio",
                                    "-frame_duration", "10", "-fflags", "+bitexact", "-flags:a", "+bitexact",
                                    "-map_metadata", "-1", str(target)], check=True)
                    data, mime = target.read_bytes(), "audio/ogg"
                slices.append((source, len(payload), len(data), mime))
                payload.extend(data)
            data = bytes(payload)
            file = immutable_file("audio-" + group, "bin", data, not check)
            for source, offset, length, mime in slices:
                records[source] = {"file": file, "sha256": digest(data), "bytes": len(data), "contentType": mime,
                                   "source": source, "sourceSha256": digest((PUBLIC / source).read_bytes()),
                                   "slice": {"offset": offset, "length": length}}
            audio_report.append({"bank": group, "file": file, "clips": len(sources), "bytes": len(data),
                                 "codec": "opus-96k" if ffmpeg else "original-wav"})
        # Recreate the same mastered music from its verified original recording,
        # not from a second lossy encode of the previous delivery OGG.
        processing = read_json(ROOT / "scripts/daily_audio_manifest.json")["assets"]
        music = read_json(ROOT / "src/audio/musicManifest.json")["tracks"]
        for name, track in music.items():
            logical = track["file"]
            item = next(entry for entry in processing if entry["output"] == "public/" + logical)
            source = ROOT / item["source"]
            if digest(source.read_bytes()) != item["sourceSha256"]:
                raise ValueError(f"Music source changed: {source}")
            if not ffmpeg:
                raise ValueError("Music delivery requires the existing ffmpeg executable")
            target = Path(temporary) / f"music-{name}.ogg"
            bitrate = 80 if name == "menu" else 96
            command = [str(ffmpeg), "-nostdin", "-v", "error"]
            if "start" in item:
                command += ["-ss", str(item["start"]), "-t", str(item["duration"])]
            command += ["-i", str(source), "-af", item["filter"], "-ac", "2", "-c:a", "libopus",
                        "-b:a", f"{bitrate}k", "-vbr", "on", "-fflags", "+bitexact", "-flags:a", "+bitexact",
                        "-map_metadata", "-1", str(target)]
            subprocess.run(command, check=True)
            data = target.read_bytes()
            add(logical, "music-" + name, "ogg", data, "audio/ogg", logical)
            audio_report.append({"music": name, "file": records[logical]["file"], "bytes": len(data),
                                 "codec": f"opus-{bitrate}k", "processing": item, "streaming": True})
    manifest = {"schemaVersion": 1, "version": digest(encode_json(records)), "records": records}
    physical_records = [physical for record in records.values() for physical in ([record, record["avif"]] if "avif" in record else [record])]
    report = {"version": manifest["version"], "images": images_report, "audio": audio_report,
              "uniqueFiles": len({r["file"] for r in physical_records}),
              "bytes": sum({r["file"]: r["bytes"] for r in physical_records}.values()),
              "visualAcceptance": "pending", "audioAcceptance": "pending",
              "parameters": {"characters": [item["id"] for item in plan], "quality": quality,
                             "ffmpeg": str(ffmpeg) if ffmpeg else None, "output": OUTPUT.as_posix(),
                             "manifestOutput": manifest_output.as_posix(), "reportDir": report_dir.as_posix(),
                             "authoringManifests": author_receipts, "checkOnly": check,
                             "avifQuality": avif_quality, "avifCharacters": sorted(avif_ids)}}
    report_file = report_dir / f"encoding-{manifest['version'][:20]}.json"
    if not check:
        manifest_output.parent.mkdir(parents=True, exist_ok=True)
        manifest_output.write_bytes(encode_json(manifest))
        report_dir.mkdir(parents=True, exist_ok=True)
        if report_file.exists() and report_file.read_bytes() != encode_json(report):
            raise ValueError(f"Encoding report collision: {report_file}")
        report_file.write_bytes(encode_json(report))
    print(json.dumps({**{key: value for key, value in report.items() if key not in ("images",)},
                      "report": report_file.as_posix()}, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ffmpeg", type=Path, help="Existing ffmpeg binary; no dependency is installed")
    parser.add_argument("--quality", type=int, default=95, choices=range(90, 101), help="Candidate WebP quality; lossless foreground pages stay unchanged")
    parser.add_argument("--character", action="append", dest="characters", help="Explicit character id; repeat for each delivery character")
    parser.add_argument("--author-manifest", action="append", type=Path, dest="author_manifests", help="Explicit authoring manifest; repeat for each source manifest")
    parser.add_argument("--report-dir", type=Path, default=DEFAULT_REPORT_DIR, help="Independent acceptance report directory")
    parser.add_argument("--manifest-output", type=Path, default=DEFAULT_MANIFEST_OUTPUT, help="Delivery manifest output path")
    parser.add_argument("--check", action="store_true", help="Run all encoding and validation in memory without writing delivery files, manifest or report")
    parser.add_argument("--avif-quality", type=int, choices=range(65, 101), help="Optional ordinary atlas AVIF alternative; keeps the original WebP; numerical quality alone is not visual acceptance")
    parser.add_argument("--avif-character", action="append", default=[], help="Explicit reviewed character eligible for AVIF; repeat as needed")
    args = parser.parse_args()
    try:
        build(args.ffmpeg, args.quality, args.characters or DEFAULT_CHARACTERS,
              args.author_manifests or (DEFAULT_AUTHOR_MANIFEST,), args.report_dir, args.manifest_output, args.check,
              args.avif_quality, args.avif_character)
    except (ValueError, OSError, TypeError, KeyError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error)) from error
