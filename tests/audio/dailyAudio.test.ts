import { describe, expect, it } from 'vitest';
import { DailyAudio, type DailyFighter } from '../../src/audio/DailyAudio';

const fighter = (overrides: Partial<DailyFighter> = {}): DailyFighter => ({ player: 0, characterId: 'luffy', state: 'idle', x: 0,
  airborne: false, animationFrame: 0, animationFrames: 4, hitstop: 0, ...overrides });

describe('daily sound timing from actual game ticks', () => {
  it('waits four seconds and gives the longest-silent player one global slot every twenty seconds per player', () => {
    const daily = new DailyAudio(), heard: [number, number][] = [];
    for (let tick = 1; tick <= 3600; tick++) {
      for (const cue of daily.step([fighter(), fighter({ player: 1 })], true, false)) {
        heard.push([tick, cue.player!]); daily.notePlayed(cue.player!);
      }
    }
    expect(heard.filter(([, player]) => player === 0).map(([tick]) => tick)).toEqual([240, 1440, 2640]);
    expect(heard.filter(([, player]) => player === 1).map(([tick]) => tick)).toEqual([241, 1441, 2641]);
  });
  it('requires sustained movement, shares cooldown across direction, dash and jump, and is silent when stuck against a wall', () => {
    const daily = new DailyAudio(); let x = 0; const voices: number[] = [];
    for (let tick = 0; tick < 900; tick++) {
      x++;
      const state = tick === 31 ? 'dash' : tick === 61 ? 'jump_fwd' : tick % 2 ? 'walk_back' : 'walk_fwd';
      const cues = daily.step([fighter({ state, x, animationFrame: Math.floor(tick / 6) % 4 })], true, false);
      if (cues.some(c => c.id.endsWith('.move'))) { voices.push(tick); daily.notePlayed(0); }
    }
    expect(voices).toEqual([24]);
    for (let tick = 0; tick < 100; tick++) expect(daily.step([fighter({ state: 'walk_fwd', x, animationFrame: tick % 4 })], true, false)).toEqual([]);
  });
  it('drops elapsed idle after pause, contacts delay chatter and new matches start fresh', () => {
    const daily = new DailyAudio();
    for (let i = 0; i < 230; i++) daily.step([fighter()], true, false);
    daily.interrupt();
    for (let i = 0; i < 239; i++) expect(daily.step([fighter()], true, false)).toEqual([]);
    expect(daily.step([fighter()], true, true)).toEqual([]);
    for (let i = 0; i < 119; i++) expect(daily.step([fighter()], true, false)).toEqual([]);
    expect(daily.step([fighter()], true, false)[0]?.id).toBe('voice.luffy.idle');
    daily.reset();
    for (let i = 0; i < 239; i++) expect(daily.step([fighter()], true, false)).toEqual([]);
  });
  it('keeps the voice spacing across an interrupted round while requiring fresh idle time', () => {
    const daily = new DailyAudio();
    for (let tick = 0; tick < 240; tick++) daily.step([fighter()], true, false);
    daily.notePlayed(0);
    daily.interrupt();
    for (let tick = 0; tick < 120; tick++) expect(daily.step([fighter()], false, false)).toEqual([]);
    for (let tick = 1; tick < 1200; tick++) expect(daily.step([fighter()], true, false)).toEqual([]);
    expect(daily.step([fighter()], true, false)).toEqual([{ id: 'voice.luffy.idle', player: 0 }]);
  });
  it('does not accrue a queue while voice is busy and does not consume cooldown for rejected playback', () => {
    const daily = new DailyAudio();
    const fighters = [fighter(), fighter({ player: 1 })];
    for (let i = 0; i < 600; i++) expect(daily.step(fighters, true, false, true)).toEqual([]);
    expect(daily.step(fighters, true, false)).toEqual([{ id: 'voice.luffy.idle', player: 0 }]);
    expect(daily.step(fighters, true, false)).toEqual([{ id: 'voice.luffy.idle', player: 0 }]);
    daily.notePlayed(0);
    expect(daily.step(fighters, true, false)).toEqual([{ id: 'voice.luffy.idle', player: 1 }]);
  });
  it('emits footsteps at distinct visible contact frames rather than every rendering tick', () => {
    const daily = new DailyAudio(); const at: number[] = [];
    for (let tick = 0; tick < 48; tick++) {
      if (daily.step([fighter({ state: 'walk_fwd', x: tick, animationFrame: Math.floor(tick / 6) % 4 })], true, false).some(c => c.id.endsWith('.footstep'))) at.push(tick);
    }
    expect(at).toEqual([12, 24, 36]);
    expect(daily.step([fighter({ state: 'walk_fwd', x: 50, animationFrame: 0 })], false, false)).toEqual([]);
  });
});
