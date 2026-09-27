import { describe, expect, it, vi } from 'vitest';
import { Btn, FightSim, px, totalFrames, type FighterDef } from '../../src/core';
import { akainuDef, luffyDef } from '../../src/characters';
import type { AnimeRuntimeManifest } from '../../src/render/animations';
import type { AnimeCharacterAssets } from '../../src/render/assets';
import { AnimeSampleController, sampleCapabilities } from '../../src/render/anime/sampleMode';

// The selector is pure; only the containing scene's base class needs a stand-in in Node.
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import { resolveAnimeSample } from '../../src/render/scenes/FightScene';

const BASE = ['idle', 'walk_fwd', 'walk_back', 'crouch', 'block_stand', 'block_crouch', 'hit_stand', 'hit_crouch'];
function runtime(def: FighterDef, states = BASE, ability = false): AnimeRuntimeManifest {
  const value: AnimeRuntimeManifest = {
    schemaVersion: 1, characterId: def.id, style: 'anime', continuous: true,
    atlas: { image: 'atlas.png', data: 'atlas.json' }, anims: {}, attachments: {},
  };
  const names = [...states, 'st_a', ...(def.id === 'luffy' ? ['st_c'] : ability ? ['sp_daifunka'] : [])];
  for (const name of names) {
    const move = def.moves.find(move => move.id === name);
    value.anims[name] = { frames: 1, fps: 60, pixelArt: false, loop: !move, exposures: [{ frame: 0, ticks: move ? totalFrames(move) : 8 }] };
    value.attachments[`${def.id}/${name}/0`] = { size: { width: 40, height: 80 }, root: { x: 20, y: 80 }, sockets: {} };
  }
  return value;
}
const assets = (luffy = runtime(luffyDef), akainu = runtime(akainuDef)): AnimeCharacterAssets => ({
  luffy: { key: 'luffy-anime', runtime: luffy }, akainu: { key: 'akainu-anime', runtime: akainu },
});

describe('candidate pair selection', () => {
  it('missing/idle-only candidates block battle creation without choosing old art', () => {
    const art = assets();
    art.luffy!.runtime.anims = { idle: art.luffy!.runtime.anims.idle! };
    const selected = resolveAnimeSample([luffyDef, akainuDef], art, () => true);
    expect(selected.art).toEqual([null, null]);
    expect(selected.issues.join(' ')).toContain('st_c');
    expect(selected.fighters).toBeNull();
    const absent = resolveAnimeSample([luffyDef, akainuDef], {}, () => true, { luffy: '尚未生成' });
    expect(absent.issues.join(' ')).toContain('尚未生成');
    expect(absent.art).toEqual([null, null]);
  });

  it('both candidates must have actual atlas frames, including defensive and hurt states', () => {
    const selected = resolveAnimeSample([luffyDef, akainuDef], assets(), (key, name) => !(key === 'akainu-anime' && name === 'akainu/block_crouch/0'));
    expect(selected.art).toEqual([null, null]);
    expect(selected.issues.join(' ')).toContain('block_crouch/0');
  });

  it('complete basic artwork can open while the optional launcher waits for reaction drawings', () => {
    const art = assets(runtime(luffyDef), runtime(akainuDef, BASE, true));
    const selected = resolveAnimeSample([luffyDef, akainuDef], art, () => true);
    expect(selected.issues).toEqual([]);
    expect(selected.art).toEqual([art.luffy, art.akainu]);
    expect(selected.fighters![1].moves.map(move => move.id)).toEqual(['st_a']);
    expect(selected.abilityIssues.join(' ')).toContain('hit_air');
    expect(selected.abilityIssues.join(' ')).toContain('knockdown');
    expect(selected.abilityIssues.join(' ')).toContain('getup');
  });

  it('launcher opens only after the opposing reaction chain is covered, preserving original combat data', () => {
    const before = JSON.stringify([luffyDef, akainuDef]);
    const art = assets(runtime(luffyDef, [...BASE, 'hit_air', 'knockdown', 'getup']), runtime(akainuDef, BASE, true));
    const selected = resolveAnimeSample([luffyDef, akainuDef], art, () => true);
    expect(selected.issues).toEqual([]);
    expect(selected.abilityIssues).toEqual([]);
    expect(selected.fighters![1].moves.map(move => move.id)).toEqual(['sp_daifunka', 'st_a']);
    for (const [index, original] of [luffyDef, akainuDef].entries()) {
      for (const move of selected.fighters![index]!.moves) expect(move).toBe(original.moves.find(source => source.id === move.id));
    }
    expect(JSON.stringify([luffyDef, akainuDef])).toBe(before);
  });

  it('checks incoming launch coverage for swapped sides and matching-character pairs', () => {
    const art = assets(runtime(luffyDef, [...BASE, 'hit_air', 'knockdown', 'getup']), runtime(akainuDef, BASE, true));
    const swapped = resolveAnimeSample([akainuDef, luffyDef], art, () => true);
    expect(swapped.fighters![0].moves.map(move => move.id)).toContain('sp_daifunka');
    const mirrored = resolveAnimeSample([akainuDef, akainuDef], art, () => true);
    expect(mirrored.art.every(Boolean)).toBe(true);
    expect(mirrored.fighters!.every(def => !def.moves.some(move => move.id === 'sp_daifunka'))).toBe(true);
    expect(mirrored.abilityIssues).toHaveLength(2);
  });

  it('a newly declared but broken jump resource blocks the sample instead of quietly disabling it', () => {
    const art = assets(runtime(luffyDef, [...BASE, 'jump_neutral']), runtime(akainuDef));
    expect(resolveAnimeSample([luffyDef, akainuDef], art, () => true).fighters).not.toBeNull();
    expect(sampleCapabilities(art.luffy!.runtime).jump).toBe(false);
    const damaged = resolveAnimeSample([luffyDef, akainuDef], art, (_key, frame) => frame !== 'luffy/jump_neutral/0');
    expect(damaged.fighters).toBeNull();
    expect(damaged.issues.join(' ')).toContain('jump_neutral/0');
  });

  it('new throws wait for both tech/reaction chains, then real throw and tech inputs reach only available actions', () => {
    const attacker = runtime(luffyDef, [...BASE, 'throw_fwd', 'throw_tech']);
    const move = luffyDef.moves.find(move => move.id === 'throw_fwd')!;
    attacker.anims.throw_fwd!.throwExposures = [{ frame: 0, ticks: move.throwData!.duration }];
    const defender = runtime(akainuDef, [...BASE, 'thrown', 'hit_air', 'knockdown', 'getup', 'throw_tech']);
    const art = assets(attacker, defender);
    const selected = resolveAnimeSample([luffyDef, akainuDef], art, () => true);
    expect(selected.issues).toEqual([]);
    expect(selected.fighters![0].moves).toContain(move);
    const sim = new FightSim({ p1: selected.fighters![0], p2: selected.fighters![1], introFrames: 0, roundTime: -1 });
    const controller = new AnimeSampleController(1, [sampleCapabilities(attacker), sampleCapabilities(defender)]);
    controller.mode = 'human';
    sim.state.fighters[0].x = px(-12); sim.state.fighters[1].x = px(12);
    sim.step(controller.input(sim, { p1: Btn.Right | Btn.C, p2: 0 }));
    expect(sim.state.fighters.map(fighter => fighter.state)).toEqual(['throw', 'thrown']);
    const techInput = controller.input(sim, { p1: 0, p2: Btn.C });
    expect(techInput.p2).toBe(Btn.C);
    sim.step(techInput);
    expect(sim.state.fighters.map(fighter => fighter.state)).toEqual(['throw_tech', 'throw_tech']);
    delete defender.anims.throw_tech;
    delete defender.attachments['akainu/throw_tech/0'];
    const pending = resolveAnimeSample([luffyDef, akainuDef], art, () => true);
    expect(pending.fighters![0].moves).not.toContain(move);
    expect(pending.abilityIssues.join(' ')).toContain('throw_tech');
  });
});
