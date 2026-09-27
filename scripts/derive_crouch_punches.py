"""Reproduce the reviewed crouching jabs using only original body/arm pixels."""
from pathlib import Path
import hashlib
import json

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUTPUT_HASHES = {
    "luffy": "0f44ccf829120aca00aa9271ae174f6316f09bcfc0ecb068689c0c7b2fe6f139",
    "akainu": "3b7230492e44126443d5dcba3bad622c93a6794f16d9cb7872cced2af463fccd",
}


def part(image, polygon):
    mask = Image.new("L", image.size)
    ImageDraw.Draw(mask).polygon(polygon, fill=255)
    result = image.copy()
    result.putalpha(Image.composite(image.getchannel("A"), Image.new("L", image.size), mask))
    return result


def put(output, limb, joint, target, angle):
    layer = Image.new("RGBA", (256, 256))
    layer.alpha_composite(limb, (128 - joint[0], 128 - joint[1]))
    layer = layer.rotate(angle, Image.Resampling.NEAREST, center=(128, 128))
    output.alpha_composite(layer, (target[0] - 128, target[1] - 128))


def derive(source_path: Path, output_path: Path, character_id: str):
    source = Image.open(source_path).convert("RGBA")
    output = Image.new("RGBA", (90, 80))
    if character_id == "luffy":
        body = source.crop((36, 5348, 78, 5403))
        output.alpha_composite(body)
        ImageDraw.Draw(output).polygon([(26,20),(30,22),(34,23),(39,22),(42,25),(43,29),(37,30),(32,28),(28,27)], fill=(0,0,0,0))
        polygon = [(35,15),(39,15),(42,14),(50,14),(51,15),(57,15),(58,14),(65,14),(66,18),(64,21),(58,21),(56,19),(49,19),(48,20),(39,19),(35,18)]
        limb = part(source.crop((154, 93, 220, 147)), polygon)
        joint, target, angle = [37,17], [27,23], 0
    elif character_id == "akainu":
        body = source.crop((778, 43, 830, 94))
        output.alpha_composite(body)
        ImageDraw.Draw(output).polygon([(29,26),(33,28),(31,32),(32,36),(34,40),(38,43),(38,47),(32,46),(30,43),(28,39),(28,35),(27,31),(27,28)], fill=(0,0,0,0))
        # Restore only the original inner-coat pixels behind the moved forearm.
        mask = Image.new("L", output.size)
        ImageDraw.Draw(mask).polygon([(29,32),(31,32),(32,36),(34,40),(37,43),(37,46),(32,45),(30,42),(28,38)], fill=255)
        patch = body.crop((33,32,35,35))
        coat = Image.new("RGBA", output.size)
        for x in range(27,39,2):
            for y in range(30,48,3):
                coat.alpha_composite(patch, (x,y))
        coat.putalpha(mask)
        output.alpha_composite(coat)
        polygon = [(47,32),(51,33),(55,35),(59,37),(62,38),(66,38),(67,40),(67,44),(62,44),(60,42),(55,41),(51,39),(48,37)]
        limb = part(source.crop((478,117,545,181)), polygon)
        joint, target, angle = [49,35], [33,23], 35
    else:
        raise ValueError(f"No reviewed crouching jab for {character_id}")
    put(output, limb, joint, target, angle)
    bounds = output.getbbox()
    if bounds is None:
        raise ValueError(f"Empty derived crouching jab for {character_id}")
    output.crop(bounds).save(output_path)
    digest = hashlib.sha256(output_path.read_bytes()).hexdigest()
    if digest != OUTPUT_HASHES[character_id]:
        raise ValueError(f"{character_id}: derived crouching jab differs from the reviewed output")
    print(f"{character_id}: reproduced reviewed crouching jab {output_path.name}")


def main():
    manifest = json.loads((ROOT / "scripts/sprite_manifest.json").read_text(encoding="utf-8"))
    for character_id in OUTPUT_HASHES:
        config = manifest["characters"][character_id]
        source_path = ROOT / config["source"]["path"]
        if not source_path.is_file():
            print(f"{character_id}: original source absent; retained derived crouching jab")
            continue
        if hashlib.sha256(source_path.read_bytes()).hexdigest() != config["source"]["sha256"]:
            raise ValueError(f"{character_id}: unreviewed source; crouching jab derivation stopped")
        derive(source_path, source_path.with_name("source-derived-jab.png"), character_id)


if __name__ == "__main__":
    main()
