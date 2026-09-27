import Phaser from 'phaser';
import { sfx } from '../../audio/Sfx';
import { ANIME_CHARACTERS, ANIME_ERRORS, type AnimeCharacterAssets } from '../assets';
import { RENDER_SCALE, UI_SCALE } from '../screen';
import { readPresentation } from '../presentation';

/** On-demand local diagnostics. No telemetry, recording, or persistent event history. */
export class DiagnosticsPanel {
  private element: HTMLDialogElement | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly scene: Phaser.Scene) {
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.close());
  }

  get visible(): boolean { return this.element !== null; }

  open(): void {
    if (this.element) return;
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', '游戏诊断');
    dialog.style.cssText = 'box-sizing:border-box;width:min(850px,94vw);height:86vh;background:#101b24;color:#d9e9ed;border:1px solid #638293;border-radius:12px;padding:24px;font:14px/1.5 Consolas,Microsoft YaHei,monospace';
    const title = document.createElement('h2');
    title.textContent = '游戏诊断 · 0913';
    const description = document.createElement('p');
    description.textContent = '这里显示游戏内部状态。输出电平不能证明系统扬声器已经发声。';
    const button = document.createElement('button');
    button.textContent = '关闭 / Esc';
    button.style.cssText = 'padding:8px 18px;margin-bottom:12px;cursor:pointer';
    button.onclick = () => this.close();
    const output = document.createElement('pre');
    output.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px';
    dialog.append(title, description, button, output);
    document.body.append(dialog);
    this.element = dialog;
    dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
    dialog.addEventListener('keydown', event => event.stopPropagation());
    sfx().setDiagnosticsEnabled(true);
    const refresh = () => { output.textContent = JSON.stringify(this.snapshot(), null, 2); };
    refresh();
    this.timer = setInterval(refresh, 500);
    dialog.showModal();
    button.focus();
  }

  snapshot(): object {
    const canvas = this.scene.game.canvas;
    const rect = canvas.getBoundingClientRect();
    const assets = (this.scene.registry.get(ANIME_CHARACTERS) as AnimeCharacterAssets | undefined) ?? {};
    const textures = Object.entries(assets).map(([id, asset]) => ({
      id, textureDensity: asset.runtime.textureDensity ?? 1, pages: asset.runtime.pages ?? [asset.runtime.atlas],
      keys: [...new Set(Object.values(asset.frameTextures ?? { base: asset.key }))],
      interfaceTexture: asset.uiKey ?? null,
      animations: Object.keys(asset.runtime.anims),
    }));
    const renderer = this.scene.game.renderer;
    const gl = renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer ? renderer.gl : null;
    return {
      profile: readPresentation(this.scene.registry), scripts: [...document.scripts].map(script => script.src).filter(Boolean),
      canvas: { backing: [canvas.width, canvas.height], css: [rect.width, rect.height], dpr: window.devicePixelRatio,
        cssPerBackingPixel: rect.width / canvas.width, renderScale: RENDER_SCALE, uiScale: UI_SCALE,
        imageRendering: getComputedStyle(canvas).imageRendering },
      device: { renderer: gl ? 'WebGL' : 'Canvas', maxTextureSize: gl?.getParameter(gl.MAX_TEXTURE_SIZE) ?? null,
        textureCount: this.scene.textures.getTextureKeys().length },
      textures, loadErrors: this.scene.registry.get(ANIME_ERRORS) ?? {},
      sampleAbilityIssues: this.scene.registry.get('sampleAbilityIssues') ?? [], audio: sfx().diagnostics(),
      sampleCapabilities: this.scene.registry.get('sampleCapabilities') ?? [],
    };
  }

  close(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.element?.close();
    this.element?.remove();
    this.element = null;
    sfx().setDiagnosticsEnabled(false);
  }
}
