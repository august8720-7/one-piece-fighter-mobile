import { describe, expect, it } from 'vitest';
import { akainuDef, twinkleDef } from '../../src/characters';
import {
  PROJECTILE_PRESENTATIONS,
  projectileMaterial,
  projectileMoveMaterial,
} from '../../src/render/fx/movePresentation';
import { REQUIRED_FX_FRAMES } from '../../src/render/resourcePlan';

const projectileKinds = (...defs: readonly (typeof akainuDef)[]): string[] => [...new Set(
  defs.flatMap(def => def.moves.flatMap(move => move.projectiles?.map(projectile => projectile.kind) ?? [])),
)].sort();

describe('联动投射物表现资源', () => {
  it('全部实际kind都有显式材质且对应图集声明主体、落地和消散帧', () => {
    const actualKinds = projectileKinds(akainuDef, twinkleDef);
    expect(Object.keys(PROJECTILE_PRESENTATIONS).sort()).toEqual(actualKinds);
    for (const kind of actualKinds) {
      const style = PROJECTILE_PRESENTATIONS[kind]!;
      const frames = REQUIRED_FX_FRAMES[style.character];
      expect(frames, `${kind}缺少${style.character}资源计划`).toBeDefined();
      expect(frames).toContain(style.frame);
      expect(frames).toContain(style.fadeFrame);
      if (style.groundFrame) expect(frames).toContain(style.groundFrame);
      expect(projectileMaterial(kind)).toBe(style.character);
    }
  });

  it('星星弹被路飞反弹后仍按kind和原招式读取twinkle材质', () => {
    const reflected = { owner: 'luffy', kind: 'twinkle_tiny_star', moveId: 'sp_tiny_star' } as const;
    expect(reflected.owner).toBe('luffy');
    expect(projectileMaterial(reflected.kind)).toBe('twinkle');
    expect(projectileMoveMaterial(reflected.moveId)).toBe('twinkle');
    expect(projectileMaterial(reflected.kind)).not.toBe('akainu');
  });

  it('未知kind和未知招式显式返回undefined，不能静默借用dog材质', () => {
    expect(projectileMaterial('unknown')).toBeUndefined();
    expect(projectileMoveMaterial('unknown')).toBeUndefined();
    expect(PROJECTILE_PRESENTATIONS.unknown).toBeUndefined();
    expect(projectileMaterial('dog')).toBe('akainu');
  });
});
