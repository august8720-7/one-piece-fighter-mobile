"""Deterministic post-processing of explicitly recorded Image 2.5 character art.

No image generation, downloads, source discovery, or inferred animation frames.
Source/evidence hashes are verified before any candidate output is written.
"""
from __future__ import annotations

import argparse
from collections import deque
from datetime import datetime
import hashlib
import io
import json
import math
from pathlib import Path
import re
import shutil
from urllib.parse import urlparse

from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "scripts" / "anime_manifest.json"
NAME = re.compile(r"^[a-z][a-z0-9_]*$")
HASH = re.compile(r"^[a-fA-F0-9]{64}$")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def integer(value: object, minimum: int = 0) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= minimum


def point(value: object, label: str) -> tuple[float, float]:
    require(isinstance(value, list) and len(value) == 2 and all(number(n) for n in value), f"{label}: expected [x,y]")
    return float(value[0]), float(value[1])


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def verified_file(record: dict, directory: Path, label: str) -> Path:
    require(isinstance(record, dict), f"{label}: missing file/hash record")
    name, expected = record.get("file"), record.get("sha256")
    require(isinstance(name, str) and name and not Path(name).is_absolute(), f"{label}: file must be repository-relative")
    path = (ROOT / name).resolve()
    require(path.is_relative_to(directory.resolve()) and path.is_file(), f"{label}: file missing or outside {directory.relative_to(ROOT)}")
    require(isinstance(expected, str) and bool(HASH.fullmatch(expected)), f"{label}: invalid SHA256")
    require(digest(path.read_bytes()) == expected.lower(), f"{label}: SHA256 mismatch")
    return path


def load_sources(sources: dict) -> dict[str, Image.Image]:
    require(isinstance(sources, dict) and bool(sources), "sources must contain recorded Image 2.5 originals")
    images = {}
    for key, source in sources.items():
        require(bool(NAME.fullmatch(key)) and isinstance(source, dict), f"invalid source {key}")
        require(source.get("model") == "GPT Image 2.5" and source.get("provider") == "chatgpt-web", f"{key}: only recorded GPT Image 2.5 official web originals are permitted")
        unit_scale = source.get("unitScale", 1)
        require(number(unit_scale) and 0 < unit_scale <= 8, f"{key}: unitScale must be in (0,8]")
        require(unit_scale == 1 or (isinstance(source.get("scaleBasis"), str) and bool(source["scaleBasis"].strip())), f"{key}: non-unit source calibration requires scaleBasis from a fixed reference pose")
        session = urlparse(source.get("sessionUrl", ""))
        require(session.scheme == "https" and session.hostname == "chatgpt.com" and session.path.startswith("/c/") and len(session.path) > 3, f"{key}: missing official generation session")
        require(isinstance(source.get("generatedAt"), str), f"{key}: generatedAt required")
        datetime.fromisoformat(source["generatedAt"].replace("Z", "+00:00"))
        verified_file(source.get("modelEvidence"), ROOT / "docs/assets", f"{key} model evidence")
        verified_file(source.get("prompt"), ROOT / "docs/assets", f"{key} complete prompt")
        path = verified_file(source, ROOT / "public/assets/generated/source", key)
        with Image.open(path) as original:
            require(original.format == "PNG", f"{key}: original must be PNG")
            images[key] = original.convert("RGBA")
    return images


def remove_border_key(image: Image.Image, config: dict) -> tuple[Image.Image, dict]:
    """Remove only connected background; optional green-edge decontamination.

    Dark/white interiors are never keyed by brightness. Despill follows only
    green-dominant pixels connected to the removed background, at most three
    source pixels deep; it cannot cross a non-green character outline/interior.
    """
    color, tolerance = config.get("color"), config.get("tolerance", 0)
    require(isinstance(color, list) and len(color) == 3 and all(integer(v) and v <= 255 for v in color), "border-key color must be RGB bytes")
    require(integer(tolerance) and tolerance <= 64, "border-key tolerance must be 0..64")
    require(isinstance(config.get("despill", False), bool), "despill must be boolean")
    require(not config.get("despill") or color == [0, 255, 0], "despill currently requires explicit pure green background")
    result = image.copy()
    width, height = result.size
    pixels = result.load()
    seeds = config.get("seeds", [])
    require(isinstance(seeds, list) and all(isinstance(p, list) and len(p) == 2 and all(integer(v) for v in p) and p[0] < width and p[1] < height for p in seeds), "background seeds must be explicit in-crop integer [x,y] positions")
    require(all(pixels[x, y][3] == 0 or max(abs(pixels[x, y][i] - color[i]) for i in range(3)) <= tolerance for x, y in seeds), "background seed does not match the explicit key color")
    seen, removed = set(), set()
    queue = deque([(x, y) for x in range(width) for y in (0, height - 1)] + [(x, y) for y in range(height) for x in (0, width - 1)] + [tuple(p) for p in seeds])
    while queue:
        x, y = queue.popleft()
        if (x, y) in seen:
            continue
        seen.add((x, y))
        rgba = pixels[x, y]
        if rgba[3] and max(abs(rgba[i] - color[i]) for i in range(3)) > tolerance:
            continue
        pixels[x, y] = (rgba[0], rgba[1], rgba[2], 0)
        removed.add((x, y))
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < width and 0 <= ny < height and (nx, ny) not in seen:
                queue.append((nx, ny))
    require(bool(removed), "no border-connected key found; inspect source and key configuration")
    changed = 0
    region_changed = 0
    radius = 0
    regions = config.get("despillRegions", [])
    require(isinstance(regions, list), "despillRegions must be an explicit rectangle list")
    require(not regions or (config.get("despill") and isinstance(config.get("despillNote"), str) and bool(config["despillNote"].strip()) and isinstance(config.get("despillSourceSha256"), str) and bool(HASH.fullmatch(config["despillSourceSha256"]))), "local despill regions require inspected note and source SHA256 binding")
    feather = config.get("despillAlphaFeather")
    feather_pixels = set()
    if "despillAlphaFeather" in config:
        require(isinstance(feather, dict) and set(feather) == {"regions", "minGreenExcess", "fullGreenExcess"}, "despillAlphaFeather requires only regions/minGreenExcess/fullGreenExcess")
        require(config.get("despill") and isinstance(config.get("despillNote"), str) and bool(config["despillNote"].strip()) and isinstance(config.get("despillSourceSha256"), str) and bool(HASH.fullmatch(config["despillSourceSha256"])), "local alpha feather requires inspected note and source SHA256 binding")
        low, high = feather["minGreenExcess"], feather["fullGreenExcess"]
        require(integer(low) and integer(high) and 0 <= low < high <= 255, "local alpha feather thresholds must be integer 0 <= min < full <= 255")
        require(isinstance(feather["regions"], list) and bool(feather["regions"]), "local alpha feather regions must be a nonempty explicit rectangle list")
        for rect in feather["regions"]:
            rx, ry, rw, rh = rectangle(rect, width, height, "local alpha feather region")
            feather_pixels.update((x, y) for y in range(ry, ry + rh) for x in range(rx, rx + rw))
    if config.get("despill"):
        ring, frontier = set(), removed
        radius = config.get("despillRadius", 1)
        connected = config.get("despillConnected", False)
        require(isinstance(connected, bool), "despillConnected must be boolean")
        require(integer(radius, 1) and radius <= 3, "despillRadius must be 1..3")
        for _ in range(radius):
            following = set()
            for x, y in frontier:
                for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                    if 0 <= nx < width and 0 <= ny < height and (nx, ny) not in removed and (nx, ny) not in ring:
                        r, g, b, alpha = pixels[nx, ny]
                        if not connected or (alpha and g > max(r, b)):
                            following.add((nx, ny))
            ring.update(following)
            frontier = following
        local = set()
        for rect in regions:
            rx, ry, rw, rh = rectangle(rect, width, height, "local despill region")
            local.update((x, y) for y in range(ry, ry + rh) for x in range(rx, rx + rw))
        for x, y in ring | local:
            r, g, b, alpha = pixels[x, y]
            green = max(0, g - max(r, b)) / 255
            if not alpha or green <= 0:
                continue
            opacity = 1 - green
            if opacity <= 0:
                pixels[x, y] = (0, 0, 0, 0)
            else:
                rgb = [min(255, max(0, round((v - green * key) / opacity))) for v, key in zip((r, g, b), color)]
                pixels[x, y] = (*rgb, round(alpha * opacity))
            changed += 1
            if (x, y) in local:
                region_changed += 1
    stats = {"removedBorderPixels": len(removed), "despilledEdgePixels": changed - region_changed, "despilledRegionPixels": region_changed, "despillRegions": regions, "despillRadius": radius, "despillMethod": ("green-connected-source-edge" if config.get("despillConnected") else "geometric-source-edge") if config.get("despill") else "disabled"}
    if feather_pixels:
        alpha_changed = 0
        original_pixels = image.load()
        for x, y in feather_pixels:
            r, g, b, _ = original_pixels[x, y]
            excess = g - max(r, b)
            current = pixels[x, y]
            if excess <= low or current[3] == 0:
                continue
            alpha = round(current[3] * (1 - min(1, (excess - low) / (high - low))))
            if alpha != current[3]:
                pixels[x, y] = (*current[:3], alpha)
                alpha_changed += 1
        stats["despillAlphaFeather"] = {**feather, "changedPixels": alpha_changed, "method": "original-green-excess-local-alpha-only"}
    return result, stats


def rectangle(value: object, width: int, height: int, label: str) -> tuple[int, int, int, int]:
    require(isinstance(value, list) and len(value) == 4 and all(integer(n) for n in value), f"{label}: expected integer [x,y,w,h]")
    x, y, w, h = value
    require(w > 0 and h > 0 and x + w <= width and y + h <= height, f"{label}: outside image or empty")
    return x, y, w, h


def protected_rgba_digest(image: Image.Image, rectangles: list[tuple[int, int, int, int]]) -> str:
    """Hash untouched original RGBA in row-major order, excluding the rectangle union."""
    pixels = image.tobytes()
    checksum = hashlib.sha256()
    stride = image.width * 4
    for y in range(image.height):
        cursor = 0
        intervals = sorted((x, x + width) for x, top, width, height in rectangles if top <= y < top + height)
        for left, right in intervals:
            checksum.update(pixels[y * stride + cursor * 4:y * stride + left * 4])
            cursor = right
        checksum.update(pixels[y * stride + cursor * 4:(y + 1) * stride])
    return checksum.hexdigest()


def apply_source_patches(source: Image.Image, patches: object, sources: dict[str, Image.Image] | None) -> tuple[Image.Image, dict]:
    """Replace verified original PNG rectangles before cropping, without blending or resizing.

    build_character supplies only images returned by load_sources. Direct preparation
    must explicitly provide that loaded map; a patch can never be silently ignored.
    """
    require(isinstance(patches, list) and bool(patches), "sourcePatches must be a nonempty explicit list")
    require(isinstance(sources, dict), "sourcePatches require the loaded sources map")
    rectangles, entries = [], []
    for index, patch in enumerate(patches):
        label = f"sourcePatches[{index}]"
        require(isinstance(patch, dict) and set(patch) == {"source", "rect"}, f"{label}: only source and rect are permitted")
        key = patch["source"]
        require(isinstance(key, str) and bool(NAME.fullmatch(key)) and key in sources, f"{label}: unknown source")
        replacement = sources[key]
        require(isinstance(replacement, Image.Image) and replacement.size == source.size, f"{label}: original PNG dimensions must match")
        rect = rectangle(patch["rect"], source.width, source.height, label + " rect")
        x, y, width, height = rect
        require(all(x + width <= ox or ox + ow <= x or y + height <= oy or oy + oh <= y for ox, oy, ow, oh in rectangles), f"{label}: duplicate or overlapping source rectangles")
        rectangles.append(rect)
        entries.append((key, replacement, rect))
    original = source.convert("RGBA")
    result = original.copy()
    patch_reports = []
    for key, replacement, (x, y, width, height) in entries:
        bounds = (x, y, x + width, y + height)
        region = replacement.convert("RGBA").crop(bounds)
        before = original.crop(bounds).tobytes()
        result.paste(region, (x, y))
        after = result.crop(bounds).tobytes()
        require(after == region.tobytes(), "source patch RGBA changed during replacement")
        patch_reports.append({"source": key, "rect": [x, y, width, height], "pixels": width * height,
            "beforeRgbaSha256": digest(before), "patchRgbaSha256": digest(region.tobytes()), "afterRgbaSha256": digest(after)})
    before_hash = protected_rgba_digest(original, rectangles)
    after_hash = protected_rgba_digest(result, rectangles)
    require(before_hash == after_hash, "source patches changed protected original pixels")
    patched_pixels = sum(width * height for _, _, width, height in rectangles)
    return result, {"method": "same-coordinate-original-rgba-replacement", "canvas": list(original.size),
        "patches": patch_reports, "patchedPixels": patched_pixels,
        "protectedPixels": original.width * original.height - patched_pixels, "protectedPixelsChanged": 0,
        "protectedBeforeRgbaSha256": before_hash, "protectedAfterRgbaSha256": after_hash}


def apply_magma_transform(image: Image.Image, config: dict, root: tuple[float, float], sockets: dict) -> tuple[Image.Image, dict, dict]:
    """Extend an existing magma midsection horizontally; the distal fist is only translated.

    This independent candidate-only transform never relaxes rubber's compression bounds.
    All source pixels outside the explicit region stay fixed. New canvas space is transparent.
    """
    allowed = {"type", "anchor", "wrist", "region", "extensionPixels", "protectedRects", "note"}
    require(set(config) <= allowed and config.get("type") == "magma-straight", "unknown magma transform parameter")
    original = image.convert("RGBA")
    width, height = original.size
    ax, ay = point(config.get("anchor"), "magma anchor")
    wx, wy = point(config.get("wrist"), "magma wrist")
    rx, ry, rw, rh = rectangle(config.get("region"), width, height, "magma region")
    require(ax == rx and ax.is_integer() and wx.is_integer() and rx < wx < rx + rw, "magma boundaries must be forward integer columns inside region")
    require(ry <= ay < ry + rh and ay == wy, "magma extension must be horizontal inside region")
    extension = config.get("extensionPixels")
    length = int(wx - ax)
    require(integer(extension, 1) and extension <= min(256, length), "magma extension must be integer 1..256 and no greater than the original segment")
    rectangles = config.get("protectedRects")
    require(isinstance(rectangles, list) and bool(rectangles), "magma protectedRects required")
    protected = [rectangle(rect, width, height, "magma protected rectangle") for rect in rectangles]
    require(all(x + w <= rx or rx + rw + extension <= x or y + h <= ry or ry + rh <= y for x, y, w, h in protected), "magma destination overlaps protected body")
    contains = lambda p: any(x <= p[0] <= x + w and y <= p[1] <= y + h for x, y, w, h in protected)
    require(contains(root), "magma root must remain protected")
    require("shoulder" in sockets and contains(sockets["shoulder"]), "magma shoulder must remain protected")
    wrist = int(wx)
    segment = original.crop((rx, ry, wrist, ry + rh))
    fist = original.crop((wrist, ry, rx + rw, ry + rh))
    require(segment.getchannel("A").getextrema()[1] > 0 and fist.getchannel("A").getextrema()[1] > 0, "magma segment/fist must contain source artwork")
    result = Image.new("RGBA", (width + extension, height), (0, 0, 0, 0))
    result.paste(original, (0, 0))
    result.paste((0, 0, 0, 0), (rx, ry, rx + rw, ry + rh))
    require(result.getchannel("A").crop((rx, ry, rx + rw + extension, ry + rh)).getextrema()[1] == 0, "magma extension overlaps unmoved source artwork")
    result.paste(segment.resize((length + extension, rh), Image.Resampling.BICUBIC), (rx, ry))
    result.paste(fist, (wrist + extension, ry))
    before_fist = fist.tobytes()
    after_fist = result.crop((wrist + extension, ry, rx + rw + extension, ry + rh)).tobytes()
    require(before_fist == after_fist, "magma fist pixels changed")
    hashes = []
    for x, y, w, h in protected:
        before = original.crop((x, y, x + w, y + h)).tobytes()
        after = result.crop((x, y, x + w, y + h)).tobytes()
        require(before == after, "magma protected pixels changed")
        hashes.append({"rect": [x, y, w, h], "beforeSha256": digest(before), "afterSha256": digest(after)})
    def forward(p: tuple[float, float]) -> tuple[float, float]:
        if not (rx <= p[0] < rx + rw and ry <= p[1] < ry + rh):
            return p
        return (p[0] + extension if p[0] >= wrist else rx + (p[0] - rx) * (length + extension) / length, p[1])
    transformed = {name: forward(p) for name, p in sockets.items()}
    return result, transformed, {"type": "magma-straight", "parameters": config,
        "segmentScaleX": (length + extension) / length, "extensionPixels": extension,
        "protectedPixelsChanged": 0, "protectedRegionHashes": hashes,
        "fistPixelsChanged": 0, "fistBeforeSha256": digest(before_fist), "fistAfterSha256": digest(after_fist),
        "canvasBefore": [width, height], "canvasAfter": list(result.size), "rootUnchanged": list(root),
        "transformedSockets": {key: list(value) for key, value in transformed.items()}}


def apply_frame_transform(image: Image.Image, config: dict, root: tuple[float, float], sockets: dict) -> tuple[Image.Image, dict, dict]:
    """Calibrate one explicitly identified rubber segment using source pixels only.

    The proximal boundary stays fixed; the straight section alone is compressed.
    The distal hand undergoes a rigid rotation/translation, never a scale. A short
    smooth rotation ramp joins the unchanged cuff without drawing a fill shape.
    """
    if isinstance(config, dict) and config.get("type") == "magma-straight":
        return apply_magma_transform(image, config, root, sockets)
    require(isinstance(config, dict) and config.get("type") == "rubber-straight", "unsupported frame transform")
    allowed = {"type", "anchor", "wrist", "region", "compression", "rotationDegrees", "transitionLength", "protectedRects", "note"}
    require(set(config) <= allowed, "unknown rubber transform parameter")
    width, height = image.size
    ax, ay = point(config.get("anchor"), "rubber anchor")
    wx, wy = point(config.get("wrist"), "rubber wrist")
    rx, ry, rw, rh = rectangle(config.get("region"), width, height, "rubber region")
    require(ax == rx and rx < wx < rx + rw and ry <= ay < ry + rh and ry <= wy < ry + rh, "rubber anchor/wrist must define a forward segment inside region")
    compression, degrees, transition = (config.get(k) for k in ("compression", "rotationDegrees", "transitionLength"))
    require(number(compression) and .25 <= compression <= 1, "rubber compression must be .25..1")
    require(number(degrees) and abs(degrees) <= 15, "rubber rotationDegrees must be -15..15")
    require(number(transition) and 0 < transition <= min(128, wx - ax), "rubber transitionLength must be positive and no longer than the straight segment or128px")
    rectangles = config.get("protectedRects")
    require(isinstance(rectangles, list) and bool(rectangles), "rubber protectedRects required")
    protected = [rectangle(rect, width, height, "rubber protected rectangle") for rect in rectangles]
    require(all(x + w <= rx or rx + rw <= x or y + h <= ry or ry + rh <= y for x, y, w, h in protected), "rubber source region overlaps protected body")
    contains = lambda p: any(x <= p[0] <= x + w and y <= p[1] <= y + h for x, y, w, h in protected)
    require(contains(root), "rubber root must remain in a protected rectangle")
    require("shoulder" in sockets and contains(sockets["shoulder"]), "rubber shoulder must remain protected")
    theta, length = math.radians(degrees), wx - ax
    cosine, sine = math.cos(theta), math.sin(theta)

    def forward(p: tuple[float, float]) -> tuple[float, float]:
        s, v = p[0] - ax, p[1] - ay
        z = min(1, max(0, s / transition))
        angle = theta * z * z * (3 - 2 * z)
        u = compression * s if s <= length else compression * length + s - length
        c, sn = math.cos(angle), math.sin(angle)
        return ax + u * c - v * sn, ay + u * sn + v * c

    original = image.convert("RGBA")
    pixels = original.load()
    moving = [(x, y) for y in range(ry, ry + rh) for x in range(rx, rx + rw) if pixels[x, y][3]]
    require(bool(moving), "rubber source region contains no artwork")
    mapped = [forward((x + .5, y + .5)) for x, y in moving]
    require(all(.5 <= x <= width - .5 and .5 <= y <= height - .5 for x, y in mapped), "rubber transform would clip source artwork")
    # Region masking prevents interpolation from borrowing body/neighbor pixels.
    moving_image = Image.new("RGBA", original.size)
    moving_image.paste(original.crop((rx, ry, rx + rw, ry + rh)), (rx, ry))
    moving_pixels = moving_image.load()
    result = original.copy()
    result.paste((0, 0, 0, 0), (rx, ry, rx + rw, ry + rh))
    output = result.load()
    min_x = max(0, math.floor(min(x for x, _ in mapped) - 2))
    max_x = min(width, math.ceil(max(x for x, _ in mapped) + 2))
    min_y = max(0, math.floor(min(y for _, y in mapped) - 2))
    max_y = min(height, math.ceil(max(y for _, y in mapped) + 2))
    for y in range(min_y, max_y):
        for x in range(min_x, max_x):
            X, Y = x + .5 - ax, y + .5 - ay
            u, v = X * cosine + Y * sine, -X * sine + Y * cosine
            s = u / compression if u <= compression * length else length + u - compression * length
            # Invert the small smooth rotation ramp; outside it the first guess is exact.
            for _ in range(12):
                z = min(1, max(0, s / transition))
                angle = theta * z * z * (3 - 2 * z)
                da = theta * (6 * z - 6 * z * z) / transition if 0 < s < transition else 0
                u = compression * s if s <= length else compression * length + s - length
                du = compression if s <= length else 1
                c, sn = math.cos(angle), math.sin(angle)
                fx, fy = u * c - v * sn - X, u * sn + v * c - Y
                dx, dy = du * c - (u * sn + v * c) * da, du * sn + (u * c - v * sn) * da
                determinant = dx * c + sn * dy
                require(determinant > .01, "rubber transform folds near its connection")
                ds, dv = (fx * c + fy * sn) / determinant, (dx * fy - dy * fx) / determinant
                s, v = s - ds, v - dv
                if abs(ds) + abs(dv) < 1e-7:
                    break
            sx, sy = ax + s - .5, ay + v - .5
            if s < 0 or not (rx - 1 <= sx < rx + rw and ry - 1 <= sy < ry + rh):
                continue
            ix, iy = math.floor(sx), math.floor(sy)
            dx, dy = sx - ix, sy - iy
            weights = ((ix, iy, (1 - dx) * (1 - dy)), (ix + 1, iy, dx * (1 - dy)), (ix, iy + 1, (1 - dx) * dy), (ix + 1, iy + 1, dx * dy))
            samples = [(moving_pixels[nx, ny], weight) for nx, ny, weight in weights if 0 <= nx < width and 0 <= ny < height]
            alpha = sum(rgba[3] * weight for rgba, weight in samples)
            if alpha < .5:
                continue
            require(not any(px <= x < px + pw and py <= y < py + ph for px, py, pw, ph in protected), "rubber transformed artwork overlaps protected body")
            dest = output[x, y]
            total = alpha + dest[3] * (1 - alpha / 255)
            rgb = [round((sum(rgba[i] * rgba[3] * weight for rgba, weight in samples) + dest[i] * dest[3] * (1 - alpha / 255)) / total) for i in range(3)]
            output[x, y] = (*rgb, round(total))
    protected_hashes = []
    for x, y, w, h in protected:
        before = original.crop((x, y, x + w, y + h)).tobytes()
        after = result.crop((x, y, x + w, y + h)).tobytes()
        require(after == before, "rubber protected pixels changed")
        protected_hashes.append({"rect": [x, y, w, h], "beforeSha256": digest(before), "afterSha256": digest(after)})
    transformed = {name: forward(p) if rx <= p[0] < rx + rw and ry <= p[1] < ry + rh else p for name, p in sockets.items()}
    return result, transformed, {"type": "rubber-straight", "parameters": config, "protectedPixelsChanged": 0, "protectedRegionHashes": protected_hashes, "rootUnchanged": list(root), "transformedSockets": {key: list(value) for key, value in transformed.items()}}


def prepare_frame(source: Image.Image, config: dict, scale: float, sources: dict[str, Image.Image] | None = None) -> tuple[Image.Image, dict, dict]:
    patch_stats = None
    if "sourcePatches" in config:
        require("transform" not in config, "sourcePatches cannot be combined with a local geometry transform")
        source, patch_stats = apply_source_patches(source, config["sourcePatches"], sources)
    crop = config.get("crop")
    require(isinstance(crop, list) and len(crop) == 4 and all(integer(n) for n in crop) and crop[2] > 0 and crop[3] > 0, "crop must be [x,y,w,h] integers")
    x, y, width, height = crop
    require(x + width <= source.width and y + height <= source.height, "crop exceeds original bounds")
    root = point(config.get("root"), "root")
    sockets = config.get("sockets")
    require(isinstance(sockets, dict), "sockets must be explicit (empty is allowed)")
    require(all(isinstance(key, str) and NAME.fullmatch(key) for key in sockets), "invalid socket name")
    points = {name: point(value, name) for name, value in sockets.items()}
    image = source.crop((x, y, x + width, y + height))
    transparency = config.get("transparency")
    require(isinstance(transparency, dict), "transparency mode must be explicit")
    require("despillAlphaFeather" not in transparency or transparency.get("mode") == "border-key", "local alpha feather requires border-key transparency")
    stats = {}
    if transparency.get("mode") == "border-key":
        image, stats = remove_border_key(image, transparency)
    else:
        require(transparency.get("mode") == "source-alpha", "unsupported transparency mode")
    if patch_stats is not None:
        stats["sourcePatches"] = patch_stats
    exclusions = config.get("excludeRects", [])
    require(isinstance(exclusions, list), "excludeRects must be an explicit list")
    for exclusion in exclusions:
        ex, ey, ew, eh = rectangle(exclusion, width, height, "neighbor exclusion")
        image.paste((0, 0, 0, 0), (ex, ey, ex + ew, ey + eh))
    if "transform" in config:
        image, points, transform_stats = apply_frame_transform(image, config["transform"], root, points)
        stats["transform"] = transform_stats
    low, high = image.getchannel("A").getextrema()
    require(high > 0 and low < 255, "frame must contain both visible art and transparent pixels; no opaque/empty stand-ins")
    # A magma extension may add transparent room; never squeeze that canvas back to the source crop.
    size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
    if image.size != size:
        # Pillow's premultiplied RGBA resize avoids dark halos from transparent RGB.
        image = image.resize(size, Image.Resampling.LANCZOS)
    geometry = {"size": {"width": size[0], "height": size[1]}, "root": {"x": root[0] * scale, "y": root[1] * scale}, "sockets": {name: {"x": p[0] * scale, "y": p[1] * scale} for name, p in points.items()}}
    return image, geometry, stats


def split_foreground(image: Image.Image, config: dict) -> tuple[Image.Image, Image.Image, dict]:
    """Partition already-resampled pixels with an explicit nearest-neighbor source mask."""
    require("transform" not in config, "foreground polygon cannot be combined with a geometric frame transform")
    polygon, note = config.get("foregroundPolygon"), config.get("foregroundNote")
    require(isinstance(note, str) and bool(note.strip()), "foregroundNote must document the inspected source-pixel selection")
    require(isinstance(polygon, list) and 3 <= len(polygon) <= 64, "foregroundPolygon must contain 3..64 crop-local vertices")
    width, height = config["crop"][2:]
    vertices = [point(vertex, "foreground vertex") for vertex in polygon]
    require(all(0 <= x <= width and 0 <= y <= height for x, y in vertices), "foreground polygon lies outside source crop")
    mask = Image.new("L", (width, height))
    ImageDraw.Draw(mask).polygon(vertices, fill=255)
    if mask.size != image.size:
        mask = mask.resize(image.size, Image.Resampling.NEAREST)
    alpha = image.getchannel("A")
    foreground, body = image.copy(), image.copy()
    foreground.putalpha(ImageChops.multiply(alpha, mask))
    body.putalpha(ImageChops.multiply(alpha, ImageChops.invert(mask)))
    require(foreground.getchannel("A").getextrema()[1] > 0 and body.getchannel("A").getextrema()[1] > 0, "foreground must select visible artwork while retaining a visible body")
    combined = Image.alpha_composite(body, foreground)
    require(combined.tobytes() == image.tobytes(), "foreground partition changed original prepared pixels")
    visible = lambda layer: sum(layer.getchannel("A").histogram()[1:])
    return body, foreground, {"method": "whole-frame-resample-then-nearest-source-mask", "polygon": polygon, "note": note, "bodyVisiblePixels": visible(body), "foregroundVisiblePixels": visible(foreground), "preparedRgbaSha256": digest(image.tobytes()), "recombinedRgbaSha256": digest(combined.tobytes())}


def pack_frames(images: dict[str, Image.Image], maximum: int) -> tuple[Image.Image, dict[str, tuple[int, int]]]:
    require(integer(maximum, 64) and maximum <= 4096 and maximum & (maximum - 1) == 0, "maxTextureSize must be a power of two between 64 and 4096")
    require(bool(images), "no frames to pack")
    ordered = sorted(images, key=lambda name: (-images[name].height, -images[name].width, name))
    require(all(image.width + 4 <= maximum and image.height + 4 <= maximum for image in images.values()), "a frame exceeds maxTextureSize including padding")
    minimum = max(max(image.width + 4 for image in images.values()), math.ceil(math.sqrt(sum((im.width + 4) * (im.height + 4) for im in images.values()))))
    width = min(maximum, 1 << max(0, minimum - 1).bit_length())
    while True:
        positions, x, y, row = {}, 2, 2, 0
        for name in ordered:
            image = images[name]
            if x + image.width + 2 > width:
                x, y, row = 2, y + row + 4, 0
            positions[name] = (x, y)
            x += image.width + 4
            row = max(row, image.height)
        height = 1 << max(0, y + row + 1).bit_length()
        if height <= maximum:
            break
        require(width < maximum, "atlas exceeds maxTextureSize; split approved content explicitly rather than growing unbounded")
        width = min(maximum, width * 2)
    atlas = Image.new("RGBA", (width, height))
    for name, xy in positions.items():
        atlas.alpha_composite(images[name], xy)
    return atlas, positions


def pack_action_pages(images: dict[str, Image.Image], anims: dict, maximum: int, foregrounds: dict[str, str] | None = None, page_break_before: list[str] | None = None) -> tuple[list[tuple[Image.Image, dict]], dict[str, int]]:
    """Keep each action's newly encountered crops together; shared crops are stored once.

    A single action too large for one page is an explicit authoring error. Paging
    must not quietly resize the drawings or duplicate them to claim coverage.
    Explicit breaks flush before an action's new crops, leaving shared crops in
    their original pages. Omitted breaks preserve the existing packing order.
    """
    require(page_break_before is None or isinstance(page_break_before, list), "pageBreakBefore must be a list of action names")
    requested_breaks = [] if page_break_before is None else page_break_before
    require(all(isinstance(action, str) and bool(NAME.fullmatch(action)) for action in requested_breaks), "pageBreakBefore must contain valid action names")
    require(len(set(requested_breaks)) == len(requested_breaks), "pageBreakBefore action names must be unique")
    require(all(action in anims for action in requested_breaks), "pageBreakBefore references an unknown action")
    breaks = set(requested_breaks)
    pages, frame_pages, current = [], {}, {}

    def flush() -> None:
        nonlocal current
        if not current:
            return
        index = len(pages)
        pages.append(pack_frames(current, maximum))
        frame_pages.update({name: index for name in current})
        current = {}

    for action, anim in anims.items():
        mapping = anim.get("frames") if isinstance(anim, dict) else None
        require(isinstance(mapping, list) and bool(mapping) and all(isinstance(frame, str) and frame in images for frame in mapping), f"{action}: every frame must name an explicit crop")
        mapping = [part for frame in mapping for part in ([frame, foregrounds[frame]] if foregrounds and frame in foregrounds else [frame])]
        added = {name: images[name] for name in mapping if name not in frame_pages and name not in current}
        if action in breaks:
            require(bool(added), f"{action}: pageBreakBefore requires at least one newly encountered crop")
            flush()
        if not added:
            continue
        try:
            pack_frames({**current, **added}, maximum)
        except ValueError:
            flush()
            try:
                pack_frames(added, maximum)
            except ValueError as error:
                raise ValueError(f"{action}: action group exceeds maxTextureSize; explicitly revise the action grouping or source geometry") from error
        current.update(added)
    flush()
    require(set(frame_pages) == set(images), "unmapped crops present; remove them from candidate config or map them explicitly")
    return pages, frame_pages


def exposures(value: object, count: int, label: str) -> list[dict]:
    require(isinstance(value, list) and bool(value), f"{label}: explicit exposures required")
    for entry in value:
        require(isinstance(entry, dict) and integer(entry.get("frame")) and entry["frame"] < count and integer(entry.get("ticks"), 1), f"{label}: invalid frame/ticks")
    return [{"frame": entry["frame"], "ticks": entry["ticks"]} for entry in value]


def airborne_phases(value: object, count: int, label: str) -> dict:
    require(label in ("jump_neutral", "jump_fwd", "jump_back") and isinstance(value, dict), f"{label}: airborne phases only describe jump states")
    valid_frame = lambda index: integer(index) and index < count
    require(valid_frame(value.get("rising")) and valid_frame(value.get("falling")) and value["rising"] != value["falling"], f"{label}: invalid rising/falling poses")
    result = {"rising": value["rising"], "falling": value["falling"]}
    if "apex" in value:
        apex = value["apex"]
        require(isinstance(apex, dict) and valid_frame(apex.get("frame")) and apex["frame"] not in (value["rising"], value["falling"]) and number(apex.get("maxSpeed")) and apex["maxSpeed"] >= 0, f"{label}: invalid apex pose/speed")
        result["apex"] = {"frame": apex["frame"], "maxSpeed": apex["maxSpeed"]}
    return result


def build_character(character: str, config: dict, manifest_hash: str) -> tuple[dict[str, bytes], dict]:
    require(bool(NAME.fullmatch(character)) and isinstance(config, dict), "invalid character config")
    scale = config.get("scale")
    require(number(scale) and 0 < scale <= 4, "scale must be one character-wide value in (0,4]")
    density = config.get("textureDensity", 1)
    require(number(density) and 0 < density <= 4, "textureDensity must be in (0,4]")
    sources = load_sources(config.get("sources"))
    frames = config.get("frames")
    require(isinstance(frames, dict) and bool(frames), "frames must contain explicit crops")
    images, geometry, stats, foregrounds = {}, {}, {}, {}
    for name, frame in frames.items():
        require(bool(NAME.fullmatch(name)) and isinstance(frame, dict), "invalid frame config")
        require(frame.get("source") in sources, f"{name}: unknown source")
        transparency = frame.get("transparency", {})
        if isinstance(transparency, dict) and (transparency.get("despillRegions") or "despillAlphaFeather" in transparency):
            require(transparency.get("despillSourceSha256") == config["sources"][frame["source"]].get("sha256"), f"{name}: local despill source SHA256 mismatch")
        source_scale = config["sources"][frame["source"]].get("unitScale", 1)
        images[name], geometry[name], stats[name] = prepare_frame(sources[frame["source"]], frame, scale * source_scale * density, sources)
        if "sourcePatches" in stats[name]:
            patch_report = stats[name]["sourcePatches"]
            patch_report["originalSource"] = frame["source"]
            patch_report["originalSourceSha256"] = config["sources"][frame["source"]]["sha256"]
            for patch in patch_report["patches"]:
                patch["sourceSha256"] = config["sources"][patch["source"]]["sha256"]
        if "foregroundPolygon" in frame:
            layer = name + "/foreground"
            images[name], images[layer], stats[name]["foreground"] = split_foreground(images[name], frame)
            geometry[layer] = geometry[name]
            foregrounds[name] = layer
    anims = config.get("anims")
    require(isinstance(anims, dict) and bool(anims), "anims must contain explicitly mapped actions")
    page_break_before = config.get("pageBreakBefore", [])
    require(isinstance(page_break_before, list), "pageBreakBefore must be a list of action names")
    pages, frame_pages = pack_action_pages(images, anims, config.get("maxTextureSize"), foregrounds, page_break_before)
    runtime = {"schemaVersion": 2, "characterId": character, "style": "anime", "continuous": True, "textureDensity": density, "atlas": {"image": "atlas.png", "data": "atlas.json"}, "pages": [], "framePages": {}, "anims": {}, "attachments": {}}
    atlas_frames, used = [{} for _ in pages], set()
    for name, anim in anims.items():
        require(bool(NAME.fullmatch(name)) and isinstance(anim, dict), "invalid animation config")
        mapping = anim.get("frames")
        require(isinstance(mapping, list) and bool(mapping) and all(isinstance(frame, str) and frame in images for frame in mapping), f"{name}: every frame must name an explicit crop")
        require(isinstance(anim.get("loop"), bool), f"{name}: loop must be boolean")
        runtime_anim = {"frames": len(mapping), "fps": 60, "loop": anim["loop"], "pixelArt": False, "exposures": exposures(anim.get("exposures"), len(mapping), name)}
        if "throwExposures" in anim:
            runtime_anim["throwExposures"] = exposures(anim["throwExposures"], len(mapping), name + "/throw")
        if "airbornePhases" in anim:
            runtime_anim["airbornePhases"] = airborne_phases(anim["airbornePhases"], len(mapping), name)
        runtime["anims"][name] = runtime_anim
        for index, frame in enumerate(mapping):
            used.add(frame)
            key = f"{character}/{name}/{index}"
            parts = [(key, frame)]
            if frame in foregrounds:
                foreground_key = key + "/foreground"
                runtime.setdefault("foregroundFrames", {})[key] = foreground_key
                parts.append((foreground_key, foregrounds[frame]))
            for part_key, part in parts:
                page_index = frame_pages[part]
                image, location, geom = images[part], pages[page_index][1][part], geometry[part]
                atlas_frames[page_index][part_key] = {"frame": {"x": location[0], "y": location[1], "w": image.width, "h": image.height}, "rotated": False, "trimmed": False, "spriteSourceSize": {"x": 0, "y": 0, "w": image.width, "h": image.height}, "sourceSize": {"w": image.width, "h": image.height}, "pivot": {"x": geom["root"]["x"] / image.width, "y": geom["root"]["y"] / image.height}}
                runtime["framePages"][part_key] = f"p{page_index}"
                runtime["attachments"][part_key] = geom
    require(used == set(frames), "unmapped crops present; remove them from candidate config or map them explicitly")
    encode = lambda value: (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    outputs, page_reports = {}, []
    for index, (atlas, _) in enumerate(pages):
        page_id = f"p{index}"
        stem = "atlas" if index == 0 else f"atlas-{page_id}"
        page = {"id": page_id, "image": stem + ".png", "data": stem + ".json", "width": atlas.width, "height": atlas.height}
        runtime["pages"].append(page)
        metadata = {"image": page["image"], "size": {"w": atlas.width, "h": atlas.height}, "scale": "1", "style": "anime", "pixelArt": False, "textureDensity": density, "page": page_id, "capabilities": {"continuous": True}, "manifestSha256": manifest_hash}
        png = io.BytesIO()
        atlas.save(png, format="PNG")
        outputs[page["image"]] = png.getvalue()
        outputs[page["data"]] = encode({"frames": atlas_frames[index], "meta": metadata})
        page_reports.append({**page, "uncompressedRgbaBytes": atlas.width * atlas.height * 4, "mappedFrames": len(atlas_frames[index])})
    outputs["runtime.json"] = encode(runtime)
    report = {"character": character, "status": "validated-candidate-not-art-acceptance", "uniformScale": scale, "textureDensity": density, "sourceUnitScales": {key: source.get("unitScale", 1) for key, source in config["sources"].items()}, "textureSize": list(pages[0][0].size) if len(pages) == 1 else None, "pages": page_reports, "uncompressedRgbaBytes": sum(page["uncompressedRgbaBytes"] for page in page_reports), "uniqueCrops": len(frames), "foregroundCrops": len(foregrounds), "mappedFrames": sum(len(anim["frames"]) for anim in anims.values()), "mappedForegroundFrames": len(runtime.get("foregroundFrames", {})), "animations": list(anims), "transparency": stats, "sourceHashes": {key: source["sha256"] for key, source in config["sources"].items()}, "outputHashes": {name: digest(content) for name, content in outputs.items()}}
    outputs["build-report.json"] = encode(report)
    return outputs, report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("characters", nargs="*")
    parser.add_argument("--manifest", type=Path, default=MANIFEST)
    parser.add_argument("--check", action="store_true", help="Validate and assemble in memory; do not write assets")
    parser.add_argument("--replace", action="store_true", help="Back up existing candidate files before replacement; never touches legacy assets")
    args = parser.parse_args()
    raw = args.manifest.read_bytes()
    manifest = json.loads(raw)
    require(manifest.get("schemaVersion") == 1 and isinstance(manifest.get("characters"), dict), "unsupported manifest schema")
    configured = manifest["characters"]
    selected = args.characters or list(configured)
    if not selected:
        print(json.dumps({"status": "no-assets", "message": "No recorded Image 2.5 character candidates configured; nothing was built."}))
        return
    assembled = []
    for character in selected:
        require(character in configured, f"{character}: no explicit candidate; refusing source discovery")
        assembled.append((character, *build_character(character, configured[character], digest(raw))))
    # All selected characters must validate before any output can change.
    for character, outputs, report in assembled:
        destination = ROOT / "public/assets/characters" / character / "anime"
        require(destination.resolve().is_relative_to((ROOT / "public/assets/characters").resolve()), "unsafe candidate destination")
        existing = [destination / name for name in outputs if (destination / name).exists()]
        if existing and not args.check:
            require(args.replace, f"{character}: candidate files exist; use --replace to preserve a backup before replacement")
    for character, outputs, report in assembled:
        if not args.check:
            destination = ROOT / "public/assets/characters" / character / "anime"
            existing = sorted(path for path in destination.iterdir() if path.is_file()) if destination.exists() else []
            if existing:
                backup = ROOT / ".local-releases" / ("anime-backup-" + character + "-" + datetime.now().strftime("%m%d-%H%M%S-%f"))
                backup.mkdir(parents=True, exist_ok=False)
                inventory = [{"file": path.name, "bytes": path.stat().st_size, "sha256": digest(path.read_bytes())} for path in existing]
                (backup / "backup-inventory.json").write_text(json.dumps(inventory, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                for path in existing:
                    shutil.copy2(path, backup / path.name)
                    require(digest(path.read_bytes()) == digest((backup / path.name).read_bytes()), "backup verification failed")
                report["backup"] = str(backup)
            destination.mkdir(parents=True, exist_ok=True)
            for name, content in outputs.items():
                (destination / name).write_bytes(content)
        print(json.dumps({**report, "checkOnly": args.check}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, TypeError, KeyError) as error:
        raise SystemExit(str(error)) from error
