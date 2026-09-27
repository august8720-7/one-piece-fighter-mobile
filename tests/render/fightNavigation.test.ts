import { describe, expect, it } from 'vitest';
import { FightSim } from '../../src/core';
import { characters } from '../../src/characters';
import type { FightSceneData } from '../../src/render/scenes/FightScene';
import { cpuChallengeData, pauseEntries } from '../../src/render/ui/fightNavigation';

const training: FightSceneData = { p1: 'akainu', p2: 'luffy', mode: 'training', difficulty: 'hard', tutorial: true };

describe('训练到正式人机', () => {
  it('练习完成首先提供挑战 CPU，普通暂停默认仍是继续', () => {
    expect(pauseEntries(training, true)[0]?.action).toBe('cpu');
    expect(pauseEntries(training)[0]?.action).toBe('resume');
    expect(pauseEntries(training).find((entry) => entry.action === 'cpu')?.label).toContain('困难');
    expect(pauseEntries({ ...training, mode: 'versus' }).some((entry) => entry.action === 'cpu')).toBe(false);
  });

  it('角色与难度保留，教学标记不进入新的人机比赛', () => {
    const challenge = cpuChallengeData(training);
    expect(challenge).toEqual({ p1: 'akainu', p2: 'luffy', mode: 'cpu', difficulty: 'hard' });
    const sim = new FightSim({ p1: characters[challenge.p1]!, p2: characters[challenge.p2]!, seed: 1 });
    expect(sim.training.infiniteHp).toBeFalsy();
    expect(sim.training.infiniteMeter).toBeFalsy();
    expect(sim.state.timer).toBeGreaterThan(0);
    expect(sim.state.phase).toBe('intro');
  });

  it('没有指定难度时使用普通人机', () => {
    expect(cpuChallengeData({ p1: 'luffy', p2: 'akainu', mode: 'training' }).difficulty).toBe('normal');
  });

  it('新人物教学结束保留画风画质并要求完整覆盖，样板不开放CPU捷径', () => {
    const data: FightSceneData = { ...training, art: 'anime', quality: 'high', scope: 'sample' };
    expect(cpuChallengeData(data)).toMatchObject({ art: 'anime', quality: 'high', scope: 'full', mode: 'cpu' });
    expect(cpuChallengeData(data).tutorial).toBeUndefined();
    expect(pauseEntries(data).some(entry => entry.action === 'cpu')).toBe(false);
  });
});
