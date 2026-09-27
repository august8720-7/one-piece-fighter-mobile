import { characters } from '@characters/index';
import uiArtManifest from '@render/anime/uiArtManifest.json';

export const MOBILE_LOBBY_SCREENS = ['home', 'select', 'room', 'hidden', 'pause', 'result', 'error'] as const;
export type MobileLobbyScreen = typeof MOBILE_LOBBY_SCREENS[number];
export const MOBILE_LOBBY_MODES = ['cpu', 'training', 'host', 'join'] as const;
export type MobileLobbyMode = typeof MOBILE_LOBBY_MODES[number];

export interface MobileLobbyState {
  screen: MobileLobbyScreen;
  mode?: MobileLobbyMode;
  selectedCharacter?: string;
  opponentCharacter?: string;
  localPlayer?: 0 | 1;
  roomCode?: string;
  connected?: boolean;
  ready?: boolean;
  remoteReady?: boolean;
  busy?: boolean;
  status?: string;
  error?: string;
  winnerName?: string;
  soundEnabled?: boolean;
  fullscreen?: boolean;
  canStart?: boolean;
  canResume?: boolean;
  wins?: readonly [number, number];
  localWon?: boolean;
}

export interface MobileLobbyCallbacks {
  onChooseMode: (mode: MobileLobbyMode) => void;
  onSelectCharacter: (characterId: string) => void;
  onSelectOpponent: (characterId: string) => void;
  onStartSolo: () => void;
  onCreateRoom: () => void;
  onJoinRoom: (roomCode: string) => void;
  onCopyRoomCode: (roomCode: string) => void;
  onReady: (ready: boolean) => void;
  onBack: () => void;
  onExit: () => void;
  onResume: () => void;
  onRematch: () => void;
  onReselect: () => void;
  onRetry: () => void;
  onSoundToggle: () => void;
  onFullscreenToggle: () => void;
}

export interface MobileLobbyOptions {
  parent: HTMLElement;
  callbacks: MobileLobbyCallbacks;
}

export interface MobileCharacterCard {
  id: string;
  name: string;
  tagline: string;
  color: string;
}

export const ROOM_CODE_PATTERN = /^[A-Z0-9]{10}$/;

export function normalizeRoomCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
}

export function mobileCharacterCards(): MobileCharacterCard[] {
  return Object.values(characters).map(def => ({
    id: def.id,
    name: def.name,
    tagline: def.tagline ?? '打法待载入',
    color: `#${def.color.toString(16).padStart(6, '0')}`,
  }));
}

export function lobbyErrorCopy(mode?: MobileLobbyMode): { title: string; help: string; retry: string } {
  if (mode === 'cpu' || mode === 'training') {
    return {
      title: '暂时无法开始',
      help: '本场角色或舞台资源尚未准备完成，请稍后重试。',
      retry: '重试加载',
    };
  }
  return {
    title: '连接中断',
    help: '请确认两台手机连接同一 Wi-Fi 或热点，然后重试。',
    retry: '重试连接',
  };
}

const MODE_COPY: Readonly<Record<MobileLobbyMode, { title: string; note: string }>> = {
  cpu: { title: '单人人机', note: '与电脑完成完整比赛' },
  training: { title: '训练模式', note: '练习移动、防御和全部技能' },
  host: { title: '创建房间', note: '同 Wi-Fi／热点邀请另一台手机' },
  join: { title: '加入房间', note: '输入另一台手机显示的 10 位码' },
};

type ArtworkRecord = (typeof uiArtManifest.characters)[keyof typeof uiArtManifest.characters];

/** Persistent DOM shell for menus and overlays; update() only changes stateful nodes. */
export class MobileLobby {
  readonly element: HTMLElement;
  private state: MobileLobbyState = { screen: 'home' };
  private readonly screens = new Map<MobileLobbyScreen, HTMLElement>();
  private readonly characterButtons = new Map<string, HTMLButtonElement>();
  private readonly localBadges = new Map<string, HTMLElement>();
  private readonly opponentBadges = new Map<string, HTMLElement>();
  private readonly artwork = new Map<string, Set<HTMLElement>>();
  private readonly joinInput: HTMLInputElement;
  private readonly joinButton: HTMLButtonElement;
  private readonly roomCode: HTMLElement;
  private readonly copyButton: HTMLButtonElement;
  private readonly createRoomButton: HTMLButtonElement;
  private readonly readyButton: HTMLButtonElement;
  private readonly connectionStatus: HTMLElement;
  private readonly playerStatus: HTMLElement;
  private readonly resultTitle: HTMLElement;
  private readonly errorHeading: HTMLElement;
  private readonly errorText: HTMLElement;
  private readonly errorHelp: HTMLElement;
  private readonly retryButton: HTMLButtonElement;
  private readonly soundButton: HTMLButtonElement;
  private readonly fullscreenButton: HTMLButtonElement;
  private readonly selectLocalButton: HTMLButtonElement;
  private readonly selectOpponentButton: HTMLButtonElement;
  private readonly startSoloButton: HTMLButtonElement;
  private readonly resumeButton: HTMLButtonElement;
  private readonly pauseStatus: HTMLElement;
  private readonly scoreText: HTMLElement;
  private selectionTarget: 'local' | 'opponent' = 'local';

  constructor(options: MobileLobbyOptions) {
    this.element = document.createElement('section');
    this.element.className = 'opf-mobile-lobby';
    this.element.setAttribute('aria-label', '手机版主菜单');

    const frame = document.createElement('div');
    frame.className = 'opf-lobby-frame';
    const brand = document.createElement('header');
    brand.className = 'opf-lobby-brand';
    brand.append(this.text('span', 'ONE PIECE FIGHTER', 'opf-lobby-kicker'), this.text('h1', '四人联动 · 手机预览', 'opf-lobby-title'));
    frame.append(brand);

    const home = this.screen('home', '选择模式');
    const homeRoster = this.div('opf-lobby-home-roster');
    for (const card of mobileCharacterCards()) {
      const figure = this.div(`opf-lobby-home-fighter${card.id === 'labubu' || card.id === 'twinkle' ? ' is-crossover' : ''}`);
      figure.style.setProperty('--card-accent', card.color);
      const art = this.artTarget(card.id, 'opf-lobby-home-art', card.name);
      figure.append(art, this.text('strong', card.name, 'opf-lobby-home-name'));
      homeRoster.append(figure);
    }
    const modeGrid = this.div('opf-lobby-mode-grid');
    for (const mode of MOBILE_LOBBY_MODES) {
      const copy = MODE_COPY[mode];
      const button = this.button(copy.title, 'opf-lobby-mode', () => options.callbacks.onChooseMode(mode));
      button.append(this.text('small', copy.note, 'opf-lobby-note'));
      button.dataset.mode = mode;
      modeGrid.append(button);
    }
    home.append(homeRoster, modeGrid);

    const select = this.screen('select', '选择角色');
    select.append(this.text('p', '四名角色均保留四普攻与九项一键技能', 'opf-lobby-lead'));
    const selectionTabs = this.div('opf-lobby-selection-tabs');
    this.selectLocalButton = this.button('选择我方', 'opf-lobby-select-tab is-active', () => this.setSelectionTarget('local'));
    this.selectOpponentButton = this.button('选择对手', 'opf-lobby-select-tab', () => this.setSelectionTarget('opponent'));
    selectionTabs.append(this.selectLocalButton, this.selectOpponentButton);
    const roster = this.div('opf-lobby-roster');
    for (const card of mobileCharacterCards()) {
      const button = this.button('', 'opf-lobby-character', () => {
        if (this.selectionTarget === 'opponent') options.callbacks.onSelectOpponent(card.id);
        else options.callbacks.onSelectCharacter(card.id);
      });
      button.dataset.character = card.id;
      button.style.setProperty('--card-accent', card.color);
      const art = this.artTarget(card.id, 'opf-lobby-art', card.name);
      const badges = this.div('opf-lobby-selection-badges');
      const localBadge = this.text('span', '我方', 'opf-lobby-selection-badge opf-lobby-local-badge');
      const opponentBadge = this.text('span', '对手', 'opf-lobby-selection-badge opf-lobby-opponent-badge');
      this.localBadges.set(card.id, localBadge);
      this.opponentBadges.set(card.id, opponentBadge);
      badges.append(localBadge, opponentBadge);
      button.append(art, this.text('strong', card.name, 'opf-lobby-character-name'), this.text('span', card.tagline, 'opf-lobby-tagline'), badges);
      this.characterButtons.set(card.id, button);
      roster.append(button);
    }
    this.startSoloButton = this.button('开始', 'opf-lobby-primary opf-lobby-start-solo', options.callbacks.onStartSolo);
    const selectActions = this.div('opf-lobby-select-actions');
    selectActions.append(this.startSoloButton, this.button('返回', 'opf-lobby-secondary', options.callbacks.onBack));
    select.append(selectionTabs, roster, selectActions);

    const room = this.screen('room', '房间准备');
    this.playerStatus = this.text('p', '本机席位等待分配', 'opf-lobby-player');
    const codePanel = this.div('opf-lobby-code-panel');
    codePanel.append(this.text('span', '房间码', 'opf-lobby-label'));
    this.roomCode = this.text('output', '----------', 'opf-lobby-code');
    this.copyButton = this.button('复制房间码', 'opf-lobby-copy', () => {
      const code = this.state.roomCode;
      if (code) options.callbacks.onCopyRoomCode(code);
    });
    this.createRoomButton = this.button('创建房间', 'opf-lobby-primary', options.callbacks.onCreateRoom);
    codePanel.append(this.roomCode, this.createRoomButton, this.copyButton);
    const joinPanel = this.div('opf-lobby-join');
    this.joinInput = document.createElement('input');
    this.joinInput.className = 'opf-lobby-code-input';
    this.joinInput.type = 'text';
    this.joinInput.inputMode = 'text';
    this.joinInput.autocomplete = 'off';
    this.joinInput.maxLength = 10;
    this.joinInput.placeholder = '输入 10 位房间码';
    this.joinInput.setAttribute('aria-label', '10位房间码');
    this.joinInput.addEventListener('input', () => {
      const normalized = normalizeRoomCode(this.joinInput.value);
      if (this.joinInput.value !== normalized) this.joinInput.value = normalized;
      this.joinButton.disabled = !ROOM_CODE_PATTERN.test(normalized) || !!this.state.busy;
    });
    this.joinButton = this.button('连接房间', 'opf-lobby-primary', () => {
      const code = normalizeRoomCode(this.joinInput.value);
      if (ROOM_CODE_PATTERN.test(code)) options.callbacks.onJoinRoom(code);
    });
    this.joinButton.disabled = true;
    joinPanel.append(this.joinInput, this.joinButton);
    this.connectionStatus = this.text('p', '等待连接', 'opf-lobby-status');
    this.readyButton = this.button('准备', 'opf-lobby-primary', () => options.callbacks.onReady(!this.state.ready));
    room.append(this.playerStatus, codePanel, joinPanel, this.connectionStatus, this.readyButton,
      this.button('退出房间', 'opf-lobby-danger', options.callbacks.onExit),
      this.button('返回', 'opf-lobby-secondary', options.callbacks.onBack));
    codePanel.dataset.roomCodePanel = 'true';
    joinPanel.dataset.joinPanel = 'true';

    const pause = this.screen('pause', '比赛暂停');
    this.soundButton = this.button('声音：开', 'opf-lobby-secondary', options.callbacks.onSoundToggle);
    this.fullscreenButton = this.button('进入全屏', 'opf-lobby-secondary', options.callbacks.onFullscreenToggle);
    this.resumeButton = this.button('继续比赛', 'opf-lobby-primary', options.callbacks.onResume);
    this.pauseStatus = this.text('p', '比赛已暂停', 'opf-lobby-status');
    pause.append(this.pauseStatus, this.resumeButton, this.soundButton, this.fullscreenButton,
      this.button('退出比赛', 'opf-lobby-danger', options.callbacks.onExit));

    const result = this.screen('result', '比赛结果');
    this.resultTitle = this.text('p', '比赛结束', 'opf-lobby-result-title');
    this.scoreText = this.text('p', '', 'opf-lobby-score');
    result.append(this.resultTitle, this.scoreText, this.button('再来一局', 'opf-lobby-primary', options.callbacks.onRematch),
      this.button('换角色', 'opf-lobby-secondary', options.callbacks.onReselect),
      this.button('回主菜单', 'opf-lobby-danger', options.callbacks.onExit));

    const error = this.screen('error', '连接中断');
    this.errorHeading = error.querySelector<HTMLElement>('.opf-lobby-heading')!;
    this.errorText = this.text('p', '连接未完成', 'opf-lobby-error-text');
    this.errorHelp = this.text('p', '请确认两台手机连接同一 Wi-Fi 或热点，然后重试。', 'opf-lobby-help');
    this.retryButton = this.button('重试连接', 'opf-lobby-primary', options.callbacks.onRetry);
    error.append(this.errorText, this.errorHelp, this.retryButton,
      this.button('返回', 'opf-lobby-secondary', options.callbacks.onBack));

    const hidden = this.screen('hidden', '');
    hidden.hidden = true;
    frame.append(home, select, room, pause, result, error, hidden);
    this.element.append(frame, this.orientationHint());
    options.parent.append(this.element);
    this.update({ screen: 'home', soundEnabled: true, fullscreen: false });
  }

  update(state: MobileLobbyState): void {
    this.state = { ...state };
    this.element.dataset.screen = state.screen;
    this.element.hidden = state.screen === 'hidden';
    for (const [name, screen] of this.screens) screen.hidden = name !== state.screen;
    for (const [id, button] of this.characterButtons) {
      const local = id === state.selectedCharacter;
      const opponent = id === state.opponentCharacter;
      button.classList.toggle('is-selected', this.selectionTarget === 'local' ? local : opponent);
      button.classList.toggle('is-local', local);
      button.classList.toggle('is-opponent', opponent);
      button.setAttribute('aria-pressed', String(local || opponent));
      this.localBadges.get(id)!.hidden = !local;
      this.opponentBadges.get(id)!.hidden = !opponent;
      button.disabled = !!state.busy;
    }

    const solo = state.mode === 'cpu' || state.mode === 'training';
    this.selectOpponentButton.hidden = !solo;
    if (!solo && this.selectionTarget === 'opponent') this.setSelectionTarget('local');
    this.startSoloButton.hidden = !solo;
    this.startSoloButton.disabled = !!state.busy || !state.selectedCharacter || !state.opponentCharacter || state.canStart === false;

    const isJoin = state.mode === 'join';
    const codePanel = this.element.querySelector<HTMLElement>('[data-room-code-panel]');
    const joinPanel = this.element.querySelector<HTMLElement>('[data-join-panel]');
    if (codePanel) codePanel.hidden = isJoin;
    if (joinPanel) joinPanel.hidden = !isJoin;
    this.roomCode.textContent = state.roomCode ?? '----------';
    this.copyButton.disabled = !state.roomCode || !!state.busy;
    this.createRoomButton.hidden = !!state.roomCode;
    this.createRoomButton.disabled = !!state.busy;
    this.joinInput.disabled = !!state.busy;
    this.joinButton.disabled = !!state.busy || !ROOM_CODE_PATTERN.test(normalizeRoomCode(this.joinInput.value));
    this.readyButton.textContent = state.ready ? '取消准备' : '准备';
    this.readyButton.disabled = !!state.busy || !state.connected;
    this.readyButton.classList.toggle('is-ready', !!state.ready);
    this.connectionStatus.textContent = state.status ?? this.connectionSummary(state);
    this.playerStatus.textContent = state.localPlayer === undefined
      ? '本机席位等待分配'
      : `本机 P${state.localPlayer + 1}${state.remoteReady ? ' · 对方已准备' : ''}`;
    this.resumeButton.disabled = state.canResume === false || !!state.busy;
    this.pauseStatus.textContent = state.status ?? (state.canResume === false ? '等待对方继续…' : '比赛已暂停');
    this.resultTitle.textContent = state.winnerName
      ? `${state.winnerName} 获胜`
      : state.localWon === undefined ? '比赛结束' : state.localWon ? '本机获胜' : '对手获胜';
    this.scoreText.textContent = state.wins ? `${state.wins[0]} － ${state.wins[1]}` : '';
    this.scoreText.hidden = !state.wins;
    this.errorText.textContent = state.error ?? '连接未完成';
    const errorCopy = lobbyErrorCopy(state.mode);
    this.errorHeading.textContent = errorCopy.title;
    this.errorHelp.textContent = errorCopy.help;
    this.retryButton.textContent = errorCopy.retry;
    this.soundButton.textContent = `声音：${state.soundEnabled === false ? '关' : '开'}`;
    this.fullscreenButton.textContent = state.fullscreen ? '退出全屏' : '进入全屏';
    this.element.classList.toggle('is-busy', !!state.busy);
    this.element.classList.toggle('is-ready', !!state.ready && !!state.remoteReady && !!state.canStart);
  }

  setArtwork(characterId: string, blobUrl: string): void {
    const targets = this.artwork.get(characterId);
    const record = this.artworkRecord(characterId);
    if (!targets || !record) return;
    const body = record.frames.body;
    for (const target of targets) {
      const image = document.createElement('img');
      image.alt = '';
      image.draggable = false;
      image.src = blobUrl;
      image.style.width = `${record.width / body.w * 100}%`;
      image.style.height = `${record.height / body.h * 100}%`;
      image.style.left = `${-body.x / body.w * 100}%`;
      image.style.top = `${-body.y / body.h * 100}%`;
      target.style.aspectRatio = `${body.w} / ${body.h}`;
      image.addEventListener('load', () => target.classList.add('has-art'), { once: true });
      image.addEventListener('error', () => target.classList.remove('has-art'), { once: true });
      target.querySelector('img')?.remove();
      target.append(image);
    }
  }

  destroy(): void {
    this.element.remove();
    this.screens.clear();
    this.characterButtons.clear();
    this.artwork.clear();
    this.localBadges.clear();
    this.opponentBadges.clear();
  }

  private setSelectionTarget(target: 'local' | 'opponent'): void {
    this.selectionTarget = target;
    this.selectLocalButton.classList.toggle('is-active', target === 'local');
    this.selectOpponentButton.classList.toggle('is-active', target === 'opponent');
    for (const [id, button] of this.characterButtons) {
      const selected = target === 'local' ? id === this.state.selectedCharacter : id === this.state.opponentCharacter;
      button.classList.toggle('is-selected', selected);
    }
  }

  private screen(name: MobileLobbyScreen, title: string): HTMLElement {
    const screen = this.div(`opf-lobby-screen opf-lobby-${name}`);
    screen.dataset.lobbyScreen = name;
    if (title) screen.append(this.text('h2', title, 'opf-lobby-heading'));
    this.screens.set(name, screen);
    return screen;
  }

  private connectionSummary(state: MobileLobbyState): string {
    if (!state.connected) return state.busy ? '正在建立连接…' : '等待连接';
    if (!state.ready) return '已连接，等待你准备';
    if (!state.remoteReady) return '你已准备，等待对方';
    return state.canStart ? '双方已准备，即将开始' : '双方已准备，正在校验本场资源';
  }

  private artworkRecord(id: string): ArtworkRecord | null {
    return (uiArtManifest.characters as Record<string, ArtworkRecord>)[id] ?? null;
  }

  private artTarget(characterId: string, className: string, characterName: string): HTMLElement {
    const art = this.div(className);
    art.setAttribute('aria-label', `${characterName}角色图`);
    art.append(this.text('span', '角色图载入中', 'opf-lobby-art-placeholder'));
    let targets = this.artwork.get(characterId);
    if (!targets) {
      targets = new Set();
      this.artwork.set(characterId, targets);
    }
    targets.add(art);
    return art;
  }

  private orientationHint(): HTMLElement {
    const hint = this.div('opf-orientation-hint');
    hint.append(this.text('strong', '请横屏游玩', ''), this.text('span', '旋转手机后，方向、普攻与九项技能会同时显示。', ''));
    return hint;
  }

  private button(label: string, className: string, callback: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.addEventListener('click', callback);
    return button;
  }

  private div(className: string): HTMLDivElement {
    const element = document.createElement('div');
    element.className = className;
    return element;
  }

  private text<K extends keyof HTMLElementTagNameMap>(tag: K, value: string, className: string): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = value;
    return element;
  }
}
