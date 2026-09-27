import type Phaser from 'phaser';
import { sfx, sfxHudText } from '../../audio/Sfx';
import { SCREEN_W, font, ui } from '../screen';
import { UI } from './MenuList';

/** Entry controls use exactly the battle mixer and preserve saved volume settings. */
export function audioQuickControls(scene: Phaser.Scene, y: number): void {
  const audio = sfx();
  let closed = false;
  const status = scene.add.text(SCREEN_W / 2, y + ui(28), '', { fontFamily: UI.font, fontSize: font(12), color: UI.dim }).setOrigin(0.5).setDepth(10);
  const actions: readonly [string, () => Promise<unknown>][] = [
    ['开启声音', () => audio.enableSound()],
    ['试听打击', () => audio.preview()],
    ['重试失败音频', () => audio.retryFailed()],
  ];
  actions.forEach(([label, action], index) => {
    scene.add.text(SCREEN_W / 2 + ui((index - 1) * 142), y, label, {
      fontFamily: UI.font, fontSize: font(14), color: UI.accent,
      backgroundColor: '#14213d', padding: { x: ui(12), y: ui(7) },
    }).setOrigin(0.5).setDepth(10).setInteractive({ useHandCursor: true }).on('pointerdown', () => {
      void action().then(() => {
        if (!closed) status.setText(sfxHudText(audio.hudState()));
      }).catch(() => {
        if (!closed) status.setText('声音操作失败，可再次尝试');
      });
    });
  });
  const refresh = (): void => { status.setText(`音效：${sfxHudText(audio.hudState())} · 人物：${sfxHudText(audio.hudState('voice'))} · 音乐：${sfxHudText(audio.hudState('music'))}`); };
  scene.events.on('update', refresh);
  scene.events.once('shutdown', () => {
    closed = true;
    audio.cancelPreview();
    scene.events.off('update', refresh);
  });
  refresh();
}
