import Phaser from 'phaser';
import { animeAtlasPages, isAnimeRuntimeManifest, validateAnimeRuntimeManifest, type AnimeRuntimeManifest } from './animations';
import { characters } from '@characters/index';
import { readPresentation } from './presentation';
import uiArtManifest from './anime/uiArtManifest.json';
import { AssetDownloadError, AssetDownloads, DELIVERY_VERSION, deliveryRecord, sharedDownloads } from './assetDownloads';
import { CHARACTER_RESOURCE_PLANS, presentationResources, type PresentationResource } from './resourcePlan';

export { REQUIRED_FX_FRAMES } from './resourcePlan';

export const SPRITE_KEYS = 'spriteKeys';
export type SpriteKeys = Record<string, string | null>;
export const SPRITE_SOURCES = 'spriteSources';
export type SpriteSources = Record<string, 'atlas' | 'placeholder' | null>;
export const ANIME_CHARACTERS = 'animeCharacters';
export const ANIME_ERRORS = 'animeErrors';
export interface AnimeCharacterAsset { key: string; runtime: AnimeRuntimeManifest; frameTextures?: Record<string, string>; uiKey?: string; deliveryVersion?: string }
export type AnimeCharacterAssets = Record<string, AnimeCharacterAsset>;
export const ANIME_LOAD_RESULT = 'animeLoadResult';
export type AssetErrorCode = 'unavailable' | 'timeout' | 'invalid' | 'decode' | 'integrity' | 'texture';
export interface AssetFailure { characterId: string; code: AssetErrorCode; message: string }
export interface AnimeLoadResult {
  ok: boolean;
  requested: string[];
  assets: AnimeCharacterAssets;
  errors: Record<string, string>;
  failures: AssetFailure[];
}
export const ANIME_INTERFACES = 'animeInterfaces';
interface InterfaceAsset { key: string; version: string; sourceIdentity: string }
type InterfaceAssets = Record<string, InterfaceAsset>;
const characterWork = new WeakMap<object, Map<string, Promise<AnimeCharacterAsset>>>();
const interfaceWork = new WeakMap<object, Map<string, Promise<string>>>();
const presentationWork = new WeakMap<object, Map<string, Promise<void>>>();

function interfaceSourceIdentity(id: string): string {
  const source = uiArtManifest.characters[id as keyof typeof uiArtManifest.characters];
  return JSON.stringify(source ? [source.sha256, source.width, source.height, source.frames] : null);
}

/** Every menu entry uses the same validated version and complete-frame check. */
export function areAnimeInterfacesReady(scene: Phaser.Scene, ids: readonly string[]): boolean {
  const loaded = (scene.registry.get(ANIME_INTERFACES) as InterfaceAssets | undefined) ?? {};
  return ids.every(id => {
    const source = uiArtManifest.characters[id as keyof typeof uiArtManifest.characters], asset = loaded[id];
    return !!source && !('enabled' in source && source.enabled === false)
      && asset?.version === DELIVERY_VERSION && asset.sourceIdentity === interfaceSourceIdentity(id)
      && scene.textures.exists(asset.key)
      && ['body', 'portrait'].every(kind => scene.textures.get(asset.key).has(`${id}/ui/${kind}`));
  });
}

function workMap<T>(owner: object, store: WeakMap<object, Map<string, Promise<T>>>): Map<string, Promise<T>> {
  let map = store.get(owner);
  if (!map) { map = new Map(); store.set(owner, map); }
  return map;
}

/** Menus only need these independent high-resolution crops, never the combat atlas. */
export async function loadAnimeInterfaces(scene: Phaser.Scene, ids: readonly string[], downloads = sharedDownloads(scene.game ?? scene.registry)): Promise<{ ok: boolean; failures: AssetFailure[] }> {
  const failures: AssetFailure[] = [];
  await Promise.all([...new Set(ids)].map(async id => {
    try { await loadInterface(scene, id, downloads); }
    catch (error) { failures.push(assetFailure(id, error)); }
  }));
  return { ok: failures.length === 0, failures };
}

async function loadInterface(scene: Phaser.Scene, id: string, downloads: AssetDownloads): Promise<string> {
  const records = (): InterfaceAssets => (scene.registry.get(ANIME_INTERFACES) as InterfaceAssets | undefined) ?? {};
  const previous = records()[id];
  const source = uiArtManifest.characters[id as keyof typeof uiArtManifest.characters];
  if (source && 'enabled' in source && source.enabled === false) {
    throw new AssetLoadError('invalid', `角色 ${id} 的界面原画正在造型复核，暂不采用`);
  }
  if (source && deliveryRecord(source.image) && previous && areAnimeInterfacesReady(scene, [id])) return previous.key;
  const tasks = workMap(scene.textures, interfaceWork);
  let work = tasks.get(id);
  if (!work) {
    work = (async () => {
      const art = await fetchAnimeInterface(id, downloads);
      const key = `${id}-anime-ui-${art.identity}`;
      const texture = scene.textures.exists(key) ? scene.textures.get(key) : scene.textures.addAtlas(key, art.image, art.atlas);
      if (!texture) throw new AssetLoadError('texture', '人物界面纹理注册失败');
      if (!['body', 'portrait'].every(kind => texture.has(`${id}/ui/${kind}`))) throw new AssetLoadError('invalid', '人物界面缺少全身或头像帧');
      texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
      scene.registry.set(ANIME_INTERFACES, { ...records(), [id]: { key, version: DELIVERY_VERSION, sourceIdentity: interfaceSourceIdentity(id) } });
      return key;
    })().catch(error => {
      const current = { ...records() };
      delete current[id];
      scene.registry.set(ANIME_INTERFACES, current);
      throw error;
    }).finally(() => { tasks.delete(id); });
    tasks.set(id, work);
  }
  return work;
}
export const PRESENTATION_ASSET_LOAD_RESULT = 'presentationAssetLoadResult';
export interface PresentationAssetFailure { key: string; code: AssetErrorCode; message: string }
export interface PresentationAssetLoadResult {
  ok: boolean;
  required: boolean;
  requested: string[];
  loaded: string[];
  failures: PresentationAssetFailure[];
}
const VARIANTS = ['atlas', 'placeholder'] as const;
const REQUEST_TIMEOUT = 8000;

interface AtlasData {
  frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>;
}

/** 每名角色独立尝试正式图集与占位图；一张坏图不会中断其他角色。 */
export async function loadCharacterAtlases(scene: Phaser.Scene, ids: readonly string[]): Promise<SpriteKeys> {
  const keys: SpriteKeys = { ...((scene.registry.get(SPRITE_KEYS) as SpriteKeys | undefined) ?? {}) };
  const sources: SpriteSources = { ...((scene.registry.get(SPRITE_SOURCES) as SpriteSources | undefined) ?? {}) };
  await Promise.all([...new Set(ids)].map(async (id) => {
    if (id in keys && (!keys[id] || scene.textures.exists(keys[id]!))) return;
    keys[id] = null;
    sources[id] = null;
    for (const variant of VARIANTS) {
      const key = `${id}-${variant}`;
      if (!scene.textures.exists(key)) {
        const base = `assets/characters/${id}/${variant}`;
        try {
          // 每份文件只取一次，等图片真正解码后再注册纹理。
          const [data, image] = await Promise.all([fetchAtlas(`${base}.json`, id), fetchImage(`${base}.png`)]);
          for (const { frame } of Object.values(data.frames)) {
            if (frame.x + frame.w > image.naturalWidth || frame.y + frame.h > image.naturalHeight) throw new Error('Atlas frame outside image');
          }
          scene.textures.addAtlas(key, image, data);
        } catch {
          continue;
        }
      }
      const texture = scene.textures.get(key);
      if (!texture.has(`${id}/idle/0`)) continue;
      if (variant === 'placeholder') texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
      keys[id] = key;
      sources[id] = variant;
      break;
    }
  }));
  scene.registry.set(SPRITE_KEYS, keys);
  scene.registry.set(SPRITE_SOURCES, sources);
  return keys;
}

/** Candidate artwork lives beside the complete legacy character, never replacing its registry key. */
export async function loadAnimeCharacters(scene: Phaser.Scene, ids: readonly string[], downloads = sharedDownloads(scene.game ?? scene.registry)): Promise<AnimeLoadResult> {
  const previousAssets = (scene.registry.get(ANIME_CHARACTERS) as AnimeCharacterAssets | undefined) ?? {};
  const assets: AnimeCharacterAssets = { ...previousAssets };
  const errors: Record<string, string> = { ...((scene.registry.get(ANIME_ERRORS) as Record<string, string> | undefined) ?? {}) };
  const failures: AssetFailure[] = [];
  const requested = [...new Set(ids)];
  for (const id of requested) {
    // A failed refresh must never silently reuse this fighter's previous bundle.
    delete assets[id];
    delete errors[id];
  }
  await Promise.all(requested.map(async id => {
    try {
      const previous = previousAssets[id];
      if (deliveryRecord(`assets/characters/${id}/anime/runtime.json`) && previous?.deliveryVersion === DELIVERY_VERSION
        && Object.keys(previous.runtime.attachments).every(name => {
          const key = previous.frameTextures?.[name] ?? previous.key;
          return scene.textures.exists(key) && scene.textures.get(key).has(name);
        })) {
        await loadInterface(scene, id, downloads);
        assets[id] = previous;
        return;
      }
      const tasks = workMap(scene.textures, characterWork);
      let work = tasks.get(id);
      if (!work) {
        work = (async (): Promise<AnimeCharacterAsset> => {
      const base = `assets/characters/${id}/anime/`;
      const value: unknown = await downloads.read(`${base}runtime.json`, response => response.json());
      const invalid = validateAnimeRuntimeManifest(value, characters[id]?.moves);
      if (invalid.length || !isAnimeRuntimeManifest(value) || value.characterId !== id) throw new AssetLoadError('invalid', invalid[0] ?? '人物配置身份不匹配');
      const [pageResult, uiResult] = await Promise.allSettled([settleAll(animeAtlasPages(value).map(async page => {
        const [atlas, { image, imageHash }] = await settleAll([
          fetchAtlas(`${base}${page.data}`, id, false, downloads), fetchAnimeImage(`${base}${page.image}`, downloads),
        ]);
        if (image.naturalWidth > 4096 || image.naturalHeight > 4096) throw new AssetLoadError('texture', `人物图集单页超过 4096：${page.id}`);
        if ((page.width !== undefined && image.naturalWidth !== page.width) || (page.height !== undefined && image.naturalHeight !== page.height)) throw new AssetLoadError('invalid', `人物分页尺寸不匹配：${page.id}`);
        return { page, atlas, image, imageHash };
      })), loadInterface(scene, id, downloads)]);
      // Do not announce a retryable result while the parallel UI decode still
      // holds object URLs or can deliver a late completion into the next load.
      if (pageResult.status === 'rejected') throw pageResult.reason;
      if (uiResult.status === 'rejected') throw uiResult.reason;
      const pages = pageResult.value;
      const uiKey = uiResult.value;
      // Page files must not inject or shadow a frame assigned elsewhere. Validate the
      // complete atlas namespace before installing any immutable texture.
      for (const { page, atlas } of pages) for (const name of Object.keys(atlas.frames)) {
        if (!value.attachments[name] || (value.framePages?.[name] ?? 'p0') !== page.id) {
          throw new AssetLoadError('invalid', `人物分页包含未声明或归属错误的动作帧：${page.id}/${name}`);
        }
      }
      for (const [name, geometry] of Object.entries(value.attachments)) {
        const pageId = value.framePages?.[name] ?? 'p0';
        const loaded = pages.find(entry => entry.page.id === pageId);
        const frame = loaded?.atlas.frames[name]?.frame;
        const image = loaded?.image;
        if (!frame || !image || frame.x + frame.w > image.naturalWidth || frame.y + frame.h > image.naturalHeight
          || frame.w !== geometry.size.width || frame.h !== geometry.size.height) throw new AssetLoadError('invalid', `动作帧不完整：${name}`);
      }
      // Include all runtime/atlas metadata and the PNG bytes, not just frame names or dimensions.
      // Immutable keys keep a running Fight's texture intact when another bundle is loaded.
      const identity = await sha256(JSON.stringify([value, pages.map(({ page, atlas, imageHash }) => [page.id, atlas, imageHash])]));
      const frameTextures: Record<string, string> = {};
      let key = '';
      for (const { page, atlas, image } of pages) {
        const pageKey = `${id}-anime-${identity}${page.id === 'p0' ? '' : `-${page.id}`}`;
        const texture = scene.textures.exists(pageKey) ? scene.textures.get(pageKey) : scene.textures.addAtlas(pageKey, image, atlas);
        if (!texture) throw new AssetLoadError('texture', `人物纹理注册失败：${page.id}`);
        texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
        if (page.id === 'p0') key = pageKey;
        for (const name of Object.keys(atlas.frames)) frameTextures[name] = pageKey;
      }
      return { key, runtime: value, frameTextures, uiKey, deliveryVersion: DELIVERY_VERSION };
        })().finally(() => { tasks.delete(id); });
        tasks.set(id, work);
      }
      assets[id] = await work;
    } catch (error) {
      const failure = assetFailure(id, error);
      errors[id] = failure.message;
      failures.push(failure);
    }
  }));
  // Concurrent background/select loads may finish in either order. Publish only
  // the requested characters into the latest registry, never a stale snapshot.
  const latest = { ...((scene.registry.get(ANIME_CHARACTERS) as AnimeCharacterAssets | undefined) ?? {}) };
  const latestErrors = { ...((scene.registry.get(ANIME_ERRORS) as Record<string, string> | undefined) ?? {}) };
  for (const id of requested) {
    if (assets[id]) latest[id] = assets[id]; else delete latest[id];
    if (errors[id]) latestErrors[id] = errors[id]; else delete latestErrors[id];
  }
  scene.registry.set(ANIME_CHARACTERS, latest);
  scene.registry.set(ANIME_ERRORS, latestErrors);
  const result = { ok: failures.length === 0, requested, assets: latest, errors: latestErrors, failures };
  scene.registry.set(ANIME_LOAD_RESULT, result);
  return result;
}

class AssetLoadError extends Error {
  constructor(readonly code: AssetErrorCode, message: string) { super(message); }
}

function assetFailure(characterId: string, error: unknown): AssetFailure {
  if (error instanceof AssetLoadError || error instanceof AssetDownloadError) return { characterId, code: error.code, message: error.message };
  if (error instanceof Error && error.name === 'AbortError') return { characterId, code: 'timeout', message: '人物资源请求超时，可重试' };
  const message = error instanceof Error ? error.message : '人物资源载入失败';
  return { characterId, code: message.includes('decode') ? 'decode' : message.includes('timed out') ? 'timeout' : 'unavailable', message };
}

/** Drain sibling downloads/decodes before allowing a scene retry to begin. */
async function settleAll<const T extends readonly unknown[]>(promises: T): Promise<{ -readonly [P in keyof T]: Awaited<T[P]> }> {
  const results = await Promise.allSettled(promises);
  const failed = results.find(result => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
  return results.map(result => (result as PromiseFulfilledResult<unknown>).value) as { -readonly [P in keyof T]: Awaited<T[P]> };
}

async function fetchAtlas(url: string, id: string, requireIdle = true, downloads = new AssetDownloads()): Promise<AtlasData> {
    const data = await downloads.read(url, response => response.json()) as AtlasData;
    if (!data?.frames || typeof data.frames !== 'object' || !Object.keys(data.frames).length) throw new AssetLoadError('invalid', '人物图集没有动作帧');
    if (requireIdle && !data.frames[`${id}/idle/0`]) throw new AssetLoadError('invalid', '人物图集缺少站立帧');
    for (const entry of Object.values(data.frames)) {
      const f = entry?.frame;
      if (!f || ![f.x, f.y, f.w, f.h].every(Number.isInteger) || f.x < 0 || f.y < 0 || f.w <= 0 || f.h <= 0) throw new AssetLoadError('invalid', '人物图集帧坐标非法');
    }
    return data;
}

async function sha256(value: string | ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle?.digest) throw new AssetLoadError('integrity', '此浏览器无法执行 SHA-256 完整性校验，请使用新版 Chrome / Edge 并通过 HTTPS（本机可用 localhost / 127.0.0.1）打开');
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function fetchAnimeInterface(id: string, downloads: AssetDownloads): Promise<{ image: HTMLImageElement; atlas: AtlasData; identity: string }> {
  const record = uiArtManifest.characters[id as keyof typeof uiArtManifest.characters];
  if (!record) throw new AssetLoadError('invalid', '人物界面配置缺失');
  const { image, imageHash } = await fetchAnimeImage(record.image, downloads);
  const delivery = deliveryRecord(record.image);
  if ((delivery && delivery.sourceSha256 !== record.sha256) || imageHash !== (delivery?.sha256 ?? record.sha256)) throw new AssetLoadError('integrity', '人物界面原图内容校验失败，请重新载入');
  if (image.naturalWidth !== record.width || image.naturalHeight !== record.height || Math.max(record.width, record.height) > 4096) {
    throw new AssetLoadError('invalid', '人物界面图片尺寸不匹配');
  }
  const frames: AtlasData['frames'] = {};
  for (const [name, frame] of Object.entries(record.frames)) {
    if (![frame.x, frame.y, frame.w, frame.h].every(Number.isInteger) || frame.x < 0 || frame.y < 0 || frame.w <= 0 || frame.h <= 0
      || frame.x + frame.w > record.width || frame.y + frame.h > record.height) throw new AssetLoadError('invalid', '人物界面裁切范围非法');
    frames[`${id}/ui/${name}`] = { frame };
  }
  return { image, atlas: { frames }, identity: await sha256(JSON.stringify([imageHash, record.frames])) };
}

/** Fetch the exact bytes used for both decoding and the immutable candidate texture key. */
async function fetchAnimeImage(url: string, downloads: AssetDownloads): Promise<{ image: HTMLImageElement; imageHash: string }> {
  // Keep arrayBuffer: some embedded Chromium hosts fail large response.blob().
  const bytes = await downloads.read(url, response => response.arrayBuffer());
  const delivery = deliveryRecord(url);
  const imageHash = delivery?.sha256 ?? await sha256(bytes);
  const objectUrl = URL.createObjectURL(new Blob([bytes], { type: delivery?.contentType ?? (url.endsWith('.webp') ? 'image/webp' : 'image/png') }));
  try { return { image: await fetchImage(objectUrl), imageHash }; }
  finally { URL.revokeObjectURL(objectUrl); }
}

export function fetchImage(url: string, signal?: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    let settled = false;
    const timer = setTimeout(() => finish(new Error('Image load timed out')), REQUEST_TIMEOUT);
    const abort = () => finish(new AssetLoadError('timeout', '图片请求超时，可重试'));
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      image.onload = null;
      image.onerror = null;
      if (error) { image.src = ''; reject(error); }
      else resolve(image);
    };
    image.onload = () => image.naturalWidth > 0 ? finish() : finish(new Error('Empty image'));
    image.onerror = () => finish(new Error('Image decode failed'));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    image.src = url;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function presentationAtlas(value: unknown, image: HTMLImageElement, requiredFrames: readonly string[]): AtlasData {
  if (!isRecord(value) || !isRecord(value.frames) || !Object.keys(value.frames).length) throw new AssetLoadError('invalid', '技能图集没有合法帧表');
  for (const name of requiredFrames) if (!Object.hasOwn(value.frames, name)) throw new AssetLoadError('invalid', `技能图集缺少必需帧：${name}`);
  for (const [name, entry] of Object.entries(value.frames)) {
    if (!isRecord(entry) || !isRecord(entry.frame)) throw new AssetLoadError('invalid', `技能图集帧结构非法：${name}`);
    const f = entry.frame;
    const dimensions = [f.x, f.y, f.w, f.h];
    if (!dimensions.every(Number.isInteger) || (f.x as number) < 0 || (f.y as number) < 0 || (f.w as number) <= 0 || (f.h as number) <= 0
      || (f.x as number) + (f.w as number) > image.naturalWidth || (f.y as number) + (f.h as number) > image.naturalHeight) {
      throw new AssetLoadError('invalid', `技能图集帧坐标非法或越界：${name}`);
    }
    // The delivered FX pack is unrotated/untrimmed. Reject metadata that would
    // change its visible size or origin despite a superficially valid rectangle.
    if ((entry.rotated !== undefined && entry.rotated !== false) || (entry.trimmed !== undefined && entry.trimmed !== false)) throw new AssetLoadError('invalid', `技能图集帧变换不受支持：${name}`);
    for (const field of ['sourceSize', 'spriteSourceSize']) {
      const size = entry[field];
      if (size !== undefined && (!isRecord(size) || size.w !== f.w || size.h !== f.h
        || (field === 'spriteSourceSize' && (size.x !== 0 || size.y !== 0)))) throw new AssetLoadError('invalid', `技能图集帧尺寸元数据非法：${name}`);
    }
  }
  if (value.meta !== undefined && (!isRecord(value.meta) || (value.meta.size !== undefined && (!isRecord(value.meta.size)
    || value.meta.size.w !== image.naturalWidth || value.meta.size.h !== image.naturalHeight)))) throw new AssetLoadError('invalid', '技能图集图片尺寸与元数据不符');
  return value as unknown as AtlasData;
}

function validatePresentationTexture(scene: Phaser.Scene, key: string, frames: readonly string[]): void {
  if (!scene.textures.exists(key)) throw new AssetLoadError('texture', '表现纹理注册失败');
  const texture = scene.textures.get(key);
  const image = texture.getSourceImage();
  if (!image || ![image.width, image.height].every(value => Number.isInteger(value) && value > 0)) throw new AssetLoadError('texture', '表现纹理图片已失效');
  for (const name of frames) {
    if (!texture.has(name)) throw new AssetLoadError('texture', `表现纹理缺少必需帧：${name}`);
    const frame = texture.get(name);
    if (![frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight].every(Number.isInteger)
      || frame.cutX < 0 || frame.cutY < 0 || frame.cutWidth <= 0 || frame.cutHeight <= 0
      || frame.cutX + frame.cutWidth > image.width || frame.cutY + frame.cutHeight > image.height) throw new AssetLoadError('texture', `表现纹理帧已失效：${name}`);
  }
}

async function presentationImage(url: string, downloads: AssetDownloads): Promise<HTMLImageElement> {
  const bytes = await downloads.read(url, response => response.arrayBuffer());
  const objectUrl = URL.createObjectURL(new Blob([bytes], { type: deliveryRecord(url)?.contentType ?? (url.endsWith('.webp') ? 'image/webp' : 'image/png') }));
  try {
    const image = await fetchImage(objectUrl);
    if (!Number.isInteger(image.naturalHeight) || image.naturalHeight <= 0) throw new AssetLoadError('decode', '表现图片尺寸非法');
    return image;
  } finally { URL.revokeObjectURL(objectUrl); }
}

/** Full anime requires its declared stage/FX pack; optional callers still receive failures for inspection. */
export async function loadPresentationAssets(
  scene: Phaser.Scene,
  downloads = sharedDownloads(scene.game ?? scene.registry),
  scope: 'menu' | 'fight' = 'fight',
  characterIds: readonly string[] = ['luffy', 'akainu'],
): Promise<PresentationAssetLoadResult> {
  const profile = readPresentation(scene.registry);
  const required = profile.art === 'anime' && profile.scope === 'full';
  const plan = presentationResources(scope, characterIds);
  const requests: readonly PresentationResource[] = plan.resources;
  const results = await Promise.all(requests.map(async request => {
    try {
      if (!scene.textures.exists(request.key)) {
        const tasks = workMap(scene.textures, presentationWork);
        let work = tasks.get(request.key);
        if (!work) {
          work = (async () => {
        const [imageResult, atlasResult] = await Promise.allSettled([
          presentationImage(request.image, downloads),
          request.atlas ? downloads.read(request.atlas, response => response.json()) : Promise.resolve(null),
        ]);
        if (imageResult.status === 'rejected') throw imageResult.reason;
        if (atlasResult.status === 'rejected') throw atlasResult.reason;
        const image = imageResult.value;
        const texture = request.atlas
          ? scene.textures.addAtlas(request.key, image, presentationAtlas(atlasResult.value, image, request.frames))
          : scene.textures.addImage(request.key, image);
        if (!texture) throw new AssetLoadError('texture', '表现纹理注册失败');
          })().finally(() => { tasks.delete(request.key); });
          tasks.set(request.key, work);
        }
        await work;
      }
      validatePresentationTexture(scene, request.key, request.frames);
      return { key: request.key };
    } catch (error) {
      // Invalid cached/partly installed textures cannot make retry appear successful.
      if (scene.textures.exists(request.key)) scene.textures.remove(request.key);
      const reason = assetFailure('', error);
      const message = error instanceof Error && error.name === 'AbortError' ? '资源请求超时，可重试' : reason.message;
      return { key: request.key, failure: { key: request.key, code: reason.code, message: `${request.key}：${message}` } };
    }
  }));
  const failures = [
    ...results.flatMap(result => result.failure ? [result.failure] : []),
    ...plan.unknownCharacterIds.map(id => ({ key: `fx-${id}`, code: 'invalid' as const, message: `fx-${id}：角色表现资源未声明` })),
  ];
  const result = { ok: failures.length === 0, required, requested: requests.map(request => request.key), loaded: results.filter(result => !result.failure).map(result => result.key), failures };
  if (scope === 'fight') scene.registry.set(PRESENTATION_ASSET_LOAD_RESULT, result);
  return result;
}

/** Call only after Fight has shut down. Verified byte/cache entries remain reusable;
 * this releases decoded combat textures for characters that are no longer selected. */
export function releaseUnusedFightAssets(scene: Phaser.Scene, retainedCharacterIds: readonly string[]): string[] {
  const retained = new Set(retainedCharacterIds);
  const removed: string[] = [];
  const remove = (key: string): void => {
    if (!scene.textures.exists(key)) return;
    scene.textures.remove(key);
    removed.push(key);
  };
  for (const [id, plan] of Object.entries(CHARACTER_RESOURCE_PLANS)) {
    if (!retained.has(id)) for (const resource of plan.presentation) remove(resource.key);
  }
  const assets = { ...((scene.registry.get(ANIME_CHARACTERS) as AnimeCharacterAssets | undefined) ?? {}) };
  const errors = { ...((scene.registry.get(ANIME_ERRORS) as Record<string, string> | undefined) ?? {}) };
  for (const [id, asset] of Object.entries(assets)) {
    if (retained.has(id)) continue;
    for (const key of new Set([asset.key, ...Object.values(asset.frameTextures ?? {})])) remove(key);
    delete assets[id];
    delete errors[id];
  }
  scene.registry.set(ANIME_CHARACTERS, assets);
  scene.registry.set(ANIME_ERRORS, errors);
  return removed;
}

export function spriteFrame(scene: Phaser.Scene, charId: string, anim: string, index = 0): { key: string; frame: string } | null {
  if (readPresentation(scene.registry).art === 'anime') {
    const asset = (scene.registry.get(ANIME_CHARACTERS) as AnimeCharacterAssets | undefined)?.[charId];
    if (!asset) return null;
    // A title/card can intentionally use a real idle drawing until a portrait exists.
    // Combat/result actions never borrow an unrelated drawing or a legacy texture.
    const displayAnim = anim === 'portrait' && !asset.runtime.anims.portrait ? 'idle' : anim;
    const frame = `${charId}/${displayAnim}/${index}`;
    const key = asset.frameTextures?.[frame] ?? asset.key;
    return scene.textures.exists(key) && scene.textures.get(key).has(frame) ? { key, frame } : null;
  }
  const keys = (scene.registry.get(SPRITE_KEYS) as SpriteKeys | undefined) ?? {};
  const key = keys[charId];
  if (!key) return null;
  const frame = `${charId}/${anim}/${index}`;
  return scene.textures.get(key).has(frame) ? { key, frame } : null;
}

/** High-density interface crops never replace a combat action or borrow legacy art. */
export function interfaceFrame(scene: Phaser.Scene, charId: string, kind: 'body' | 'portrait'): { key: string; frame: string } | null {
  if (readPresentation(scene.registry).art !== 'anime') return null;
  const asset = (scene.registry.get(ANIME_CHARACTERS) as AnimeCharacterAssets | undefined)?.[charId];
  const uiKey = (scene.registry.get(ANIME_INTERFACES) as InterfaceAssets | undefined)?.[charId]?.key ?? asset?.uiKey;
  const frame = `${charId}/ui/${kind}`;
  return uiKey && scene.textures.exists(uiKey) && scene.textures.get(uiKey).has(frame) ? { key: uiKey, frame } : null;
}
