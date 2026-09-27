import {
  Btn, GRAVITY, GROUND_Y, K, MAX_FALL_SPEED, P, STAGE_LEFT, STAGE_RIGHT, SUBPIXEL,
  frameAt, overlaps, px, toWorldBox, type Box, type BoxPx, type FighterState, type MoveData,
} from '@core/index';
import type { AiAction, Btn4 } from './types';

const BUTTONS: Record<Btn4, number> = { A: Btn.A, B: Btn.B, C: Btn.C, D: Btn.D };

/** 粗筛明显打不到的近身攻击和投技；可及不等于必定命中，不预测玩家下一帧输入。 */
export function actionCanReach(action: AiAction, me: FighterState, opp: FighterState): boolean {
  let candidates: readonly MoveData[];
  if (action.kind === 'normal') {
    candidates = me.def.moves.filter((m) =>
      !m.input.motion && !m.input.plus && m.type !== 'throw' &&
      m.input.stance === action.stance && m.input.button === BUTTONS[action.button] &&
      (action.forward ? m.input.direction === 6 : m.input.direction === undefined),
    );
  } else if (action.kind === 'throw') {
    return !opp.airborne && me.def.moves.some((m) =>
      m.type === 'throw' && m.throwData && Math.abs(me.x - opp.x) <= m.throwData.range * SUBPIXEL,
    );
  } else if (action.kind === 'special') {
    candidates = me.def.moves.filter((m) => m.input.motion === action.motion &&
      (m.input.button & (action.button === 'P' ? P : K)) !== 0 &&
      (m.meterCost ?? 0) <= me.meter);
  } else return true;

  const hurtboxes = currentHurtboxes(opp);
  return candidates.some((move) => {
    // 投射物的生成点、飞行与反射另需评估，此处保守豁免，不能将近身距离当成射程。
    if (move.projectiles?.length || move.install || move.reflect || move.dodge) return true;
    if (move.throwData && opp.airborne) return false;
    let advance = 0;
    let elapsed = 0;
    let velocity = me.airborne ? me.vx * me.facing : 0;
    for (const frame of move.frames) {
      if (frame.velocity?.x) velocity = px(frame.velocity.x);
      else if (!me.airborne) velocity = 0; // 与 core 相同：地面缺省位移不会沿用启动段速度。
      if (frame.hitboxes?.length) {
        const target = targetEnvelope(opp, hurtboxes, elapsed + frame.duration - 1);
        for (const hitbox of frame.hitboxes) {
          // 打击判定先于本帧物理；active 最后一帧判定时，只完成了 duration - 1 次位移。
          const start = toWorldBox(hitbox, me.x + advance * me.facing, me.y, me.facing);
          const end = toWorldBox(hitbox, me.x + (advance + velocity * (frame.duration - 1)) * me.facing, me.y, me.facing);
          const area = { x: Math.min(start.x, end.x), y: start.y, w: start.w + Math.abs(end.x - start.x), h: start.h };
          if (target.some((box) => overlaps(area, box))) return true;
        }
      }
      advance += velocity * frame.duration;
      elapsed += frame.duration;
    }
    return false;
  });
}

/** 当前攻击姿态与当前帧伸出的肢体都属于可打部位，不能一律按站立躯干判断。 */
function currentHurtboxes(f: FighterState): readonly BoxPx[] {
  const move = f.state === 'attack' ? f.def.moves.find((m) => m.id === f.moveId) : undefined;
  const frame = move ? frameAt(move, f.stateFrame) : null;
  if (frame?.hurtboxes) return frame.hurtboxes;
  if (f.airborne) return f.def.hurtboxAir;
  const crouching = move?.input.stance === 'crouch' ||
    ['crouch', 'block_crouch', 'hit_crouch', 'roll_fwd', 'roll_back', 'knockdown'].includes(f.state);
  return crouching ? f.def.hurtboxCrouch : f.def.hurtboxStand;
}

/**
 * 空中目标可能在出招启动时接近：沿已知速度和重力保留当前位置到 active 的范围。
 * 这是保守包络，不模拟未来出招、取消、受击或躲避，也不据此保证一次攻击命中。
 */
function targetEnvelope(f: FighterState, boxes: readonly BoxPx[], horizon: number): Box[] {
  if (!f.airborne) return boxes.map((b) => toWorldBox(b, f.x, f.y, f.facing));
  let x = f.x;
  let y = f.y;
  let vy = f.vy;
  let minX = x;
  let maxX = x;
  let minY = y;
  let maxY = y;
  let landed = false;
  const halfW = (f.def.pushboxStand[2] * SUBPIXEL) >> 1;
  for (let i = 0; i < Math.max(0, horizon - f.hitstop); i++) {
    x = Math.max(STAGE_LEFT + halfW, Math.min(STAGE_RIGHT - halfW, x + f.vx));
    vy = Math.min(vy + GRAVITY, MAX_FALL_SPEED);
    y = Math.min(GROUND_Y, y + vy);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    if (y === GROUND_Y) {
      landed = true;
      break;
    }
  }
  const areas = boxes.map((b) => {
    const start = toWorldBox(b, minX, minY, f.facing);
    return { ...start, w: start.w + maxX - minX, h: start.h + maxY - minY };
  });
  if (landed) areas.push(...f.def.hurtboxStand.map((b) => toWorldBox(b, x, GROUND_Y, f.facing)));
  return areas;
}
