import { LOGIC_FPS, SUBPIXEL, totalFrames, type FightSim, type FighterState, type MoveData } from '@core/index';

interface VisualPhase {
  start: number;
  end: number;
  frames: readonly number[];
  loopFps?: number;
}

/** One drawing held for an explicit number of 60 Hz simulation ticks. */
export interface FrameExposure { frame: number; ticks: number }
/** Optional authored jump poses follow actual vertical velocity, including short hops. */
export interface AirbornePhases {
  rising: number;
  falling: number;
  /** The optional apex window is in world pixels per 60 Hz tick, independent of density. */
  apex?: { frame: number; maxSpeed: number };
}
export interface AttachmentPoint { x: number; y: number }
/** Coordinates refer to the atlas source frame, after the uniform character scale. */
export interface FrameAttachments {
  size: { width: number; height: number };
  /** May lie outside the cropped image, for airborne or extended poses. */
  root: AttachmentPoint;
  sockets: Record<string, AttachmentPoint>;
}
export interface CharacterPresentation {
  style: 'anime' | 'pixel';
  continuous: boolean;
  attachments: Record<string, FrameAttachments>;
  /** Packed texels per baseline (960 x 540) artwork pixel; never a gameplay scale. */
  textureDensity?: number;
  /** Installed immutable texture keys, resolved by the loader for each frame. */
  frameTextures?: Record<string, string>;
  /** Optional same-canvas pixel layer. Auxiliary frames never count as animation poses. */
  foregroundFrames?: Record<string, string>;
}
export interface AnimeAtlasPage {
  id: string;
  image: string;
  data: string;
  /** Legacy schema 1 did not declare page dimensions. */
  width?: number;
  height?: number;
}
export interface AnimeRuntimeManifest extends CharacterPresentation {
  schemaVersion: 1 | 2;
  characterId: string;
  style: 'anime';
  continuous: true;
  atlas: { image: string; data: string };
  /** Schema 2 requires an explicit page assignment for every frame. */
  pages?: readonly AnimeAtlasPage[];
  framePages?: Record<string, string>;
  anims: AnimTable;
}

/** Only call on a validated manifest; schema 1 remains a single-density single page. */
export function animeAtlasPages(runtime: AnimeRuntimeManifest): readonly AnimeAtlasPage[] {
  return runtime.schemaVersion === 2 ? runtime.pages! : [{ id: 'p0', ...runtime.atlas }];
}

/** The caller supplies renderScale / 2, keeping world coordinates independent of art density. */
export function animeSpriteScale(renderScale: number, textureDensity = 1): number {
  return (renderScale / 2) / textureDensity;
}

/** 非招式状态的动画声明 */
export interface AnimDef {
  frames: number;
  fps: number;
  loop: boolean;
  /** 相对站立的绘制缩放。蹲/跳姿势比例不对时用来压回同一人。 */
  drawScale?: number;
  /** 同一个逻辑姿势段内的视觉帧；帧切换只由 stateFrame 决定。 */
  bySprite?: Record<number, readonly number[]>;
  /** 发射物没有近身 hitbox，发射/收招直接跟随逻辑时间。 */
  timeline?: readonly VisualPhase[];
  /** 抓住以后使用独立时间轴，直到真正放人和收招结束。 */
  throwTimeline?: readonly VisualPhase[];
  pixelArt?: boolean;
  /** Explicit state/attack timing; takes precedence over fps and legacy mappings. */
  exposures?: readonly FrameExposure[];
  /** Timing after a throw actually connects, independent of the attack startup. */
  throwExposures?: readonly FrameExposure[];
  airbornePhases?: AirbornePhases;
}

export type AnimTable = Record<string, AnimDef>;

/** Reactions to explicit connected moves, never replacements for the global thrown state. */
export const HELD_LEG_FLIP = 'held_leg_flip';
export const HELD_LABUBU_THROW = 'held_labubu_throw';
export const HELD_TWINKLE_THROW = 'held_twinkle_throw';
export const HELD_REACTION_ANIMS = [HELD_LEG_FLIP, HELD_LABUBU_THROW, HELD_TWINKLE_THROW] as const;
export type HeldReactionId = typeof HELD_REACTION_ANIMS[number];
export const isHeldReactionAnim = (name: string): name is HeldReactionId => HELD_REACTION_ANIMS.some(reaction => reaction === name);

export function heldReactionForMove(attackerId: string, move: Pick<MoveData, 'id' | 'throwData'> | null): HeldReactionId | null {
  if (!move?.throwData) return null;
  if (attackerId === 'labubu' && move.id === 'sp_leg_flip') return HELD_LEG_FLIP;
  if (move.id !== 'throw_fwd' && move.id !== 'throw_back') return null;
  return attackerId === 'labubu' ? HELD_LABUBU_THROW : attackerId === 'twinkle' ? HELD_TWINKLE_THROW : null;
}

/** Reads the actual pair and the attacker's clock; thrown's own clock does not advance. */
export function connectedHeldReaction(sim: FightSim, victim: FighterState): { anim: HeldReactionId; index: 0 } | null {
  if (sim.state.fighters[victim.player] !== victim || victim.state !== 'thrown' || victim.airborne) return null;
  const attacker = sim.state.fighters[victim.player === 0 ? 1 : 0];
  if (attacker.state !== 'throw' || attacker.hasHit) return null;
  const move = sim.move(attacker), anim = heldReactionForMove(attacker.def.id, move);
  if (!anim || !move?.throwData || !Number.isInteger(attacker.stateFrame)
    || attacker.stateFrame < 0 || attacker.stateFrame >= move.throwData.releaseFrame) return null;
  return { anim, index: 0 };
}

/** Structural gate only: the named grip still needs real pixel/contact acceptance. */
export function heldReactionFrameIssues(
  characterId: string, table: AnimTable, attachments: CharacterPresentation['attachments'], reaction: HeldReactionId = HELD_LEG_FLIP,
): string[] {
  const name = frameName(characterId, reaction, 0), anim = table[reaction], frame = attachments[name];
  const issues: string[] = [];
  if (!record(anim)) issues.push(`${name}: missing conditional reaction animation`);
  else {
    if (anim.frames !== 1 || anim.loop !== false) issues.push(`${name}: held reaction must declare one non-looping pose`);
    if (!Array.isArray(anim.exposures) || !anim.exposures.length
      || !anim.exposures.every(exposure => record(exposure) && exposure.frame === 0 && positiveInteger(exposure.ticks))) issues.push(`${name}: held reaction requires explicit valid exposure`);
  }
  if (!record(frame) || !record(frame.size) || !positiveInteger(frame.size.width) || !positiveInteger(frame.size.height)
    || !point(frame.root) || !record(frame.sockets)) return [...issues, `${name}: missing or invalid attachment geometry`];
  const grip = frame.sockets.grip;
  if (!record(grip) || !finite(grip.x) || !finite(grip.y)
    || grip.x < 0 || grip.y < 0 || grip.x >= frame.size.width || grip.y >= frame.size.height) issues.push(`${name}: missing or invalid grip socket`);
  return issues;
}

/** Named strings hold a debug pose; timed presentation uses an explicit logical clock. */
export type AnimationOverride = string | { anim: string; stateFrame: number };

export interface SpriteStateConfig {
  frames: readonly number[];
  fps: number;
  loop: boolean;
}

export interface SpriteMoveConfig {
  frames: readonly number[];
  startup: readonly number[];
  active: readonly number[];
  recovery: readonly number[];
}

/** 显式素材清单同时驱动图集和运行时动画，避免两个地方的帧数漂移。 */
export function spriteAnimations(states: Record<string, SpriteStateConfig>, moves: Record<string, SpriteMoveConfig>, definitions: readonly MoveData[]): AnimTable {
  const table: AnimTable = {};
  for (const [state, config] of Object.entries(states)) {
    table[state] = { frames: config.frames.length, fps: config.fps, loop: config.loop, pixelArt: true };
  }
  for (const move of definitions) {
    const config = moves[move.id];
    if (!config) continue;
    const lastSprite = move.frames.at(-1)!.sprite;
    const bySprite: Record<number, readonly number[]> = {};
    for (const frame of move.frames) {
      bySprite[frame.sprite] = frame.hitboxes?.length ? config.active : frame.sprite === lastSprite ? config.recovery : config.startup;
    }
    const def: AnimDef = { frames: config.frames.length, fps: LOGIC_FPS, loop: false, bySprite, pixelArt: true };
    const total = totalFrames(move);
    if (move.projectiles?.length && !move.frames.some((frame) => frame.hitboxes?.length)) {
      const first = Math.min(...move.projectiles.map((projectile) => projectile.frame));
      const last = Math.max(...move.projectiles.map((projectile) => projectile.frame));
      const recovery = Math.min(total, Math.max(total - move.frames.at(-1)!.duration, last + 1));
      def.timeline = [
        { start: 0, end: first, frames: config.startup },
        { start: first, end: recovery, frames: config.active },
        { start: recovery, end: total, frames: config.recovery },
      ];
    }
    if (move.throwData) {
      const release = move.throwData.releaseFrame;
      const end = move.throwData.duration ?? total;
      const windup = Math.min(6, Math.max(1, Math.floor(release / 4)));
      def.throwTimeline = [
        { start: 0, end: windup, frames: config.startup },
        { start: windup, end: release, frames: config.active, loopFps: 12 },
        { start: release, end, frames: [config.active.at(-1) ?? 0, ...config.recovery] },
      ];
    }
    table[move.id] = def;
  }
  return table;
}

/** 所有角色共用的默认状态动画表；角色可在自己的 animations.ts 覆盖 */
export const DEFAULT_ANIMS: AnimTable = {
  idle: { frames: 4, fps: 8, loop: true },
  walk_fwd: { frames: 4, fps: 10, loop: true },
  walk_back: { frames: 4, fps: 10, loop: true },
  crouch: { frames: 1, fps: 1, loop: false },
  prejump: { frames: 1, fps: 1, loop: false },
  jump_neutral: { frames: 2, fps: 6, loop: false },
  jump_fwd: { frames: 2, fps: 6, loop: false },
  jump_back: { frames: 2, fps: 6, loop: false },
  landing: { frames: 1, fps: 1, loop: false },
  dash: { frames: 2, fps: 12, loop: true },
  backdash: { frames: 2, fps: 6, loop: false },
  roll_fwd: { frames: 4, fps: 12, loop: true },
  roll_back: { frames: 4, fps: 12, loop: true },
  block_stand: { frames: 1, fps: 1, loop: false },
  block_crouch: { frames: 1, fps: 1, loop: false },
  hit_stand: { frames: 1, fps: 1, loop: false },
  hit_crouch: { frames: 1, fps: 1, loop: false },
  hit_air: { frames: 1, fps: 1, loop: false },
  knockdown: { frames: 1, fps: 1, loop: false },
  getup: { frames: 2, fps: 8, loop: false },
  throw: { frames: 2, fps: 4, loop: false },
  thrown: { frames: 1, fps: 1, loop: false },
  throw_tech: { frames: 1, fps: 1, loop: false },
  ko: { frames: 1, fps: 1, loop: false },
  /** 演出用（非逻辑状态）：胜利姿势、选人 / 标题立绘 */
  win: { frames: 1, fps: 1, loop: false },
  portrait: { frames: 1, fps: 1, loop: false },
};

export const frameName = (charId: string, anim: string, index: number): string => `${charId}/${anim}/${index}`;

/**
 * 当前应显示的动画名与帧号（确定性：由逻辑状态直接推导，不用 Phaser 的计时动画）。
 * override 用于演出（如回合结束胜者摆 win 姿势）。
 */
export function animDrawScale(table: AnimTable, anim: string): number {
  return table[anim]?.drawScale ?? DEFAULT_ANIMS[anim]?.drawScale ?? 1;
}

export function currentAnimation(sim: FightSim, f: FighterState, table: AnimTable, override?: AnimationOverride): { anim: string; index: number } {
  if (override) {
    if (typeof override !== 'string') {
      const def = table[override.anim] ?? DEFAULT_ANIMS[override.anim];
      return { anim: override.anim, index: def ? animIndex(def, override.stateFrame) : 0 };
    }
    const sep = override.indexOf('/');
    if (sep >= 0) return { anim: override.slice(0, sep), index: Number(override.slice(sep + 1)) || 0 };
    return { anim: override, index: 0 };
  }
  if ((f.state === 'attack' || f.state === 'throw') && f.moveId) {
    const visual = table[f.moveId];
    if (f.state === 'throw') {
      if (visual?.throwExposures) return { anim: f.moveId, index: exposureIndex(visual.throwExposures, f.stateFrame, false) };
      if (visual?.throwTimeline) return { anim: f.moveId, index: timelineIndex(visual.throwTimeline, f.stateFrame) };
      const def = table['throw'] ?? DEFAULT_ANIMS['throw']!;
      return { anim: 'throw', index: animIndex(def, f.stateFrame) };
    }
    const fd = sim.currentFrame(f);
    const move = sim.move(f);
    if (visual?.exposures) return { anim: f.moveId, index: exposureIndex(visual.exposures, f.stateFrame, false) };
    if (visual?.timeline) return { anim: f.moveId, index: timelineIndex(visual.timeline, f.stateFrame) };
    return { anim: f.moveId, index: visual?.bySprite && move ? moveVisualIndex(move, f.stateFrame, visual.bySprite) : fd?.sprite ?? 0 };
  }
  const def = table[f.state] ?? DEFAULT_ANIMS[f.state] ?? { frames: 1, fps: 1, loop: false };
  if (f.airborne && def.airbornePhases) {
    const phases = def.airbornePhases;
    const index = phases.apex && Math.abs(f.vy) <= phases.apex.maxSpeed * SUBPIXEL
      ? phases.apex.frame : f.vy < 0 ? phases.rising : phases.falling;
    return { anim: f.state, index };
  }
  return { anim: f.state, index: animIndex(def, f.stateFrame) };
}

function timelineIndex(phases: readonly VisualPhase[], stateFrame: number): number {
  const phase = phases.find((part) => part.end > part.start && stateFrame < part.end) ?? phases.at(-1);
  if (!phase?.frames.length) return 0;
  const elapsed = Math.max(0, stateFrame - phase.start);
  if (phase.loopFps) return phase.frames[Math.floor(elapsed * phase.loopFps / LOGIC_FPS) % phase.frames.length]!;
  return phase.frames[Math.min(phase.frames.length - 1, Math.floor(elapsed * phase.frames.length / Math.max(1, phase.end - phase.start)))]!;
}

/** 连续且同 sprite 的逻辑段合并取时长，例如起手霸体消失不应把动作倒放到第一帧。 */
export function moveVisualIndex(move: MoveData, stateFrame: number, sequences: Record<number, readonly number[]>): number {
  let start = 0;
  for (let i = 0; i < move.frames.length; i++) {
    const frame = move.frames[i]!;
    let duration = frame.duration;
    while (i + 1 < move.frames.length && move.frames[i + 1]!.sprite === frame.sprite) duration += move.frames[++i]!.duration;
    if (stateFrame < start + duration || i === move.frames.length - 1) {
      const sequence = sequences[frame.sprite];
      if (!sequence?.length) return frame.sprite;
      const elapsed = Math.max(0, stateFrame - start);
      return sequence[Math.min(sequence.length - 1, Math.floor(elapsed * sequence.length / Math.max(1, duration)))]!;
    }
    start += duration;
  }
  return 0;
}

function animIndex(def: AnimDef, stateFrame: number): number {
  if (def.exposures) return exposureIndex(def.exposures, stateFrame, def.loop);
  if (def.frames <= 1) return 0;
  const framesPer = Math.max(1, Math.round(LOGIC_FPS / def.fps));
  const i = Math.floor(stateFrame / framesPer);
  return def.loop ? i % def.frames : Math.min(i, def.frames - 1);
}

/** 图集需要包含的全部帧名（生成占位图集 / 校验素材完整性用）。 */
export function requiredFrames(charId: string, table: AnimTable, moveFrameCounts: Record<string, number>): string[] {
  const out = new Set<string>();
  for (const [anim, def] of Object.entries({ ...DEFAULT_ANIMS, ...table })) {
    for (let i = 0; i < def.frames; i++) out.add(frameName(charId, anim, i));
  }
  for (const [moveId, n] of Object.entries(moveFrameCounts)) {
    for (let i = 0; i < n; i++) out.add(frameName(charId, moveId, i));
  }
  return [...out];
}

/** No wall clock or mutable cursor: hitstop and frame stepping cannot drift. */
export function exposureIndex(exposures: readonly FrameExposure[], stateFrame: number, loop: boolean): number {
  const total = exposures.reduce((sum, exposure) => sum + exposure.ticks, 0);
  if (!exposures.length || total <= 0) return 0;
  let tick = Math.max(0, Math.floor(stateFrame));
  if (loop) tick %= total;
  for (const exposure of exposures) {
    if (tick < exposure.ticks) return exposure.frame;
    tick -= exposure.ticks;
  }
  return exposures.at(-1)!.frame;
}

export function attachmentPoint(
  frame: FrameAttachments, socket: string,
  transform: { x: number; y: number; facing: 1 | -1; scaleX: number; scaleY: number },
): AttachmentPoint | null {
  const point = socket === 'root' ? frame.root : frame.sockets[socket];
  return point ? {
    x: transform.x + (point.x - frame.root.x) * transform.scaleX * transform.facing,
    y: transform.y + (point.y - frame.root.y) * transform.scaleY,
  } : null;
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const positiveInteger = (value: unknown): value is number => finite(value) && Number.isInteger(value) && value > 0;
const point = (value: unknown): boolean => record(value) && finite(value.x) && finite(value.y);

/** Validate before installing a candidate; errors must not silently select legacy character art. */
export function validateAnimeRuntimeManifest(value: unknown, moves?: readonly MoveData[]): string[] {
  const errors: string[] = [];
  if (!record(value)) return ['manifest must be an object'];
  if ((value.schemaVersion !== 1 && value.schemaVersion !== 2) || value.style !== 'anime' || value.continuous !== true) errors.push('unsupported schema/style/continuous capability');
  if (typeof value.characterId !== 'string' || !/^[a-z][a-z0-9_]*$/.test(value.characterId)) errors.push('invalid characterId');
  if (!record(value.atlas) || !['atlas.png', 'atlas.webp'].includes(String(value.atlas.image)) || value.atlas.data !== 'atlas.json') errors.push('atlas must reference local atlas.png/webp and atlas.json');
  if (value.textureDensity !== undefined && (!finite(value.textureDensity) || value.textureDensity <= 0 || value.textureDensity > 4)) errors.push('textureDensity must be in (0,4]');
  const pages = new Map<string, Record<string, unknown>>();
  if (value.schemaVersion === 2) {
    if (value.textureDensity === undefined) errors.push('schema 2 requires textureDensity');
    if (!Array.isArray(value.pages) || !value.pages.length) errors.push('schema 2 requires atlas pages');
    else for (const [index, page] of value.pages.entries()) {
      const id = `p${index}`, stem = index === 0 ? 'atlas' : `atlas-${id}`;
      if (!record(page) || page.id !== id || ![`${stem}.png`, `${stem}.webp`].includes(String(page.image)) || page.data !== `${stem}.json` || !positiveInteger(page.width) || !positiveInteger(page.height) || page.width > 4096 || page.height > 4096) {
        errors.push(`invalid atlas page ${id}: expected local files and dimensions within 4096`);
        continue;
      }
      pages.set(id, page);
    }
    if (!record(value.framePages)) errors.push('schema 2 requires framePages');
  } else if (value.pages !== undefined || value.framePages !== undefined) errors.push('schema 1 cannot declare pages');
  if (!record(value.anims) || !Object.keys(value.anims).length) return [...errors, 'anims must contain explicit animations'];
  if (!record(value.attachments)) return [...errors, 'attachments must be an object'];
  const attachments = value.attachments;
  const expectedFrames = new Set<string>();
  const usedPages = new Set<string>();
  const checkFrame = (key: string): void => {
    const frame = attachments[key];
    expectedFrames.add(key);
    if (!record(frame) || !record(frame.size) || !positiveInteger(frame.size.width) || !positiveInteger(frame.size.height) || !point(frame.root) || !record(frame.sockets) || !Object.values(frame.sockets).every(point)) errors.push(`${key}: missing or invalid attachment geometry`);
    if (value.schemaVersion === 2 && record(value.framePages)) {
      const pageId = value.framePages[key], page = typeof pageId === 'string' ? pages.get(pageId) : undefined;
      if (!page) errors.push(`${key}: missing or invalid atlas page`);
      else {
        usedPages.add(String(pageId));
        if (record(frame) && record(frame.size) && finite(frame.size.width) && finite(frame.size.height) && finite(page.width) && finite(page.height) && (frame.size.width > page.width || frame.size.height > page.height)) errors.push(`${key}: frame geometry exceeds atlas page`);
      }
    }
  };
  for (const [name, anim] of Object.entries(value.anims)) {
    if (!/^[a-z][a-z0-9_]*$/.test(name) || !record(anim)) { errors.push(`invalid animation ${name}`); continue; }
    if (!positiveInteger(anim.frames) || anim.fps !== LOGIC_FPS || typeof anim.loop !== 'boolean' || anim.pixelArt !== false) errors.push(`${name}: invalid frame count/style`);
    if (anim.drawScale !== undefined && anim.drawScale !== 1) errors.push(`${name}: per-action body scaling is forbidden`);
    if (anim.airbornePhases !== undefined) {
      const phases = anim.airbornePhases;
      const validFrame = (index: unknown): index is number => finite(index) && Number.isInteger(index) && index >= 0 && positiveInteger(anim.frames) && index < anim.frames;
      if (!['jump_neutral', 'jump_fwd', 'jump_back'].includes(name) || !record(phases)
        || !validFrame(phases.rising) || !validFrame(phases.falling) || phases.rising === phases.falling
        || (phases.apex !== undefined && (!record(phases.apex) || !validFrame(phases.apex.frame)
          || phases.apex.frame === phases.rising || phases.apex.frame === phases.falling
          || !finite(phases.apex.maxSpeed) || phases.apex.maxSpeed < 0))) errors.push(`${name}: invalid airborne phase poses`);
    }
    const checkExposures = (raw: unknown, label: string): number | null => {
      if (!Array.isArray(raw) || !raw.length) { errors.push(`${name}: ${label} must be nonempty`); return null; }
      let total = 0;
      for (const exposure of raw) {
        if (!record(exposure) || !finite(exposure.frame) || !Number.isInteger(exposure.frame) || exposure.frame < 0 || !positiveInteger(anim.frames) || exposure.frame >= anim.frames || !positiveInteger(exposure.ticks)) {
          errors.push(`${name}: invalid ${label} exposure`); return null;
        }
        total += exposure.ticks;
      }
      return total;
    };
    const duration = checkExposures(anim.exposures, 'exposures');
    const move = moves?.find((entry) => entry.id === name);
    if (move && (duration !== totalFrames(move) || anim.loop)) errors.push(`${name}: exposure duration must match the non-looping move`);
    if (anim.throwExposures !== undefined) {
      const duration = checkExposures(anim.throwExposures, 'throwExposures');
      if (move && (!move.throwData || duration !== (move.throwData.duration ?? totalFrames(move)))) errors.push(`${name}: throw duration mismatch`);
    } else if (move?.throwData) errors.push(`${name}: connected throw requires throwExposures`);
    if (positiveInteger(anim.frames)) for (let index = 0; index < anim.frames; index++) {
      checkFrame(frameName(String(value.characterId), name, index));
    }
  }
  // Conditional on the actual caster's moves; once declared, each pose must be complete.
  for (const reaction of HELD_REACTION_ANIMS) if (Object.hasOwn(value.anims, reaction)) {
    errors.push(...heldReactionFrameIssues(String(value.characterId), value.anims as AnimTable, attachments as CharacterPresentation['attachments'], reaction));
  }
  if (value.foregroundFrames !== undefined) {
    if (!record(value.foregroundFrames)) errors.push('foregroundFrames must be an explicit frame map');
    else {
      const bodyFrames = new Set(expectedFrames);
      for (const [body, foreground] of Object.entries(value.foregroundFrames)) {
        if (!bodyFrames.has(body) || foreground !== `${body}/foreground`) { errors.push(`${body}: invalid foreground frame reference`); continue; }
        checkFrame(foreground);
        const base = attachments[body], layer = attachments[foreground];
        if (!record(base) || !record(layer) || !record(base.size) || !record(layer.size) || !record(base.root) || !record(layer.root)
          || base.size.width !== layer.size.width || base.size.height !== layer.size.height || base.root.x !== layer.root.x || base.root.y !== layer.root.y) errors.push(`${body}: foreground must share body canvas and root`);
      }
    }
  }
  for (const key of Object.keys(attachments)) if (!expectedFrames.has(key)) errors.push(`${key}: undeclared attachment geometry`);
  if (value.schemaVersion === 2 && record(value.framePages)) {
    for (const key of Object.keys(value.framePages)) if (!expectedFrames.has(key)) errors.push(`${key}: undeclared atlas frame`);
    for (const id of pages.keys()) if (!usedPages.has(id)) errors.push(`${id}: unused atlas page`);
  }
  return errors;
}

export function isAnimeRuntimeManifest(value: unknown): value is AnimeRuntimeManifest {
  return validateAnimeRuntimeManifest(value).length === 0;
}
