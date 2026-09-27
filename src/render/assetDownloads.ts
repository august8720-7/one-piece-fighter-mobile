import deliveryManifest from './deliveryManifest.json';
import { fightDownloadUrls } from './resourcePlan';
import { DeliveryFormatSelection, type DeliveryDefinition, type DeliveryRecord } from './deliveryFormats';
import { probeAvifAlpha } from './avifProbe';
import { sha256Hex } from '../mobile/sha256';

export type { DeliveryRecord } from './deliveryFormats';
export const DELIVERY_VERSION = deliveryManifest.version;
const deliveryFormat = new DeliveryFormatSelection(deliveryManifest.records as Readonly<Record<string, DeliveryDefinition>>);
export const prepareDeliveryFormat = (forceWebp = false): Promise<'webp' | 'avif'> => deliveryFormat.prepare(probeAvifAlpha, 300, forceWebp);
export const deliveryRecord = (url: string): DeliveryRecord | undefined => deliveryFormat.records()[url];

/** Network limits apply to each active file, not an entire character or time in the queue. */
export const ASSET_DOWNLOAD_TIMEOUT = 90_000;
export const ASSET_DOWNLOAD_ATTEMPTS = 2;

export class AssetDownloadError extends Error {
  constructor(readonly code: 'timeout' | 'unavailable' | 'invalid' | 'integrity', readonly url: string, message: string) {
    super(`${url}：${message}`);
  }
}

export interface DownloadProgress { completed: number; url: string; retry: boolean; receivedBytes?: number; totalBytes?: number }
export type DownloadPriority = 'critical' | 'background';
type ByteCache = Pick<Cache, 'match' | 'put' | 'delete'>;
export interface AssetDownloadOptions {
  records?: Readonly<Record<string, DeliveryRecord>>;
  cache?: (() => Promise<ByteCache | null>);
}

/** A preload shares one pool across both fighters, UI portraits, stage and FX. */
export class AssetDownloads {
  private active = 0;
  private completed = 0;
  private sequence = 0;
  private readonly queue: Array<{
    identity: string;
    priority: DownloadPriority;
    sequence: number;
    kind: number;
    imageBytes: number;
    resolve: () => void;
    reject: (error: unknown) => void;
  }> = [];
  private readonly pending = new Map<string, Promise<ArrayBuffer>>();
  private readonly requestedPriorities = new Map<string, DownloadPriority>();
  private readonly verified = new Map<string, ArrayBuffer>();
  private readonly bypassHttpCache = new Set<string>();
  private readonly transfers = new Map<string, { received: number; total: number }>();
  private readonly listeners = new Set<(progress: DownloadProgress) => void>();
  private readonly cancellations = new Set<() => void>();
  private destroyed = false;
  private readonly records: Readonly<Record<string, DeliveryRecord>>;
  private readonly cacheFactory: () => Promise<ByteCache | null>;
  private cachePromise?: Promise<ByteCache | null>;
  private lastProgress?: DownloadProgress;
  readonly diagnostics = { networkFiles: 0, persistentHits: 0, memoryHits: 0, corruptCache: 0, cacheErrors: 0 };

  constructor(onProgress?: (progress: DownloadProgress) => void, options: AssetDownloadOptions = {}) {
    if (onProgress) this.listeners.add(onProgress);
    this.records = options.records ?? deliveryFormat.records();
    this.cacheFactory = options.cache ?? (async () => {
      try { return globalThis.caches ? await caches.open('opf-delivery-v1') : null; }
      catch { this.diagnostics.cacheErrors++; return null; }
    });
  }

  observe(listener: (progress: DownloadProgress) => void): () => void {
    this.listeners.add(listener);
    if (this.lastProgress) listener(this.lastProgress);
    return () => this.listeners.delete(listener);
  }

  /** Scene changes keep the pool; permanent game teardown cancels its remaining work. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const cancel of this.cancellations) cancel();
    for (const queued of this.queue.splice(0)) queued.reject(new AssetDownloadError('unavailable', queued.identity, '游戏已退出，停止资源下载'));
    this.listeners.clear();
    this.verified.clear();
    this.bypassHttpCache.clear();
  }

  private checkActive(url: string): void {
    if (this.destroyed) throw new AssetDownloadError('unavailable', url, '游戏已退出，停止资源下载');
  }

  async invalidate(url: string): Promise<void> {
    const record = this.records[url];
    if (!record) return;
    const identity = `${record.file}:${record.sha256}`;
    this.verified.delete(identity);
    this.bypassHttpCache.add(identity);
    try {
      const cache = await this.cachePromise;
      if (cache) await cache.delete(new URL(record.file, globalThis.location?.href ?? 'http://localhost/').href);
    } catch { this.diagnostics.cacheErrors++; }
  }

  private progress(url: string, retry = false): void {
    const bytes = [...this.transfers.values()];
    const progress: DownloadProgress = { completed: this.completed, url, retry };
    if (bytes.length) {
      progress.receivedBytes = bytes.reduce((sum, entry) => sum + entry.received, 0);
      progress.totalBytes = bytes.reduce((sum, entry) => sum + entry.total, 0);
    }
    this.lastProgress = progress;
    for (const listener of this.listeners) listener(progress);
  }

  async read<T>(url: string, consume: (response: Response) => Promise<T>, priority: DownloadPriority = 'critical'): Promise<T> {
    this.checkActive(url);
    const record = this.records[url];
    if (!record) return this.readNetwork(url, consume, priority, url);
    this.validateRecord(url, record);
    const bytes = await this.readVerified(url, record, priority);
    this.checkActive(url);
    const selected = record.slice ? bytes.slice(record.slice.offset, record.slice.offset + record.slice.length) : bytes;
    try { return await consume(new Response(selected, { headers: { 'content-type': record.contentType } })); }
    catch (error) {
      if (error instanceof SyntaxError) throw new AssetDownloadError('invalid', url, '配置不是有效 JSON');
      throw error;
    }
  }

  private validateRecord(url: string, record: DeliveryRecord): void {
    if (!/^assets\/delivery\/[a-z0-9-]+\.(webp|avif|json|bin|ogg)$/.test(record.file)
      || !/^[a-f0-9]{64}$/.test(record.sha256) || !Number.isSafeInteger(record.bytes) || record.bytes <= 0
      || (record.slice && (!Number.isSafeInteger(record.slice.offset) || !Number.isSafeInteger(record.slice.length)
      || record.slice.offset < 0 || record.slice.length <= 0 || record.slice.offset + record.slice.length > record.bytes))) {
      throw new AssetDownloadError('invalid', url, '发布文件或分段配置非法');
    }
  }

  private async verify(bytes: ArrayBuffer, record: DeliveryRecord): Promise<boolean> {
    if (bytes.byteLength !== record.bytes) return false;
    try { return await sha256Hex(bytes) === record.sha256; }
    catch { throw new AssetDownloadError('integrity', record.file, 'SHA-256 内容校验计算失败'); }
  }

  private readVerified(url: string, record: DeliveryRecord, priority: DownloadPriority): Promise<ArrayBuffer> {
    const identity = `${record.file}:${record.sha256}`;
    const ready = this.verified.get(identity);
    if (ready) { this.diagnostics.memoryHits++; return Promise.resolve(ready); }
    const pending = this.pending.get(identity);
    if (pending) {
      if (priority === 'critical') this.promote(identity);
      return pending;
    }
    this.requestedPriorities.set(identity, priority);
    this.transfers.set(identity, { received: 0, total: record.bytes });
    const promise = (async () => {
      const cache = await (this.cachePromise ??= this.cacheFactory().catch(() => { this.diagnostics.cacheErrors++; return null; }));
      const key = new URL(record.file, globalThis.location?.href ?? 'http://localhost/').href;
      if (cache) {
        try {
          const hit = await cache.match(key);
          if (hit) {
            const bytes = await hit.arrayBuffer();
            if (await this.verify(bytes, record)) {
              this.diagnostics.persistentHits++;
              this.transfers.get(identity)!.received = record.bytes;
              this.progress(url);
              return bytes;
            }
            this.diagnostics.corruptCache++;
            this.bypassHttpCache.add(identity);
            await cache.delete(key);
          }
        } catch { this.diagnostics.cacheErrors++; }
      }
      const bytes = await this.readNetwork(record.file, async response => {
        const transfer = this.transfers.get(identity)!;
        transfer.received = 0;
        let bytes: ArrayBuffer;
        if (response.body?.getReader) {
          const reader = response.body.getReader();
          const chunks: Uint8Array[] = [];
          try {
            for (;;) {
              const { value, done } = await reader.read();
              if (done) break;
              transfer.received += value.byteLength;
              if (transfer.received > record.bytes) {
                await reader.cancel();
                throw new AssetDownloadError('integrity', url, '资源长度超过发布清单');
              }
              chunks.push(value);
              this.progress(url);
            }
          } finally { reader.releaseLock(); }
          const joined = new Uint8Array(transfer.received);
          let offset = 0;
          for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
          bytes = joined.buffer;
        } else bytes = await response.arrayBuffer();
        if (!await this.verify(bytes, record)) throw new AssetDownloadError('integrity', url, '资源内容校验失败，请重试或更新页面');
        transfer.received = bytes.byteLength;
        return bytes;
      }, priority, identity, this.bypassHttpCache.has(identity) ? 'reload' : 'default',
      url.endsWith('/runtime.json') ? 0 : url.endsWith('.json') ? 1 : record.contentType.startsWith('image/') ? 2 : 3,
      record.contentType.startsWith('image/') ? record.bytes : 0);
      this.diagnostics.networkFiles++;
      if (cache) {
        try { await cache.put(key, new Response(bytes, { headers: { 'content-type': record.slice ? 'application/octet-stream' : record.contentType } })); }
        catch { this.diagnostics.cacheErrors++; }
      }
      return bytes;
    })().then(bytes => { this.checkActive(url); this.bypassHttpCache.delete(identity); this.verified.set(identity, bytes); return bytes; })
      .catch(error => {
        if (error instanceof AssetDownloadError && error.code === 'integrity') this.bypassHttpCache.add(identity);
        throw error;
      })
      .finally(() => { this.pending.delete(identity); this.requestedPriorities.delete(identity); });
    this.pending.set(identity, promise);
    return promise;
  }

  private promote(identity: string): void {
    this.requestedPriorities.set(identity, 'critical');
    const queued = this.queue.find(entry => entry.identity === identity);
    if (queued) queued.priority = 'critical';
  }

  private pump(): void {
    while (!this.destroyed && this.active < 4 && this.queue.length) {
      // A later character lock can add its metadata after the first fighter's
      // large files. Reorder pending work across both locks, without interrupting
      // active transfers or letting background files delay required resources.
      this.queue.sort((a, b) => Number(b.priority === 'critical') - Number(a.priority === 'critical')
        || a.kind - b.kind || b.imageBytes - a.imageBytes || a.sequence - b.sequence);
      const next = this.queue.shift();
      if (!next) return;
      this.active++;
      next.resolve();
    }
  }

  private async readNetwork<T>(url: string, consume: (response: Response) => Promise<T>, priority: DownloadPriority, identity: string, cacheMode: RequestCache = 'no-cache', kind = 3, imageBytes = 0): Promise<T> {
    await new Promise<void>((resolve, reject) => {
      this.queue.push({ identity, priority: this.requestedPriorities.get(identity) ?? priority, sequence: this.sequence++, kind, imageBytes, resolve, reject });
      this.pump();
    });
    try {
      for (let attempt = 0; ; attempt++) {
        this.checkActive(url);
        this.progress(url, attempt > 0);
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        let transientHttp = false;
        let cancel!: () => void;
        try {
          const cancelled = new Promise<never>((_, reject) => {
            cancel = () => { controller.abort(); reject(new AssetDownloadError('unavailable', url, '游戏已退出，停止资源下载')); };
            this.cancellations.add(cancel);
          });
          const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              reject(new AssetDownloadError('timeout', url, `下载超过90秒，已尝试${attempt + 1}次；请检查网络后重试`));
              controller.abort();
            }, ASSET_DOWNLOAD_TIMEOUT);
          });
          const request = async (): Promise<T> => {
            // Hashed files can reuse HTML preloads; every byte is still verified.
            // Raw mutable URLs revalidate, while retries bypass HTTP caches.
            const response = await fetch(url, { signal: controller.signal, cache: attempt === 0 ? cacheMode : 'reload' });
            if (!response.ok) {
              transientHttp = response.status === 408 || response.status === 429 || response.status >= 500;
              throw new AssetDownloadError('unavailable', url, `下载失败（HTTP ${response.status}）`);
            }
            if (response.headers.get('content-type')?.includes('text/html')) {
              throw new AssetDownloadError('unavailable', url, '资源未找到，服务器返回了网页');
            }
            return consume(response);
          };
          const value = await Promise.race([request(), timeout, cancelled]);
          this.checkActive(url);
          this.completed++;
          this.progress(url);
          return value;
        } catch (error) {
          const retryable = transientHttp || error instanceof TypeError || (error instanceof AssetDownloadError && error.code === 'timeout');
          if (retryable && attempt + 1 < ASSET_DOWNLOAD_ATTEMPTS) continue;
          if (error instanceof AssetDownloadError) throw error;
          if (error instanceof SyntaxError) throw new AssetDownloadError('invalid', url, '配置不是有效 JSON');
          throw new AssetDownloadError('unavailable', url, error instanceof Error ? error.message : '下载失败');
        } finally { clearTimeout(timer); this.cancellations.delete(cancel); }
      }
    } finally {
      this.active--;
      this.pump();
    }
  }

  /** Used by the declarative warm plan so tests and alternate builds keep their own manifest. */
  deliveryRecords(): Readonly<Record<string, DeliveryRecord>> { return this.records; }
}

/** One queue and content cache outlive scene changes, while each Game owns its own lifetime. */
const gameDownloads = new WeakMap<object, AssetDownloads>();
export function sharedDownloads(owner: object): AssetDownloads {
  let downloads = gameDownloads.get(owner);
  if (!downloads) { downloads = new AssetDownloads(); gameDownloads.set(owner, downloads); }
  return downloads;
}

/** Warm immutable bytes in menus. Large GPU textures are installed by Preload,
 * so a fast persistent-cache hit cannot stall character-selection input. */
export async function warmFightDownloads(downloads: AssetDownloads, characterIds: readonly string[] = []): Promise<void> {
  const unique = new Map<string, string>();
  const records = downloads.deliveryRecords();
  for (const url of fightDownloadUrls(records, characterIds)) {
    const record = records[url];
    if (record && !unique.has(record.file)) unique.set(record.file, url);
  }
  // Resolve page geometry before large transfers occupy every slot. Start the
  // largest images early so their decode can overlap the remaining small files.
  const rank = (url: string): number => url.endsWith('/runtime.json') ? 0
    : url.endsWith('.json') ? 1 : records[url]?.contentType.startsWith('image/') ? 2 : 3;
  const ordered = [...unique.values()].sort((a, b) => rank(a) - rank(b)
    || (rank(a) === 2 ? records[b]!.bytes - records[a]!.bytes : 0));
  await Promise.all(ordered.map(url => downloads.read(url, response => response.arrayBuffer(), characterIds.length ? 'critical' : 'background')));
}
