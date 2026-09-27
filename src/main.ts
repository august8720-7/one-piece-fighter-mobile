import Phaser from 'phaser';
import { sfx } from './audio/Sfx';
import { SCREEN_H, SCREEN_W } from '@render/screen';
import { BootScene } from '@render/scenes/BootScene';
import { CharacterSelectScene } from '@render/scenes/CharacterSelectScene';
import { FightScene } from '@render/scenes/FightScene';
import { MenuScene } from '@render/scenes/MenuScene';
import { PreloadScene } from '@render/scenes/PreloadScene';
import { ResultScene } from '@render/scenes/ResultScene';
import { SettingsScene } from '@render/scenes/SettingsScene';
import { TitleScene } from '@render/scenes/TitleScene';
import { sharedDownloads } from '@render/assetDownloads';

const startupParams = new URLSearchParams(window.location.search);
if (startupParams.get('art') === 'anime') document.body.dataset.art = 'anime';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: SCREEN_W,
  height: SCREEN_H,
  backgroundColor: '#07080c',
  antialias: true,
  pixelArt: false,
  roundPixels: false,
  // Bound redundant high-refresh rendering. A 60 limit in Phaser discards the
  // remainder and can undershoot 60 on 120/144/165 Hz displays; logic stays 60 Hz.
  fps: { limit: 120 },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  input: { gamepad: false },
  scene: [BootScene, TitleScene, MenuScene, CharacterSelectScene, SettingsScene, PreloadScene, FightScene, ResultScene],
});

// FightScene owns its explicit pause menu; other scenes resume music when focus returns.
game.events.on(Phaser.Core.Events.BLUR, () => sfx().pause());
game.events.on(Phaser.Core.Events.HIDDEN, () => sfx().pause());
const resumeMenuAudio = (): void => { if (!game.scene.isActive('Fight')) sfx().resume(); };
game.events.on(Phaser.Core.Events.FOCUS, resumeMenuAudio);
game.events.on(Phaser.Core.Events.VISIBLE, resumeMenuAudio);
game.events.once(Phaser.Core.Events.DESTROY, () => { sharedDownloads(game).destroy(); void sfx().destroy(); });
