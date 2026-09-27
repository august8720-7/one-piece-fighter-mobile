import { describe, expect, it } from 'vitest';
import { createCueCatalog, eventCues, hitSfxKind } from '../../src/audio/audioCues';
import type { FightAudioEvent, ProjectileEndReason } from '../../src/audio/audioTypes';
import { Btn, FightSim, type HitEvent } from '../../src/core';
import { akainuDef, labubuDef, luffyDef, twinkleDef } from '../../src/characters';
import sampleManifest from '../../src/audio/sampleManifest.json';

const event = (patch: Partial<FightAudioEvent>): FightAudioEvent => ({ phase: 'hit', characterId: 'luffy', player: 0, moveId: 'st_a', ...patch });
const known = (...ids: string[]) => (id: string) => ids.includes(id);

describe('战斗音频纯映射', () => {
  it('交付清单为两角实际事件提供通用声音，不冒充未确认专属喊招', () => {
    const ids = new Set(Object.keys(sampleManifest.cues));
    for (const characterId of ['luffy', 'akainu']) {
      for (const phase of ['ko', 'win'] as const) {
        expect(eventCues(event({ phase, characterId }), id => ids.has(id)))
          .toContainEqual({ id: `voice.${characterId}.${phase}`, player: 0 });
      }
      const start = eventCues(event({ phase: 'start', characterId, moveId: 'sp_meteor' }), id => ids.has(id));
      expect(start.filter(cue => cue.id.startsWith('voice.'))).toEqual([{ id: `voice.${characterId}.attack`, player: 0 }]);
      expect(eventCues(event({ defenderId: characterId, defenderPlayer: 1 }), id => ids.has(id)))
        .toContainEqual({ id: `voice.${characterId}.hurt`, player: 1 });
    }
    expect([...ids].filter(id => /^voice\..+\.(sp_|ult_)/.test(id))).toEqual([]);
  });
  it('流星只有真实落地才爆裂，犬头自然结束才消散，清理不响', () => {
    const reasons: ProjectileEndReason[] = ['hit', 'block', 'clash', 'ground', 'timeout', 'out_of_bounds', 'round_end', 'round_reset', 'position_reset'];
    for (const projectileKind of ['meteor', 'dog'] as const) {
      for (const endReason of reasons) {
        const cues = eventCues(event({ phase: 'projectile_end', characterId: 'akainu', player: 1, projectileKind, endReason }), known());
        const expected = projectileKind === 'meteor' && endReason === 'ground' ? 'sfx.akainu.meteor.end'
          : projectileKind === 'dog' && (endReason === 'timeout' || endReason === 'out_of_bounds') ? 'sfx.akainu.inugami.end' : null;
        expect(cues).toEqual(expected ? [{ id: expected, player: 1 }] : []);
      }
    }
  });

  it('命中/格挡/相消已有声音时，紧接的道具结束事件不再补一遍', () => {
    expect(eventCues(event({ phase: 'hit', damage: 60 }), known())).toEqual([{ id: 'hit_heavy', player: 0 }]);
    expect(eventCues(event({ phase: 'block' }), known())).toEqual([{ id: 'block', player: 0 }]);
    for (const endReason of ['hit', 'block', 'clash'] as const) {
      expect(eventCues(event({ phase: 'projectile_end', projectileKind: 'meteor', endReason }), known())).toEqual([]);
    }
  });

  it('实际存在精确招名语音时使用它，不再同时叠通用喊声', () => {
    const cues = eventCues(event({ phase: 'start', moveId: 'sp_gatling' }), known('voice.luffy.sp_gatling', 'voice.luffy.attack'));
    expect(cues).toEqual([{ id: 'sfx.luffy.gatling.start', player: 0 }, { id: 'voice.luffy.sp_gatling', player: 0 }]);
  });

  it('精确招名缺失时只回退到同角色已有通用attack，不冒充招名', () => {
    const start = event({ phase: 'start', characterId: 'akainu', player: 1, moveId: 'sp_meigou' });
    expect(eventCues(start, known('voice.akainu.attack'))).toEqual([{ id: 'sfx.akainu.meigou.start', player: 1 }, { id: 'voice.akainu.attack', player: 1 }]);
    expect(eventCues(start, known('voice.luffy.attack'))).toEqual([{ id: 'sfx.akainu.meigou.start', player: 1 }]);
    expect(eventCues(start, known())).toEqual([{ id: 'sfx.akainu.meigou.start', player: 1 }]);
  });

  it('受击语音使用防守角色和防守玩家，不误用攻击者声音或声道', () => {
    const hit = event({ characterId: 'akainu', player: 1, moveId: 'st_c', damage: 85, defenderId: 'luffy', defenderPlayer: 0 });
    const cues = eventCues(hit, known('voice.akainu.hurt', 'voice.luffy.hurt'));
    expect(cues).toEqual([{ id: 'magma_hit', player: 1 }, { id: 'voice.luffy.hurt', player: 0 }]);
    expect(eventCues(hit, known('voice.akainu.hurt'))).toEqual([{ id: 'magma_hit', player: 1 }]);
  });

  it('普通拳脚使用短出力，伸缩重拳保留起手挥出回收', () => {
    for (const moveId of ['st_a', 'cr_d', 'f_c', 'j_c']) {
      const cues = eventCues(event({ phase: 'start', moveId }), () => true);
      expect(cues).toEqual([{ id: 'voice.luffy.effort', player: 0 }]);
    }
    expect(eventCues(event({ phase: 'start', moveId: 'st_c' }), () => true)).toEqual([{ id: 'sfx.luffy.stretch.start', player: 0 }, { id: 'voice.luffy.effort', player: 0 }]);
    expect(eventCues(event({ phase: 'swing', moveId: 'st_c' }), () => true)).toEqual([{ id: 'sfx.luffy.stretch.release', player: 0 }]);
    expect(eventCues(event({ phase: 'recover', moveId: 'st_c' }), () => true)).toEqual([{ id: 'sfx.luffy.stretch.end', player: 0 }]);
    expect(eventCues(event({ phase: 'swing', moveId: 'st_a' }), () => true)).toEqual([{ id: 'whoosh', player: 0 }]);
  });

  it('橡胶/岩浆材质区分保留，反击音优先于岩浆重击', () => {
    expect(eventCues(event({ phase: 'start', moveId: 'sp_gatling' }), known())[0]!.id).toBe('sfx.luffy.gatling.start');
    expect(eventCues(event({ phase: 'start', characterId: 'akainu', moveId: 'sp_daifunka' }), known())[0]!.id).toBe('sfx.akainu.daifunka.start');
    expect(eventCues(event({ characterId: 'akainu', moveId: 'sp_daifunka', damage: 130 }), known())[0]!.id).toBe('magma_hit');
    expect(eventCues(event({ characterId: 'akainu', moveId: 'sp_daifunka', damage: 130, counter: true }), known())[0]!.id).toBe('counter');
    expect(eventCues(event({ characterId: 'akainu', moveId: 'st_a', damage: 40 }), known())[0]!.id).toBe('hit_light');
  });

  it('同角色不同能力的释放声独立配置，起手和收招不会冒充接触命中', () => {
    const moves = [
      ['luffy', 'st_c', 'stretch'], ['luffy', 'sp_gatling', 'gatling'], ['luffy', 'sp_storm', 'gatling'],
      ['luffy', 'sp_gigant_pistol', 'gigant'], ['luffy', 'ult_red_hawk', 'red_hawk'],
      ['luffy', 'sp_gear2', 'gear2'], ['luffy', 'sp_balloon', 'balloon'],
      ['luffy', 'sp_bazooka', 'stretch'], ['luffy', 'sp_rifle', 'stretch'], ['luffy', 'sp_rocket', 'stretch'],
      ['akainu', 'sp_daifunka', 'daifunka'], ['akainu', 'sp_daifunka_ren', 'daifunka'],
      ['akainu', 'sp_meigou', 'meigou'], ['akainu', 'ult_meigou_end', 'meigou'],
      ['akainu', 'sp_ground_split', 'ground_split'], ['akainu', 'sp_magma_body', 'magma_body'],
    ] as const;
    for (const [characterId, moveId, family] of moves) {
      for (const [phase, stage] of [['start', 'start'], ['swing', 'release'], ['recover', 'end']] as const) {
        expect(eventCues(event({ characterId, moveId, phase }), known())).toEqual([{ id: `sfx.${characterId}.${family}.${stage}`, player: 0 }]);
      }
    }
    expect(eventCues(event({ phase: 'recover', moveId: 'st_a' }), known())).toEqual([]);
  });

  it('流星和犬头按实际投射物生成发声，不按施法空挥或收招提前响', () => {
    for (const [moveId, projectileKind, family] of [
      ['sp_meteor', 'meteor', 'meteor'], ['sp_meteor_rain', 'meteor', 'meteor'], ['sp_inugami', 'dog', 'inugami'],
    ] as const) {
      const cast = event({ characterId: 'akainu', moveId, projectileKind });
      expect(eventCues({ ...cast, phase: 'swing' }, known())).toEqual([]);
      expect(eventCues({ ...cast, phase: 'recover' }, known())).toEqual([]);
      expect(eventCues({ ...cast, phase: 'projectile_spawn' }, known())).toEqual([{ id: `sfx.akainu.${family}.release`, player: 0 }]);
    }
  });

  it('路飞弹反赤犬道具后沿用岩浆材质、使用当前所有者声道', () => {
    const reflected = event({ characterId: 'luffy', materialCharacterId: 'akainu', moveId: 'sp_meteor', projectileKind: 'meteor', player: 1 });
    expect(eventCues({ ...reflected, phase: 'projectile_end', endReason: 'ground' }, known())).toEqual([{ id: 'sfx.akainu.meteor.end', player: 1 }]);
    expect(eventCues({ ...reflected, phase: 'hit' }, known())).toEqual([{ id: 'magma_hit', player: 1 }]);
  });

  it('路飞弹反星星弹后仍使用twinkle材质，不误判为赤犬岩浆', () => {
    const reflected = event({
      characterId: 'luffy', materialCharacterId: 'twinkle', moveId: 'sp_tiny_star',
      projectileKind: 'twinkle_tiny_star', player: 0,
    });
    expect(eventCues({ ...reflected, phase: 'projectile_spawn' }, known()))
      .toEqual([{ id: 'sfx.twinkle.star.release', player: 0 }]);
    expect(eventCues({ ...reflected, phase: 'projectile_end', endReason: 'timeout' }, known()))
      .toEqual([{ id: 'sfx.twinkle.star.end', player: 0 }]);
    expect(eventCues({ ...reflected, phase: 'hit', damage: 40 }, known()))
      .toEqual([{ id: 'hit_light', player: 0 }]);
  });

  it.each([0, 1] as const)('P%s 实际气球反弹只响橡胶段，弹回后被格挡仍响普通格挡', (reflector) => {
    const sim = new FightSim({ p1: reflector === 0 ? luffyDef : akainuDef, p2: reflector === 1 ? luffyDef : akainuDef, seed: 5, introFrames: 0, roundTime: -1 });
    const caster = reflector === 0 ? 1 : 0;
    const stepFor = (player: 0 | 1, buttons: number) => sim.step(player === 0 ? { p1: buttons, p2: 0 } : { p1: 0, p2: buttons });
    const casterBack = caster === 0 ? Btn.Left : Btn.Right;
    for (const buttons of [Btn.Down, Btn.Down | casterBack, casterBack | Btn.C]) stepFor(caster, buttons);
    expect(sim.state.fighters[caster].moveId).toBe('sp_inugami');
    for (let frame = 0; frame < 26; frame++) sim.step({ p1: 0, p2: 0 });
    for (const buttons of [Btn.Down, 0, Btn.Down | Btn.A]) stepFor(reflector, buttons);
    expect(sim.state.fighters[reflector].moveId).toBe('sp_balloon');
    const contacts: HitEvent[] = [];
    for (let frame = 0; frame < 140; frame++) {
      stepFor(caster, casterBack);
      contacts.push(...sim.hits.filter(contact => contact.projectile));
    }
    const reflections = contacts.filter(contact => contact.kind === 'reflect');
    const blocks = contacts.filter(contact => contact.kind === 'block');
    expect(reflections).toHaveLength(1);
    expect(blocks).toHaveLength(1);
    for (const contact of [...reflections, ...blocks]) {
      expect(contact.attacker).toBe(reflector);
      expect(contact.moveId).toBe('sp_inugami');
      if (contact.kind !== 'reflect' && contact.kind !== 'block') throw new Error('Expected an actual reflection or block contact');
      expect(eventCues({ phase: contact.kind, characterId: sim.state.fighters[contact.attacker]!.def.id, materialCharacterId: 'akainu', player: contact.attacker, moveId: contact.moveId }, known()))
        .toEqual([{ id: contact.kind === 'reflect' ? 'sfx.luffy.stretch.release' : 'block', player: reflector }]);
    }
  });

  it('旧两角三十六个阶段保持不变，录制文件覆盖后保留缺素材时的退路', () => {
    const catalog = createCueCatalog({ 'sfx.luffy.gear2.release': { files: ['/assets/audio/sfx/steam.wav'], group: 'sfx' } });
    const legacyStages = Object.entries(catalog).filter(([id]) => /^sfx\.(luffy|akainu)\./.test(id));
    expect(legacyStages).toHaveLength(36);
    expect(legacyStages.every(([, cue]) => cue.group === 'sfx' && !!cue.fallback)).toBe(true);
    expect(catalog['sfx.luffy.gear2.release']).toMatchObject({ files: ['/assets/audio/sfx/steam.wav'], characterId: 'luffy', fallback: 'whoosh' });
    expect(catalog['sfx.akainu.meteor.release']!.cooldownMs).toBeLessThan(1000 * 4 / 60);
  });

  it('新增两角保留三阶段音效，九技能只使用已采用的通用语音而不冒充专属喊招', () => {
    const catalog = createCueCatalog({});
    const families = {
      labubu: ['rush', 'flurry', 'upper', 'slide', 'grapple', 'drive', 'charge'],
      twinkle: ['star', 'push', 'fall', 'reflect', 'blink', 'wave'],
    } as const;
    for (const [characterId, expectedFamilies] of Object.entries(families)) {
      const expected = expectedFamilies.flatMap(family => ['start', 'release', 'end'].map(stage => `sfx.${characterId}.${family}.${stage}`)).sort();
      const actual = Object.keys(catalog).filter(id => id.startsWith(`sfx.${characterId}.`)).sort();
      expect(actual).toEqual(expected);
      for (const id of actual) expect(catalog[id]).toMatchObject({ group: 'sfx', characterId, fallback: expect.any(String) });
    }
    const delivered = sampleManifest.cues as Record<string, unknown>;
    expect(Object.keys(delivered).filter(id => /^voice\.(labubu|twinkle)\./.test(id)).sort())
      .toEqual([
        'voice.labubu.attack', 'voice.labubu.effort', 'voice.labubu.hurt', 'voice.labubu.idle', 'voice.labubu.ko', 'voice.labubu.select', 'voice.labubu.win',
        'voice.twinkle.attack', 'voice.twinkle.effort', 'voice.twinkle.hurt', 'voice.twinkle.idle', 'voice.twinkle.ko', 'voice.twinkle.select', 'voice.twinkle.win',
      ]);
    for (const def of [labubuDef, twinkleDef]) {
      expect(def.skillSlots).toHaveLength(9);
      for (const moveId of def.skillSlots!) {
        const cues = eventCues(event({ phase: 'start', characterId: def.id, moveId }), id => id in delivered);
        expect(cues.some(cue => cue.id.startsWith(`sfx.${def.id}.`))).toBe(true);
        expect(cues.filter(cue => cue.id.startsWith('voice.'))).toEqual([{ id: `voice.${def.id}.attack`, player: 0 }]);
      }
      expect(eventCues(event({ phase: 'start', characterId: def.id, moveId: 'st_a' }), id => id in delivered)
        .filter(cue => cue.id.startsWith('voice.'))).toEqual([{ id: `voice.${def.id}.effort`, player: 0 }]);
    }
  });

  it('轻重击分界维持原伤害阈值，反击不受伤害大小限制', () => {
    expect(hitSfxKind(59, false)).toBe('hit_light');
    expect(hitSfxKind(60, false)).toBe('hit_heavy');
    expect(hitSfxKind(0, true)).toBe('counter');
    expect(hitSfxKind(130, true)).toBe('counter');
  });

  it('缺录制音效可以保留合成回退，语音目录只包含实际传入条目', () => {
    const catalog = createCueCatalog({
      'voice.luffy.attack': { group: 'voice', files: ['/assets/audio/voice/luffy/attack.ogg'], transcript: '通用出力喊声' },
      magma_hit: { group: 'sfx', files: ['/assets/audio/sfx/magma-hit.ogg'] },
    });
    expect(catalog.hit_light!.fallback).toBe('hit_light');
    expect(catalog.magma_hit!.files).toEqual(['/assets/audio/sfx/magma-hit.ogg']);
    expect(catalog['voice.luffy.attack']!.fallback).toBeUndefined();
    expect(catalog['voice.luffy.attack']!.transcript).toBe('通用出力喊声');
    expect(Object.keys(catalog).filter((id) => id.startsWith('voice.'))).toEqual(['voice.luffy.attack']);
    expect(catalog['voice.luffy.sp_gatling']).toBeUndefined();
  });
});
