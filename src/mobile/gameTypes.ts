import type { Phase, SkillAvailability, StateId } from '../core';
import type { NetworkRoundStatus } from './NetworkRound';

export interface MobileFightSnapshot {
  frame: number;
  phase: Phase;
  round: number;
  localPlayer: 0 | 1;
  character: string;
  characters: readonly [string, string];
  hp: readonly [number, number];
  positions: readonly [number, number];
  states: readonly [StateId, StateId];
  moves: readonly [string | null, string | null];
  meter: number;
  skills: readonly SkillAvailability[];
  paused: boolean;
  networkStatus?: NetworkRoundStatus;
  networkReason?: string | null;
}
export interface MobileGameResult { winner: 0 | 1; wins: readonly [number, number]; frame: number; verified: boolean }
