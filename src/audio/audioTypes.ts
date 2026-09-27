export type AudioGroup = 'sfx' | 'voice' | 'ambient' | 'music';

/** Readiness describes the selected in-game bus, never the user's physical speakers. */
export type AudioHudState = 'muted' | 'master_zero' | 'group_zero' | 'paused' | 'locked' | 'loading'
  | 'download_failed' | 'decode_failed' | 'resume_failed' | 'start_failed' | 'unavailable' | 'ready' | 'destroyed';
export type AudioFailureKind = 'download' | 'decode';
export interface AudioSettings {
  muted: boolean;
  volume: number;
  groups: Record<AudioGroup, number>;
}
export interface AudioTraceEntry {
  at: number;
  kind: 'event' | 'play' | 'drop' | 'failure' | 'control';
  detail: string;
  cueId?: string;
}

export type SfxKind =
  | 'hit_light' | 'hit_heavy' | 'block' | 'throw' | 'special' | 'ko'
  | 'menu_move' | 'menu_confirm' | 'round_start' | 'counter' | 'whoosh'
  | 'magma' | 'meteor_fall' | 'meteor_land';

export interface AudioCue {
  files: readonly string[];
  group: AudioGroup;
  gain?: number;
  priority?: number;
  cooldownMs?: number;
  maxInstances?: number;
  loop?: boolean;
  fallback?: SfxKind;
  characterId?: string;
  transcript?: string;
  source?: string;
  note?: string;
}

export type CueCatalog = Record<string, AudioCue>;
export type ProjectileEndReason = 'hit' | 'block' | 'clash' | 'ground' | 'timeout' | 'out_of_bounds' | 'round_end' | 'round_reset' | 'position_reset';

export interface FightAudioEvent {
  /** recover is the first frame of the final recovery segment, not every gap between hits. */
  phase: 'start' | 'swing' | 'recover' | 'hit' | 'block' | 'reflect' | 'throw' | 'landing' | 'ko' | 'win' | 'projectile_spawn' | 'projectile_end' | 'round_start';
  characterId: string;
  player: 0 | 1;
  moveId?: string;
  moveInstance?: number;
  /** Each multi-hit active segment may swing once; move start still plays once. */
  segmentId?: string | number;
  /** Reflections change the owner, while the original projectile material stays. */
  materialCharacterId?: string;
  damage?: number;
  counter?: boolean;
  defenderId?: string;
  defenderPlayer?: 0 | 1;
  projectileKind?: string;
  endReason?: ProjectileEndReason;
}

export interface CueRequest {
  id: string;
  player?: 0 | 1;
}

export interface PresentationAudioEvent {
  phase: 'select' | 'round' | 'fight' | 'ko' | 'win';
  /** Unique confirmation/round/match instance; repeated renders must reuse it. */
  key: string;
  characterId?: string;
  player?: 0 | 1;
  round?: number;
  /** Only the match rules know whether both players are one win from victory. */
  finalRound?: boolean;
}

/** Emitted only for a sample that actually started. Null clears a stopped subtitle. */
export interface VoicePlayback {
  cueId: string;
  file: string;
  player?: 0 | 1;
  text: string;
  transcriptVerified: boolean;
  durationMs: number;
}

export interface AudioPreloadReport {
  fetched: number;
  decoded: number;
  failed: string[];
}
