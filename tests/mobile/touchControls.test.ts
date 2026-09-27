import { describe, expect, it } from 'vitest';
import { Btn, SKILL_BUTTONS } from '../../src/core';
import { labubuDef, twinkleDef } from '../../src/characters';
import {
  TOUCH_ATTACK_BUTTONS,
  TOUCH_DIRECTION_BUTTONS,
  TOUCH_SKILL_BUTTONS,
  characterSkillLabels,
} from '../../src/mobile/TouchControls';

describe('mobile touch control definitions', () => {
  it('方向盘覆盖八方向，含四个明确斜向且没有互相冲突的同轴位', () => {
    expect(TOUCH_DIRECTION_BUTTONS).toHaveLength(8);
    const diagonals = TOUCH_DIRECTION_BUTTONS.filter(button =>
      !!(button.bits & (Btn.Up | Btn.Down)) && !!(button.bits & (Btn.Left | Btn.Right)));
    expect(diagonals).toHaveLength(4);
    for (const button of TOUCH_DIRECTION_BUTTONS) {
      expect((button.bits & Btn.Left) && (button.bits & Btn.Right)).toBeFalsy();
      expect((button.bits & Btn.Up) && (button.bits & Btn.Down)).toBeFalsy();
    }
  });

  it('四普攻和九技能均为独立按钮，不缩减或合并成自动连招', () => {
    expect(TOUCH_ATTACK_BUTTONS.map(button => button.bits)).toEqual([Btn.A, Btn.C, Btn.B, Btn.D]);
    expect(TOUCH_SKILL_BUTTONS).toHaveLength(9);
    expect(TOUCH_SKILL_BUTTONS.map(button => button.bits)).toEqual([...SKILL_BUTTONS]);
    expect(new Set([...TOUCH_ATTACK_BUTTONS, ...TOUCH_SKILL_BUTTONS].map(button => button.bits)).size).toBe(13);
  });

  it('技能标签直接来自当前角色九个真实slot，未知角色显式回退为序号', () => {
    expect(characterSkillLabels('labubu')).toEqual(labubuDef.skillSlots!.map(id => labubuDef.moves.find(move => move.id === id)!.name));
    expect(characterSkillLabels('twinkle')).toEqual(twinkleDef.skillSlots!.map(id => twinkleDef.moves.find(move => move.id === id)!.name));
    expect(characterSkillLabels('missing')).toEqual(Array.from({ length: 9 }, (_, index) => `技能${index + 1}`));
  });
});
