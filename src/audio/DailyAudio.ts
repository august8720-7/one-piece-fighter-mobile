import type { CueRequest } from './audioTypes';

export interface DailyFighter {
  player: 0 | 1; characterId: string; state: string; x: number; airborne: boolean;
  animationFrame: number; animationFrames: number; hitstop: number;
}
interface Speaker {
  state: string; x: number; animationFrame: number; idle: number; moving: number;
  voiceAt: number; idleAt: number; footAt: number;
}
const fresh = (): Speaker => ({ state: '', x: 0, animationFrame: -1, idle: 0, moving: 0, voiceAt: -1200, idleAt: -1200, footAt: -12 });
const moving = (state: string) => ['walk_fwd', 'walk_back', 'dash', 'backdash'].includes(state);

/** Uses only completed simulation ticks and displayed poses; no wall-clock backlog or core writes. */
export class DailyAudio {
  private tick = 0;
  private contactAt = -120;
  private speakers: [Speaker, Speaker] = [fresh(), fresh()];

  reset(): void { this.tick = 0; this.contactAt = -120; this.speakers = [fresh(), fresh()]; }
  interrupt(): void { for (const speaker of this.speakers) { speaker.idle = 0; speaker.moving = 0; } }

  /** Call only when the engine accepted the requested daily voice. */
  notePlayed(player: 0 | 1): void { this.speakers[player].voiceAt = this.tick; this.speakers[player].idleAt = this.tick; }

  step(fighters: readonly DailyFighter[], active: boolean, contact: boolean, voiceBusy = false): CueRequest[] {
    if (!active) { this.interrupt(); return []; }
    this.tick++;
    if (contact) this.contactAt = this.tick;
    const cues: CueRequest[] = [];
    const candidates: CueRequest[] = [];
    for (const f of fighters) {
      const s = this.speakers[f.player];
      const changed = s.state !== f.state;
      const displaced = s.state !== '' && f.x !== s.x;
      const foot = f.animationFrame === 0 || f.animationFrame === Math.floor(f.animationFrames / 2);
      if (f.hitstop === 0) {
        s.idle = f.state === 'idle' ? s.idle + 1 : 0;
        s.moving = moving(f.state) && displaced ? s.moving + 1 : 0;
        if (s.moving > 0 && !f.airborne && foot && (changed || s.animationFrame !== f.animationFrame) && this.tick - s.footAt >= 9) {
          cues.push({ id: `sfx.${f.characterId}.footstep`, player: f.player }); s.footAt = this.tick;
        }
        const burst = changed && (f.state === 'dash' || f.state === 'backdash' || f.state.startsWith('jump_'));
        if (burst) cues.push({ id: `sfx.${f.characterId}.movement`, player: f.player });
        if ((s.moving >= 24 || burst) && this.tick - s.voiceAt >= 1200) {
          candidates.push({ id: `voice.${f.characterId}.move`, player: f.player });
        }
        if (s.idle >= 240 && this.tick - this.contactAt >= 120 && this.tick - s.voiceAt >= 1200) {
          candidates.push({ id: `voice.${f.characterId}.idle`, player: f.player });
        }
      }
      s.state = f.state; s.x = f.x; s.animationFrame = f.animationFrame;
    }
    candidates.sort((a, b) => this.speakers[a.player!].voiceAt - this.speakers[b.player!].voiceAt || a.player! - b.player!);
    if (!voiceBusy && candidates[0]) cues.push(candidates[0]);
    return cues;
  }
}
