import { Btn, K, P, Rng, SUBPIXEL, firstActiveFrame, inStartupOrActive, type FightSim, type FighterState, type PlayerIndex } from '@core/index';
import { DIFFICULTY, type AiAction, type AiOption, type AiProfile, type Btn4, type Difficulty } from './types';
import { actionCanReach } from './attackRange';

const BTN: Record<Btn4, number> = { A: Btn.A, B: Btn.B, C: Btn.C, D: Btn.D };
const NOTHING_TO_DO: readonly number[] = [];

/**
 * CPU 对手。每帧 input(sim) 返回一名玩家的输入位图。
 * - 只读世界状态，只输出输入，搓招通过多帧脚本队列完成（AGENTS.md：AI 不直接改 core）
 * - 可种子随机，同一 seed 与同一对局输入 → 同一行为（保证可复现测试）
 * - 难度只改变"人的缺陷"参数：反应延迟、防御率、搓招成功率、连段意愿
 */
export class Cpu {
  private readonly rng: Rng;
  private readonly params;
  /** 待发送的输入脚本（每帧一个位图） */
  private script: number[] = [];
  /** 持续按住（防御 / 行走 / 奔跑） */
  private hold: { bits: number; frames: number; block?: boolean } | null = null;
  /** 下一次中立决策的逻辑帧；动作和硬直期间经过的时间同样计入反应间隔。 */
  private nextDecisionAt = 0;
  /** 同一招连续再出也要作为新动作观察。 */
  private lastOppInstance: number | null = null;
  private observedAttackAt = 0;
  private techArmed = false;
  /** 特殊技冷却：motion+button → 上次使用的帧号（防止同一招无脑连发） */
  private lastUsed = new Map<string, number>();
  private frame = 0;
  /** 看到威胁后，等到 readyAt 才防御（反应延迟） */
  private pendingBlock: { readyAt: number; low: boolean } | null = null;
  /** 同一次出招只决定一次续招，避免在 hitstop 中反复重置搓招脚本。 */
  private comboConsideredInstance = -1;
  /** 诊断：实际读取 followups 的次数 */
  followupChecks = 0;

  constructor(
    private readonly player: PlayerIndex,
    private readonly profile: AiProfile,
    readonly difficulty: Difficulty = 'normal',
    seed = 1,
  ) {
    this.rng = new Rng(seed);
    this.params = DIFFICULTY[difficulty];
  }

  input(sim: FightSim): number {
    const w = sim.state;
    this.frame = w.frame;
    if (w.phase !== 'fight') {
      this.comboConsideredInstance = -1;
      this.script = [];
      this.hold = null;
      this.pendingBlock = null;
      this.lastOppInstance = null;
      this.nextDecisionAt = 0;
      return 0;
    }
    const me = w.fighters[this.player];
    const opp = w.fighters[this.player === 0 ? 1 : 0];
    if (me.state !== 'attack') this.comboConsideredInstance = -1;

    if (me.state === 'thrown') {
      if (!this.techArmed) {
        this.techArmed = true;
        return this.roll(this.params.techChance) ? Btn.C : 0;
      }
      return 0;
    }
    this.techArmed = false;

    if (me.state === 'hit_air' && me.vy > 0 && !me.hardKnockdown) return this.roll(this.params.comboWill) ? Btn.A : 0;

    const oppInstance = opp.state === 'attack' ? opp.moveInstance : null;
    const oppStarted = oppInstance !== null && oppInstance !== this.lastOppInstance;
    this.lastOppInstance = oppInstance;
    if (oppStarted) {
      this.observedAttackAt = this.frame;
      this.pendingBlock = null;
    }

    // 新起手：只登记延迟防御，当帧不挡。已在预判防御中则保留。
    if (oppStarted && this.isThreat(sim, opp) && this.roll(this.params.blockChance)) {
      if (!this.hold?.block) {
        this.pendingBlock = {
          readyAt: this.frame + this.params.reaction,
          low: this.pickLow(sim, opp),
        };
      }
    }
    if (this.pendingBlock && !this.isThreat(sim, opp) && opp.state !== 'attack') this.pendingBlock = null;

    // 命中确认：必须在取消窗口内决策，不被中立决策间隔 / actionable 挡掉
    if (this.canCancelCombo(me)) {
      if (this.comboConsideredInstance !== me.moveInstance) {
        this.comboConsideredInstance = me.moveInstance;
        const follow = this.decideFollowup(sim, me);
        if (follow) {
          this.script = [];
          this.hold = null;
          this.enqueue(follow, me, opp);
        }
      }
      return this.dequeue();
    }

    if (this.pendingBlock && this.frame >= this.pendingBlock.readyAt) {
      const pending = this.pendingBlock;
      this.pendingBlock = null;
      // 反应完成时重新检查剩余威胁，不能把等待过的帧数再加到持防时间里。
      // 对手已收招/离开射程时取消过期防御，让正常决策处理确反或接近。
      if (this.isThreat(sim, opp)) {
        this.script = [];
        this.enqueue({ kind: 'block', frames: this.threatFrames(sim, opp), low: pending.low }, me, opp);
        return this.dequeue();
      }
    }

    if (this.script.length) return this.script.shift()!;
    if (this.hold) {
      if (--this.hold.frames <= 0) this.hold = null;
      else return this.hold.bits;
    }

    if (!this.actionable(me)) return 0;

    if (this.frame < this.nextDecisionAt) return 0;
    this.nextDecisionAt = this.frame + this.params.reaction;

    const action = this.decide(sim, me, opp);
    if (action) this.enqueue(action, me, opp);
    return this.dequeue();
  }

  private dequeue(): number {
    if (this.script.length) return this.script.shift()!;
    const h = this.hold;
    return h ? h.bits : 0;
  }

  private canCancelCombo(me: FighterState): boolean {
    return me.state === 'attack' && me.hasHit && me.stateFrame <= me.cancelUntil;
  }

  private decideFollowup(sim: FightSim, me: FighterState): AiAction | null {
    this.followupChecks++;
    if (!this.roll(this.params.comboWill)) return null;
    const myMove = sim.move(me);
    if (this.profile.confirmCombo && myMove?.id === this.profile.confirmCombo.from) {
      return this.profile.confirmCombo.action;
    }
    const group = this.profile.followups.find((f) => f.from.includes('*') || (myMove && f.from.includes(myMove.id)));
    return group ? this.pick(group.options, me) : null;
  }

  private decide(sim: FightSim, me: FighterState, opp: FighterState): AiAction | null {
    const dist = Math.abs(me.x - opp.x) / SUBPIXEL;
    const oppMove = sim.move(opp);
    if (opp.state === 'attack' && oppMove && !inStartupOrActive(oppMove, opp.stateFrame)
      && this.frame - this.observedAttackAt >= this.params.reaction && this.roll(this.params.comboWill)) {
      // 确反按实际招式可达性筛选，不用近身分区截断长手的合法反击距离。
      const a = this.pick(this.profile.punish ?? this.profile.close, me, opp);
      if (a) return a;
    }
    if (opp.state === 'attack' && oppMove && this.profile.armorBreak && sim.hasArmor(opp) && dist < this.profile.midRange && actionCanReach(this.profile.armorBreak, me, opp) && this.roll(this.params.motionSuccess)) {
      return this.profile.armorBreak;
    }
    if (opp.state === 'attack' && this.frame - this.observedAttackAt >= this.params.reaction && this.isThreat(sim, opp) && this.pendingBlock === null && this.roll(this.params.blockChance)) {
      const g = oppMove?.guard;
      return { kind: 'block', frames: this.threatFrames(sim, opp), low: g === 'low' || (g !== 'high' && this.roll(50)) };
    }

    const incoming = sim.state.projectiles.find((p) => p.owner !== this.player && Math.sign(p.vx) === Math.sign(me.x - p.x) && Math.abs(p.x - me.x) / SUBPIXEL < 220);
    if (incoming) {
      const a = this.pick(this.profile.projectileAnswer, me, opp);
      if (a) return a;
    }

    if (opp.airborne && dist < 120 && opp.y < -20 * SUBPIXEL) {
      const a = this.pick(this.profile.antiAir, me, opp);
      if (a) return a;
    }

    if (opp.state === 'knockdown' || opp.state === 'getup') {
      const a = this.pick(this.profile.okizeme, me, opp);
      if (a) return a;
    }

    if (!this.roll(this.params.aggression)) {
      return this.roll(50) ? { kind: 'wait', frames: 6 } : { kind: 'walk', dir: dist < this.profile.closeRange ? -1 : 1, frames: 8 };
    }
    const zone = dist < this.profile.closeRange ? this.profile.close : dist < this.profile.midRange ? this.profile.mid : this.profile.far;
    return this.pick(zone, me, opp) ?? { kind: 'walk', dir: 1, frames: 8 };
  }

  private isThreat(sim: FightSim, opp: FightSim['state']['fighters'][number]): boolean {
    if (opp.state !== 'attack') return false;
    const m = sim.move(opp);
    if (!m || !inStartupOrActive(m, opp.stateFrame)) return false;
    let reach = 0;
    for (const f of m.frames) for (const hb of f.hitboxes ?? []) reach = Math.max(reach, hb[0] + hb[2]);
    const me = sim.state.fighters[this.player];
    const remaining = Math.max(0, firstActiveFrame(m) - opp.stateFrame);
    const towards = Math.sign(opp.x - me.x) === Math.sign(me.vx) ? (Math.abs(me.vx) * remaining) / SUBPIXEL : 0;
    const advance = Math.max(0, ...m.frames.map((f) => f.velocity?.x ?? 0)) * remaining;
    return Math.abs(me.x - opp.x) / SUBPIXEL - towards - advance < reach + 40;
  }

  private threatFrames(sim: FightSim, opp: FighterState): number {
    const m = sim.move(opp);
    if (!m) return 12;
    const total = m.frames.reduce((n, f) => n + f.duration, 0);
    let lastActiveEnd = 0;
    let acc = 0;
    for (const f of m.frames) {
      acc += f.duration;
      if (f.hitboxes) lastActiveEnd = acc;
    }
    const until = Math.max(lastActiveEnd, Math.min(total, lastActiveEnd + 4)) - opp.stateFrame;
    return Math.max(8, until + 4);
  }

  private pickLow(sim: FightSim, opp: FighterState): boolean {
    const g = sim.move(opp)?.guard;
    return g === 'low' || (g !== 'high' && this.roll(50));
  }

  private actionable(me: FighterState): boolean {
    return me.state === 'idle' || me.state === 'walk_fwd' || me.state === 'walk_back' || me.state === 'crouch' || me.state === 'dash';
  }

  private enqueue(a: AiAction, me: FighterState, opp: FighterState): void {
    const F = me.facing === 1 ? Btn.Right : Btn.Left;
    const B = me.facing === 1 ? Btn.Left : Btn.Right;
    const D = Btn.Down;
    switch (a.kind) {
      case 'walk':
        this.hold = { bits: a.dir === 1 ? F : B, frames: a.frames };
        break;
      case 'run':
        this.script = [F, 0, F];
        this.hold = { bits: F, frames: a.frames };
        break;
      case 'backdash':
        this.script = [B, 0, B, 0];
        break;
      case 'jump': {
        const dir = a.dir === 1 ? F : a.dir === -1 ? B : 0;
        const s: number[] = [Btn.Up | dir, Btn.Up | dir, Btn.Up | dir, Btn.Up | dir, 0];
        if (a.attack) {
          for (let i = 0; i < (a.delay ?? 12); i++) s.push(0);
          s.push(BTN[a.attack], 0);
        }
        this.script = s;
        break;
      }
      case 'normal': {
        const dir = a.forward ? F : 0;
        const stance = a.stance === 'crouch' ? D : 0;
        this.script = [stance | dir | BTN[a.button], stance | dir, 0];
        break;
      }
      case 'throw':
        this.script = [F | Btn.C, F, 0];
        break;
      case 'special':
        this.script = this.motionScript(a.motion, a.button === 'P' ? P : K, F, B, D);
        this.lastUsed.set(`${a.motion}${a.button}`, this.frame);
        break;
      case 'block':
        this.hold = { bits: a.low ? B | D : B, frames: a.frames, block: true };
        break;
      case 'roll':
        this.script = [(a.dir === 1 ? F : B) | Btn.A | Btn.B, 0];
        break;
      case 'wait':
        this.hold = { bits: 0, frames: a.frames };
        break;
    }
    void opp;
  }

  private motionScript(motion: string, buttons: number, F: number, B: number, D: number): number[] {
    const btn = buttons === P ? Btn.C : Btn.D;
    if (!this.roll(this.params.motionSuccess)) return [btn, 0];
    switch (motion) {
      case '236':
        return [D, D | F, F | btn, 0];
      case '214':
        return [D, D | B, B | btn, 0];
      case '623':
        return [F, 0, D, D | F, D | F | btn, 0];
      case '22':
        return [D, 0, D | btn, 0];
      case '236236':
        return [D, D | F, F, 0, D, D | F, F | btn, 0];
      case '214214':
        return [D, D | B, B, 0, D, D | B, B | btn, 0];
      default:
        return [btn, 0];
    }
  }

  private roll(percent: number): boolean {
    return this.rng.nextInt(100) < percent;
  }

  private pick(options: AiOption[], me: FighterState, opp?: FighterState): AiAction | null {
    const ok = options.filter((o) => {
      if (opp && !actionCanReach(o.action, me, opp)) return false;
      if (o.action.kind !== 'special') return true;
      if ((o.action.minMeter ?? 0) > me.meter) return false;
      const last = this.lastUsed.get(`${o.action.motion}${o.action.button}`);
      return last === undefined || this.frame - last >= (o.action.cooldown ?? 0);
    });
    const total = ok.reduce((n, o) => n + o.weight, 0);
    if (total <= 0) return null;
    let r = this.rng.nextInt(total);
    for (const o of ok) {
      r -= o.weight;
      if (r < 0) return o.action;
    }
    return ok[ok.length - 1]?.action ?? null;
  }

  get pending(): readonly number[] {
    return this.script.length ? this.script : NOTHING_TO_DO;
  }
}
