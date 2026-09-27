import { Btn, Rng, SUBPIXEL, type FightSim, type PlayerIndex } from '@core/index';

export const DUMMY_MODES = ['human', 'stand', 'crouch', 'jump', 'block', 'tech', 'attack', 'random'] as const;
export type DummyMode = (typeof DUMMY_MODES)[number];

/**
 * 训练木桩：根据模式产生一名玩家的输入位图。
 * 只读取世界状态、只输出输入，不直接改 core（AGENTS.md 目录约定）。
 */
export class Dummy {
  mode: DummyMode = 'stand';
  private readonly rng = new Rng(2026);
  private randomPick: Exclude<DummyMode, 'human' | 'random'> = 'stand';
  private randomTtl = 0;

  next(): void {
    const i = DUMMY_MODES.indexOf(this.mode);
    this.mode = DUMMY_MODES[(i + 1) % DUMMY_MODES.length]!;
  }

  /** 返回 null 表示由人类控制 */
  input(sim: FightSim, player: PlayerIndex): number | null {
    if (this.mode === 'human') return null;
    let mode: Exclude<DummyMode, 'human' | 'random'> = this.mode === 'random' ? this.randomPick : this.mode;
    if (this.mode === 'random') {
      if (--this.randomTtl <= 0) {
        const opts = ['stand', 'crouch', 'jump', 'block', 'tech', 'attack'] as const;
        this.randomPick = opts[this.rng.nextInt(opts.length)]!;
        this.randomTtl = 30 + this.rng.nextInt(60);
      }
      mode = this.randomPick;
    }

    const me = sim.state.fighters[player];
    const opp = sim.state.fighters[player === 0 ? 1 : 0];
    const back = me.facing === 1 ? Btn.Left : Btn.Right;

    switch (mode) {
      case 'stand':
        return 0;
      case 'crouch':
        return Btn.Down;
      case 'jump':
        // 落地后立刻再跳；空中不输入（避免误出空中技）
        return me.airborne || me.state === 'prejump' ? 0 : Btn.Up;
      case 'block': {
        // 全防：默认蹲防；来袭攻击是中段（high）时站防
        const oppMove = sim.move(opp);
        let guard = oppMove?.guard;
        for (const p of sim.state.projectiles) if (p.owner !== player) guard = p.guard;
        return guard === 'high' ? back : back | Btn.Down;
      }
      case 'tech':
        // 软倒落地瞬间按攻击键受身（硬倒无效，由 core 判定）
        return me.state === 'hit_air' || me.state === 'knockdown' ? Btn.A : 0;
      case 'attack': {
        const gap = Math.abs(me.x - opp.x);
        const jab = me.def.moves.find((move) => move.id === 'st_a');
        const reach = Math.max(0, ...(jab?.frames.flatMap((frame) => (frame.hitboxes ?? []).map((box) => box[0] + box[2])) ?? []));
        if (gap > Math.max(30, reach) * SUBPIXEL) return me.x < opp.x ? Btn.Right : Btn.Left;
        return me.state === 'attack' ? 0 : Btn.A;
      }
    }
  }
}
