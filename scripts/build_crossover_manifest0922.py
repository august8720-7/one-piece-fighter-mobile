"""Resolve the corrected crossover authoring manifest into build_anime_atlas.py.

This wrapper never discovers sources or invents crops. It resolves only catalog
keys explicitly allowed by crossover_manifest0922.json, rejects every old source
marked rejected, verifies the one character-wide scale basis, and expands only
explicit frame/tick lists into runtime animation exposures.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
from datetime import datetime
import hashlib
import json
import math
from pathlib import Path
import shutil
import sys

from PIL import Image

import build_anime_atlas as atlas

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = ROOT / "scripts/crossover_manifest0922.json"
DEFAULT_RESOLVED = ROOT / "scripts/crossover_manifest0922.resolved.json"
REJECTED_PREFIX = "rejected_"
DEFAULT_BACKUP_ROOT = Path("D:/one-piece-fighter-crossover-0922/candidate")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def load_json(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    require(isinstance(value, dict), f"{path}: root must be an object")
    return value


def encode_json(value: dict) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def repository_file(relative: str, expected_hash: str, label: str) -> Path:
    require(isinstance(relative, str) and relative and not Path(relative).is_absolute(), f"{label}: repository-relative file required")
    path = (ROOT / relative).resolve()
    require(path.is_relative_to(ROOT) and path.is_file(), f"{label}: missing or outside repository")
    require(digest(path) == expected_hash.lower(), f"{label}: SHA256 mismatch")
    return path


def repository_path(relative: str, label: str) -> Path:
    require(isinstance(relative, str) and relative and not Path(relative).is_absolute(), f"{label}: repository-relative file required")
    path = (ROOT / relative).resolve()
    require(path.is_relative_to(ROOT) and path.is_file(), f"{label}: missing or outside repository")
    return path


def alpha_bbox(path: Path, crop: list[int], threshold: int) -> list[int]:
    require(len(crop) == 4 and all(isinstance(value, int) for value in crop), "scaleBasis.crop must be four integers")
    x, y, width, height = crop
    require(width > 0 and height > 0, "scaleBasis.crop must be nonempty")
    with Image.open(path) as image:
        require(x >= 0 and y >= 0 and x + width <= image.width and y + height <= image.height, "scaleBasis.crop exceeds source")
        alpha = image.convert("RGBA").crop((x, y, x + width, y + height)).getchannel("A")
    box = alpha.point(lambda value: 255 if value >= threshold else 0).getbbox()
    require(box is not None, "scaleBasis reference has no visible pixels")
    return list(box)


def rejected_keys(manifest: dict) -> set[str]:
    rows = manifest.get("rejected")
    require(isinstance(rows, list), "rejected must be an explicit list")
    keys: set[str] = set()
    for row in rows:
        require(isinstance(row, dict) and isinstance(row.get("reason"), str), "invalid rejected entry")
        source_keys = row.get("sourceKeys")
        require(isinstance(source_keys, list) and all(isinstance(key, str) for key in source_keys), "rejected sourceKeys must be strings")
        keys.update(source_keys)
    return keys


def resolve_source(alias: str, ref: dict, catalog: dict, manifest: dict) -> dict:
    require(isinstance(ref, dict), f"sourceRefs.{alias}: object required")
    key = ref.get("catalogKey")
    require(isinstance(key, str) and key, f"sourceRefs.{alias}: catalogKey required")
    require(key not in rejected_keys(manifest), f"{alias}: rejected source key {key} cannot enter corrected authoring")
    sources = catalog.get("sources")
    require(isinstance(sources, dict) and key in sources, f"{alias}: catalog source missing: {key}")
    record = sources[key]
    require(isinstance(record, dict), f"{alias}: invalid catalog source")
    status = record.get("adoptionStatus")
    allowed = ref.get("allowedStatuses")
    require(isinstance(allowed, list) and allowed and all(isinstance(value, str) for value in allowed), f"{alias}: allowedStatuses required")
    require(isinstance(status, str) and not status.startswith(REJECTED_PREFIX), f"{alias}: rejected adoption status {status}")
    require(status in allowed and status in manifest["acceptedAdoptionStatuses"], f"{alias}: adoption status {status} is not allowed")
    repository_file(record["file"], record["sha256"], f"{alias} source")
    resolved = deepcopy(record)
    if "unitScale" in ref:
        unit_scale = ref["unitScale"]
        scale_basis = ref.get("scaleBasis")
        require(isinstance(unit_scale, (int, float)) and not isinstance(unit_scale, bool) and math.isfinite(unit_scale) and 0 < unit_scale <= 8, f"{alias}: invalid sheet-wide unitScale")
        require(isinstance(scale_basis, str) and bool(scale_basis.strip()), f"{alias}: unitScale override requires an explicit scaleBasis")
        resolved["unitScale"] = unit_scale
        resolved["scaleBasis"] = scale_basis
    return resolved


def validate_scale_basis(character: str, config: dict, catalog: dict, manifest: dict) -> None:
    basis = config.get("scaleBasis")
    require(isinstance(basis, dict), f"{character}: scaleBasis required")
    key = basis.get("catalogKey")
    require(key not in rejected_keys(manifest), f"{character}: rejected scale source {key}")
    record = catalog.get("sources", {}).get(key)
    require(isinstance(record, dict), f"{character}: scale source missing: {key}")
    require(record.get("adoptionStatus") in manifest["acceptedAdoptionStatuses"], f"{character}: scale source status is not accepted")
    path = repository_file(record["file"], record["sha256"], f"{character} scale source")
    threshold = basis.get("alphaThreshold")
    require(isinstance(threshold, int) and 1 <= threshold <= 255, f"{character}: invalid alpha threshold")
    measured = alpha_bbox(path, basis.get("crop"), threshold)
    require(measured == basis.get("visibleBbox"), f"{character}: scale reference bbox drifted: {measured}")
    height = measured[3] - measured[1]
    require(height == basis.get("visibleHeight"), f"{character}: scale reference height drifted")
    target = config.get("targetWorldHeight")
    scale = config.get("scale")
    require(isinstance(target, (int, float)) and target > 0 and isinstance(scale, (int, float)) and math.isfinite(scale), f"{character}: target/scale invalid")
    expected = 2 * target / height
    require(abs(scale - expected) < 1e-12, f"{character}: uniform scale must equal 2*target/referenceHeight")


def validate_page_plan(character: str, pages: object, catalog: dict, manifest: dict) -> None:
    require(isinstance(pages, dict) and pages, f"{character}: plannedPages required")
    for name, page in pages.items():
        require(isinstance(page, dict), f"{character}/{name}: page plan must be an object")
        layout = page.get("layout")
        require(isinstance(layout, dict) and isinstance(layout.get("rows"), int) and isinstance(layout.get("columns"), int)
                and layout["rows"] > 0 and layout["columns"] > 0, f"{character}/{name}: explicit positive rows/columns required")
        indices = page.get("indices")
        count = layout["rows"] * layout["columns"]
        require(isinstance(indices, dict) and set(indices) == {str(i) for i in range(count)}, f"{character}/{name}: indices 0..{count - 1} required exactly once")
        require(len(set(indices.values())) == count, f"{character}/{name}: planned poses must be unique")
        status = page.get("status")
        require(status in ("pending", "ready"), f"{character}/{name}: status must be pending or ready")
        key = page.get("catalogKey")
        require(isinstance(key, str) and key not in rejected_keys(manifest), f"{character}/{name}: rejected or missing catalog key")
        if status == "ready":
            require(isinstance(page.get("sourceAlias"), str), f"{character}/{name}: ready page requires sourceAlias")
            record = catalog.get("sources", {}).get(key)
            require(isinstance(record, dict), f"{character}/{name}: ready source absent from catalog")
            require(record.get("adoptionStatus") in manifest["acceptedAdoptionStatuses"], f"{character}/{name}: source status is not accepted")


def animations(config: dict) -> dict:
    frames = config.get("frames")
    definitions = config.get("animations")
    require(isinstance(frames, dict) and isinstance(definitions, dict), "frames/animations must be objects")
    out: dict[str, dict] = {}
    for name, definition in definitions.items():
        require(isinstance(definition, dict), f"{name}: animation must be an object")
        mapping = definition.get("frames")
        ticks = definition.get("ticks")
        require(isinstance(mapping, list) and mapping and all(frame in frames for frame in mapping), f"{name}: every frame must be an explicit crop")
        require(isinstance(ticks, list) and len(ticks) == len(mapping) and all(isinstance(tick, int) and tick > 0 for tick in ticks), f"{name}: one positive tick count per frame required")
        require(isinstance(definition.get("loop"), bool), f"{name}: loop must be boolean")
        if "sharedPhases" in definition:
            shared = definition["sharedPhases"]
            require(isinstance(shared, dict) and set(shared) == {"startup", "recovery"}
                    and all(isinstance(note, str) and note.strip() for note in shared.values()),
                    f"{name}: sharedPhases must explain startup and recovery reuse")
            require(len(mapping) == 3 and len(set(mapping)) == 3 and not definition["loop"],
                    f"{name}: shared attack phases require three distinct non-looping poses")
            elsewhere = [frame for other_name, other in definitions.items() if other_name != name
                         and isinstance(other, dict) for frame in other.get("frames", [])]
            require(mapping[0] in elsewhere and mapping[2] in elsewhere,
                    f"{name}: shared startup/recovery must reuse existing mapped poses")
            require(mapping[1] not in elsewhere,
                    f"{name}: active phase must retain its independent inspected pose")
        row = {"frames": mapping, "loop": definition["loop"], "exposures": [{"frame": index, "ticks": tick} for index, tick in enumerate(ticks)]}
        if "airbornePhases" in definition:
            row["airbornePhases"] = definition["airbornePhases"]
        if "throwFrames" in definition:
            require("throwTicks" in definition, f"{name}: throwFrames requires throwTicks")
        if "throwTicks" in definition:
            throw_indices = list(range(len(mapping)))
            if "throwFrames" in definition:
                throw_mapping = definition["throwFrames"]
                require(isinstance(throw_mapping, list) and throw_mapping
                        and all(isinstance(frame, str) and frame in mapping for frame in throw_mapping),
                        f"{name}: throwFrames must select existing frames of this animation")
                throw_indices = [mapping.index(frame) for frame in throw_mapping]
            throw_ticks = definition["throwTicks"]
            require(isinstance(throw_ticks, list) and len(throw_ticks) == len(throw_indices)
                    and all(type(tick) is int and tick > 0 for tick in throw_ticks), f"{name}: invalid throwTicks")
            row["throwExposures"] = [{"frame": index, "ticks": tick} for index, tick in zip(throw_indices, throw_ticks)]
        out[name] = row
    return out


def resolve(manifest_path: Path, selected: list[str] | None = None) -> tuple[dict, dict]:
    manifest = load_json(manifest_path)
    require(manifest.get("schemaVersion") == 1 and manifest.get("kind") == "crossover-explicit-authoring", "unsupported crossover manifest")
    allowed = manifest.get("allowedCharacters")
    require(allowed == ["labubu", "twinkle"], "allowedCharacters must stay labubu,twinkle")
    accepted = manifest.get("acceptedAdoptionStatuses")
    require(isinstance(accepted, list) and accepted and all(isinstance(value, str) and not value.startswith(REJECTED_PREFIX) for value in accepted), "invalid acceptedAdoptionStatuses")
    catalog_path = repository_path(manifest["sourceCatalog"], "source catalog")
    catalog = load_json(catalog_path)
    require(catalog.get("schemaVersion") == 1 and isinstance(catalog.get("sources"), dict), "unsupported source catalog")
    for key in rejected_keys(manifest):
        record = catalog["sources"].get(key)
        require(isinstance(record, dict) and str(record.get("adoptionStatus", "")).startswith(REJECTED_PREFIX), f"rejected source {key} is not marked rejected in catalog")
    chosen = selected or allowed
    require(chosen and len(chosen) == len(set(chosen)) and all(character in allowed for character in chosen), "selected characters must be unique allowedCharacters")
    resolved = {
        "schemaVersion": 1,
        "sourceManifest": {"file": manifest_path.relative_to(ROOT).as_posix(), "sha256": digest(manifest_path)},
        "sourceCatalog": {"file": catalog_path.relative_to(ROOT).as_posix(), "sha256": digest(catalog_path)},
        "generator": {"file": Path(__file__).resolve().relative_to(ROOT).as_posix(), "sha256": digest(Path(__file__).resolve())},
        "notes": manifest.get("notes", []),
        "characters": {},
    }
    summary = {"manifest": str(manifest_path), "catalog": str(catalog_path), "characters": {}, "buildable": []}
    for character in chosen:
        config = manifest["characters"].get(character)
        require(isinstance(config, dict), f"{character}: character config missing")
        validate_scale_basis(character, config, catalog, manifest)
        validate_page_plan(character, config.get("plannedPages"), catalog, manifest)
        source_refs = config.get("sourceRefs")
        require(isinstance(source_refs, dict) and source_refs, f"{character}: sourceRefs required")
        sources = {alias: resolve_source(alias, ref, catalog, manifest) for alias, ref in source_refs.items()}
        atlas.load_sources(sources)
        for name, page in config["plannedPages"].items():
            if page["status"] != "ready":
                continue
            alias = page["sourceAlias"]
            require(alias in source_refs and source_refs[alias]["catalogKey"] == page["catalogKey"], f"{character}/{name}: ready page sourceAlias does not resolve its catalogKey")
        anims = animations(config)
        frames = config.get("frames")
        if frames or anims:
            require(frames and anims, f"{character}: frames and animations must become buildable together")
            used = {frame["source"] for frame in frames.values()}
            require(used <= set(sources), f"{character}: frame references unresolved source aliases: {sorted(used - set(sources))}")
            resolved["characters"][character] = {
                "scale": config["scale"], "textureDensity": config["textureDensity"], "maxTextureSize": config["maxTextureSize"],
                "sources": sources, "frames": frames, "anims": anims,
            }
            summary["buildable"].append(character)
        summary["characters"][character] = {
            "buildStatus": config.get("buildStatus"), "targetWorldHeight": config.get("targetWorldHeight"),
            "resolvedSources": sorted(sources), "explicitFrames": len(frames), "explicitAnimations": len(anims),
            "sharedPhaseAnimations": sorted(name for name, animation in config["animations"].items() if "sharedPhases" in animation),
            "pendingPages": sorted(name for name, page in config["plannedPages"].items() if page["status"] == "pending"),
        }
    return resolved, summary


def sync_resolved(path: Path, resolved: dict) -> str:
    target = path.resolve()
    require(target.is_relative_to((ROOT / "scripts").resolve()) and target.name.endswith(".resolved.json"), "resolved manifest must stay under scripts and end in .resolved.json")
    encoded = encode_json(resolved)
    if target.exists() and target.read_bytes() != encoded:
        target.write_bytes(encoded)
    elif not target.exists():
        target.write_bytes(encoded)
    require(target.read_bytes() == encoded, "resolved manifest write verification failed")
    return hashlib.sha256(encoded).hexdigest()


def backup_existing(characters: list[str], backup_root: Path) -> Path | None:
    root = backup_root.resolve()
    expected = Path("D:/one-piece-fighter-crossover-0922").resolve()
    require(root.is_relative_to(expected), "backup root must stay under D:/one-piece-fighter-crossover-0922")
    existing: dict[str, list[Path]] = {}
    for character in characters:
        destination = ROOT / "public/assets/characters" / character / "anime"
        files = sorted(path for path in destination.iterdir() if path.is_file()) if destination.exists() else []
        if files:
            existing[character] = files
    if not existing:
        return None
    run = root / ("atlas-backup-" + datetime.now().strftime("%m%d-%H%M%S-%f"))
    run.mkdir(parents=True, exist_ok=False)
    (run / "README.md").write_text(
        "# Crossover atlas backup\n\nCreated before replacing generated LABUBU/Twinkle sample atlas outputs. "
        "Existing files are copied byte-for-byte; no source or previous backup is removed.\n",
        encoding="utf-8",
    )
    inventory = []
    for character, files in existing.items():
        for path in files:
            inventory.append({"character": character, "file": path.name, "bytes": path.stat().st_size, "sha256": digest(path)})
    (run / "source-inventory.json").write_bytes(encode_json({"files": inventory}))
    verified = []
    for row in inventory:
        source = ROOT / "public/assets/characters" / row["character"] / "anime" / row["file"]
        destination = run / row["character"] / row["file"]
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        actual = digest(destination)
        require(actual == row["sha256"] and destination.stat().st_size == row["bytes"], f"backup verification failed: {row['character']}/{row['file']}")
        verified.append({**row, "copiedSha256": actual, "verified": True})
    (run / "copy-verification.json").write_bytes(encode_json({"files": verified}))
    return run


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("characters", nargs="*")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--resolved", type=Path, default=DEFAULT_RESOLVED)
    parser.add_argument("--backup-root", type=Path, default=DEFAULT_BACKUP_ROOT)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="Resolve and run build_anime_atlas.py in memory")
    mode.add_argument("--write", action="store_true", help="Write only a complete-candidate")
    mode.add_argument("--write-sample", action="store_true", help="Write only explicitly mapped sample actions; runtime gates must reject missing coverage")
    parser.add_argument("--replace", action="store_true", help="Pass replacement backup behavior to the underlying builder")
    args = parser.parse_args()
    resolved, summary = resolve(args.manifest.resolve(), None)
    selected = args.characters or list(resolved["characters"])
    require(selected and len(selected) == len(set(selected)) and all(character in resolved["characters"] for character in selected), "selected characters must be unique resolved characters")
    resolved_hash = sync_resolved(args.resolved, resolved)
    summary["resolved"] = str(args.resolved.resolve())
    summary["resolvedSha256"] = resolved_hash
    summary["buildable"] = [character for character in summary["buildable"] if character in selected]
    if not args.check and not args.write and not args.write_sample:
        print(json.dumps({"status": "config-valid", **summary}, ensure_ascii=False))
        return
    require(summary["buildable"], "no buildable character: explicit inspected frames and animations are still pending")
    if args.write:
        require(all(summary["characters"][character]["buildStatus"] == "complete-candidate" for character in summary["buildable"]), "write requires complete-candidate status for every selected buildable character")
    if args.write_sample:
        require(all(summary["characters"][character]["buildStatus"] == "sample-candidate" for character in summary["buildable"]), "write-sample requires sample-candidate status for every selected buildable character")
    if args.replace:
        require(args.write or args.write_sample, "--replace is valid only with a write mode")
    assembled = []
    for character in summary["buildable"]:
        outputs, report = atlas.build_character(character, resolved["characters"][character], resolved_hash)
        destination = ROOT / "public/assets/characters" / character / "anime"
        collisions = [destination / name for name in outputs if (destination / name).exists()]
        if collisions and not args.check:
            require(args.replace, f"{character}: candidate files exist; use --replace after preserving a verified backup")
        assembled.append((character, outputs, report))
    backup = None if args.check else backup_existing(summary["buildable"], args.backup_root)
    for character, outputs, report in assembled:
        if not args.check:
            destination = ROOT / "public/assets/characters" / character / "anime"
            destination.mkdir(parents=True, exist_ok=True)
            for name, content in outputs.items():
                (destination / name).write_bytes(content)
            if backup:
                report["backup"] = str(backup / character)
        print(json.dumps({**report, "checkOnly": args.check}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError) as error:
        raise SystemExit(str(error)) from error
