import Phaser from 'phaser';
import { PreloadScene } from '../render/scenes/PreloadScene';
import { FightScene, type FightSceneData } from '../render/scenes/FightScene';
import { TitleScene } from '../render/scenes/TitleScene';
import { MenuScene } from '../render/scenes/MenuScene';
import { CharacterSelectScene } from '../render/scenes/CharacterSelectScene';
import { SettingsScene } from '../render/scenes/SettingsScene';
import { ResultScene } from '../render/scenes/ResultScene';
import { SCREEN_W, SCREEN_H } from '../render/screen';
import { prepareDeliveryFormat, sharedDownloads } from '../render/assetDownloads';
import { adoptPresentation, presentationFromQuery } from '../render/presentation';
import { getInputHub } from '../input/InputHub';
import { sfx } from '../audio/Sfx';
import type { MobileFightSnapshot, MobileGameResult } from './gameTypes';

export interface MobileGameHooks {
  onReady: () => void;
  onPauseRequest: () => void;
  onResult: (result: MobileGameResult) => void;
  onError: (issues: string[]) => void;
  onProgress: (message: string) => void;
  onFrame: (snapshot: MobileFightSnapshot | null) => void;
}
export interface MobileGameHandle {
  readonly canvas: HTMLCanvasElement;
  play(data: FightSceneData): void;
  stop(): void;
  pause(paused: boolean): void;
  snapshot(): MobileFightSnapshot | null;
}

/** Load this module only after selecting a match; the menu stays independent of Phaser. */
export async function createMobileGame(parent: HTMLElement, hooks: MobileGameHooks): Promise<MobileGameHandle> {
  await prepareDeliveryFormat(new URLSearchParams(location.search).get('codec') === 'webp');
  return new Promise(resolve => {
    class MobileIdle extends Phaser.Scene {
      constructor() { super('MobileIdle'); }
      create(): void {
        const game = this.game;
        adoptPresentation(game.registry, presentationFromQuery(new URLSearchParams(location.search)));
        const fight = () => game.scene.isActive('Fight') ? game.scene.getScene('Fight') as FightScene : null;
        let generation = 0;
        game.events.on('mobile-fight-ready', hooks.onReady);
        game.events.on('mobile-pause-request', hooks.onPauseRequest);
        game.events.on('mobile-result', hooks.onResult);
        game.events.on('mobile-load-failed', hooks.onError);
        game.events.on('mobile-load-progress', hooks.onProgress);
        game.events.on(Phaser.Core.Events.POST_RENDER, () => hooks.onFrame(fight()?.mobileSnapshot() ?? null));
        game.events.once(Phaser.Core.Events.DESTROY, () => sharedDownloads(game).destroy());
        const stop = () => {
          game.registry.set('mobileGeneration', ++generation);
          for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.sys.settings.key);
          getInputHub().flush(); sfx().pause();
        };
        resolve({ canvas: game.canvas, stop,
          play(data) {
            stop();
            const profile = presentationFromQuery(new URLSearchParams(location.search));
            game.scene.start('Preload', { ...data, ...profile, mobile: true, mobileGeneration: generation });
          },
          pause: paused => fight()?.setMobilePaused(paused),
          snapshot: () => fight()?.mobileSnapshot() ?? null,
        });
      }
    }
    new Phaser.Game({ type: Phaser.AUTO, parent, width: SCREEN_W, height: SCREEN_H,
      backgroundColor: '#07131f', antialias: true, pixelArt: false, roundPixels: false,
      fps: { limit: 120 }, audio: { noAudio: true }, input: { gamepad: false },
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene: [MobileIdle, PreloadScene, FightScene, TitleScene, MenuScene, CharacterSelectScene, SettingsScene, ResultScene],
    });
  });
}
