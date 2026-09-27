import manifest from './musicManifest.json';
import type { AudioHudState } from './audioTypes';
import { deliveryRecord } from '../render/assetDownloads';

export interface MusicTrack { file: string; loop: boolean; gain: number; title: string }
export type MusicCatalog = Record<string, MusicTrack>;
interface Stream {
  id: string; media: HTMLAudioElement; source: MediaElementAudioSourceNode; gain: GainNode;
  state: AudioHudState; error: string | null; pending: boolean; generation: number;
  timeout: ReturnType<typeof setTimeout> | null;
}

/** Long music stays in the browser media pipeline, connected to the game's existing mixer. */
export class MusicPlayer {
  private context: AudioContext | null = null;
  private bus: GainNode | null = null;
  private current: Stream | null = null;
  private tail: Stream | null = null;
  private fadeTimer: ReturnType<typeof setTimeout> | null = null;
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  private desired: string | null = null;
  private level = 1;
  private enabled = false;
  private paused = false;
  private ducked = false;
  private previewing = false;
  private destroyed = false;
  private failure: string | null = null;

  constructor(private readonly catalog: MusicCatalog = manifest.tracks,
    private readonly mediaFactory: () => HTMLAudioElement = () => new Audio()) {}

  attach(context: AudioContext, bus: GainNode): void {
    if (this.context !== context) this.clearStreams();
    this.context = context; this.bus = bus;
  }

  request(id: string, level = 1): void {
    if (!this.catalog[id] || this.destroyed) return;
    this.cancelPreview();
    this.desired = id; this.level = level;
    this.sync(); this.applyGain();
  }

  control(enabled: boolean, paused: boolean): void {
    this.enabled = enabled; this.paused = paused; this.sync();
  }

  duck(active: boolean): void {
    if (this.ducked === active) return;
    this.ducked = active; this.applyGain();
  }

  preview(): void {
    if (this.destroyed) return;
    this.previewing = true;
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => this.cancelPreview(), 8000);
    this.sync();
  }

  cancelPreview(): void {
    if (!this.previewing) return;
    this.previewing = false;
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer = null; this.sync();
  }

  retry(): void {
    if (!this.failure && !this.current?.error) { this.sync(); return; }
    this.failure = null; this.clearStreams(); this.sync();
  }

  stop(): void {
    this.desired = null; this.previewing = false;
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer = null; this.failure = null; this.clearStreams();
  }

  destroy(): void { this.stop(); this.destroyed = true; this.context = null; this.bus = null; }

  private sync(): void {
    if (this.destroyed || !this.context || !this.bus) return;
    const id = this.desired ?? (this.previewing ? 'menu' : null);
    const audible = this.enabled && (!this.paused || this.previewing) && this.context.state === 'running';
    if (!id) { this.clearStreams(); return; }
    if (!audible) {
      if (this.current) this.suspend(this.current);
      this.clearTail(); return;
    }
    if (this.failure) return;
    if (this.current?.id !== id) {
      this.clearTail();
      this.tail = this.current; this.current = null;
      try {
        const media = this.mediaFactory();
        media.preload = 'auto'; media.loop = this.catalog[id]!.loop;
        const source = this.context.createMediaElementSource(media);
        const gain = this.context.createGain();
        gain.gain.value = 0; source.connect(gain).connect(this.bus);
        const stream: Stream = { id, media, source, gain, state: 'loading', error: null, pending: false, generation: 0, timeout: null };
        this.current = stream;
        media.onplaying = () => { if (this.current === stream) { stream.state = 'ready'; this.clearTimeout(stream); } };
        media.onwaiting = () => {
          if (this.current === stream && !media.paused) { stream.state = 'loading'; this.armTimeout(stream); }
        };
        media.onended = () => { if (this.current === stream) stream.state = 'ready'; };
        media.onerror = () => {
          if (this.current !== stream) return;
          this.fail(stream, media.error?.code === 3 ? 'decode_failed' : 'download_failed', media.error?.message || `Media error ${media.error?.code ?? 0}`);
        };
        const file = this.catalog[id]!.file;
        media.src = deliveryRecord(file)?.file ?? file;
      } catch (error) {
        this.failure = String(error); this.clearStreams(); return;
      }
      if (this.tail) {
        this.tail.gain.gain.cancelScheduledValues(this.context.currentTime);
        this.tail.gain.gain.setTargetAtTime(0, this.context.currentTime, 0.12);
        this.fadeTimer = setTimeout(() => this.clearTail(), 500);
      }
      this.applyGain();
    }
    const stream = this.current;
    if (!stream || stream.error || stream.pending || !stream.media.paused || stream.media.ended) return;
    stream.pending = true;
    const generation = ++stream.generation;
    this.armTimeout(stream);
    try {
      void stream.media.play().then(() => {
        if (this.current !== stream || generation !== stream.generation) return;
        stream.pending = false; stream.state = 'ready'; this.clearTimeout(stream);
      }, (error: unknown) => {
        if (this.current !== stream || generation !== stream.generation) return;
        this.fail(stream, 'start_failed', String(error));
      });
    } catch (error) { this.fail(stream, 'start_failed', String(error)); }
  }

  private fail(stream: Stream, state: AudioHudState, error: string): void {
    stream.state = state; stream.error = error; this.suspend(stream);
  }
  private armTimeout(stream: Stream): void {
    if (stream.timeout) return;
    stream.timeout = setTimeout(() => {
      if (this.current === stream) this.fail(stream, 'download_failed', 'Music did not start or resume within 15 seconds');
    }, 15000);
  }
  private clearTimeout(stream: Stream): void {
    if (stream.timeout) clearTimeout(stream.timeout);
    stream.timeout = null;
  }
  private suspend(stream: Stream): void {
    stream.generation++; stream.pending = false; this.clearTimeout(stream); stream.media.pause();
  }
  private applyGain(): void {
    if (!this.current || !this.context) return;
    const gain = this.current.gain.gain, now = this.context.currentTime;
    gain.cancelScheduledValues(now);
    gain.setTargetAtTime(this.catalog[this.current.id]!.gain * this.level * (this.ducked ? 0.5 : 1), now, this.ducked ? 0.04 : 0.2);
  }
  private dispose(stream: Stream): void {
    this.suspend(stream);
    stream.media.onplaying = stream.media.onwaiting = stream.media.onended = stream.media.onerror = null;
    stream.media.removeAttribute('src'); stream.media.load();
    stream.source.disconnect(); stream.gain.disconnect();
  }
  private clearTail(): void {
    if (this.fadeTimer) clearTimeout(this.fadeTimer);
    this.fadeTimer = null;
    if (this.tail) this.dispose(this.tail);
    this.tail = null;
  }
  private clearStreams(): void {
    this.clearTail();
    if (this.current) this.dispose(this.current);
    this.current = null;
  }

  state(): AudioHudState {
    if (this.destroyed) return 'destroyed';
    if (this.failure) return 'unavailable';
    return this.current?.state ?? (this.desired ? 'loading' : 'ready');
  }
  diagnostics() {
    return { requested: this.desired, state: this.state(), error: this.failure ?? this.current?.error ?? null,
      track: this.current?.id ?? null, position: this.current?.media.currentTime ?? 0,
      duration: this.current?.media.duration ?? null, paused: this.current?.media.paused ?? true,
      previewing: this.previewing, ducked: this.ducked, instances: Number(!!this.current) + Number(!!this.tail) };
  }
}
