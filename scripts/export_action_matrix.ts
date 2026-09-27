/** Export read-only combat data for art production: npx vite-node scripts/export_action_matrix.ts */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { akainuDef } from '@characters/akainu/def';
import { luffyDef } from '@characters/luffy/def';
import {
  GETUP_FRAMES, KNOCKDOWN_FRAMES, LANDING_FRAMES, LOGIC_FPS, MOVE_RANK,
  PREJUMP_FRAMES, THROW_TECH_FRAMES, firstActiveFrame, totalFrames,
  type FighterDef, type MoveData,
} from '@core/index';

const root = process.cwd();
const sourcePaths = [
  'src/characters/luffy/def.ts', 'src/characters/luffy/moves.ts',
  'src/characters/akainu/def.ts', 'src/characters/akainu/moves.ts',
  'src/core/types.ts', 'src/core/moveBuilder.ts', 'src/core/FightSim.ts',
  'src/core/constants.ts', 'src/core/balance.ts', 'src/render/animations.ts',
];
const sources = sourcePaths.map((path) => ({ path, sha256: createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex') }));
const simSource = readFileSync(resolve(root, 'src/core/FightSim.ts'), 'utf8');
// This private engine constant is read from its source; never silently duplicate a numeric default.
const defaultCancelMatch = simSource.match(/const DEFAULT_CANCEL_WINDOW\s*=\s*(\d+)\s*;/);
if (!defaultCancelMatch) throw new Error('Cannot read DEFAULT_CANCEL_WINDOW; inspect FightSim before regenerating.');
const defaultCancelWindow = Number(defaultCancelMatch[1]);
const typesSource = readFileSync(resolve(root, 'src/core/types.ts'), 'utf8');
const stateDeclaration = typesSource.match(/export type StateId\s*=([\s\S]*?);/);
if (!stateDeclaration) throw new Error('Cannot read StateId union.');
const stateIds = [...stateDeclaration[1]!.matchAll(/'([^']+)'/g)].map((match) => match[1]!);

function cancelData(def: FighterDef, move: MoveData) {
  const trigger = move.throwData ? 'none_throw_uses_separate_state'
    : move.reflect ? 'successful_projectile_reflection'
      : move.frames.some((frame) => frame.hitboxes?.length) ? 'melee_hit_block_or_armor' : 'none_projectile_or_install_does_not_open_window';
  const canOpen = trigger === 'successful_projectile_reflection' || trigger === 'melee_hit_block_or_armor';
  const targets = canOpen ? def.moves.filter((target) => {
    if (target.type === 'throw') return false;
    if ((move.input.stance === 'air') !== (target.input.stance === 'air')) return false;
    return MOVE_RANK[target.type] > MOVE_RANK[move.type] || !!move.chain?.includes(target.id);
  }).map((target) => ({
    id: target.id, name: target.name, meterCost: target.meterCost ?? 0,
    reason: MOVE_RANK[target.type] > MOVE_RANK[move.type] ? 'higher_rank' : 'explicit_chain',
  })) : [];
  return {
    trigger, windowFramesAfterContact: canOpen ? move.cancelWindow ?? defaultCancelWindow : null,
    condition: 'Still in attack state, hasHit, stateFrame <= contactStateFrame + window; correct input/stance and enough meter required. Hitstop pauses stateFrame. Whiff does not open a window.',
    declaredChain: move.chain ?? [], targets,
    note: 'Targets are permitted transitions, not guaranteed true combos. Pure projectile contact does not set caster hasHit; connected grabs enter throw state and cannot use attack cancellation.',
  };
}

function exportMove(def: FighterDef, move: MoveData) {
  let cursor = 0;
  const defaultHurtboxes = move.input.stance === 'air' ? def.hurtboxAir : move.input.stance === 'crouch' ? def.hurtboxCrouch : def.hurtboxStand;
  const first = firstActiveFrame(move);
  const segments = move.frames.map((frame, index) => {
    const start = cursor;
    cursor += frame.duration;
    if (!Number.isInteger(frame.duration) || frame.duration <= 0) throw new Error(`${def.id}/${move.id}: invalid frame duration`);
    return {
      dataSegmentIndex: index, startFrame0: start, endFrameExclusive0: cursor, durationFrames: frame.duration,
      logicalSprite: frame.sprite,
      role: move.type === 'throw' ? 'connected_throw_timeline'
        : frame.hitboxes?.length ? move.reflect ? 'reflect' : move.throwData ? 'grab' : 'strike'
          : index === move.frames.length - 1 ? 'recovery'
            : first >= 0 && start > first ? 'between_hits' : 'startup_or_cast',
      hitId: frame.hitboxes?.length ? frame.hitId ?? 1 : null,
      hitboxes: frame.hitboxes ?? [], hurtboxes: frame.hurtboxes ?? defaultHurtboxes,
      hurtboxSource: frame.hurtboxes ? 'frame_override' : `default_${move.input.stance}`,
      velocityPxPerFrame: frame.velocity ?? {}, armor: !!frame.armor,
    };
  });
  const activeIntervals = segments.filter((segment) => segment.hitboxes.length).map((segment) => ({
    startFrame0: segment.startFrame0, endFrameExclusive0: segment.endFrameExclusive0,
    durationFrames: segment.durationFrames, hitId: segment.hitId, role: segment.role, hitboxes: segment.hitboxes,
  }));
  const last = segments.at(-1)!;
  const startupFrames = move.type === 'throw' ? 0 : first >= 0 ? first : last.startFrame0;
  const installs = def.moves.flatMap((source) => source.install ? [{ sourceMoveId: source.id, install: source.install }] : []);
  const accelerated = installs.filter(() => move.type === 'special' && !move.install && first > 1).map(({ sourceMoveId, install }) => {
    const skipped = Math.min(install.specialStartupSkip, first - 1);
    return {
      installId: install.id, sourceMoveId, initialStateFrame0: skipped,
      elapsedStartupFrames: startupFrames - skipped, elapsedTotalFrames: cursor - skipped,
      note: 'Logical stateFrame boundaries stay unchanged; the beginning is skipped, not rescaled.',
    };
  });
  const notes: string[] = [];
  if (def.id === 'akainu' && move.id === 'sp_daifunka') notes.push('近身持续判定，熔岩拳与身体相连；没有独立投射物，不能画成脱手后继续伤人的飞拳。');
  if (def.id === 'luffy' && move.id === 'st_c') notes.push('橡胶手枪是伸臂能力，单段；无向上击退。手臂自身另有受击框。已选为第一批伸臂样板。');
  if (def.id === 'luffy' && move.id === 'sp_rifle') notes.push('单次伸臂、单个有效段，并带向上击飞；不是多段机关枪。当前不纳入第一批样板。');
  if (def.id === 'luffy' && move.id === 'sp_gatling') notes.push('五个不同 hitId 的攻击段；每段真实接触才能有对应命中反馈，装饰拳影不增加攻击次数。');
  if (move.throwData) notes.push('抓取成功后 stateFrame 从 0 重计；releaseFrame 相对抓住时刻，不是从招式起手计算。指令投的未抓住时间轴与抓住后时间轴分开制作。');
  if (move.install) notes.push('强化效果在 startMove 立即生效；动作起手结束不是强化开始时刻。');
  if (move.projectiles?.length) notes.push('发射帧使用招式 stateFrame；飞出后由道具自己的位置、寿命和结束事件驱动。施法者收招不代表飞行道具消失。');
  return {
    id: move.id, name: move.name, type: move.type, input: move.input,
    artStatus: '未完成', newOriginalDrawingCount: null,
    timing: {
      startupFrames, startupMeaning: move.type === 'throw' ? 'immediate_range_grab_no_attack_startup' : first >= 0 ? 'before_first_melee_box' : 'utility_builder_startup_before_final_segment',
      firstActiveFrame0: first >= 0 ? first : null,
      lastActiveFrame0: activeIntervals.length ? activeIntervals.at(-1)!.endFrameExclusive0 - 1 : null,
      activeIntervals, totalActiveFrames: activeIntervals.reduce((sum, interval) => sum + interval.durationFrames, 0),
      distinctHitIds: [...new Set(activeIntervals.map((interval) => interval.hitId))],
      recoveryStartFrame0: move.type === 'throw' ? null : last.startFrame0,
      recoveryFrames: move.type === 'throw' ? null : last.durationFrames,
      totalFrames: totalFrames(move), totalMeaning: move.throwData ? move.type === 'throw' ? 'connected_throw_only' : 'unconnected_attack_timeline' : 'uninterrupted_base_move_without_hitstop',
      acceleratedByInstall: accelerated,
    },
    segments,
    projectileSpawns: (move.projectiles ?? []).map((spawn, index) => ({
      index, frame0: spawn.frame, kind: spawn.kind, positionPx: { x: spawn.x, y: spawn.y },
      velocityPxPerFrame: { x: spawn.vx, y: spawn.vy }, gravityPxPerFrameSquared: spawn.gravity ?? 0,
      ttlFrames: spawn.ttl, box: spawn.box, durability: spawn.durability ?? 1,
      damage: spawn.damage ?? move.damage, guard: spawn.guard ?? move.guard,
      knockback: spawn.knockback ?? move.knockback, hitstun: spawn.hitstun ?? move.hitstun,
      blockstun: spawn.blockstun ?? move.blockstun, dieOnGround: !!spawn.dieOnGround,
      launchesGroundedOpponent: (spawn.knockback ?? move.knockback).y !== 0,
      hardKnockdown: false, wallBounce: false,
    })),
    connectedThrow: move.throwData ? {
      frameOrigin: '0 at successful grab', releaseFrame0: move.throwData.releaseFrame,
      durationFrames: move.throwData.duration, recoveryAfterReleaseFrames: move.throwData.duration - move.throwData.releaseFrame,
      rangePx: move.throwData.range, techWindowFrames: move.throwData.techWindow,
      holdOffsetPx: move.throwData.holdOffset, switchSides: move.throwData.switchSides,
    } : null,
    cancellation: cancelData(def, move),
    contact: {
      damagePerHitBeforeScaling: move.damage, guard: move.guard, hitstunFrames: move.hitstun,
      blockstunFrames: move.blockstun, hitstopFrames: move.hitstop, knockbackPxPerFrame: move.knockback,
      launchesGroundedOpponent: !!move.throwData || move.knockback.y !== 0 || !!move.knockdown || !!move.projectiles?.some((spawn) => (spawn.knockback ?? move.knockback).y !== 0),
      hardKnockdown: !!move.throwData || !!move.knockdown, wallBounce: !!move.wallBounce,
      armorBreak: !!move.armorBreak, reflectOnly: !!move.reflect,
    },
    meterCost: move.meterCost ?? 0, startupInvulnerableFrames: move.invuln ?? 0,
    install: move.install ?? null, burn: move.burn ?? null, dodge: !!move.dodge, notes,
  };
}

const roster = [luffyDef, akainuDef];
const characters = roster.map((def) => ({
  id: def.id, name: def.name, moveCount: def.moves.length,
  defaultBoxes: {
    stand: { pushbox: def.pushboxStand, hurtboxes: def.hurtboxStand },
    crouch: { pushbox: def.pushboxCrouch, hurtboxes: def.hurtboxCrouch },
    air: { pushbox: def.pushboxAir, hurtboxes: def.hurtboxAir },
  },
  stateArt: stateIds.map((id) => ({ id, newArtStatus: '未完成', newOriginalDrawingCount: null, mappingNote: id === 'attack' || id === 'throw' ? '实际动画还取决于 moveId；并非独立一张画。' : '逻辑状态不是原画张数；同姿势复用必须另留理由。' })),
  presentationArt: ['win', 'portrait'].map((id) => ({ id, newArtStatus: '未完成', newOriginalDrawingCount: null })),
  moves: def.moves.map((move) => exportMove(def, move)),
}));
const matrix = {
  title: '两角色动作时序0912', generatedAt: new Date().toISOString(),
  generator: 'npx vite-node scripts/export_action_matrix.ts',
  sourcePolicy: 'Read-only snapshot of the current working tree, with source SHA256. Does not claim runtime/art acceptance.',
  sources, logicFps: LOGIC_FPS,
  conventions: {
    frameOrigin: '0-based stateFrame', intervals: '[startFrame0, endFrameExclusive0)',
    box: '[x,y,w,h] in pixels; origin at fighter feet, facing right, negative y is up; projectile box origin at projectile position.',
    timing: 'Base logical timings exclude hitstop, interruptions, cancels and connected command-throw extensions. Startups are durations; first active display frame is startupFrames + 1.',
    hurtboxes: 'Segment defaults use the move input stance; actual airborne/posture changes remain governed by FightSim.',
    drawingCount: 'Logical sprite indices and state mappings are not original drawing counts; all newly planned art remains unfinished.',
    utilityRecovery: 'Utility builder final segment is declared recovery. Meteor spawns may continue during it; do not stop projectile presentation at recoveryStartFrame0.',
  },
  stateDurations: { prejump: PREJUMP_FRAMES, landing: LANDING_FRAMES, knockdown: KNOCKDOWN_FRAMES, getup: GETUP_FRAMES, throw_tech: THROW_TECH_FRAMES },
  reachableReactionNotes: ['A launching hit enters hit_air even if jump inputs are disabled.', 'If alive on landing: soft knockdown with an attack held may enter getup directly; otherwise knockdown then getup. Hard knockdown cannot skip knockdown. Zero HP may enter ko.'],
  characters,
};
const jsonPath = resolve(root, 'docs/design/动作时序0912.json');
writeFileSync(jsonPath, JSON.stringify(matrix, null, 2) + '\n', 'utf8');

const move = (character: string, id: string) => characters.find((entry) => entry.id === character)!.moves.find((entry) => entry.id === id)!;
const row = (character: string, id: string): string => {
  const data = move(character, id), timing = data.timing;
  const owner = characters.find((entry) => entry.id === character)!.name;
  return `| ${owner}·${data.name}（${id}） | ${timing.startupFrames} | ${timing.activeIntervals.map((part) => `${part.startFrame0 + 1}–${part.endFrameExclusive0}`).join('、') || '无近身框'} | ${timing.recoveryFrames ?? '见抓取时间轴'} | ${timing.totalFrames} |`;
};
const markdown = `# 动作制作清单 0912

本文件和同目录《动作时序0912.json》由 \`npx vite-node scripts/export_action_matrix.ts\` 从当前代码生成。${characters.map((entry) => `${entry.name} ${entry.moveCount} 招`).join('，')}；每角色另列 ${stateIds.length} 个逻辑状态及胜利/头像。**本轮新增人物原画和动作全部未完成；已有状态映射、sprite 索引、旧图集帧数都不等于新增原画数量或美术验收。** 每次招式数据变更后重跑，JSON 的源文件 SHA256 用于核对这份快照。

## 时序怎么读

JSON 用从 0 开始的 \`stateFrame\`，区间左闭右开，例如 [9,13) 表示第 10–13 帧有效，共 4 帧。下表转成从 1 开始的展示帧；起手、收招、总长都是 60 Hz 逻辑帧数。命中定格、取消、打断和抓取成功后的独立演出会改变实际经过时间，不能把表内总长当墙钟动画时长。

| 招式 | 起手帧数 | 有效展示帧 | 收招帧数 | 基础总帧数 |
|---|---:|---|---:|---:|
${row('luffy', 'st_a')}
${row('luffy', 'st_c')}
${row('akainu', 'st_a')}
${row('akainu', 'sp_daifunka')}
${row('luffy', 'sp_rifle')}
${row('luffy', 'sp_gatling')}

完整矩阵逐招保留每段攻击框/受击框、位移与霸体，另列发射帧、投技释放时刻、取消目标及条件。判定框为脚下原点、朝右的像素坐标，y 向上为负；不是图片裁切范围。

## 第一批可操控样板

- 已选择路飞 \`st_a\` 轻拳和 \`st_c\` 橡胶手枪；后者是单段伸臂能力，并非普通短拳，能检验肩—上臂—伸长段—拳头连接和回收。它的向上击退为 0，适合先锁定地面样板。
- 赤犬先用 \`st_a\` 提供最小反击；双方准备站立、前后走、蹲、站防/蹲防、站立受击/蹲受击。合法命中或格挡后，路飞 \`st_a → st_c\` 可验证取消衔接；空挥不允许这样取消。
- 样板必须真实限制未制作动作的入口，不能只写“禁用”。双击方向可触发冲刺/后撤，组合键可触发翻滚、投技或吹飞，蹲下攻击会选择蹲招；若这些仍能触发，就必须纳入制作和验收。不能触发后才用旧图或缺图回退掩盖。
- 第二个能力样板加入赤犬 \`sp_daifunka\` 大喷火。它是**与身体相连的近身持续判定**，无独立投射物；当前击退 y=${move('akainu', 'sp_daifunka').contact.knockbackPxPerFrame.y}，因此路飞 \`hit_air → knockdown → getup\` 必须同时补齐。禁跳也挡不住被打飞；非硬倒着地时按攻击键可直接受身进入 getup。若允许换边/镜像角色/双方使用击飞技，双方都须覆盖这条链。
- 样板若仍可耗尽血量，就还必须有 ko；若进入正式结算还需胜利动作。未完成时通过明确样板模式约束流程，不能假定“这次不会触发”。

## 扩展动作时的三个区别

1. \`sp_rifle\` 橡胶回旋弹只有一个有效段，击退 y=${move('luffy', 'sp_rifle').contact.knockbackPxPerFrame.y}，属于单次伸臂并击飞；当前不纳入第一批样板。名字有“回旋”不表示可以凭空加多段命中。
2. \`sp_gatling\` 机关枪是 ${move('luffy', 'sp_gatling').timing.distinctHitIds.length} 个 hitId 的多段攻击；拳影可多于实际段数，接触闪光/命中音只能对应真实接触。大喷火与机关枪都不能被画成脱离身体持续伤人的投射物。
3. 犬头和流星按各自 projectileSpawns 发射并独立生存；流星可能在招式数据的最后收招段继续发射。冥狗等指令投抓住后从 0 重开时间轴，释放帧必须相对抓住时刻读取，不能加错到空挥的总帧数里。

## 制作与验收记录

每个动作填写：原画候选/采用列表、脚下根点与肩手连接点、视觉帧停留、镜像处理、透明边缘、复用理由、来源记录、正常速度实机结果。JSON 中 \`newOriginalDrawingCount: null\` 表示尚未确认，不能填旧素材数量冒充。

取消目标只是满足等级/chain/地空限制后的候选，仍需真实命中/格挡/弹反、窗口内输入及足够气量，不保证一定连得上。纯投射物命中不会给施法者打开近身取消窗口，抓住后进入 throw 状态也不是 attack 取消。二档会跳过合规特殊技起手的前若干逻辑帧，矩阵另列 acceleratedByInstall；原画按 stateFrame 对齐，不重拉整招时长。

验收至少覆盖：正常速度与逐帧、双朝向、空挥/命中/格挡、合法取消和受击打断、暂停/恢复与命中定格、击飞着地/受身/起身。当前只交付数据与清单，不代表任何新增原画或动作已完成。
`;
writeFileSync(resolve(root, 'docs/design/动作制作清单0912.md'), markdown, 'utf8');
console.log(`Exported ${characters.map((entry) => `${entry.id}:${entry.moveCount}`).join(', ')} moves; ${stateIds.length} states per character.`);
console.log(jsonPath);
