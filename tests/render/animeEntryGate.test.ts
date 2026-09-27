import { describe, expect, it } from 'vitest';
import { totalFrames, type FighterDef } from '../../src/core';
import { akainuDef, labubuDef, luffyDef, twinkleDef } from '../../src/characters';
import { DEFAULT_ANIMS, HELD_LABUBU_THROW, HELD_LEG_FLIP, HELD_TWINKLE_THROW, type AnimeRuntimeManifest, type HeldReactionId } from '../../src/render/animations';
import type { AnimeCharacterAssets } from '../../src/render/assets';
import { evaluateAnimeEntry } from '../../src/render/anime/entryGate';

const profile = { art: 'anime', quality: 'high', scope: 'full' } as const;
function completeRuntime(def: FighterDef): AnimeRuntimeManifest {
  const runtime: AnimeRuntimeManifest = { schemaVersion: 1, characterId: def.id, style: 'anime', continuous: true, atlas: { image: 'atlas.png', data: 'atlas.json' }, anims: {}, attachments: {} };
  for (const name of [...Object.keys(DEFAULT_ANIMS), ...def.moves.map(move => move.id)]) {
    const move = def.moves.find(move => move.id === name);
    runtime.anims[name] = { frames: 1, fps: 60, loop: !move, pixelArt: false, exposures: [{ frame: 0, ticks: move ? totalFrames(move) : 8 }], ...(move?.throwData ? { throwExposures: [{ frame: 0, ticks: move.throwData.duration ?? totalFrames(move) }] } : {}) };
    runtime.attachments[`${def.id}/${name}/0`] = { size: { width: 80, height: 160 }, root: { x: 40, y: 160 }, sockets: {} };
  }
  return runtime;
}
const fixture = (): AnimeCharacterAssets => ({ luffy: { key: 'luffy-new', runtime: completeRuntime(luffyDef) }, akainu: { key: 'akainu-new', runtime: completeRuntime(akainuDef) } });
function addReaction(runtime: AnimeRuntimeManifest, reaction: HeldReactionId, ticks: number): void {
  runtime.anims[reaction] = { frames: 1, fps: 60, loop: false, pixelArt: false, exposures: [{ frame: 0, ticks }] };
  runtime.attachments[`${runtime.characterId}/${reaction}/0`] = { size: { width: 80, height: 160 }, root: { x: 40, y: 160 }, sockets: { grip: { x: 68, y: 134 } } };
}

describe('anime entry before FightSim', () => {
  it('rejects missing assets and declared decode errors without selecting an old fighter', () => {
    const missing = evaluateAnimeEntry(profile, [luffyDef, akainuDef], {}, { luffy: 'decode failed' }, 'cpu');
    expect(missing.ok).toBe(false);
    expect(missing.kind).toBe('load-error');
    expect(missing.issues.join(' ')).toContain('decode failed');
    expect(missing.scope).toBe('full');
  });

  it('requires every move and KO/win/reaction state for complete matches', () => {
    const assets = fixture();
    expect(evaluateAnimeEntry(profile, [luffyDef, akainuDef], assets, {}, 'cpu').ok).toBe(true);
    delete assets.akainu!.runtime.anims.ko;
    delete assets.luffy!.runtime.anims.sp_gatling;
    const gate = evaluateAnimeEntry(profile, [luffyDef, akainuDef], assets, {}, 'cpu');
    expect(gate.kind).toBe('coverage-error');
    expect(gate.issues.join(' ')).toContain('ko');
    expect(gate.issues.join(' ')).toContain('sp_gatling');
    expect(gate.scope).toBe('full');
  });

  it('a sample request can never launch a normal CPU match', () => {
    const gate = evaluateAnimeEntry({ ...profile, scope: 'sample' }, [luffyDef, akainuDef], fixture(), {}, 'cpu');
    expect(gate.ok).toBe(false);
    expect(gate.issues.join(' ')).toContain('只开放训练');
  });

  it('checks throws against connected timelines and leaves combat definitions unchanged', () => {
    const before = JSON.stringify([luffyDef, akainuDef]);
    const assets = fixture();
    const throwMove = luffyDef.moves.find(move => move.throwData)!;
    delete assets.luffy!.runtime.anims[throwMove.id]!.throwExposures;
    expect(evaluateAnimeEntry(profile, [luffyDef, akainuDef], assets, {}, 'versus').ok).toBe(false);
    expect(JSON.stringify([luffyDef, akainuDef])).toBe(before);
  });

  it.each([0, 1] as const)('requires only the actual LABUBU opponent reaction before a full match (LABUBU side %s)', side => {
    const pair = side === 0 ? [labubuDef, twinkleDef] as const : [twinkleDef, labubuDef] as const;
    const assets: AnimeCharacterAssets = { labubu: { key: 'labubu-new', runtime: completeRuntime(labubuDef) },
      twinkle: { key: 'twinkle-new', runtime: completeRuntime(twinkleDef) } };
    // Ordinary reactions are present here so this original test still isolates the special throw gate.
    addReaction(assets.twinkle!.runtime, HELD_LABUBU_THROW, 22);
    addReaction(assets.labubu!.runtime, HELD_TWINKLE_THROW, 23);
    const blocked = evaluateAnimeEntry(profile, pair, assets, {}, 'versus');
    expect(blocked.kind).toBe('coverage-error');
    expect(blocked.issues.join(' ')).toContain('星星人缺少动作：held_leg_flip');
    expect(blocked.issues.some(issue => issue.includes('LABUBU缺少动作：held_leg_flip'))).toBe(false);
    const target = assets.twinkle!.runtime;
    addReaction(target, HELD_LEG_FLIP, 24);
    expect(evaluateAnimeEntry(profile, pair, assets, {}, 'versus').ok).toBe(true);
    delete target.attachments['twinkle/held_leg_flip/0'];
    expect(evaluateAnimeEntry(profile, pair, assets, {}, 'versus').issues.join(' ')).toContain('attachment geometry');
  });

  for (const [caster, reaction, ticks] of [[labubuDef, HELD_LABUBU_THROW, 22], [twinkleDef, HELD_TWINKLE_THROW, 23]] as const) {
    it.each([0, 1] as const)(`${caster.id} ordinary pair requires only its actual opponent reaction, side %s`, side => {
      const pair = side === 0 ? [caster, luffyDef] as const : [luffyDef, caster] as const;
      const assets: AnimeCharacterAssets = { [caster.id]: { key: `${caster.id}-new`, runtime: completeRuntime(caster) },
        luffy: { key: 'luffy-new', runtime: completeRuntime(luffyDef) } };
      const victim = assets.luffy!.runtime;
      if (caster.id === 'labubu') addReaction(victim, HELD_LEG_FLIP, 24);
      const missing = evaluateAnimeEntry(profile, pair, assets, {}, 'versus');
      expect(missing.kind).toBe('coverage-error');
      expect(missing.issues).toContain(`路飞缺少动作：${reaction}`);
      expect(missing.issues.some(issue => issue.startsWith(`${caster.name}缺少动作：held_`))).toBe(false);
      addReaction(victim, reaction === HELD_LABUBU_THROW ? HELD_TWINKLE_THROW : HELD_LABUBU_THROW, ticks);
      expect(evaluateAnimeEntry(profile, pair, assets, {}, 'versus').ok).toBe(false);
      addReaction(victim, reaction, ticks);
      expect(evaluateAnimeEntry(profile, pair, assets, {}, 'versus').ok).toBe(true);
      delete victim.anims[reaction]!.exposures;
      expect(evaluateAnimeEntry(profile, pair, assets, {}, 'versus').issues.join(' ')).toContain('valid exposure');
    });
  }
});
