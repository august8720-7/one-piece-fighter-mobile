import { AudioEngine } from './AudioEngine';
import type { AudioHudState } from './audioTypes';

export type { AudioGroup, FightAudioEvent, SfxKind } from './audioTypes';
export { hitSfxKind } from './audioCues';
export { AudioEngine as SfxEngine } from './AudioEngine';

export type SfxHudState = AudioHudState;
export function sfxHudText(state: SfxHudState): string {
  const labels: Record<SfxHudState, string> = {
    muted: '声音关闭', locked: '点击解锁声音', ready: '声音已开启',
    master_zero: '总音量为零', group_zero: '此分组音量为零', paused: '战斗声音已暂停',
    loading: '声音加载中', download_failed: '部分音频下载失败，可重试',
    decode_failed: '部分音频解码失败，可重试', resume_failed: '声音启动失败，请重试开启',
    start_failed: '声音播放失败，请重试试听', unavailable: '音频设备不可用，请重试开启', destroyed: '声音已退出',
  };
  return labels[state];
}

let engine: AudioEngine | null = null;
export function sfx(): AudioEngine {
  engine ??= new AudioEngine();
  return engine;
}
