import type { ControlModes } from '@core/index';

/** CPU and training dummies always consume their original command inputs. */
export function matchControls(mode: string, preferences: ControlModes, sample = false): ControlModes {
  if (sample) return ['classic', 'classic'];
  return [preferences[0], mode === 'versus' ? preferences[1] : 'classic'];
}

export const controlModeLabel = (mode: string): string => mode === 'simple' ? '一键技能' : '经典搓招';
