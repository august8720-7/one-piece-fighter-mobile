import Phaser from 'phaser';
import { GROUND_Y, SUBPIXEL, toWorldBox, type FightSim, type HitEvent, type PlayerIndex, type ProjectileEndEvent, type ProjectileState, type WorldState } from '@core/index';
import { RENDER_SCALE, UI_SCALE } from '../screen';
import { MOVE_PRESENTATIONS, PROJECTILE_PRESENTATIONS, projectileMoveMaterial, type ProjectileVisualPose } from './movePresentation';

interface Burst { character: string; frame: string; x: number; y: number; width: number; height: number; life: number; total: number; facing: number; ground: boolean; fixedScale?: boolean; reflected?: boolean }

/** Reused texture instances; timings follow simulation steps, positions remain in world space. */
export class SkillEffects {
  private readonly sprites: Phaser.GameObjects.Image[] = [];
  private readonly bursts: Burst[] = [];
  private cursor = 0;
  constructor(private readonly scene: Phaser.Scene, private readonly worldLayer?: Phaser.GameObjects.Container) {}

  private image(character: string, frame: string, x: number, y: number, width: number, height: number, facing = 1, alpha = 1, originY = 0.5, depth = 35): boolean {
    const key = `fx-${character}`;
    if (!this.scene.textures.exists(key) || !this.scene.textures.get(key).has(frame)) return false;
    if (this.cursor >= 96) return true;
    let image = this.sprites[this.cursor++];
    if (!image) {
      image = this.scene.add.image(x, y, key, frame);
      this.worldLayer?.add(image);
      this.sprites.push(image);
    }
    image.setTexture(key, frame).setVisible(true).setPosition(x, y).setOrigin(0.5, originY)
      .setDisplaySize(width, height).setFlipX(facing < 0).setAlpha(alpha).setDepth(depth).clearTint();
    return true;
  }

  tick(): void {
    for (let i = this.bursts.length - 1; i >= 0; i--) if (--this.bursts[i]!.life <= 0) this.bursts.splice(i, 1);
  }

  clear(): void {
    this.bursts.length = 0;
    for (const image of this.sprites) image.setVisible(false);
  }

  private burst(character: string, frame: string, x: number, y: number, width: number, height: number, life: number, facing = 1, ground = false, visual?: Pick<Burst, 'fixedScale' | 'reflected'>): void {
    if (this.bursts.length >= 40) this.bursts.shift();
    this.bursts.push({ character, frame, x, y, width, height, life, total: life, facing, ground, ...visual });
  }

  contact(hit: HitEvent, world: WorldState): void {
    const attacker = world.fighters[hit.attacker]!;
    if (hit.kind === 'block' || hit.kind === 'reflect' || hit.kind === 'tech') {
      this.burst('common', 'rebound', hit.x, hit.y, 34, 56, 9, attacker.facing);
      return;
    }
    if (hit.kind !== 'hit' && hit.kind !== 'armor' && hit.kind !== 'clash') return;
    const material = hit.projectile ? projectileMoveMaterial(hit.moveId) ?? attacker.def.id : attacker.def.id;
    const art = MOVE_PRESENTATIONS[material]?.[hit.moveId];
    const character = art ? material : 'common';
    const frame = art?.impact ?? 'impact';
    const size = Math.min(72, 22 + hit.damage * 0.12);
    // Contact embellishment stays local, never paints a second damage field.
    this.burst(character, frame, hit.x, hit.y, size, size, 10, attacker.facing);
  }

  projectileEnd(event: ProjectileEndEvent, pose?: ProjectileVisualPose): void {
    const style = PROJECTILE_PRESENTATIONS[event.kind];
    if (!style) return;
    if (style.contactBody && pose && (event.reason === 'hit' || event.reason === 'block' || event.reason === 'clash')) {
      const box = toWorldBox(pose.box, event.x, event.y, pose.facing);
      this.burst(style.character, style.frame,
        box.x + box.w / 2 + pose.facing * box.w * style.offsetX, box.y + box.h / 2 + box.h * style.offsetY,
        box.w / SUBPIXEL * style.widthScale, box.h / SUBPIXEL * style.heightScale, 8, pose.facing, false,
        { fixedScale: true, reflected: pose.reflected });
    }
    if (event.reason === 'ground' && style.groundFrame) {
      this.burst(style.character, style.groundFrame, event.x, GROUND_Y, 52, 70, 14, 1, true);
      if (event.kind === 'meteor') this.burst('akainu', 'smoke', event.x, GROUND_Y, 52, 48, 27, 1, true);
    } else if (event.reason === 'timeout' || event.reason === 'out_of_bounds') {
      this.burst(style.character, style.fadeFrame, event.x, event.y, 32, 32, 12);
    }
    // hit/block/clash have their own contact event; resets are silent cleanups.
  }

  begin(): void { this.cursor = 0; }

  projectile(p: ProjectileState, sim: FightSim, sx: (x: number) => number, sy: (y: number) => number): boolean {
    const style = PROJECTILE_PRESENTATIONS[p.kind];
    if (!style) return false;
    const b = sim.projectileBox(p);
    const x = sx(b.x + b.w / 2), y = sy(b.y + b.h / 2);
    const width = b.w / SUBPIXEL * RENDER_SCALE, height = b.h / SUBPIXEL * RENDER_SCALE;
    const previousCursor = this.cursor;
    const result = this.image(style.character, style.frame, x + p.facing * width * style.offsetX,
      y + height * style.offsetY, width * style.widthScale, height * style.heightScale, p.facing);
    if (result && p.reflected && this.cursor > previousCursor) this.sprites[this.cursor - 1]?.setTint(0x89dfff);
    return result;
  }

  fighters(sim: FightSim, sx: (x: number) => number, sy: (y: number) => number, bodyInCharacterArt?: (player: PlayerIndex) => boolean): void {
    const world = sim.state;
    for (const f of world.fighters) {
      const id = f.def.id, move = sim.move(f), fd = sim.currentFrame(f);
      const art = move && MOVE_PRESENTATIONS[id]?.[move.id];
      const embeddedBody = !!bodyInCharacterArt?.(f.player);
      const x = sx(f.x), y = sy(f.y);
      if (f.install && (id === 'luffy' || id === 'labubu')) {
        for (let i = 0; i < 2; i++) {
          const t = (world.frame + i * 25) % 50;
          this.image(id, id === 'luffy' ? 'steam' : 'charge', x + (i ? 20 : -24) * UI_SCALE, y - (34 + t * 2) * UI_SCALE, 62 * UI_SCALE, 104 * UI_SCALE, f.facing, 0.30 * (1 - t / 70), 0.5, 8);
        }
      }
      if (f.state === 'throw' && id === 'akainu' && move?.id === 'ult_meigou_end') {
        const release = move.throwData?.releaseFrame ?? 0;
        const victim = world.fighters[f.player === 0 ? 1 : 0];
        if (!f.hasHit && victim?.state === 'thrown' && f.stateFrame >= 0 && f.stateFrame < release) {
          const charge = f.stateFrame / Math.max(1, release - 1);
          const pulse = Math.sin(f.stateFrame * Math.PI / 9) * 0.04;
          // Inspected hold-pose palm is (+31, -66) world pixels. Keep this small
          // aura on its lower edge, below the face and behind the solid grasp (depth 13).
          // It is drawn from the current hold state, never queued as a release burst.
          this.image(id, 'flame', sx(f.x + f.facing * 31 * SUBPIXEL), sy(f.y - 63 * SUBPIXEL),
            (14 + charge * 10) * RENDER_SCALE, (8 + charge * 4) * RENDER_SCALE,
            f.facing, 0.36 + charge * 0.30 + pulse, 0.5, 12);
        }
        continue;
      }
      if (!move || f.state !== 'attack') continue;
      // Artwork supplies solid limbs, while vapor, terrain and motion trails remain independent.
      // Contact bursts and detached projectiles keep their own actual-event paths.
      if (art?.body === 'steam' || art?.body === 'melt' || art?.body === 'charge' || (move?.dodge && art?.body === 'spark')) {
        if (!embeddedBody || art.independentBody) {
          this.image(id, art.body, x, y - 85 * UI_SCALE, 88 * UI_SCALE, 164 * UI_SCALE, f.facing, art.body === 'melt' ? 0.7 : 0.45);
        }
        continue;
      }
      if (!fd?.hitboxes?.length) {
        const firstActive = move.frames.findIndex(frame => !!frame.hitboxes?.length);
        const startup = move.frames.slice(0, firstActive < 0 ? 1 : firstActive).reduce((n, frame) => n + frame.duration, 0);
        if (art?.charged && f.stateFrame < startup) {
          const t = f.stateFrame / Math.max(1, startup);
          this.image(id, art.chargeFrame ?? (id === 'akainu' ? 'flame' : 'steam'), x + f.facing * 24 * UI_SCALE, y - 85 * UI_SCALE, (30 + t * 35) * UI_SCALE, (25 + t * 35) * UI_SCALE, f.facing, 0.4 + t * 0.25);
        }
        continue;
      }
      if (embeddedBody && !art?.independentBody) continue;
      for (const [bx, by, bw, bh] of fd.hitboxes) {
        const centerX = sx(f.x + (bx + bw / 2) * f.facing * SUBPIXEL);
        const centerY = sy(f.y + (by + bh / 2) * SUBPIXEL);
        const body = art?.body ?? (id === 'luffy' ? 'wind' : 'flame');
        const alpha = art?.bodyAlpha ?? (art ? 0.92 : 0.40);
        this.image(id, body, centerX, centerY, bw * RENDER_SCALE, bh * RENDER_SCALE, f.facing, alpha);
      }
    }
  }

  finish(sx: (x: number) => number, sy: (y: number) => number): void {
    for (const b of this.bursts) {
      const age = b.total - b.life;
      const scale = b.fixedScale ? 1 : 0.75 + Math.min(1, age / 5) * 0.25;
      const alpha = Math.min(1, b.life / (b.frame === 'smoke' ? 25 : 7));
      const previousCursor = this.cursor;
      this.image(b.character, b.frame, sx(b.x), sy(b.y) - (b.frame === 'smoke' ? age * 0.5 * UI_SCALE : 0),
        b.width * RENDER_SCALE * scale, b.height * RENDER_SCALE * scale, b.facing, alpha, b.ground ? 1 : 0.5, b.frame === 'smoke' ? 25 : 42);
      if (b.reflected && this.cursor > previousCursor) this.sprites[this.cursor - 1]?.setTint(0x89dfff);
    }
    for (let i = this.cursor; i < this.sprites.length; i++) this.sprites[i]!.setVisible(false);
  }
}
