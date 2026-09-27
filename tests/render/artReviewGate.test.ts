import type Phaser from 'phaser';
import { describe, expect, it, vi } from 'vitest';
import type { AssetDownloads } from '../../src/render/assetDownloads';

const delivery = vi.hoisted(() => ({
  version: 'review-gate-fixture',
  records: {
    'assets/characters/luffy/anime/ui.png': {},
    'assets/characters/twinkle/anime/ui.png': {},
  },
}));
vi.mock('../../src/render/deliveryManifest.json', () => ({ default: delivery }));
vi.mock('../../src/render/anime/uiArtManifest.json', () => ({ default: {
  schemaVersion: 1,
  characters: {
    luffy: { image: 'assets/characters/luffy/anime/ui.png' },
    twinkle: { image: 'assets/characters/twinkle/anime/ui.png', enabled: false, reviewStatus: 'blocked-user-shape-correction' },
  },
} }));
vi.mock('phaser', () => ({ default: { Textures: { FilterMode: { LINEAR: 0, NEAREST: 1 } } } }));

import { ANIME_INTERFACES, loadAnimeInterfaces } from '../../src/render/assets';
import { DELIVERY_VERSION } from '../../src/render/assetDownloads';

function fixture() {
  const values = new Map<string, unknown>();
  values.set(ANIME_INTERFACES, {
    // The source fixture intentionally omits optional enabled; its metadata identity is still bound.
    luffy: { key: 'luffy-reviewed-ui', version: DELIVERY_VERSION, sourceIdentity: '[null,null,null,null]' },
    twinkle: { key: 'twinkle-stale-ui', version: DELIVERY_VERSION },
  });
  const exists = vi.fn(() => true);
  const get = vi.fn(() => ({ has: vi.fn(() => true) }));
  const scene = {
    registry: { get: (key: string) => values.get(key), set: (key: string, value: unknown) => values.set(key, value) },
    textures: { exists, get },
  } as unknown as Phaser.Scene;
  const read = vi.fn();
  return { scene, exists, get, downloads: { read } as unknown as AssetDownloads, read };
}

describe('character art review gate', () => {
  it('rejects disabled art before reusing a registered texture or requesting bytes', async () => {
    const current = fixture();
    const result = await loadAnimeInterfaces(current.scene, ['twinkle'], current.downloads);
    expect(result).toEqual({
      ok: false,
      failures: [{ characterId: 'twinkle', code: 'invalid', message: '角色 twinkle 的界面原画正在造型复核，暂不采用' }],
    });
    expect(current.exists).not.toHaveBeenCalled();
    expect(current.get).not.toHaveBeenCalled();
    expect(current.read).not.toHaveBeenCalled();
  });

  it('keeps legacy manifest rows without enabled compatible with the cache fast path', async () => {
    const current = fixture();
    expect(await loadAnimeInterfaces(current.scene, ['luffy'], current.downloads)).toEqual({ ok: true, failures: [] });
    expect(current.exists).toHaveBeenCalledWith('luffy-reviewed-ui');
    expect(current.get).toHaveBeenCalledWith('luffy-reviewed-ui');
    expect(current.read).not.toHaveBeenCalled();
  });
});
