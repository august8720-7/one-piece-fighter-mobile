import type { FighterDef } from '@core/index';
import type { AnimeCharacterAssets } from '../assets';
import type { PresentationProfile } from '../presentation';
import { createSampleFighter, validateFullCoverage, validateSampleCoverage } from './sampleMode';

export interface AnimeEntryResult {
  ok: boolean;
  kind: 'ready' | 'load-error' | 'coverage-error';
  issues: string[];
  scope: PresentationProfile['scope'];
}

/** This gate runs before creating FightSim. Missing art never changes requested style. */
export function evaluateAnimeEntry(
  profile: PresentationProfile,
  fighters: readonly [FighterDef, FighterDef],
  assets: AnimeCharacterAssets,
  errors: Readonly<Record<string, string>> = {},
  mode: string = 'training',
): AnimeEntryResult {
  const issues: string[] = [];
  if (profile.art !== 'anime') return { ok: true, kind: 'ready', issues, scope: 'full' };
  for (const def of fighters) {
    if (errors[def.id] || !assets[def.id]) issues.push(`${def.name}：${errors[def.id] ?? '尚无完整可加载的人物资源'}`);
  }
  if (issues.length) return { ok: false, kind: 'load-error', issues: [...new Set(issues)], scope: profile.scope };
  if (profile.scope === 'sample' && mode !== 'training') issues.push('限定动作样板只开放训练；完整比赛需要完整动作覆盖');
  const definitions = profile.scope === 'sample'
    ? fighters.map((def, side) => createSampleFighter(def, assets[def.id]!.runtime, { opponentRuntime: assets[fighters[side === 0 ? 1 : 0].id]!.runtime }))
    : fighters;
  for (const side of [0, 1] as const) {
    const def = definitions[side]!;
    const runtime = assets[def.id]!.runtime;
    const coverage = profile.scope === 'full' ? validateFullCoverage(def, runtime, definitions[side === 0 ? 1 : 0]!)
      : validateSampleCoverage(def, runtime, definitions[side === 0 ? 1 : 0]!, { infiniteHp: true });
    if (coverage.missingStates.length) issues.push(`${def.name}缺少动作：${coverage.missingStates.join('、')}`);
    if (coverage.missingMoves.length) issues.push(`${def.name}缺少招式：${coverage.missingMoves.join('、')}`);
    issues.push(...coverage.errors.map(error => `${def.name}：${error}`));
  }
  return { ok: issues.length === 0, kind: issues.length ? 'coverage-error' : 'ready', issues: [...new Set(issues)], scope: profile.scope };
}
