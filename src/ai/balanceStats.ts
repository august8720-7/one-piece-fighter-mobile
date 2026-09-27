/** 平衡脚本的比赛结局。超时与平局都不记胜场。 */
export type MatchOutcome = 'p1' | 'p2' | 'draw' | 'timeout';

export const BALANCE_PARAM_VERSION = '2026-09-10-batch1';

/** 只计算当前回合 fight 阶段；不累计上一回合和入场动画。 */
export class RoundClock {
  private phase = '';
  private startedAt = 0;
  observe(phase: string, frame: number): number | null {
    if (phase === 'fight' && this.phase !== 'fight') this.startedAt = frame;
    const duration = phase === 'round_end' && this.phase === 'fight' ? frame - this.startedAt : null;
    this.phase = phase;
    return duration;
  }
}

export function balanceOptions(count = '40', difficulty = 'normal'): { matches: number; difficulty: 'easy' | 'normal' | 'hard' } {
  const matches = Number(count);
  if (!Number.isInteger(matches) || matches < 2 || matches > 2000 || matches % 2 !== 0) throw new Error('matches must be an even integer from 2 to 2000 (paired sides)');
  if (difficulty !== 'easy' && difficulty !== 'normal' && difficulty !== 'hard') throw new Error('difficulty must be easy, normal or hard');
  return { matches, difficulty };
}

export function classifyMatch(phase: string, wins: readonly [number, number]): MatchOutcome {
  if (phase !== 'match_end') return 'timeout';
  if (wins[0] === wins[1]) return 'draw';
  return wins[0] > wins[1] ? 'p1' : 'p2';
}
