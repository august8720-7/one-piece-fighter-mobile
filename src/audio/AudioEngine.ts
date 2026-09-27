import sampleManifest from './sampleManifest.json';
import { createCueCatalog, eventCues } from './audioCues';
import { synthesize } from './synthesize';
import { MusicPlayer, type MusicCatalog } from './MusicPlayer';
import { voiceLine } from './voiceLines';
import type { PresentationAudioEvent, VoicePlayback } from './audioTypes';
import { deliveryRecord, type AssetDownloads } from '../render/assetDownloads';
import type { AudioCue, AudioFailureKind, AudioGroup, AudioHudState, AudioPreloadReport, AudioSettings, AudioTraceEntry, CueCatalog, FightAudioEvent, SfxKind } from './audioTypes';

const STORAGE_KEY = 'opf.audio.v1';
const GROUPS: readonly AudioGroup[] = ['sfx', 'voice', 'ambient', 'music'];
const GROUP_LIMITS: Record<AudioGroup, number> = { sfx: 10, voice: 2, ambient: 2, music: 2 };
const DEFAULT_LEVELS: Record<AudioGroup, number> = { sfx: 0.8, voice: 0.9, ambient: 0.3, music: 0.5 };
const TRACE_LIMIT = 64;
type AudioStorage = Pick<Storage, 'getItem' | 'setItem'>;

interface CachedSample {
  bytes: ArrayBuffer | null;
  buffer: AudioBuffer | null;
  loading: Promise<void> | null;
  decoding: Promise<void> | null;
  error: string | null;
  errorKind: AudioFailureKind | null;
  abort: AbortController | null;
}

interface PlayingSound {
  id: number;
  cueId: string;
  group: AudioGroup;
  player: 0 | 1 | undefined;
  source: AudioBufferSourceNode;
  gain: GainNode;
  priority: number;
  loop: boolean;
  mode: 'sample' | 'synth';
  preview: boolean;
}

export interface AudioEngineOptions {
  contextFactory?: () => AudioContext;
  fetch?: typeof fetch;
  storage?: AudioStorage | null;
  now?: () => number;
  catalog?: CueCatalog;
  musicCatalog?: MusicCatalog;
  mediaFactory?: () => HTMLAudioElement;
}

const volumeValue = (value: number, fallback: number): number => Number.isFinite(value) ? Math.max(0, Math.min(1, Math.round(value * 10) / 10)) : fallback;

/** One tracked WebAudio playback path for samples and fallback effects. */
export class AudioEngine {
  private readonly music: MusicPlayer;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private groups: Record<AudioGroup, GainNode> | null = null;
  private readonly catalog: CueCatalog;
  private readonly factory: () => AudioContext;
  private readonly fetcher: typeof fetch | null;
  private readonly storage: AudioStorage | null;
  private readonly now: () => number;
  private readonly samples = new Map<string, CachedSample>();
  private downloads: AssetDownloads | null = null;
  private readonly fallbackBuffers = new Map<SfxKind, AudioBuffer>();
  private readonly playing = new Map<number, PlayingSound>();
  private readonly loops = new Set<string>();
  private readonly lastPlayed = new Map<string, number>();
  private readonly variants = new Map<string, number>();
  private readonly eventKeys = new Set<string>();
  private readonly presentationKeys = new Set<string>();
  private readonly voiceListeners = new Set<(voice: VoicePlayback | null) => void>();
  private captionSoundId: number | null = null;
  private nextId = 0;
  private paused = false;
  private destroyed = false;
  private activating: Promise<void> | null = null;
  private retryResume: (() => void) | null = null;
  private activationError: { kind: 'unavailable' | 'resume_failed'; message: string } | null = null;
  private playbackError: string | null = null;
  private playbackErrorGroup: AudioGroup | null = null;
  private previewVersion = 0;
  private diagnosticsEnabled = false;
  private readonly traceEntries: AudioTraceEntry[] = [];
  private meters: { before: AnalyserNode; after: AnalyserNode; data: Float32Array<ArrayBuffer> } | null = null;
  private meterError: string | null = null;
  private readonly levels: Record<AudioGroup, number> = { ...DEFAULT_LEVELS };
  private sampledPlays = 0;
  private fallbackPlays = 0;
  muted = false;
  volume = 0.6;

  constructor(options: AudioEngineOptions = {}) {
    this.music = new MusicPlayer(options.musicCatalog, options.mediaFactory);
    this.catalog = createCueCatalog(options.catalog ?? sampleManifest.cues as unknown as CueCatalog);
    this.factory = options.contextFactory ?? (() => new AudioContext());
    this.fetcher = options.fetch ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    this.now = options.now ?? (() => performance.now());
    let storage: AudioStorage | null = options.storage ?? null;
    if (options.storage === undefined) {
      try { storage = globalThis.localStorage ?? null; } catch { /* Storage may be disabled. */ }
    }
    this.storage = storage;
    try {
      const raw = storage?.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw) as { muted?: boolean; volume?: number; groups?: Partial<Record<AudioGroup, number>> };
        if (typeof data.muted === 'boolean') this.muted = data.muted;
        if (typeof data.volume === 'number') this.volume = volumeValue(data.volume, this.volume);
        for (const group of GROUPS) {
          const value = data.groups?.[group];
          if (typeof value === 'number') this.levels[group] = volumeValue(value, this.levels[group]);
        }
      }
    } catch { /* Keep defaults if saved settings are invalid. */ }
  }

  hudState(group: AudioGroup = 'sfx'): AudioHudState {
    if (this.destroyed) return 'destroyed';
    if (this.muted) return 'muted';
    if (this.volume === 0) return 'master_zero';
    if (this.levels[group] === 0) return 'group_zero';
    if (this.paused) return 'paused';
    if (this.activationError) return this.activationError.kind;
    if (this.context?.state !== 'running') return 'locked';
    if (group === 'music') return this.music.state();
    if (this.playbackError && this.playbackErrorGroup === group) return 'start_failed';
    const entries = this.groupSamples(group);
    if (entries.some(sample => sample.loading || sample.decoding)) return 'loading';
    if (entries.some(sample => sample.errorKind === 'download')) return 'download_failed';
    if (entries.some(sample => sample.errorKind === 'decode')) return 'decode_failed';
    return 'ready';
  }

  private groupSamples(group: AudioGroup): CachedSample[] {
    const urls = new Set(Object.values(this.catalog).filter(cue => cue.group === group).flatMap(cue => [...cue.files]));
    return [...urls].flatMap(url => { const sample = this.samples.get(url); return sample ? [sample] : []; });
  }

  /** Call from a real key/pointer gesture. Preload never creates a context. */
  unlock(): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    if (this.activating) {
      // A resume requested without browser activation may never settle. A later
      // real gesture must reach resume synchronously, while sharing the same
      // context/mixer initialization and subsequent sample decoding.
      this.retryResume?.();
      return this.activating;
    }
    this.activating = this.activate().finally(() => { this.activating = null; });
    return this.activating;
  }

  private async activate(): Promise<void> {
    let stage: 'unavailable' | 'resume_failed' = 'unavailable';
    try {
      if (!this.context || this.context.state === 'closed' || !this.master || !this.groups) {
        this.detachMeters();
        this.master?.disconnect();
        if (this.groups) for (const group of GROUPS) this.groups[group].disconnect();
        if (!this.context || this.context.state === 'closed') this.context = this.factory();
        this.master = this.context.createGain();
        this.master.connect(this.context.destination);
        const channel = (): GainNode => {
          const gain = this.context!.createGain();
          gain.connect(this.master!);
          return gain;
        };
        this.groups = { sfx: channel(), voice: channel(), ambient: channel(), music: channel() };
        this.music.attach(this.context, this.groups.music);
        this.applyGains();
        if (this.diagnosticsEnabled) this.attachMeters();
      }
      stage = 'resume_failed';
      if (this.context.state !== 'running') await this.waitForResume(this.context);
      if (this.destroyed) return;
      if (this.context.state !== 'running') throw new Error(`AudioContext is ${this.context.state}`);
      this.activationError = null;
      this.syncMusic();
      this.trace('control', 'unlocked');
      await Promise.all([...this.samples.values()].map((entry) => this.decode(entry)));
      this.restoreLoops();
    } catch (error) {
      if (this.destroyed) return;
      this.activationError = { kind: stage, message: error instanceof Error ? error.message : 'audio activation failed' };
      this.trace('failure', `${stage}: ${this.activationError.message}`);
    }
  }

  private waitForResume(context: AudioContext): Promise<void> {
    return new Promise((resolve, reject) => {
      let attempt = 0;
      const retry = (): void => {
        const current = ++attempt;
        const finish = (error?: unknown): void => {
          if (this.retryResume !== retry) return;
          if (this.destroyed || context.state === 'running') {
            this.retryResume = null;
            resolve();
          } else if (current === attempt) {
            this.retryResume = null;
            reject(error ?? new Error(`AudioContext is ${context.state}`));
          }
          // A superseded request cannot overwrite the newer gesture's result.
        };
        if (this.destroyed || context.state === 'running') { finish(); return; }
        try { void context.resume().then(() => finish(), finish); }
        catch (error) { finish(error); }
      };
      this.retryResume = retry;
      retry();
    });
  }

  /** Explicit UI action; zero volumes remain unchanged so saved preferences are respected. */
  async enableSound(): Promise<void> {
    if (this.muted) this.toggleMute();
    await this.unlock();
  }

  /** Same source -> cue gain -> group -> master route as combat, never a separate loud test tone. */
  async preview(cueId = 'hit_heavy'): Promise<boolean> {
    this.cancelPreview();
    const version = this.previewVersion;
    const cue = this.catalog[cueId];
    if (!cue || cue.loop || this.destroyed) return this.drop(cueId, 'preview_unavailable');
    await this.unlock();
    if (version !== this.previewVersion) return this.drop(cueId, 'preview_cancelled');
    await Promise.all(cue.files.map(url => this.load(url)));
    if (version !== this.previewVersion) return this.drop(cueId, 'preview_cancelled');
    return this.playCueInternal(cueId, { ui: true }, true);
  }

  /** A closing audio UI owns its audition, not the next scene's combat, menu sounds or ambience. */
  cancelPreview(): void {
    this.previewVersion++;
    this.music.cancelPreview();
    for (const sound of [...this.playing.values()]) if (sound.preview) this.stop(sound);
  }

  useDownloads(downloads: AssetDownloads): void { this.downloads = downloads; }

  async preloadMenu(): Promise<AudioPreloadReport> {
    // First selection happens before the fight preload gate. Fetch its tiny
    // replies now; the title's real gesture will decode these cached bytes.
    const ids = ['menu_move', 'menu_confirm', ...Object.keys(this.catalog).filter(id => id.startsWith('voice.') && id.endsWith('.select'))];
    const urls = [...new Set(ids.flatMap(id => [...(this.catalog[id]?.files ?? [])]))];
    await this.loadMany(urls, false);
    return this.preloadReport(urls);
  }

  async preload(characterIds?: readonly string[], onProgress?: (completed: number, total: number) => void): Promise<AudioPreloadReport> {
    if (this.destroyed) return { fetched: 0, decoded: 0, failed: [] };
    const selected = characterIds ? new Set(characterIds) : null;
    const urls = new Set<string>();
    for (const [id, cue] of Object.entries(this.catalog)) {
      const character = cue.characterId ?? (id.startsWith('voice.') ? id.split('.')[1] : undefined);
      if (selected && character && !selected.has(character)) continue;
      for (const file of cue.files) urls.add(file);
    }
    await this.loadMany([...urls], false, onProgress);
    return this.preloadReport([...urls]);
  }

  private preloadReport(urls: readonly string[]): AudioPreloadReport {
    return {
      fetched: [...urls].filter((url) => this.samples.get(url)?.bytes).length,
      decoded: [...urls].filter((url) => this.samples.get(url)?.buffer).length,
      failed: [...urls].filter((url) => this.samples.get(url)?.error),
    };
  }

  /** Explicit retry fetches failed resources again, including corrupt HTTP-200 audio bytes. */
  async retryFailed(): Promise<AudioPreloadReport> {
    this.music.retry();
    const urls = [...this.samples].filter(([, sample]) => sample.error).map(([url]) => url);
    if (this.downloads) await Promise.all(urls.map(url => this.downloads!.invalidate(url)));
    await this.loadMany(urls, true);
    return this.preloadReport(urls);
  }

  private async loadMany(urls: readonly string[], retry: boolean, onProgress?: (completed: number, total: number) => void): Promise<void> {
    let next = 0;
    let completed = 0;
    await Promise.all(Array.from({ length: Math.min(4, urls.length) }, async () => {
      while (next < urls.length && !this.destroyed) {
        const url = urls[next++]!;
        await this.load(url, retry);
        onProgress?.(++completed, urls.length);
      }
    }));
  }

  private load(url: string, retry = false): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    let entry = this.samples.get(url);
    if (!entry) {
      entry = { bytes: null, buffer: null, loading: null, decoding: null, error: null, errorKind: null, abort: null };
      this.samples.set(url, entry);
    }
    if (entry.loading) return entry.loading;
    if (entry.decoding) return entry.decoding;
    if (retry) {
      // Re-decoding the same corrupt response cannot recover when the file is repaired.
      // Keep all successful buffers; invalidate only this failed sample's bytes.
      if (entry.errorKind === 'decode') entry.bytes = null;
      entry.error = null;
      entry.errorKind = null;
      this.trace('control', `retry: ${url}`);
    }
    if (entry.error) return Promise.resolve();
    if (entry.bytes) return this.decode(entry);
    const sample = entry;
    sample.loading = (async () => {
      const abort = new AbortController();
      sample.abort = abort;
      const managed = this.downloads && deliveryRecord(url);
      // The shared pool owns queued-file deadlines and retries. An audio timer
      // must not expire before that file even gets a download slot.
      const timeout = managed ? undefined : setTimeout(() => abort.abort(), 30_000);
      try {
        let bytes: ArrayBuffer;
        if (managed) bytes = await this.downloads!.read(url, response => response.arrayBuffer());
        else {
          if (!this.fetcher) throw new Error('fetch unavailable');
          const response = await this.fetcher(url, { signal: abort.signal, cache: retry ? 'reload' : 'default' });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          bytes = await response.arrayBuffer();
        }
        if (!bytes.byteLength) throw new Error('empty audio response');
        if (this.destroyed) return;
        sample.bytes = bytes;
        await this.decode(sample);
      } catch (error) {
        if (this.destroyed) return;
        sample.error = error instanceof Error ? error.message : 'sample unavailable';
        sample.errorKind = 'download';
        this.trace('failure', `download: ${url}: ${sample.error}`);
      } finally {
        clearTimeout(timeout);
        sample.abort = null;
      }
      this.restoreLoops();
    })().finally(() => { sample.loading = null; });
    return sample.loading;
  }

  private decode(entry: CachedSample): Promise<void> {
    if (entry.decoding) return entry.decoding;
    if (this.destroyed || !this.context || !entry.bytes || entry.buffer || entry.error) return Promise.resolve();
    const context = this.context;
    entry.decoding = Promise.resolve().then(() => this.destroyed ? null : context.decodeAudioData(entry.bytes!.slice(0))).then((buffer) => {
      if (!this.destroyed && buffer) entry.buffer = buffer;
    }).catch((error: unknown) => {
      if (this.destroyed) return;
      entry.error = error instanceof Error ? error.message : 'decode failed';
      entry.errorKind = 'decode';
      this.trace('failure', `decode: ${entry.error}`);
    }).finally(() => { entry.decoding = null; });
    return entry.decoding;
  }

  play(kind: SfxKind): void {
    if (kind === 'round_start') this.eventKeys.clear();
    this.playCue(kind);
  }

  playEvent(event: FightAudioEvent): void {
    if (this.destroyed) return;
    if (event.phase === 'start' || event.phase === 'ko') this.interruptDailyVoice();
    if (event.phase === 'hit' || event.phase === 'block' || event.phase === 'throw') {
      this.interruptDailyVoice();
    }
    this.trace('event', `${event.phase}:${event.player}:${event.characterId}:${event.moveId ?? ''}:${event.moveInstance ?? ''}`);
    if (event.phase === 'round_start') this.eventKeys.clear();
    if (event.phase === 'win') {
      const key = `win:${event.player}`;
      if (this.eventKeys.has(key)) return;
      this.eventKeys.add(key);
    }
    if ((event.phase === 'start' || event.phase === 'swing' || event.phase === 'recover') && event.moveInstance !== undefined) {
      const key = `${event.phase}:${event.player}:${event.characterId}:${event.moveInstance}:${event.phase === 'swing' ? event.segmentId ?? 0 : 0}`;
      if (this.eventKeys.has(key)) { this.trace('drop', `duplicate_event:${key}`); return; }
      this.eventKeys.add(key);
      if (this.eventKeys.size > 256) this.eventKeys.delete(this.eventKeys.values().next().value!);
    }
    // A known-bad exact voice file must not hide an available same-character generic shout.
    const hasVoice = (id: string) => !!this.catalog[id]?.files.some((file) => !this.samples.get(file)?.error);
    for (const cue of eventCues(event, hasVoice)) this.playCue(cue.id, cue.player === undefined ? {} : { player: cue.player });
  }

  /** Returns false when dropped/unavailable; old combat events are never queued. */
  playCue(cueId: string, options: { player?: 0 | 1; ui?: boolean } = {}): boolean {
    return this.playCueInternal(cueId, options, false);
  }

  onVoice(listener: (voice: VoicePlayback | null) => void): () => void {
    this.voiceListeners.add(listener);
    return () => { this.voiceListeners.delete(listener); };
  }

  /** Daily requests are dropped while another line is sounding; nothing is queued. */
  voiceBusy(): boolean {
    return this.hudState('voice') !== 'ready' || [...this.playing.values()].some(sound => sound.group === 'voice');
  }

  playPresentation(event: PresentationAudioEvent): boolean {
    const key = `${event.phase}:${event.key}:${event.player ?? 'global'}`;
    if (this.presentationKeys.has(key)) return false;
    this.presentationKeys.add(key);
    if (this.presentationKeys.size > 128) this.presentationKeys.delete(this.presentationKeys.values().next().value!);
    const roundCue = event.finalRound === true ? 'announcer.round3'
      : (event.round ?? 1) > 2 ? 'announcer.nextRound' : `announcer.round${event.round === 2 ? 2 : 1}`;
    const cue = event.phase === 'select' || event.phase === 'win'
      ? `voice.${event.characterId}.${event.phase}`
      : event.phase === 'round' ? roundCue : `announcer.${event.phase}`;
    return this.playCue(cue, { ...(event.player === undefined ? {} : { player: event.player }), ui: event.phase === 'select' });
  }

  private playCueInternal(cueId: string, options: { player?: 0 | 1; ui?: boolean }, preview: boolean): boolean {
    if (this.destroyed) return this.drop(cueId, 'destroyed');
    const cue = this.catalog[cueId];
    if (!cue) return this.drop(cueId, 'unknown_cue');
    if (cue.loop) this.loops.add(cueId);
    const ui = options.ui ?? cueId.startsWith('menu_');
    if (this.muted) return this.drop(cueId, 'muted');
    if (this.volume === 0) return this.drop(cueId, 'master_zero');
    if (this.levels[cue.group] === 0) return this.drop(cueId, 'group_zero');
    if (this.paused && !ui) return this.drop(cueId, 'paused');
    if (!this.context || this.context.state !== 'running' || !this.groups) return this.drop(cueId, this.activationError?.kind ?? 'locked');
    if (cue.loop && [...this.playing.values()].some((sound) => sound.cueId === cueId)) return this.drop(cueId, 'loop_already_playing');
    const key = `${cueId}:${options.player ?? 'global'}`;
    const last = this.lastPlayed.get(key);
    if (!cue.loop && last !== undefined && this.now() - last < (cue.cooldownMs ?? 0)) return this.drop(cueId, 'cooldown');
    const files = cue.files.filter((url) => !!this.samples.get(url)?.buffer);
    for (const file of cue.files) if (!this.samples.has(file)) void this.load(file);
    let buffer: AudioBuffer | undefined;
    let selectedFile: string | undefined;
    let mode: 'sample' | 'synth' = 'sample';
    if (files.length) {
      const index = this.variants.get(key) ?? 0;
      selectedFile = files[index % files.length]!;
      buffer = this.samples.get(selectedFile)!.buffer!;
      this.variants.set(key, index + 1);
    } else if (cue.fallback && cue.group === 'sfx') {
      mode = 'synth';
      buffer = this.fallbackBuffers.get(cue.fallback);
      if (!buffer) {
        try {
          buffer = synthesize(this.context, cue.fallback);
          this.fallbackBuffers.set(cue.fallback, buffer);
        } catch (error) { return this.playbackFailed(cueId, error); }
      }
    }
    if (!buffer) return this.drop(cueId, 'sample_unavailable');
    if (!this.makeRoom(cueId, cue, options.player)) return this.drop(cueId, 'priority_limit');
    let sound: PlayingSound | null = null;
    let source: AudioBufferSourceNode | null = null;
    let gain: GainNode | null = null;
    try {
      source = this.context.createBufferSource();
      gain = this.context.createGain();
      gain.gain.value = Math.max(0, Math.min(1.5, cue.gain ?? 0.7));
      source.buffer = buffer;
      source.loop = !!cue.loop;
      source.connect(gain).connect(this.groups[cue.group]);
      const id = ++this.nextId;
      sound = { id, cueId, group: cue.group, player: options.player, source, gain, priority: cue.priority ?? 40, loop: !!cue.loop, mode, preview };
      this.playing.set(id, sound);
      const playingSound = sound;
      source.onended = () => this.release(playingSound);
      source.start();
    } catch (error) {
      if (sound) this.stop(sound);
      else { source?.disconnect(); gain?.disconnect(); }
      return this.playbackFailed(cueId, error);
    }
    if (this.playbackErrorGroup === cue.group) { this.playbackError = null; this.playbackErrorGroup = null; }
    this.lastPlayed.set(key, this.now());
    if (mode === 'sample') this.sampledPlays++; else this.fallbackPlays++;
    this.trace('play', mode, cueId);
    this.updateMusicDuck();
    if (cue.group === 'voice' && selectedFile && sound) {
      this.captionSoundId = sound.id;
      const line: VoicePlayback = { cueId, file: selectedFile, ...(options.player === undefined ? {} : { player: options.player }), ...voiceLine(selectedFile), durationMs: buffer.duration * 1000 };
      this.notifyVoice(line);
    }
    return true;
  }

  private notifyVoice(line: VoicePlayback | null): void {
    for (const listener of this.voiceListeners) {
      try { listener(line); } catch { /* A presentation listener cannot interrupt the mixer. */ }
    }
  }

  private playbackFailed(cueId: string, error: unknown): false {
    this.playbackError = error instanceof Error ? error.message : 'playback failed';
    this.playbackErrorGroup = this.catalog[cueId]?.group ?? 'sfx';
    this.trace('failure', `start: ${this.playbackError}`, cueId);
    return false;
  }

  private drop(cueId: string, reason: string): false {
    this.trace('drop', reason, cueId);
    return false;
  }

  private makeRoom(cueId: string, cue: AudioCue, player: 0 | 1 | undefined): boolean {
    const priority = cue.priority ?? 40;
    const current = [...this.playing.values()];
    if (cue.group === 'voice') {
      // Ambient chatter never overlaps either fighter's more useful speech.
      if (priority <= 10 && current.some(sound => sound.group === 'voice')) return false;
      if (priority > 10) for (const sound of current) {
        if (sound.group === 'voice' && sound.priority <= 10) this.stop(sound);
      }
      const speaker = current.filter((sound) => sound.group === 'voice' && sound.player === player);
      if (speaker.some((sound) => sound.priority > priority)) return false;
      for (const sound of speaker) this.stop(sound);
    }
    const matching = [...this.playing.values()].filter((sound) => sound.cueId === cueId && (cue.group !== 'voice' || sound.player === player));
    if (matching.length >= (cue.maxInstances ?? 3)) this.stop(matching[0]!);
    const group = [...this.playing.values()].filter((sound) => sound.group === cue.group);
    if (group.length < GROUP_LIMITS[cue.group]) return true;
    const quietest = group.reduce((chosen, sound) => sound.priority < chosen.priority ? sound : chosen);
    if (quietest.priority > priority) return false;
    this.stop(quietest);
    return true;
  }

  private stop(sound: PlayingSound): void {
    sound.source.onended = null;
    try { sound.source.stop(); } catch { /* Already ended. */ }
    this.release(sound);
  }

  private release(sound: PlayingSound): void {
    if (this.captionSoundId === sound.id) { this.captionSoundId = null; this.notifyVoice(null); }
    this.playing.delete(sound.id);
    sound.source.onended = null;
    sound.source.disconnect();
    sound.gain.disconnect();
    this.updateMusicDuck();
  }

  stopAll(): void {
    this.music.stop();
    this.clearFightSounds();
  }

  /** Round cleanup leaves the current music and its playback position intact. */
  clearFightSounds(): void {
    this.previewVersion++;
    for (const sound of [...this.playing.values()]) this.stop(sound);
    this.loops.clear();
    this.lastPlayed.clear();
    this.eventKeys.clear();
    this.presentationKeys.clear();
    this.variants.clear();
    this.paused = false;
    this.trace('control', 'stop_all');
    this.syncMusic();
  }

  /** Permanent game teardown. Scene exits use stopAll() so decoded samples remain reusable. */
  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.retryResume?.();
    this.stopAll();
    this.music.destroy();
    for (const sample of this.samples.values()) sample.abort?.abort();
    this.samples.clear();
    this.fallbackBuffers.clear();
    this.detachMeters();
    if (this.groups) for (const group of GROUPS) this.groups[group].disconnect();
    this.master?.disconnect();
    const context = this.context;
    this.context = null;
    this.master = null;
    this.groups = null;
    try { if (context && context.state !== 'closed') await context.close(); } catch { /* Device may already have closed. */ }
  }

  pause(): void {
    if (this.paused) return;
    this.previewVersion++;
    this.music.cancelPreview();
    this.paused = true;
    for (const sound of [...this.playing.values()]) this.stop(sound);
    this.syncMusic();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.syncMusic();
    this.restoreLoops();
  }

  private restoreLoops(): void {
    if (this.paused || this.muted || this.context?.state !== 'running') return;
    for (const cueId of this.loops) this.playCue(cueId);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.muted) {
      this.previewVersion++;
      for (const sound of [...this.playing.values()]) this.stop(sound);
    }
    this.applyGains();
    if (!this.muted) this.restoreLoops();
    this.save();
    return this.muted;
  }

  setVolume(value: number): void {
    this.volume = volumeValue(value, this.volume);
    if (this.volume === 0) {
      this.previewVersion++;
      for (const sound of [...this.playing.values()]) this.stop(sound);
    }
    this.applyGains();
    this.restoreLoops();
    this.save();
  }

  groupVolume(group: AudioGroup): number { return this.levels[group]; }

  settings(): AudioSettings { return { muted: this.muted, volume: this.volume, groups: { ...this.levels } }; }

  /** User-invoked only; never called by loading, errors or scene transitions. */
  restoreDefaults(): void {
    this.muted = false;
    this.volume = 0.6;
    Object.assign(this.levels, DEFAULT_LEVELS);
    this.applyGains();
    this.restoreLoops();
    this.save();
    this.trace('control', 'restore_defaults');
  }

  setGroupVolume(group: AudioGroup, value: number): void {
    this.levels[group] = volumeValue(value, this.levels[group]);
    if (this.levels[group] === 0) {
      this.previewVersion++;
      for (const sound of [...this.playing.values()]) if (sound.group === group) this.stop(sound);
    }
    this.applyGains();
    this.restoreLoops();
    this.save();
  }

  private applyGains(): void {
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
    if (this.groups) for (const group of GROUPS) this.groups[group].gain.value = this.levels[group];
    this.syncMusic();
  }

  playMusic(id: string, level = 1): void { this.music.request(id, level); this.syncMusic(); }

  /** A match-loading screen releases long streams without cutting selection voices. */
  stopMusic(): void { this.music.stop(); }

  async previewMusic(): Promise<boolean> {
    this.cancelPreview();
    const version = this.previewVersion;
    await this.unlock();
    if (version !== this.previewVersion || this.destroyed) return false;
    this.music.preview();
    return !this.muted && this.volume > 0 && this.levels.music > 0 && this.context?.state === 'running';
  }

  interruptDailyVoice(player?: 0 | 1): void {
    for (const sound of [...this.playing.values()]) {
      if (sound.group === 'voice' && (player === undefined || sound.player === player) && sound.priority <= 10) this.stop(sound);
    }
  }

  private updateMusicDuck(): void { this.music.duck([...this.playing.values()].some(sound => sound.group === 'voice')); }
  private syncMusic(): void { this.music.control(!this.destroyed && !this.muted && this.volume > 0 && this.levels.music > 0, this.paused); }

  private save(): void {
    try { this.storage?.setItem(STORAGE_KEY, JSON.stringify({ muted: this.muted, volume: this.volume, groups: this.levels })); } catch { /* Storage may be disabled. */ }
  }

  setDiagnosticsEnabled(enabled: boolean): void {
    this.diagnosticsEnabled = enabled;
    if (enabled) this.attachMeters();
    else { this.detachMeters(); this.traceEntries.length = 0; }
  }

  private trace(kind: AudioTraceEntry['kind'], detail: string, cueId?: string): void {
    if (!this.diagnosticsEnabled) return;
    this.traceEntries.push({ at: this.now(), kind, detail, ...(cueId ? { cueId } : {}) });
    if (this.traceEntries.length > TRACE_LIMIT) this.traceEntries.shift();
  }

  /** Analyser taps have no destination connection and cannot create a second audible path. */
  private attachMeters(): void {
    if (this.meters || !this.context || !this.master || !this.groups || this.destroyed) return;
    let before: AnalyserNode | null = null;
    let after: AnalyserNode | null = null;
    try {
      before = this.context.createAnalyser();
      after = this.context.createAnalyser();
      before.fftSize = 1024;
      after.fftSize = 1024;
      for (const group of GROUPS) this.groups[group].connect(before);
      this.master.connect(after);
      this.meters = { before, after, data: new Float32Array(1024) };
      this.meterError = null;
    } catch (error) {
      if (before) {
        for (const group of GROUPS) { try { this.groups[group].disconnect(before); } catch { /* Tap may not be attached. */ } }
        before.disconnect();
      }
      if (after) { try { this.master.disconnect(after); } catch { /* Tap may not be attached. */ } after.disconnect(); }
      this.meterError = error instanceof Error ? error.message : 'meter unavailable';
    }
  }

  private detachMeters(): void {
    if (!this.meters) return;
    const { before, after } = this.meters;
    if (this.groups) for (const group of GROUPS) this.groups[group].disconnect(before);
    this.master?.disconnect(after);
    before.disconnect();
    after.disconnect();
    this.meters = null;
  }

  private outputLevels() {
    if (!this.meters) return null;
    const read = (analyser: AnalyserNode) => {
      const data = this.meters!.data;
      analyser.getFloatTimeDomainData(data);
      let square = 0;
      let peak = 0;
      for (const value of data) { square += value * value; peak = Math.max(peak, Math.abs(value)); }
      return { rms: Math.sqrt(square / data.length), peak };
    };
    return { beforeMaster: read(this.meters.before), afterMaster: read(this.meters.after) };
  }

  diagnostics() {
    const samples = [...this.samples.values()];
    return {
      state: this.hudState(), paused: this.paused, destroyed: this.destroyed, sampledPlays: this.sampledPlays, fallbackPlays: this.fallbackPlays,
      contextState: this.context?.state ?? 'not_created', settings: this.settings(),
      groupStates: Object.fromEntries(GROUPS.map(group => [group, this.hudState(group)])), music: this.music.diagnostics(),
      activationError: this.activationError, playbackError: this.playbackError,
      pending: samples.filter(sample => sample.loading || sample.decoding).length,
      downloading: samples.filter(sample => sample.loading && !sample.bytes).length,
      decoding: samples.filter(sample => sample.decoding).length,
      waitingForUnlock: samples.filter(sample => sample.bytes && !sample.buffer && !sample.decoding && !sample.error).length,
      samples: [...this.samples.entries()].map(([url, sample]) => ({ url, fetched: !!sample.bytes, decoded: !!sample.buffer, error: sample.error, errorKind: sample.errorKind })),
      playing: [...this.playing.values()].map(({ cueId, group, player, loop, mode }) => ({ cueId, group, player, loop, mode })),
      diagnosticsEnabled: this.diagnosticsEnabled, recent: this.traceEntries.map(entry => ({ ...entry })),
      output: this.outputLevels(), meterError: this.meterError,
    };
  }
}
