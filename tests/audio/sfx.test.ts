import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hitSfxKind, sfx, sfxHudText } from '../../src/audio/Sfx';

const WAV_KINDS = [
  'hit_light',
  'hit_heavy',
  'block',
  'throw',
  'special',
  'ko',
  'menu_move',
  'menu_confirm',
  'round_start',
  'counter',
  'whoosh',
  'magma',
  'meteor_fall',
  'meteor_land',
] as const;

describe('hitSfxKind', () => {
  it('反击、重击、轻击分层', () => {
    expect(hitSfxKind(30, true)).toBe('counter');
    expect(hitSfxKind(80, false)).toBe('hit_heavy');
    expect(hitSfxKind(34, false)).toBe('hit_light');
  });
});

describe('sfx hud', () => {
  it('标明静音 / 未解锁，不写 MUTE', () => {
    expect(sfxHudText('muted')).toBe('声音关闭');
    expect(sfxHudText('locked')).toBe('点击解锁声音');
    expect(sfxHudText('ready')).toBe('声音已开启');
    expect(sfxHudText('master_zero')).toBe('总音量为零');
    expect(sfxHudText('group_zero')).toBe('此分组音量为零');
  });

  it('无手势时保持 locked，play 不抛', () => {
    expect(sfx().hudState()).toBe(sfx().muted ? 'muted' : 'locked');
    expect(() => sfx().play('hit_light')).not.toThrow();
  });

  it('自制 wav 回退文件齐全', () => {
    const dir = resolve(process.cwd(), 'public/assets/audio');
    for (const kind of WAV_KINDS) {
      expect(existsSync(resolve(dir, `${kind}.wav`))).toBe(true);
    }
  });
});
