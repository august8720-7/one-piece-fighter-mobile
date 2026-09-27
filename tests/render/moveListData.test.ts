import { describe, expect, it } from 'vitest';
import { akainuDef, luffyDef } from '../../src/characters';
import { defaultKeyConfig } from '../../src/input/keymap';
import { MOVE_GROUPS, MOVES_PER_PAGE, motionArrows, moveCommand, moveProperties, movesInGroup } from '../../src/render/ui/moveListData';

const luffyMove = (id: string) => luffyDef.moves.find((move) => move.id === id)!;

describe('完整出招表', () => {
  it('两角色全部九技能在一键模式显示当前绑定，普通招式保留经典输入', () => {
    const keys = defaultKeyConfig(['simple', 'simple']).p1;
    for (const def of [luffyDef, akainuDef]) {
      expect(def.skillSlots).toHaveLength(9);
      for (const id of def.skillSlots!) {
        const move = def.moves.find(item => item.id === id)!;
        const right = moveCommand(move, keys, true, 'simple', def.skillSlots);
        expect(right).toContain('一键');
        expect(moveCommand(move, keys, false, 'simple', def.skillSlots)).toBe(right);
        expect(moveCommand(move, keys, true, 'classic', def.skillSlots)).not.toContain('一键');
      }
      const normal = def.moves.find(item => item.id === 'st_a')!;
      expect(moveCommand(normal, keys, true, 'simple', def.skillSlots)).toBe(moveCommand(normal, keys, true));
    }
    keys.Skill1 = 'KeyT';
    expect(moveCommand(luffyMove('sp_gatling'), keys, true, 'simple', luffyDef.skillSlots)).toMatch(/^T · 一键/);
  });
  for (const def of [luffyDef, akainuDef]) {
    it(`${def.name} 所有招式恰好出现一次，翻页不会漏招`, () => {
      const listed = MOVE_GROUPS.flatMap((group) => {
        const rows = movesInGroup(def, group.id);
        const pages = Array.from({ length: Math.ceil(rows.length / MOVES_PER_PAGE) }, (_, index) => rows.slice(index * MOVES_PER_PAGE, (index + 1) * MOVES_PER_PAGE));
        return pages.flat().map((move) => move.id);
      });
      expect(listed.sort()).toEqual(def.moves.map((move) => move.id).sort());
      expect(new Set(listed).size).toBe(def.moves.length);
      expect(movesInGroup(def, 'ground').map((move) => move.id)).toEqual(expect.arrayContaining(['st_a', 'st_d', 'cr_a', 'cr_d', 'cd', 'f_c']));
      expect(movesInGroup(def, 'air_throw').map((move) => move.id)).toEqual(expect.arrayContaining(['j_a', 'j_d', 'throw_fwd', 'throw_back']));
    });
  }

  it.each([
    ['236', '↓↘→', '↓↙←'],
    ['214', '↓↙←', '↓↘→'],
    ['623', '→↓↘', '←↓↙'],
    ['22', '↓↓', '↓↓'],
    ['236236', '↓↘→↓↘→', '↓↙←↓↙←'],
    ['214214', '↓↙←↓↙←', '↓↘→↓↘→'],
  ])('%s 对应正确的左右朝向', (motion, right, left) => {
    expect(motionArrows(motion, true)).toBe(right);
    expect(motionArrows(motion, false)).toBe(left);
  });

  it('特殊技、指令投、蹲技及双键招式使用当前键位', () => {
    const keys = defaultKeyConfig().p1;
    keys.A = 'KeyX'; keys.C = 'KeyY'; keys.D = 'KeyZ';
    expect(moveCommand(luffyMove('sp_gatling'), keys, false)).toBe('↓↙← + 拳(X/Y)');
    expect(moveCommand(luffyMove('throw_fwd'), keys, false)).toBe('← + Y');
    expect(moveCommand(luffyMove('cr_a'), keys, true)).toBe('↓ + X');
    expect(moveCommand(luffyMove('cd'), keys, true)).toBe('Y + Z');
  });

  it('防御属性来自招式数据，不能把蹲拳写成下段、空中招式写成对空', () => {
    expect(moveProperties(luffyMove('cr_a'))).toContain('上段');
    expect(moveProperties(luffyMove('cr_b'))).toContain('下段');
    expect(moveProperties(luffyMove('j_a'))).toContain('中段');
    expect(moveProperties(luffyMove('j_a'))).not.toContain('对空');
    expect(moveProperties(luffyMove('sp_storm'))).toContain('1格气');
    expect(moveProperties(luffyMove('ult_red_hawk'))).toContain('3格气');
    expect(moveProperties(luffyMove('sp_balloon'))).toBe('弹反');
  });
});
