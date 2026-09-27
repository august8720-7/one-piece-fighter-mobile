import { characters } from '../characters';
import { sfx } from '../audio/Sfx';
import { getInputHub } from '../input/InputHub';
import { touchInput } from '../input/touch';
import { AssetDownloads } from '../render/assetDownloads';
import uiArt from '../render/anime/uiArtManifest.json';
import type { FightSceneData } from '../render/scenes/FightScene';
import { MobileLobby, type MobileLobbyMode, type MobileLobbyState } from './MobileLobby';
import { TouchControls } from './TouchControls';
import { PeerRoom, normalizeRoomCode, type RoomView } from './PeerRoom';
import { NetworkRound } from './NetworkRound';
import { MOBILE_PROTOCOL, RULESET_ID, createNetworkSetup, isMobileCharacter, isRecord, parseChoice, parseHello, parseLobby, parseNetworkSetup,
  type MobileCharacterId, type NetworkResult, type NetworkSetup } from './matchProtocol';
import type { MobileGameHandle } from './MobileGame';
import type { MobileFightSnapshot, MobileGameResult } from './gameTypes';
import './mobile.css';
import './lobby.css';
import './app.css';

type AppPhase = 'home' | 'select' | 'room' | 'loading' | 'game' | 'result' | 'error';

export class MobileApp {
  private readonly shell: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly banner: HTMLOutputElement;
  private readonly cancelLoading: HTMLButtonElement;
  private readonly lobby: MobileLobby;
  private readonly touch: TouchControls;
  private readonly room = new PeerRoom();
  private readonly menuDownloads = new AssetDownloads();
  private readonly artUrls: string[] = [];
  private game: MobileGameHandle | null = null;
  private gamePromise: Promise<MobileGameHandle> | null = null;
  private round: NetworkRound | null = null;
  private phase: AppPhase = 'home';
  private mode: MobileLobbyMode = 'cpu';
  private character: MobileCharacterId = 'labubu';
  private opponent: MobileCharacterId = 'twinkle';
  private remoteCharacter: MobileCharacterId = 'twinkle';
  private connection: RoomView = this.room.state;
  private peerHello = false;
  private greetingSent = false;
  private localReady = false;
  private remoteReady = false;
  private choiceSeq = 0;
  private remoteChoiceSeq = 0;
  private closing = false;
  private startToken = 0;
  private message = '';
  private error = '';
  private outcome: MobileGameResult | null = null;
  private lastSolo: FightSceneData | null = null;
  private lastSnapshot: MobileFightSnapshot | null = null;
  private lastRenderKey = '';
  private lastSkillKey = '';
  private invitation = '';

  constructor(root: HTMLElement) {
    this.shell = root; root.classList.add('opf-mobile-shell');
    this.stage = document.createElement('div'); this.stage.id = 'game'; this.stage.className = 'opf-game-stage'; root.append(this.stage);
    this.banner = document.createElement('output'); this.banner.className = 'opf-app-status'; this.banner.setAttribute('aria-live', 'polite'); root.append(this.banner);
    this.cancelLoading = document.createElement('button'); this.cancelLoading.className = 'opf-app-cancel'; this.cancelLoading.textContent = '取消并返回';
    this.cancelLoading.onclick = () => this.returnToSelection(); root.append(this.cancelLoading);
    this.touch = new TouchControls({ parent: root, input: touchInput, onPause: () => this.pause(true), onExit: () => this.exit() });
    this.touch.setVisible(false);
    this.lobby = new MobileLobby({ parent: root, callbacks: {
      onChooseMode: mode => this.chooseMode(mode), onSelectCharacter: id => this.selectCharacter(id),
      onSelectOpponent: id => { if (isMobileCharacter(id)) { this.opponent = id; this.render(); } },
      onStartSolo: () => this.startSolo(), onCreateRoom: () => this.createRoom(), onJoinRoom: code => this.joinRoom(code),
      onCopyRoomCode: code => { void this.copyCode(code); }, onReady: ready => this.setReady(ready), onBack: () => this.back(),
      onExit: () => this.exit(), onResume: () => this.pause(false), onRematch: () => this.rematch(),
      onReselect: () => this.returnToSelection(), onRetry: () => this.retry(),
      onSoundToggle: () => { sfx().toggleMute(); void sfx().unlock(); this.render(true); },
      onFullscreenToggle: () => { void this.fullscreen(); },
    } });
    // An input field in the lobby must not trigger gameplay keyboard bindings.
    this.lobby.element.addEventListener('keydown', event => event.stopPropagation());
    this.room.onPacket(packet => this.receive(packet));
    this.room.onState(state => this.roomState(state));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') this.pause(true); });
    window.addEventListener('pagehide', () => { this.closing = true; this.round?.close('page left'); this.room.close(); touchInput.clear(); });
    window.addEventListener('resize', () => { this.updateBounds(); if (innerHeight > innerWidth) this.pause(true); });
    document.addEventListener('fullscreenchange', () => this.render(true));
    const code = normalizeRoomCode(new URLSearchParams(location.search).get('room') ?? '');
    if (code) { this.invitation = code; this.mode = 'join'; this.phase = 'select'; }
    void this.loadMenu(); this.render(true);
  }

  private get online(): boolean { return this.mode === 'host' || this.mode === 'join'; }
  private get localPlayer(): 0 | 1 { return this.mode === 'join' ? 1 : 0; }
  private gesture(): void { void sfx().unlock(); }

  private async loadMenu(): Promise<void> {
    sfx().useDownloads(this.menuDownloads);
    await Promise.allSettled([sfx().preloadMenu(), ...Object.entries(uiArt.characters).map(async ([id, record]) => {
      const blob = await this.menuDownloads.read(record.image, response => response.blob());
      const url = URL.createObjectURL(blob); this.artUrls.push(url); this.lobby.setArtwork(id, url);
    })]);
  }
  private chooseMode(mode: MobileLobbyMode): void {
    this.gesture(); this.leaveConnection(); this.mode = mode; this.phase = 'select'; this.message = ''; this.error = ''; this.outcome = null; this.render(true);
  }
  private selectCharacter(id: string): void {
    if (!isMobileCharacter(id) || this.phase !== 'select') return;
    this.gesture(); this.character = id; this.localReady = false;
    void sfx().preloadMenu().then(() => { if (this.character === id && this.phase !== 'game') sfx().playCue(`voice.${id}.select`, { ui: true }); });
    if (this.online) { this.phase = 'room'; this.sendChoice(); }
    this.render(true);
  }
  private createRoom(): void {
    if (this.phase !== 'room') return;
    this.gesture(); this.resetGreeting(); this.message = ''; this.room.host(); this.render(true);
  }
  private joinRoom(code: string): void {
    if (this.phase !== 'room') return;
    this.gesture(); this.resetGreeting(); this.message = '';
    try { this.room.join(code); } catch (error) { this.showError(error instanceof Error ? error.message : '房间码无效'); }
    this.render(true);
  }
  private resetGreeting(): void { this.peerHello = false; this.greetingSent = false; this.localReady = false; this.remoteReady = false; this.choiceSeq = this.remoteChoiceSeq = 0; }
  private roomState(state: RoomView): void {
    this.connection = state;
    if (this.closing) return;
    if (state.status === 'connected' && !this.greetingSent) {
      this.message = '';
      this.greetingSent = true;
      this.send({ type: 'hello', protocol: MOBILE_PROTOCOL, ruleset: RULESET_ID, role: state.role, character: this.character });
    }
    if (state.status === 'failed') { this.showError(state.message); return; }
    this.render();
  }
  private send(packet: unknown): boolean {
    try { this.room.send(packet); return true; }
    catch { this.showError('连接已中断，请重新连接后开局'); return false; }
  }
  private sendChoice(): void {
    if (!this.peerHello || this.connection.status !== 'connected') return;
    this.send({ type: 'choice', seq: ++this.choiceSeq, character: this.character, ready: this.localReady });
  }
  private setReady(ready: boolean): void {
    if (this.phase !== 'room' || !this.peerHello || this.connection.status !== 'connected') return;
    this.gesture(); this.message = ''; this.localReady = ready; this.sendChoice(); this.maybeStart(); this.render(true);
  }
  private receive(raw: unknown): void {
    if (!isRecord(raw)) { this.showError('收到无法识别的连接数据，请重新配对'); return; }
    if (raw.type === 'hello') {
      const hello = parseHello(raw);
      if (!hello || hello.role !== (this.mode === 'host' ? 'guest' : 'host')) { this.showError('双方游戏版本不一致，请双方刷新后重新连接'); return; }
      if (this.peerHello) return;
      this.peerHello = true; this.message = ''; this.remoteCharacter = hello.character; this.sendChoice(); this.render(true); return;
    }
    if (raw.type === 'choice') {
      const choice = parseChoice(raw);
      if (!choice || !this.peerHello) { this.showError('角色准备信息异常，请重新连接'); return; }
      if (choice.seq <= this.remoteChoiceSeq) return;
      this.remoteChoiceSeq = choice.seq;
      if (this.phase !== 'room' && this.phase !== 'select' && this.phase !== 'result') return;
      this.message = ''; this.remoteCharacter = choice.character; this.remoteReady = choice.ready; this.maybeStart(); this.render(true); return;
    }
    if (raw.type === 'setup') {
      const setup = parseNetworkSetup(raw);
      if (this.mode !== 'join' || this.phase !== 'room' || !this.peerHello || !this.localReady || !this.remoteReady
        || !setup || setup.p1 !== this.remoteCharacter || setup.p2 !== this.character) {
        this.showError('开局信息与双方选择不一致，已停止本局'); return;
      }
      void this.startNetwork(setup); return;
    }
    if (raw.type === 'lobby') {
      const packet = parseLobby(raw);
      if (!packet) { this.showError('返回房间信息异常'); return; }
      if (this.round?.setup.sessionId !== packet.sessionId) return;
      this.stopMatch(); this.phase = 'room'; this.localReady = this.remoteReady = false;
      this.message = '对方已返回房间，双方重新准备即可开局'; this.sendChoice(); this.render(true); return;
    }
    this.round?.receive(raw);
    if (this.round?.status === 'halted') this.showError(this.roundError());
  }
  private maybeStart(): void {
    if (this.mode !== 'host' || this.phase !== 'room' || !this.peerHello || !this.localReady || !this.remoteReady) return;
    const setup = createNetworkSetup(this.character, this.remoteCharacter);
    const loading = this.startNetwork(setup);
    if (!this.send(setup)) return;
    void loading;
  }
  private async startNetwork(setup: NetworkSetup): Promise<void> {
    this.round?.dispose();
    const round = new NetworkRound({ setup, localPlayer: this.localPlayer, send: packet => this.room.send(packet), now: () => performance.now(),
      onResult: result => { if (this.round === round) this.result({ ...result, verified: true }); } });
    this.round = round; this.outcome = null;
    await this.play({ p1: setup.p1, p2: setup.p2, mode: 'versus', controlModes: ['simple', 'simple'], network: round, mobile: true });
  }
  private startSolo(): void {
    if (this.mode !== 'cpu' && this.mode !== 'training') return;
    this.gesture(); this.outcome = null;
    this.lastSolo = { p1: this.character, p2: this.opponent, mode: this.mode, difficulty: 'normal', controlModes: ['simple', 'classic'], mobile: true };
    void this.play(this.lastSolo);
  }
  private async play(data: FightSceneData): Promise<void> {
    const token = ++this.startToken;
    this.phase = 'loading'; this.message = '正在准备本场角色与声音…'; this.touch.setVisible(false); this.render(true);
    try {
      this.gamePromise ??= import('./MobileGame').then(({ createMobileGame }) => createMobileGame(this.stage, {
        onReady: () => { if (this.phase === 'loading') { this.phase = 'game'; this.message = ''; this.updateBounds(); this.render(true); if (innerHeight > innerWidth) this.pause(true); } },
        onPauseRequest: () => this.pause(true), onResult: result => this.result(result),
        onError: issues => { console.warn(`Mobile match assets failed: ${JSON.stringify(issues)}`); this.showError('角色、舞台或声音未能完整载入。检查网络后重试'); },
        onProgress: message => { if (this.phase === 'loading') { this.message = `正在载入本场资源 · ${message}`; this.render(); } },
        onFrame: snapshot => this.frame(snapshot),
      }));
      const game = await this.gamePromise; this.game = game;
      if (token !== this.startToken || this.phase !== 'loading') return;
      game.play(data);
    } catch (error) { this.gamePromise = null; this.showError(error instanceof Error ? error.message : '游戏启动失败，请重试'); }
  }
  private frame(snapshot: MobileFightSnapshot | null): void {
    const previous = this.lastSnapshot;
    this.lastSnapshot = snapshot;
    if (!snapshot || this.phase === 'home' || this.phase === 'select' || this.phase === 'room' || this.phase === 'error') return;
    const telemetry = JSON.stringify(snapshot);
    if (this.shell.dataset.gameState !== telemetry) this.shell.dataset.gameState = telemetry;
    if (this.round?.status === 'halted') { this.showError(this.roundError()); return; }
    const skills = snapshot.skills.map(item => `${item.moveId}:${item.reason}`).join('|');
    if (skills !== this.lastSkillKey) { this.lastSkillKey = skills; this.touch.updateAvailability(snapshot.skills); }
    if (this.touch.element.dataset.player !== String(snapshot.localPlayer)) this.touch.setPlayer(snapshot.localPlayer);
    if (!previous || previous.meter !== snapshot.meter) this.touch.setMeter(snapshot.meter);
    if (previous?.paused !== snapshot.paused) { if (snapshot.paused) sfx().pause(); else sfx().resume(); }
    this.render();
  }
  private pause(paused: boolean): void {
    if (this.phase !== 'game') return;
    this.gesture(); this.message = ''; this.game?.pause(paused); touchInput.clear();
    if (this.lastSnapshot) this.lastSnapshot = this.game?.snapshot() ?? null;
    this.render(true);
  }
  private result(result: MobileGameResult | NetworkResult): void {
    if (this.phase !== 'game' && this.phase !== 'loading') return;
    this.outcome = { ...result, verified: this.online }; this.phase = 'result'; this.localReady = this.remoteReady = false;
    this.touch.setVisible(false); sfx().playMusic(result.winner === this.localPlayer ? 'victory' : 'defeat'); this.render(true);
  }
  private rematch(): void {
    this.gesture();
    if (!this.online) { if (this.lastSolo) void this.play(this.lastSolo); return; }
    this.returnRoom(true, false);
  }
  private returnToSelection(): void {
    if (this.online && this.connection.status === 'connected') { this.returnRoom(false, true); return; }
    this.stopMatch(); this.phase = 'select'; this.render(true);
  }
  private returnRoom(ready: boolean, select: boolean): void {
    const id = this.round?.setup.sessionId;
    if (id && !this.send({ type: 'lobby', sessionId: id })) return;
    this.stopMatch(); this.localReady = ready; this.remoteReady = false; this.phase = select ? 'select' : 'room'; this.message = '';
    this.sendChoice(); this.render(true);
  }
  private back(): void {
    if (this.phase === 'room') { this.localReady = false; this.sendChoice(); this.phase = 'select'; this.render(true); }
    else this.exit();
  }
  private stopMatch(): void {
    this.startToken++; this.round?.dispose(); this.round = null; this.game?.stop(); this.touch.setVisible(false); getInputHub().flush();
    this.lastSnapshot = null; this.lastSkillKey = ''; delete this.shell.dataset.gameState;
  }
  private leaveConnection(): void {
    this.closing = true; this.round?.close('left match'); this.stopMatch(); this.room.close(); this.resetGreeting(); this.closing = false;
  }
  private exit(): void { this.leaveConnection(); this.phase = 'home'; this.message = ''; this.error = ''; this.outcome = null; this.render(true); }
  private retry(): void {
    if (this.online) { this.leaveConnection(); this.phase = 'room'; this.message = '重新创建或输入房间码连接'; this.error = ''; this.render(true); }
    else { void sfx().retryFailed().then(() => { if (this.lastSolo) void this.play(this.lastSolo); else this.returnToSelection(); }); }
  }
  private showError(message: string): void {
    if (this.phase === 'error' && this.error === message) return;
    this.round?.close('match stopped'); this.startToken++; this.game?.stop(); this.touch.setVisible(false);
    this.lastSnapshot = null; delete this.shell.dataset.gameState;
    this.phase = 'error'; this.error = message; this.render(true);
  }
  private roundError(): string {
    const reason = this.round?.reason ?? '';
    return /checksum|mismatch|result/.test(reason) ? '双方游戏状态或结算不一致，本局已停止。请双方重新连接开局'
      : /timeout/.test(reason) ? '对方长时间未响应，本局已停止。请重新连接开局' : '对战连接中断或收到异常数据，本局已停止';
  }
  private render(force = false): void {
    const netStatus = this.round?.status;
    const paused = this.phase === 'game' && (this.round ? this.round.localPaused || this.round.remotePaused : !!this.lastSnapshot?.paused);
    const waiting = this.phase === 'game' && (netStatus === 'loading' || netStatus === 'ready' || netStatus === 'finalizing'
      || (netStatus === 'waiting' && (this.round?.diagnostics.waitingMs ?? 0) > 250));
    const screen = this.phase === 'game' ? paused ? 'pause' : 'hidden' : this.phase === 'loading' ? this.online ? 'room' : 'hidden' : this.phase;
    const status = paused ? this.message || (this.round && !this.round.localPaused ? '对方已暂停，等待对方继续…' : '比赛已暂停')
      : this.message || (this.peerHello && this.connection.status === 'connected'
        ? `${characters[this.remoteCharacter]!.name}已加入 · ${this.remoteReady ? '对方已准备' : '等待对方准备'}` : this.connection.message);
    const state: MobileLobbyState = { screen, mode: this.mode, selectedCharacter: this.character,
      opponentCharacter: this.online ? this.remoteCharacter : this.opponent, localPlayer: this.localPlayer,
      roomCode: this.connection.code || this.invitation, connected: this.connection.status === 'connected' && this.peerHello,
      ready: this.localReady, remoteReady: this.remoteReady, busy: this.phase === 'loading' || ['opening', 'connecting'].includes(this.connection.status),
      status, error: this.error, soundEnabled: !sfx().muted, fullscreen: !!document.fullscreenElement,
      canStart: true, canResume: this.round ? this.round.localPaused : true,
      ...(this.outcome ? { winnerName: characters[this.outcome.winner === 0 ? this.lastSnapshot?.characters[0] ?? this.character : this.lastSnapshot?.characters[1] ?? this.opponent]?.name ?? '对手',
        wins: this.outcome.wins, localWon: this.outcome.winner === this.localPlayer } : {}),
    };
    const key = JSON.stringify(state);
    this.shell.dataset.appPhase = this.phase;
    if (force || key !== this.lastRenderKey) { this.lastRenderKey = key; this.lobby.update(state); }
    const showTouch = this.phase === 'game' && !paused && !waiting;
    if (this.touch.element.hidden === showTouch) this.touch.setVisible(showTouch);
    const currentCharacter = this.lastSnapshot?.character ?? this.character;
    if (this.touch.element.dataset.character !== currentCharacter) this.touch.setCharacter(currentCharacter);
    this.cancelLoading.hidden = this.phase !== 'loading';
    this.banner.hidden = this.phase !== 'loading' && !waiting;
    const text = this.phase === 'loading' ? this.message : netStatus === 'finalizing' ? '正在核对双方胜负…'
      : netStatus === 'loading' || netStatus === 'ready' ? '本机已就绪，等待另一台手机…' : '网络波动，正在等待对方输入…';
    if (this.banner.textContent !== text) this.banner.textContent = text;
  }
  private updateBounds(): void {
    if (!this.game) return;
    requestAnimationFrame(() => {
      if (!this.game) return;
      const canvas = this.game.canvas.getBoundingClientRect(), shell = this.shell.getBoundingClientRect();
      this.shell.style.setProperty('--opf-hud-bottom', `${Math.max(0, canvas.top - shell.top) + canvas.height * 0.14}px`);
    });
  }
  private async copyCode(code: string): Promise<void> {
    try { await navigator.clipboard.writeText(code); this.message = '房间码已复制，可发给同网的另一位玩家'; }
    catch { this.message = `房间码 ${code} · 请长按选择并复制`; }
    this.render(true);
  }
  private async fullscreen(): Promise<void> {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await this.shell.requestFullscreen(); }
    catch { this.message = '此浏览器请使用系统全屏或添加到主屏幕'; }
    this.updateBounds(); this.render(true);
  }
}
