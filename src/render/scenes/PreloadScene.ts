import Phaser from 'phaser';
import { characters } from '@characters/index';
import { loadAnimeCharacters, loadAnimeInterfaces, loadCharacterAtlases, loadPresentationAssets, releaseUnusedFightAssets, type AnimeLoadResult } from '../assets';
import { sfx } from '../../audio/Sfx';
import { SCREEN_H, SCREEN_W, font, ui } from '../screen';
import { UI } from '../ui/MenuList';
import { evaluateAnimeEntry } from '../anime/entryGate';
import { audioQuickControls } from '../ui/audioQuickControls';
import { adoptPresentation, legacyPresentation, presentationLabel, readPresentation, PRESENTATION_LOAD, type PresentationData } from '../presentation';
import type { FightSceneData } from './FightScene';
import { sharedDownloads } from '../assetDownloads';
import { TITLE_CHARACTER_IDS } from '../ui/titleRoster';

export type PreloadData = FightSceneData & PresentationData & {
  destination?: 'Title' | 'CharacterSelect';
  /** A defensive Fight gate routes here without triggering an automatic retry loop. */
  failure?: string[];
  retryAudio?: boolean;
};

/** A requested anime battle cannot exist until all declared resources have decoded and passed validation. */
export class PreloadScene extends Phaser.Scene {
  private data_!: PreloadData;
  private generation = 0;

  constructor() { super('Preload'); }

  init(data: PreloadData): void {
    this.data_ = { ...data, ...adoptPresentation(this.registry, data) };
  }

  create(): void {
    const generation = ++this.generation;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { this.generation++; });
    this.add.rectangle(0, 0, SCREEN_W, SCREEN_H, 0x0b1220).setOrigin(0);
    if (this.data_.failure?.length) { this.showFailure(this.data_.failure); return; }
    const label = this.add.text(SCREEN_W / 2, SCREEN_H / 2, '正在载入人物与舞台…', { fontFamily: UI.font, fontSize: font(22), color: UI.dim, align: 'center' }).setOrigin(0.5);
    const hint = this.add.text(SCREEN_W / 2, SCREEN_H / 2 + ui(90), '首次打开需要下载高清素材，较慢网络请稍候。', { fontFamily: UI.font, fontSize: font(15), color: UI.dim }).setOrigin(0.5);
    const active = (): boolean => generation === this.generation && this.scene.isActive();
    const data = this.data_;
    const profile = readPresentation(this.registry);
    const menu = profile.art === 'anime' && data.destination !== undefined;
    const downloads = sharedDownloads(this.game ?? this.registry);
    const audio = sfx();
    audio.useDownloads(downloads);
    // Give required fighter assets the link. Fight.create starts the unchanged
    // battle track with the actual opening, instead of playing its intro while waiting.
    if (!data.destination) audio.stopMusic();
    const unsubscribe = downloads.observe(progress => {
      if (!active()) return;
      const bytes = progress.totalBytes === undefined ? `已完成 ${progress.completed} 份文件`
        : `${((progress.receivedBytes ?? 0) / 1_000_000).toFixed(1)} / ${(progress.totalBytes / 1_000_000).toFixed(1)} MB`;
      label.setText(`${menu ? '正在准备菜单…' : '正在准备完整比赛…'}\n${bytes}${progress.retry ? '\n连接较慢，正在自动重试…' : ''}`);
      if (data.mobile) this.game.events.emit('mobile-load-progress', `${bytes}${progress.retry ? ' · 正在重试' : ''}`);
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, unsubscribe);
    const finish = (): void => { unsubscribe(); label.destroy(); hint.destroy(); };
    const ids = data.destination === 'Title' && profile.art === 'anime' ? [...TITLE_CHARACTER_IDS]
      : data.destination ? Object.keys(characters) : [data.p1, data.p2];
    if (!menu) releaseUnusedFightAssets(this, ids);
    const loadAudio = () => menu ? audio.preloadMenu() : audio.preload(ids);
    void Promise.all([
      menu ? loadAnimeInterfaces(this, ids, downloads) : profile.art === 'anime' ? loadAnimeCharacters(this, ids, downloads) : loadCharacterAtlases(this, ids),
      loadPresentationAssets(this, downloads, menu ? 'menu' : 'fight', menu ? [] : ids),
      data.retryAudio ? audio.retryFailed().then(loadAudio) : loadAudio(),
    ]).then(([characterResult, presentationAssets, audioResult]) => {
      if (generation !== this.generation || !this.scene.isActive()) return;
      const loaded = profile.art === 'anime' ? characterResult as AnimeLoadResult : undefined;
      const invalidIds = [data.p1, data.p2].filter(id => !characters[id]);
      const issues = invalidIds.length ? [`未知角色：${invalidIds.join('、')}`] : [];
      if (profile.art === 'anime' && profile.scope === 'full' && !presentationAssets?.ok) {
        issues.push(...(presentationAssets?.failures.map(failure => failure.message) ?? ['舞台与技能贴图加载未完成']));
      }
      if (profile.art === 'anime') {
        if (!loaded?.ok) issues.push(...(loaded?.failures.map(f => `${characters[f.characterId]?.name ?? f.characterId}：${f.message}`) ?? ['人物加载未完成']));
        if (!issues.length && !menu && !data.destination) {
          const result = evaluateAnimeEntry(profile, [characters[data.p1]!, characters[data.p2]!], loaded!.assets, loaded!.errors, data.mode);
          this.registry.set(PRESENTATION_LOAD, result);
          issues.push(...result.issues);
        }
      }
      if (profile.art === 'anime' && !audio.muted && audioResult.failed.length) issues.push(`声音未能载入：${audioResult.failed.join('、')}`);
      if (issues.length) { finish(); this.showFailure(issues); return; }
      finish();
      this.registry.set(PRESENTATION_LOAD, { ok: true, scope: profile.scope, art: profile.art, stage: menu ? 'menu' : 'fight' });
      if (data.destination === 'Title') this.scene.start('Title', profile);
      else if (data.destination === 'CharacterSelect') {
        const selection = { ...data, ...profile };
        delete selection.destination; delete selection.failure; delete selection.retryAudio;
        this.scene.start('CharacterSelect', selection);
      }
      else this.scene.start('Fight', { ...data, ...profile });
    }).catch(error => {
      if (generation !== this.generation || !this.scene.isActive()) return;
      finish();
      this.showFailure([error instanceof Error ? error.message : '资源加载失败']);
    });
  }

  private showFailure(issues: string[]): void {
    this.registry.set(PRESENTATION_LOAD, { ok: false, issues, ...readPresentation(this.registry) });
    if (this.data_.mobile) { this.game.events.emit('mobile-load-failed', issues); return; }
    const profile = readPresentation(this.registry);
    this.add.text(SCREEN_W / 2, ui(94), profile.art === 'anime' ? '新版暂时无法开始' : '游戏暂时无法开始', { fontFamily: UI.font, fontSize: font(30), color: UI.title }).setOrigin(0.5);
    const incomplete = issues.some(issue => /缺少动作|缺少招式|完整动作覆盖/.test(issue));
    const timedOut = issues.some(issue => /超时|下载超过/.test(issue));
    const summary = incomplete
      ? '新版人物动作尚未制作齐全，完整比赛尚未开放。'
      : timedOut ? '素材下载超时，自动重试后仍未完成。请检查网络后重新载入；已下载的文件会先检查是否可复用。'
        : '人物、舞台、技能或声音未能完整载入，请重试。具体原因可在加载诊断中查看。';
    this.add.text(SCREEN_W / 2, ui(174), summary, {
      fontFamily: UI.font, fontSize: font(18), color: UI.text, align: 'center', wordWrap: { width: ui(720), useAdvancedWrap: true },
    }).setOrigin(0.5, 0);
    this.add.text(SCREEN_W / 2, ui(294), '资源问题修复后可重试。进入旧版需要你主动选择。', { fontFamily: UI.font, fontSize: font(14), color: UI.dim }).setOrigin(0.5);
    const button = (x: number, label: string, action: () => void): void => {
      const text = this.add.text(ui(x), ui(350), label, { fontFamily: UI.font, fontSize: font(18), color: UI.title, backgroundColor: '#20314d', padding: { x: ui(16), y: ui(12) } }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      text.once('pointerdown', action);
    };
    button(320, '重新载入', () => {
      const retry = { ...this.data_ };
      delete retry.failure;
      this.scene.restart({ ...retry, retryAudio: true });
    });
    button(625, '主动进入旧版', () => {
      const data = { ...this.data_ };
      delete data.failure;
      const legacy = adoptPresentation(this.registry, legacyPresentation(profile));
      this.scene.restart({ ...data, ...legacy });
    });
    audioQuickControls(this, ui(458));
    const backdrop = this.add.rectangle(ui(36), ui(36), SCREEN_W - ui(72), SCREEN_H - ui(72), 0x101828, 0.98).setOrigin(0).setDepth(20).setVisible(false);
    const details = this.add.text(ui(64), ui(64), '', { fontFamily: UI.mono, fontSize: font(12), color: UI.text, lineSpacing: ui(3), wordWrap: { width: ui(832), useAdvancedWrap: true } }).setDepth(21).setVisible(false);
    const close = this.add.text(SCREEN_W - ui(70), SCREEN_H - ui(66), '关闭诊断', { fontFamily: UI.font, fontSize: font(16), color: UI.accent }).setOrigin(1, 1).setDepth(22).setInteractive({ useHandCursor: true }).setVisible(false);
    const pageLabel = this.add.text(SCREEN_W / 2, ui(433), '', { fontFamily: UI.font, fontSize: font(14), color: UI.dim }).setOrigin(0.5).setDepth(22).setVisible(false);
    const previous = this.add.text(ui(240), ui(433), '上一页', { fontFamily: UI.font, fontSize: font(16), color: UI.accent }).setOrigin(0.5).setDepth(22).setInteractive({ useHandCursor: true }).setVisible(false);
    const next = this.add.text(ui(720), ui(433), '下一页', { fontFamily: UI.font, fontSize: font(16), color: UI.accent }).setOrigin(0.5).setDepth(22).setInteractive({ useHandCursor: true }).setVisible(false);
    let page = 0;
    let pages: string[] = [];
    const renderPage = (): void => {
      details.setText(pages[page] ?? '');
      pageLabel.setText(`${page + 1} / ${pages.length}`);
    };
    previous.on('pointerdown', () => { page = Math.max(0, page - 1); renderPage(); });
    next.on('pointerdown', () => { page = Math.min(pages.length - 1, page + 1); renderPage(); });
    const modal = [backdrop, details, close, pageLabel, previous, next];
    close.on('pointerdown', () => { modal.forEach(item => item.setVisible(false)); });
    this.add.text(SCREEN_W / 2, ui(397), '查看加载诊断', { fontFamily: UI.font, fontSize: font(14), color: UI.accent }).setOrigin(0.5).setInteractive({ useHandCursor: true }).on('pointerdown', () => {
      const canvas = this.game.canvas;
      const rect = canvas.getBoundingClientRect();
      const content = `${presentationLabel(profile)}  ${profile.quality}\n画布 ${canvas.width}×${canvas.height} / 显示 ${Math.round(rect.width)}×${Math.round(rect.height)} / DPR ${window.devicePixelRatio}\n${issues.join('\n')}`;
      const lines = content.split('\n').flatMap(line => {
        const chars = Array.from(line);
        return Array.from({ length: Math.max(1, Math.ceil(chars.length / 60)) }, (_, index) => chars.slice(index * 60, (index + 1) * 60).join(''));
      });
      pages = Array.from({ length: Math.ceil(lines.length / 22) }, (_, index) => lines.slice(index * 22, (index + 1) * 22).join('\n'));
      page = 0; renderPage(); modal.forEach(item => item.setVisible(true));
    });
  }
}

export { SPRITE_KEYS, type SpriteKeys } from '../assets';
