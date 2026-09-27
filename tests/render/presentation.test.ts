import { describe, expect, it } from 'vitest';
import type Phaser from 'phaser';
import { Btn, FightSim, GROUND_Y, SUBPIXEL, firstActiveFrame, px, totalFrames, type HitEvent, type ProjectileEndEvent, type ProjectileState } from '../../src/core';
import { akainuDef, luffyDef } from '../../src/characters';
import { SkillEffects } from '../../src/render/fx/SkillEffects';
import { activeSegment } from '../../src/render/fx/movePresentation';
import { RENDER_SCALE } from '../../src/render/screen';

class ImageRecord {
  key = ''; frame = ''; x = 0; y = 0; width = 0; height = 0; alpha = 1; originY = 0.5; visible = true; flip = false; tint: number | null = null;
  setTexture(key: string, frame: string) { this.key = key; this.frame = frame; return this; }
  setVisible(visible: boolean) { this.visible = visible; return this; }
  setPosition(x: number, y: number) { this.x = x; this.y = y; return this; }
  setOrigin(_x: number, y: number) { this.originY = y; return this; }
  setDisplaySize(width: number, height: number) { this.width = width; this.height = height; return this; }
  setFlipX(flip: boolean) { this.flip = flip; return this; }
  setAlpha(alpha: number) { this.alpha = alpha; return this; }
  depth = 0;
  setDepth(depth: number) { this.depth = depth; return this; }
  clearTint() { this.tint = null; return this; }
  setTint(tint: number) { this.tint = tint; return this; }
}

function fixture(available = true) {
  const images: ImageRecord[] = [];
  const scene = {
    textures: { exists: () => available, get: () => ({ has: () => available }) },
    add: { image: () => { const image = new ImageRecord(); images.push(image); return image; } },
  } as unknown as Phaser.Scene;
  return { effects: new SkillEffects(scene), images };
}

const make = () => new FightSim({ p1: luffyDef, p2: akainuDef, introFrames: 0, roundTime: -1 });
const screen = (value: number) => value / SUBPIXEL * RENDER_SCALE;

/** Earn the ultimate and its distance using the same inputs as a player. */
function ultimateFromInputs(player: 0 | 1, miss = false) {
  const sim = new FightSim({ p1: player === 0 ? akainuDef : luffyDef, p2: player === 0 ? luffyDef : akainuDef, introFrames: 0, roundTime: -1 });
  const attacker = () => sim.state.fighters[player];
  const defender = () => sim.state.fighters[player === 0 ? 1 : 0];
  const forward = player === 0 ? Btn.Right : Btn.Left;
  const back = player === 0 ? Btn.Left : Btn.Right;
  const step = (input = 0) => sim.step(player === 0 ? { p1: input, p2: 0 } : { p1: 0, p2: input });
  const gap = () => Math.abs(attacker().x - defender().x) / SUBPIXEL;
  let throws = 0;
  for (let n = 0; n < 7; n++) {
    for (let tick = 0; gap() > 40 && tick < 180; tick++) step(forward);
    step(); step(forward | Btn.C);
    for (let tick = 0; tick < 110; tick++) {
      step();
      throws += sim.hits.filter(hit => hit.kind === 'hit' && hit.moveId === 'throw_fwd').length;
    }
  }
  expect(throws).toBe(7);
  const target = miss ? 140 : 42;
  for (let tick = 0; gap() > target && tick < 240; tick++) step(forward);
  for (let tick = 0; gap() < target - 3 && tick < 240; tick++) step(back);
  step(); step();
  for (const input of [Btn.Down, Btn.Down | forward, forward, Btn.Down, Btn.Down | forward, forward | Btn.B]) step(input);
  expect(attacker().moveId).toBe('ult_meigou_end');
  return { sim, attacker, defender, step };
}
const dog = (patch: Partial<ProjectileState> = {}): ProjectileState => ({
  id: 1, owner: 1, kind: 'dog', moveId: 'sp_inugami', moveInstance: 1,
  x: px(70), y: px(-50), vx: px(-4.5), vy: 0, gravity: 0, facing: -1,
  ttl: 140, box: [-20, -26, 40, 40], durability: 1, damage: 60, guard: 'mid', hitstun: 20, blockstun: 16, hitstop: 9,
  knockback: { x: 6, y: 0 }, burn: null, dieOnGround: false, reflected: false, ...patch,
});

describe('表现事件与图像边界', () => {
  it.each([0, 1] as const)('终焉P%s真实抓住后持续局部蓄力，70帧实际释放只爆发一次', player => {
    const { sim, attacker, step } = ultimateFromInputs(player);
    const { effects, images } = fixture();
    for (let tick = 0; attacker().state !== 'throw' && tick < 20; tick++) step();
    expect(attacker().state).toBe('throw');
    expect(attacker().stateFrame).toBe(0);
    const draw = () => {
      effects.begin(); effects.fighters(sim, screen, screen, () => true); effects.finish(screen, screen);
      return images.filter(image => image.visible);
    };
    let firstWidth = 0;
    for (let tick = 0; tick < 70; tick++) {
      expect(attacker().stateFrame).toBe(tick);
      const visible = draw();
      expect(visible).toHaveLength(1);
      const flame = visible[0]!;
      expect(flame).toMatchObject({ key: 'fx-akainu', frame: 'flame', flip: player === 1, depth: 12 });
      expect(flame.x).toBe(screen(attacker().x + attacker().facing * px(31)));
      expect(flame.y - flame.height / 2).toBeGreaterThanOrEqual(screen(attacker().y - px(69)));
      expect(flame.width).toBeLessThanOrEqual(screen(px(24)));
      if (tick === 0) firstWidth = flame.width;
      if (tick === 69) expect(flame.width).toBeGreaterThan(firstWidth);
      const paused = images.map(image => ({ ...image }));
      for (let redraw = 0; redraw < 4; redraw++) draw();
      expect(images.map(image => ({ ...image }))).toEqual(paused);
      effects.tick(); step();
    }
    const release = sim.hits.filter(hit => hit.kind === 'hit' && hit.moveId === 'ult_meigou_end');
    expect(release).toHaveLength(1);
    expect(release[0]!.damage).toBe(480);
    expect(attacker().stateFrame).toBe(70);
    for (const hit of release) effects.contact(hit, sim.state);
    expect(draw().map(image => image.frame)).toEqual(['eruption']);
    const paused = images.map(image => ({ ...image }));
    for (let redraw = 0; redraw < 120; redraw++) draw();
    expect(images.map(image => ({ ...image }))).toEqual(paused);
    let releaseCount = release.length;
    for (let tick = 0; tick < 25; tick++) {
      effects.tick(); step();
      releaseCount += sim.hits.filter(hit => hit.kind === 'hit' && hit.moveId === 'ult_meigou_end').length;
      for (const hit of sim.hits) effects.contact(hit, sim.state);
      expect(draw().some(image => image.frame === 'flame')).toBe(false);
    }
    expect(releaseCount).toBe(1);
    expect(draw()).toHaveLength(0);
  });

  it('终焉真实落空只有原起手蓄力，活动期及收招不会假抓取或爆发', () => {
    const { sim, attacker, step } = ultimateFromInputs(0, true);
    const { effects, images } = fixture();
    let startupFrames = 0;
    for (let tick = 0; tick <= 60; tick++) {
      effects.tick(); effects.begin(); effects.fighters(sim, screen, screen, () => true); effects.finish(screen, screen);
      const visible = images.filter(image => image.visible);
      if (attacker().state === 'attack' && attacker().stateFrame < 12) startupFrames += visible.length;
      else expect(visible).toHaveLength(0);
      expect(attacker().state).not.toBe('throw');
      expect(sim.hits.some(hit => hit.moveId === 'ult_meigou_end')).toBe(false);
      step();
    }
    expect(startupFrames).toBe(12);
    expect(attacker().state).toBe('idle');
  });

  it('持握中实际位置重置立即消除蓄力，不留下延迟释放；缺图不改模拟状态', () => {
    const { sim, attacker, step } = ultimateFromInputs(0);
    const { effects, images } = fixture();
    for (let tick = 0; attacker().state !== 'throw' && tick < 20; tick++) step();
    const draw = () => { effects.begin(); effects.fighters(sim, screen, screen, () => true); effects.finish(screen, screen); };
    draw();
    expect(images.some(image => image.visible && image.frame === 'flame')).toBe(true);
    const missing = fixture(false), before = JSON.stringify(sim.state);
    missing.effects.begin(); missing.effects.fighters(sim, screen, screen, () => true); missing.effects.finish(screen, screen);
    expect(missing.images).toHaveLength(0);
    expect(JSON.stringify(sim.state)).toBe(before);
    sim.resetPositions();
    draw();
    expect(images.every(image => !image.visible)).toBe(true);
    for (let tick = 0; tick < 95; tick++) {
      step(); effects.tick();
      for (const hit of sim.hits) effects.contact(hit, sim.state);
      draw();
      expect(images.every(image => !image.visible)).toBe(true);
      expect(sim.hits.some(hit => hit.moveId === 'ult_meigou_end')).toBe(false);
    }
  });

  it('真实命中定格内 active segment 不变，不重新触发该段发力', () => {
    const sim = make();
    const attacker = sim.state.fighters[0];
    attacker.x = px(-20); sim.state.fighters[1].x = px(20);
    sim.step({ p1: Btn.A, p2: 0 });
    for (let frame = 0; frame < 30 && !attacker.hasHit; frame++) sim.step({ p1: 0, p2: 0 });
    expect(attacker.hitstop).toBeGreaterThan(0);
    const segment = activeSegment(attacker, sim.move(attacker));
    expect(segment).not.toBeNull();
    for (let frame = 0, count = attacker.hitstop; frame < count; frame++) {
      sim.step({ p1: 0, p2: 0 });
      expect(activeSegment(attacker, sim.move(attacker))).toBe(segment);
    }
  });

  it('机关枪五段有五个独立segment，起手/收招和纯发射招式不冒充打击段', () => {
    const sim = make(), f = sim.state.fighters[0];
    const move = luffyDef.moves.find(move => move.id === 'sp_gatling')!;
    f.state = 'attack'; f.moveId = move.id; f.moveInstance = 9;
    const segments = new Set<string>();
    let elapsed = 0;
    for (const frame of move.frames) {
      for (let tick = 0; tick < frame.duration; tick++) {
        f.stateFrame = elapsed + tick;
        const segment = activeSegment(f, move);
        if (frame.hitboxes?.length) { expect(segment).not.toBeNull(); segments.add(segment!); }
        else expect(segment).toBeNull();
      }
      elapsed += frame.duration;
    }
    expect(segments.size).toBe(5);
    f.moveInstance++;
    f.stateFrame = firstActiveFrame(move);
    expect(segments.has(activeSegment(f, move)!)).toBe(false);
    const projectileMove = akainuDef.moves.find(move => move.id === 'sp_meteor')!;
    for (let tick = 0; tick < 44; tick++) { f.stateFrame = tick; expect(activeSegment(f, projectileMove)).toBeNull(); }
  });

  it.each([1, -1] as const)('近战特效朝向%s时中心与尺寸仍贴合当前真实打击框', (facing) => {
    const sim = make(), f = sim.state.fighters[0];
    const move = luffyDef.moves.find(move => move.id === 'sp_rifle')!;
    f.x = px(40); f.facing = facing; f.state = 'attack'; f.moveId = move.id; f.stateFrame = firstActiveFrame(move);
    const box = sim.hitboxes(f)[0]!;
    const { effects, images } = fixture();
    effects.begin(); effects.fighters(sim, screen, screen); effects.finish(screen, screen);
    const image = images.find(image => image.frame === 'rubber_fist')!;
    expect(image.x).toBe(screen(box.x + box.w / 2));
    expect(image.y).toBe(screen(box.y + box.h / 2));
    expect(image.width).toBe(screen(box.w));
    expect(image.height).toBe(screen(box.h));
    expect(image.flip).toBe(facing === -1);
  });

  it.each([1, -1] as const)('犬头朝向%s时额外拖尾只向后延伸，前缘没有扩大打击距离', (facing) => {
    const sim = make(), projectile = dog({ facing });
    const box = sim.projectileBox(projectile);
    const { effects, images } = fixture();
    effects.begin();
    expect(effects.projectile(projectile, sim, screen, screen)).toBe(true);
    const image = images[0]!;
    const leadingEdge = image.x + facing * image.width / 2;
    expect(leadingEdge).toBeCloseTo(screen(facing === 1 ? box.x + box.w : box.x));
  });

  it('新人物已含能力主体时不重复盖拳头，真实接触和脱离道具仍可表现', () => {
    const sim = make(), attacker = sim.state.fighters[1];
    const move = akainuDef.moves.find(move => move.id === 'sp_daifunka')!;
    attacker.state = 'attack'; attacker.moveId = move.id; attacker.stateFrame = firstActiveFrame(move);
    const { effects, images } = fixture();
    effects.begin(); effects.fighters(sim, screen, screen, player => player === 1); effects.finish(screen, screen);
    expect(images).toHaveLength(0);
    effects.contact({ frame: 20, kind: 'hit', attacker: 1, defender: 0, moveId: move.id, damage: 130, counter: false, comboHits: 1, comboDamage: 130, projectile: false, x: 0, y: px(-50) }, sim.state);
    effects.begin();
    effects.fighters(sim, screen, screen, player => player === 1);
    expect(effects.projectile(dog(), sim, screen, screen)).toBe(true);
    effects.finish(screen, screen);
    expect(images.map(image => image.frame)).toEqual(['dog', 'eruption']);
    expect(images.some(image => image.frame === 'magma_fist')).toBe(false);
  });

  it.each(['sp_rifle', 'sp_gigant_pistol', 'ult_red_hawk'])('动漫%s的实体手臂和拳头保持由人物原画提供', moveId => {
    const sim = make(), f = sim.state.fighters[0], { effects, images } = fixture();
    const move = luffyDef.moves.find(move => move.id === moveId)!;
    f.state = 'attack'; f.moveId = move.id; f.stateFrame = firstActiveFrame(move);
    effects.begin(); effects.fighters(sim, screen, screen, () => true); effects.finish(screen, screen);
    expect(images).toHaveLength(0);
  });

  it('动漫二档的持续蒸汽不会随起手结束、人物移动而丢失', () => {
    const sim = make(), f = sim.state.fighters[0], { effects, images } = fixture();
    f.install = 'gear2'; f.state = 'walk_fwd';
    effects.begin(); effects.fighters(sim, screen, screen, () => true); effects.finish(screen, screen);
    expect(images.map(image => image.frame)).toEqual(['steam', 'steam']);
    const original = images.map(image => image.x);
    f.x += px(40);
    effects.begin(); effects.fighters(sim, screen, screen, () => true); effects.finish(screen, screen);
    expect(images.map(image => image.x)).toEqual(original.map(x => x + screen(px(40))));
    f.install = null;
    effects.begin(); effects.fighters(sim, screen, screen, () => true); effects.finish(screen, screen);
    expect(images.every(image => !image.visible)).toBe(true);
  });

  it.each([1, -1] as const)('动漫地裂朝向%s时只覆盖真实活动判定，并贴住同一个地面', facing => {
    const sim = make(), f = sim.state.fighters[1], { effects, images } = fixture();
    const move = akainuDef.moves.find(move => move.id === 'sp_ground_split')!;
    f.facing = facing; f.state = 'attack'; f.moveId = move.id;
    for (let tick = 0; tick < totalFrames(move); tick++) {
      f.stateFrame = tick;
      effects.begin(); effects.fighters(sim, screen, screen, () => true); effects.finish(screen, screen);
      const visible = images.filter(image => image.visible);
      const boxes = sim.hitboxes(f);
      expect(visible).toHaveLength(boxes.length);
      for (const [index, box] of boxes.entries()) {
        const image = visible[index]!;
        expect(image.frame).toBe('fissure');
        expect(image.x - image.width / 2).toBe(screen(box.x));
        expect(image.x + image.width / 2).toBe(screen(box.x + box.w));
        expect(image.y + image.height / 2).toBe(screen(f.y));
        expect(image.flip).toBe(facing === -1);
      }
    }
  });

  it.each([['sp_gatling', 5], ['sp_storm', 7]] as const)('动漫%s仅在真实的%s段攻击中显示拳影，间隔和收招不冒充命中', (moveId, count) => {
    const sim = make(), f = sim.state.fighters[0], { effects, images } = fixture();
    const move = luffyDef.moves.find(move => move.id === moveId)!;
    f.state = 'attack'; f.moveId = moveId; f.moveInstance = 30;
    const batches = new Set<string>();
    for (let tick = 0; tick < totalFrames(move); tick++) {
      f.stateFrame = tick;
      effects.begin(); effects.fighters(sim, screen, screen, () => true); effects.finish(screen, screen);
      const visible = images.filter(image => image.visible);
      const boxes = sim.hitboxes(f);
      expect(visible).toHaveLength(boxes.length);
      if (boxes.length) {
        batches.add(activeSegment(f, move)!);
        expect(visible.every(image => image.frame === 'gatling' && image.alpha < 0.5)).toBe(true);
      }
      expect(visible.some(image => image.frame === 'impact')).toBe(false);
    }
    expect(batches.size).toBe(count);
  });

  it('动漫气球保留反弹范围涟漪，熔岩化保留独立熔解环', () => {
    const sim = make(), { effects, images } = fixture();
    const [luffy, akainu] = sim.state.fighters;
    const balloon = luffyDef.moves.find(move => move.id === 'sp_balloon')!;
    luffy.state = 'attack'; luffy.moveId = balloon.id; luffy.stateFrame = firstActiveFrame(balloon);
    akainu.state = 'attack'; akainu.moveId = 'sp_magma_body';
    effects.begin(); effects.fighters(sim, screen, screen, () => true); effects.finish(screen, screen);
    expect(images.map(image => image.frame)).toEqual(['rebound', 'melt']);
  });

  it.each([
    { moveId: 'sp_meteor', ex: false, count: 3, facing: 1 },
    { moveId: 'sp_meteor', ex: false, count: 3, facing: -1 },
    { moveId: 'sp_meteor_rain', ex: true, count: 8, facing: 1 },
    { moveId: 'sp_meteor_rain', ex: true, count: 8, facing: -1 },
  ] as const)('$moveId朝向$facing的真实输入产生$count个流星，绘制不增删弹体', ({ moveId, ex, count, facing }) => {
    const sim = new FightSim({ p1: akainuDef, p2: luffyDef, introFrames: 0, roundTime: -1 });
    const { effects, images } = fixture(), caster = sim.state.fighters[0];
    caster.x = px(-400 * facing); caster.facing = facing;
    sim.state.fighters[1].x = px(400 * facing);
    caster.meter = 300;
    const back = facing === 1 ? Btn.Left : Btn.Right;
    const quarter = [Btn.Down, Btn.Down | back, back];
    const command = [...(ex ? quarter : []), ...quarter];
    command[command.length - 1]! |= Btn.D;
    for (const p1 of command) sim.step({ p1, p2: 0 });
    expect(caster.moveId).toBe(moveId);
    const ids = new Set<number>(), ends = new Set<number>();
    for (let tick = 0; tick < 180; tick++) {
      sim.step({ p1: 0, p2: 0 });
      effects.tick(); effects.begin();
      for (const p of sim.state.projectiles) {
        ids.add(p.id);
        expect(effects.projectile(p, sim, screen, screen)).toBe(true);
      }
      for (const end of sim.projectileEnds) { ends.add(end.id); effects.projectileEnd(end); }
      effects.finish(screen, screen);
      const falling = images.filter(image => image.visible && image.frame === 'meteor');
      expect(falling).toHaveLength(sim.state.projectiles.length);
      for (const [index, p] of sim.state.projectiles.entries()) {
        const box = sim.projectileBox(p), image = falling[index]!;
        expect(image.y + image.height / 2).toBeCloseTo(screen(box.y + box.h));
      }
    }
    expect(ids.size).toBe(count);
    expect(ends).toEqual(ids);
    expect(sim.state.projectiles).toHaveLength(0);
  });

  it.each(['hit', 'block', 'clash'] as const)('%s的接触事件和投射物结束共同消费时，只出现一次接触反馈', kind => {
    const sim = make(), { effects, images } = fixture();
    const hit: HitEvent = { frame: 20, kind, attacker: 1, defender: 0, moveId: 'sp_inugami', damage: 60, counter: false, comboHits: 1, comboDamage: 60, projectile: true, x: px(20), y: px(-50) };
    effects.contact(hit, sim.state);
    effects.projectileEnd({ id: 1, owner: 1, kind: 'dog', moveId: hit.moveId, frame: hit.frame, x: hit.x, y: hit.y, reason: kind });
    effects.begin(); effects.finish(screen, screen);
    expect(images).toHaveLength(1);
    expect(images[0]!.frame).toBe(kind === 'block' ? 'rebound' : 'eruption');
  });

  it.each(['round_end', 'round_reset', 'position_reset'] as const)('%s只清除投射物，不制造落地爆炸', reason => {
    const { effects, images } = fixture();
    effects.projectileEnd({ id: 1, owner: 1, kind: 'meteor', moveId: 'sp_meteor', frame: 20, x: 0, y: GROUND_Y, reason });
    effects.begin(); effects.finish(screen, screen);
    expect(images).toHaveLength(0);
  });

  it('火山落地、超时和非火山落地区分；暂停重绘不老化或堆积，清理后不残留', () => {
    const { effects, images } = fixture();
    const end: ProjectileEndEvent = { id: 1, owner: 1, kind: 'meteor', moveId: 'sp_meteor', frame: 20, x: px(40), y: GROUND_Y, reason: 'ground' };
    effects.projectileEnd({ ...end, kind: 'dog', moveId: 'sp_inugami' });
    effects.begin(); effects.finish(screen, screen);
    expect(images).toHaveLength(0);
    effects.projectileEnd(end);
    effects.begin(); effects.finish(screen, screen);
    expect(images.map(image => image.frame)).toEqual(['eruption', 'smoke']);
    expect(images.every(image => image.originY === 1)).toBe(true);
    const paused = images.map(image => ({ ...image }));
    for (let draw = 0; draw < 120; draw++) { effects.begin(); effects.finish(screen, screen); }
    expect(images.map(image => ({ ...image }))).toEqual(paused);
    effects.clear(); effects.begin(); effects.finish(screen, screen);
    expect(images.every(image => !image.visible)).toBe(true);
    effects.projectileEnd({ ...end, reason: 'timeout' });
    effects.begin(); effects.finish(screen, screen);
    expect(images.filter(image => image.visible).map(image => image.frame)).toEqual(['smoke']);
    for (let tick = 0; tick < 12; tick++) effects.tick();
    effects.begin(); effects.finish(screen, screen);
    expect(images.every(image => !image.visible)).toBe(true);
    expect(images).toHaveLength(2);
  });

  it('缺失特效图集明确请求原有投射物回退，且不改模拟状态', () => {
    const sim = make(), { effects, images } = fixture(false);
    const before = JSON.stringify(sim.state);
    effects.begin();
    expect(effects.projectile(dog(), sim, screen, screen)).toBe(false);
    effects.fighters(sim, screen, screen); effects.finish(screen, screen);
    expect(images).toEqual([]);
    expect(JSON.stringify(sim.state)).toBe(before);
  });

  it('未知投射物类型不会被误画成流星火山', () => {
    const sim = make(), { effects, images } = fixture();
    effects.begin();
    expect(effects.projectile(dog({ kind: 'unknown' }), sim, screen, screen)).toBe(false);
    effects.finish(screen, screen);
    expect(images).toHaveLength(0);
  });

  it('反弹红莲命中时使用原岩浆来源材质，不能因当前持有者是路飞就变成橡胶', () => {
    const sim = make(), { effects, images } = fixture();
    const hit: HitEvent = { frame: 25, kind: 'hit', attacker: 0, defender: 1, moveId: 'sp_inugami', damage: 60, counter: false, comboHits: 1, comboDamage: 60, projectile: true, x: px(50), y: px(-60) };
    effects.contact(hit, sim.state);
    effects.begin(); effects.finish(screen, screen);
    expect(images[0]).toMatchObject({ key: 'fx-akainu', frame: 'eruption' });
  });

  it('图像池达到上限后，未画出的反弹道具不能把上一张图误染色', () => {
    const sim = make(), { effects, images } = fixture();
    effects.begin();
    for (let id = 0; id < 96; id++) effects.projectile(dog({ id }), sim, screen, screen);
    effects.projectile(dog({ id: 96, reflected: true }), sim, screen, screen);
    expect(images).toHaveLength(96);
    expect(images.every(image => image.tint === null)).toBe(true);
  });
});
