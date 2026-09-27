import Phaser from 'phaser';
import { sfx } from '../../audio/Sfx';
import { SCREEN_W, font, ui } from '../screen';
import { UI } from './MenuList';

/** Text follows the audio engine's actual source, including interrupted playback. */
export class VoiceSubtitles {
  private readonly text: Phaser.GameObjects.Text;
  constructor(scene: Phaser.Scene, y = 113) {
    this.text = scene.add.text(SCREEN_W / 2, ui(y), '', {
      fontFamily: UI.font, fontSize: font(14), color: '#f7e8bb', align: 'center',
      backgroundColor: '#101927', padding: { x: ui(8), y: ui(3) }, wordWrap: { width: ui(650) },
    }).setOrigin(0.5).setDepth(68).setVisible(false);
    const unsubscribe = sfx().onVoice(voice => {
      if (!voice) { this.clear(); return; }
      const label = voice.player === undefined ? '' : `P${voice.player + 1} · `;
      this.text.setText(`${label}${voice.text}`).setVisible(voice.text.length > 0);
    });
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, unsubscribe);
  }
  setY(y: number): void { this.text.setY(ui(y)); }
  clear(): void { this.text.setVisible(false); }
}
