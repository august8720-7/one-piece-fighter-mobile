import Phaser from 'phaser';
import type { FightSim, FighterState } from '@core/index';
import { attachmentPoint, connectedHeldReaction, currentAnimation, frameName, heldReactionFrameIssues, isHeldReactionAnim, type AnimationOverride, type AnimTable, type AttachmentPoint, type CharacterPresentation } from './animations';
import { frameFramingBounds, unionFightBounds, type FightBounds } from './fightFraming';

/**
 * 角色精灵视图：每帧根据逻辑状态直接设置帧名（不用 Phaser 计时动画，保证与 60Hz 逻辑同步）。
 * 图集里缺某一帧时返回 false，由场景回退到色块绘制。
 */
export class FighterView {
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly continuous: boolean;
  private readonly strictFrames: boolean;
  private activeTextureKey: string;
  private drawnFrame: string | null = null;
  private missing = new Set<string>();
  private foreground: Phaser.GameObjects.Sprite | null = null;
  private foregroundTextureKey: string | null = null;
  private readonly framingGroups = new Map<string, string[]>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly textureKey: string,
    private readonly charId: string,
    private readonly anims: AnimTable,
    private readonly presentation?: CharacterPresentation,
    private readonly worldLayer?: Phaser.GameObjects.Container,
  ) {
    this.activeTextureKey = textureKey;
    this.sprite = scene.add.sprite(0, 0, textureKey).setOrigin(0.5, 1).setDepth(10).setVisible(false);
    this.worldLayer?.add(this.sprite);
    const metadata = this.sprite.texture.customData as { meta?: { capabilities?: { continuous?: boolean }; style?: string; pixelArt?: boolean } };
    // Explicit capability for candidates; the old pixel atlas and placeholders remain compatible.
    this.continuous = presentation?.continuous ?? metadata.meta?.capabilities?.continuous ?? (metadata.meta?.pixelArt === true || textureKey.endsWith('-placeholder'));
    this.strictFrames = presentation?.style === 'anime' || metadata.meta?.style === 'anime';
    if (this.strictFrames) this.sprite.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    else if (metadata.meta?.pixelArt || textureKey.endsWith('-placeholder')) this.sprite.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
  }

  /** 返回是否成功用精灵表现了该帧 */
  update(
    sim: FightSim,
    f: FighterState,
    screenX: number,
    screenY: number,
    tint: number | null,
    alpha: number,
    override?: AnimationOverride,
    scale = 1,
  ): boolean {
    const reaction = this.strictFrames ? connectedHeldReaction(sim, f) : null;
    const { anim, index: visualIndex } = reaction ?? currentAnimation(sim, f, this.anims, override);
    const index = !override && !this.continuous && f.state === 'attack' ? sim.currentFrame(f)?.sprite ?? 0 : visualIndex;
    let name = frameName(this.charId, anim, index);
    if (reaction && (!this.presentation || heldReactionFrameIssues(this.charId, this.anims, this.presentation.attachments, reaction.anim).length)) {
      this.missing.add(name);
      this.hide();
      return false;
    }
    const requestedTexture = this.presentation?.frameTextures?.[name] ?? this.textureKey;
    if (requestedTexture !== this.activeTextureKey) {
      this.sprite.setTexture(requestedTexture);
      this.activeTextureKey = requestedTexture;
      if (this.strictFrames) this.sprite.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    }
    if (!this.strictFrames && !this.sprite.texture.has(name)) {
      // 新精灵源不在机器上时仍可用保留的旧图集，不因视觉帧增加就切成色块。
      const legacy = frameName(this.charId, anim, sim.currentFrame(f)?.sprite ?? 0);
      if (this.sprite.texture.has(legacy)) name = legacy;
    }
    if (!this.sprite.texture.has(name)) {
      if (!this.missing.has(name)) this.missing.add(name);
      this.hide();
      return false;
    }
    const foregroundName = this.presentation?.foregroundFrames?.[name];
    if (foregroundName) {
      const key = this.presentation?.frameTextures?.[foregroundName] ?? this.textureKey;
      if (!this.foreground) {
        this.foreground = this.scene.add.sprite(0, 0, key).setVisible(false);
        this.worldLayer?.add(this.foreground);
        this.foregroundTextureKey = key;
        if (this.strictFrames) this.foreground.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
      } else if (this.foregroundTextureKey !== key) {
        this.foreground.setTexture(key);
        this.foregroundTextureKey = key;
        if (this.strictFrames) this.foreground.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
      }
      if (!this.foreground.texture.has(foregroundName) || !this.presentation?.attachments[foregroundName]) {
        this.missing.add(foregroundName);
        this.hide();
        return false;
      }
    } else this.foreground?.setVisible(false);
    // 出招 / 投技中的一方画在上层；否则 P1 在上
    const acting = f.state === 'attack' || f.state === 'throw';
    // Only explicitly partitioned throw drawings place the victim between layers,
    // including the authored release pose after the actual launch/switch of sides.
    const layeredThrow = !!foregroundName && f.state === 'throw' && !!sim.move(f)?.throwData;
    this.sprite.setFrame(name);
    this.drawnFrame = name;
    const fr = this.sprite.frame;
    const geometry = this.presentation?.attachments[name];
    const ox = geometry ? geometry.root.x / geometry.size.width : fr.customPivot ? fr.pivotX : 0.5;
    const oy = geometry ? geometry.root.y / geometry.size.height : fr.customPivot ? fr.pivotY : 1;
    this.sprite
      .setOrigin(ox, oy)
      .setScale(scale / (this.presentation?.textureDensity ?? 1))
      .setPosition(Math.round(screenX), Math.round(screenY))
      .setFlipX(f.facing === -1)
      .setVisible(true)
      .setAlpha(alpha)
      .setDepth(layeredThrow ? 9 : acting ? 12 : f.player === 0 ? 11 : 10);
    if (tint === null) this.sprite.clearTint();
    else this.sprite.setTint(tint);
    if (foregroundName && this.foreground) {
      this.foreground.setFrame(foregroundName).setOrigin(ox, oy)
        .setScale(scale / (this.presentation?.textureDensity ?? 1))
        .setPosition(Math.round(screenX), Math.round(screenY)).setFlipX(f.facing === -1)
        .setVisible(true).setAlpha(alpha).setDepth(13);
      if (tint === null) this.foreground.clearTint();
      else this.foreground.setTint(tint);
    }
    return true;
  }

  hide(): void {
    this.sprite.setVisible(false);
    this.foreground?.setVisible(false);
    this.drawnFrame = null;
  }

  /** Current shoulder/wrist/etc. in screen pixels, mirrored around the same root as the body. */
  socket(name: string): AttachmentPoint | null {
    const frame = this.drawnFrame ? this.presentation?.attachments[this.drawnFrame] : undefined;
    if (!frame || !this.sprite.visible) return null;
    const point = attachmentPoint(frame, name, {
      x: this.sprite.x, y: this.sprite.y, facing: this.sprite.flipX ? -1 : 1,
      scaleX: this.sprite.scaleX, scaleY: this.sprite.scaleY,
    });
    if (!point || !this.worldLayer) return point;
    return { x: this.worldLayer.x + point.x * this.worldLayer.scaleX, y: this.worldLayer.y + point.y * this.worldLayer.scaleY };
  }

  /** Includes the action's adjacent poses so a wide recovery/knockdown does not suddenly crop. */
  cameraBounds(): FightBounds | null {
    if (!this.drawnFrame || !this.sprite.visible || this.presentation?.style !== 'anime') return null;
    const anim = this.drawnFrame.split('/')[1]!;
    let names = this.framingGroups.get(anim);
    if (!names) {
      const families = isHeldReactionAnim(anim) ? [anim, 'hit_air', 'knockdown']
        : anim === 'hit_air' || anim === 'thrown' || anim === 'ko' ? [anim, 'knockdown'] : [anim];
      names = Object.keys(this.presentation.attachments).filter(name => families.some(family => name.startsWith(`${this.charId}/${family}/`)));
      this.framingGroups.set(anim, names);
    }
    return unionFightBounds(names.map(name => frameFramingBounds(this.presentation!.attachments[name]!,
      this.sprite.x, this.sprite.y, this.sprite.flipX ? -1 : 1, this.sprite.scaleX)));
  }

  /** 缺失帧列表（调试面板显示） */
  get missingFrames(): readonly string[] {
    return [...this.missing];
  }

  get key(): string {
    return this.activeTextureKey;
  }
}
