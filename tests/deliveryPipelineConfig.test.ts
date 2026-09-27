import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { menuPreloadFiles } from '../scripts/menuPreload';

const python = process.env.OPF_PYTHON ?? 'python';
const sha = (value: string): string => createHash('sha256').update(value).digest('hex');

function invoke(script: string, ...args: string[]): unknown {
  const code = [
    'import json,sys',
    `sys.path.insert(0, ${JSON.stringify(resolve('scripts'))})`,
    'import build_delivery_assets as delivery',
    script,
  ].join('\n');
  return JSON.parse(execFileSync(python, ['-c', code, ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })) as unknown;
}

function manifest(path: string, characters: string[]): void {
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, characters: Object.fromEntries(characters.map(id => [id, {}])) }));
}

describe('delivery pipeline explicit four-character plan', () => {
  it('maps each character to its author manifest and explicit old/new FX layout', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'opf-delivery-plan-'));
    const legacy = resolve(root, 'legacy.json'), crossover = resolve(root, 'crossover.json'), ui = resolve(root, 'ui.json');
    manifest(legacy, ['luffy', 'akainu']); manifest(crossover, ['labubu', 'twinkle']);
    writeFileSync(ui, JSON.stringify({ characters: Object.fromEntries(['luffy', 'akainu', 'labubu', 'twinkle'].map(id => [id, { image: `${id}.png`, sha256: 'a'.repeat(64) }])) }));
    const result = invoke(
      'plan,receipts=delivery.resolve_build_plan(["luffy","akainu","labubu","twinkle"],sys.argv[1:3],sys.argv[3]); print(json.dumps({"plan":[{"id":x["id"],"manifest":x["manifest"]["path"].name,"fx":x["fx"]} for x in plan],"receipts":receipts}))',
      legacy, crossover, ui,
    ) as { plan: Array<{ id: string; manifest: string; fx: string[] }>; receipts: Array<{ characters: string[] }> };
    expect(result.plan).toEqual([
      { id: 'luffy', manifest: 'legacy.json', fx: ['assets/fx/luffy.png', 'assets/fx/luffy.json'] },
      { id: 'akainu', manifest: 'legacy.json', fx: ['assets/fx/akainu.png', 'assets/fx/akainu.json'] },
      { id: 'labubu', manifest: 'crossover.json', fx: ['assets/fx/labubu/atlas.png', 'assets/fx/labubu/atlas.json'] },
      { id: 'twinkle', manifest: 'crossover.json', fx: ['assets/fx/twinkle/atlas.png', 'assets/fx/twinkle/atlas.json'] },
    ]);
    expect(result.receipts.map(item => item.characters)).toEqual([['akainu', 'luffy'], ['labubu', 'twinkle']]);
  });

  it('rejects disabled UI before reading any runtime master', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'opf-delivery-disabled-'));
    const author = resolve(root, 'author.json'), ui = resolve(root, 'ui.json');
    manifest(author, ['labubu']);
    writeFileSync(ui, JSON.stringify({ characters: { labubu: { image: 'labubu.png', sha256: 'a'.repeat(64), enabled: false, reviewStatus: 'blocked-review' } } }));
    expect(() => invoke('delivery.resolve_build_plan(["labubu"],[sys.argv[1]],sys.argv[2])', author, ui))
      .toThrow('Disabled character art cannot be encoded: labubu (blocked-review)');
  });

  it('separates every selected character audio bank without path-name guessing', () => {
    const result = invoke('print(json.dumps(delivery.audio_banks(json.loads(sys.argv[1]),["luffy","labubu"])))', JSON.stringify({
      common: { files: ['common.wav'] },
      luffy: { characterId: 'luffy', files: ['luffy.wav'] },
      labubu: { characterId: 'labubu', files: ['labubu.wav'] },
      twinkle: { characterId: 'twinkle', files: ['twinkle.wav'] },
    })) as Record<string, string[]>;
    expect(result).toEqual({ effects: ['common.wav'], 'character-labubu': ['labubu.wav'], 'character-luffy': ['luffy.wav'] });
  });

  it('keeps selection responses in the small menu bank even when combat reuses the same clip', () => {
    const result = invoke('print(json.dumps(delivery.audio_banks(json.loads(sys.argv[1]),["luffy","labubu"])))', JSON.stringify({
      'menu_confirm': { files: ['confirm.wav'] },
      'voice.luffy.select': { characterId: 'luffy', files: ['response.wav'] },
      'voice.luffy.attack': { characterId: 'luffy', files: ['response.wav', 'battle.wav'] },
      'voice.labubu.select': { characterId: 'labubu', files: ['labubu-select.wav'] },
      'voice.twinkle.select': { characterId: 'twinkle', files: ['excluded.wav'] },
    })) as Record<string, string[]>;
    expect(result).toEqual({ menu: ['confirm.wav', 'labubu-select.wav', 'response.wav'], 'character-luffy': ['battle.wav'] });
  });

  it('preloads reviewed menu art and the preview bank without unselected fighter payloads', () => {
    expect(menuPreloadFiles({
      'assets/stages/marineford/backdrop.webp': { file: 'backdrop.webp' },
      'portrait-a.png': { file: 'portrait.webp' },
      'portrait-alias.png': { file: 'portrait.webp' },
      'fighter-atlas.png': { file: 'large-atlas.webp' },
      'fighter-voice.wav': { file: 'large-bank.bin' },
      'select-a.wav': { file: 'small-menu.bin' },
      'select-b.wav': { file: 'small-menu.bin' },
    }, {
      labubu: { image: 'portrait-a.png' }, twinkle: { image: 'portrait-alias.png' },
      luffy: { image: 'old-portrait-not-needed-on-title.png' },
      rejected: { image: 'do-not-request.png', enabled: false },
    }, ['select-a.wav', 'select-b.wav'])).toEqual(['backdrop.webp', 'portrait.webp', 'small-menu.bin']);
    expect(() => menuPreloadFiles({}, { labubu: { image: 'a.png' }, twinkle: { image: 'b.png' } })).toThrow('Missing menu preload asset');
    expect(() => menuPreloadFiles({}, { labubu: { image: 'a.png', enabled: false }, twinkle: { image: 'b.png' } })).toThrow('Title art is unavailable');
  });

  it('derives the content-addressed name in check mode without writing a delivery file', () => {
    const result = invoke('p=delivery.immutable_file("check-only-fixture","bin",b"never-write",False); print(json.dumps({"file":p,"exists":(delivery.PUBLIC/p).exists()}))') as { file: string; exists: boolean };
    expect(result.file).toMatch(/^assets\/delivery\/check-only-fixture-[a-f0-9]{20}\.bin$/);
    expect(result.exists).toBe(false);
  });

  it('encodes AVIF with actual sample-exact alpha and unchanged dimensions', () => {
    const result = invoke([
      'import io',
      'from PIL import Image',
      'im=Image.new("RGBA",(16,16)); im.putdata([(70,130,210,a) for a in range(256)])',
      'data,checks=delivery.encode_avif_image(im,65)',
      'decoded=Image.open(io.BytesIO(data)).convert("RGBA")',
      'print(json.dumps({"checks":checks,"alpha":list(decoded.getchannel("A").getdata())}))',
    ].join('\n')) as { checks: { exactAlpha: boolean; size: number[] }; alpha: number[] };
    expect(result.checks).toMatchObject({ exactAlpha: true, size: [16, 16] });
    expect(result.alpha).toEqual(Array.from({ length: 256 }, (_, i) => i));
    expect(() => invoke('delivery.encode_avif_image(None,60)')).toThrow('Reviewed AVIF candidate quality');
  });

  it('verifies a resolved manifest against its custom, catalog and generator receipts', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'opf-resolved-provenance-'));
    const custom = '{"kind":"custom"}', catalog = '{"sources":{}}', generator = 'print("builder")';
    writeFileSync(resolve(root, 'custom.json'), custom); writeFileSync(resolve(root, 'catalog.json'), catalog); writeFileSync(resolve(root, 'builder.py'), generator);
    const resolved = resolve(root, 'crossover.resolved.json');
    writeFileSync(resolved, JSON.stringify({
      schemaVersion: 1, characters: { labubu: {} },
      sourceManifest: { file: 'custom.json', sha256: sha(custom) },
      sourceCatalog: { file: 'catalog.json', sha256: sha(catalog) },
      generator: { file: 'builder.py', sha256: sha(generator) },
    }));
    const verified = invoke('owners,receipts=delivery.load_authoring_ownership([sys.argv[1]],sys.argv[2]); print(json.dumps(receipts))', resolved, root) as Array<{ characters: string[]; provenance: Record<string, { file: string }> }>;
    expect(verified[0]).toMatchObject({ characters: ['labubu'], provenance: {
      sourceManifest: { file: 'custom.json' }, sourceCatalog: { file: 'catalog.json' }, generator: { file: 'builder.py' },
    } });
    writeFileSync(resolve(root, 'custom.json'), '{"kind":"changed"}');
    expect(() => invoke('delivery.load_authoring_ownership([sys.argv[1]],sys.argv[2])', resolved, root)).toThrow('sourceManifest receipt mismatch: custom.json');
  });
});
