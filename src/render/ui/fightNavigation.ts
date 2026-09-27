import type { FightSceneData } from '../scenes/FightScene';

export type PauseAction = 'resume' | 'settings' | 'moves' | 'cpu' | 'characters' | 'title';

/** 重新建立正式人机对局，不携带教学标记或训练中的状态。 */
export function cpuChallengeData(data: FightSceneData): FightSceneData {
  const preserved = { ...data };
  delete preserved.tutorial;
  return { ...preserved, mode: 'cpu', difficulty: data.difficulty ?? 'normal', ...(data.art ? { scope: 'full' } : {}) };
}

export function pauseEntries(data: FightSceneData, tutorialComplete = false): { label: string; action: PauseAction }[] {
  const entries: { label: string; action: PauseAction }[] = [
    { label: '继续  RESUME', action: 'resume' },
    { label: '设置 / 声音  SETTINGS', action: 'settings' },
    { label: '出招表  MOVE LIST', action: 'moves' },
    { label: '重新选人  CHARACTER SELECT', action: 'characters' },
    { label: '回标题  TITLE', action: 'title' },
  ];
  if (data.mode === 'training' && data.scope !== 'sample') {
    const difficulty = { easy: '简单', normal: '普通', hard: '困难' }[data.difficulty ?? 'normal'];
    entries.splice(tutorialComplete ? 0 : 3, 0, { label: `挑战 CPU · ${difficulty}  VS CPU`, action: 'cpu' });
  }
  return entries;
}
