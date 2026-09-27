import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { characters } from '../src/characters';
import { GETUP_FRAMES, KNOCKDOWN_FRAMES, LANDING_FRAMES, PREJUMP_FRAMES, THROW_TECH_FRAMES, totalFrames, type FighterDef, type MoveData } from '../src/core';
import { DEFAULT_ANIMS, animeAtlasPages, isAnimeRuntimeManifest, type AirbornePhases, type AnimeRuntimeManifest } from '../src/render/animations';
import { validateFullCoverage } from '../src/render/anime/sampleMode';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPORT_JSON = '.local-releases/改造验收-0913/全动作技能覆盖0913.json';
const REPORT_MD = 'docs/全动作技能覆盖0913.md';
const sha = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');
const json = <T>(path: string): T => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8').replace(/^\uFEFF/, '')) as T;
const relativePath = (path: string): string => relative(ROOT, path).replaceAll('\\', '/');

interface Receipt { file: string; sha256: string }
interface Source extends Receipt { model: string; provider: string; generatedAt: string; sessionUrl: string; modelEvidence: Receipt; prompt: Receipt }
interface SourcePatch { source: string; rect: number[] }
interface SourceFrame { source: string; sourcePatches?: SourcePatch[]; crop?: number[]; transform?: Record<string, unknown>; status?: string; note?: string }
interface SourceAnimation { frames: string[]; exposures: { frame: number; ticks: number }[]; throwExposures?: { frame: number; ticks: number }[]; airbornePhases?: AirbornePhases; loop: boolean }
export interface AuthoringCharacter {
  sources: Record<string, Source>;
  frames: Record<string, SourceFrame>;
  anims: Record<string, SourceAnimation>;
  referenceFrames_NOT_BUILT?: Record<string, SourceFrame>;
  reviewFrames_NOT_BUILT?: Record<string, SourceFrame>;
}
export interface Authoring {
  characters: Record<string, AuthoringCharacter>;
  sourceManifest?: Receipt;
  sourceCatalog?: Receipt;
  generator?: Receipt;
}
export interface AuthoringManifestInput { file: string; sha256: string; authoring: Authoring; provenance?: Record<string, Receipt> }
export interface AuthoringOwner { file: string; sha256: string; authoring: AuthoringCharacter }
interface SourceUsageInput {
  sources: Record<string, { file: string }>;
  frames: Record<string, SourceFrame>;
  anims: Record<string, { frames: string[] }>;
  referenceFrames_NOT_BUILT?: Record<string, SourceFrame>;
  reviewFrames_NOT_BUILT?: Record<string, SourceFrame>;
}
interface PixelFrame { sha256: string; width: number; height: number; empty: boolean }
interface Atlas { frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>; meta?: { manifestSha256?: string } }
const phaseIdentity = (phases: AirbornePhases | undefined): string => JSON.stringify(phases
  ? [phases.rising, phases.falling, phases.apex?.frame ?? null, phases.apex?.maxSpeed ?? null] : null);

/** One character has exactly one authoring manifest. Changing a crossover manifest
 * must never invalidate an unchanged legacy character atlas. */
export function assignAuthoringManifests(inputs: readonly AuthoringManifestInput[]): Map<string, AuthoringOwner> {
  const owners = new Map<string, AuthoringOwner>();
  for (const input of inputs) for (const [id, authoring] of Object.entries(input.authoring.characters)) {
    if (owners.has(id)) throw new Error(`角色 ${id} 被多个作者清单重复声明`);
    owners.set(id, { file: input.file, sha256: input.sha256, authoring });
  }
  return owners;
}

function loadAuthoringManifests(files: readonly string[]): { inputs: AuthoringManifestInput[]; owners: Map<string, AuthoringOwner> } {
  const inputs = files.map(file => {
    const bytes = readFileSync(resolve(ROOT, file));
    const authoring = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')) as Partial<Authoring> & { schemaVersion?: number };
    if (authoring.schemaVersion !== 1 || !authoring.characters || typeof authoring.characters !== 'object') throw new Error(`不支持的作者清单：${file}`);
    const provenance = verifyAuthoringProvenance(file, authoring);
    return { file, sha256: sha(bytes), authoring: authoring as Authoring, provenance };
  });
  return { inputs, owners: assignAuthoringManifests(inputs) };
}

function receipt(receipt: Receipt | undefined) {
  if (!receipt?.file) return { file: null, expectedSha256: null, actualSha256: null, ok: false };
  const file = resolve(ROOT, receipt.file);
  const hash = existsSync(file) ? sha(readFileSync(file)) : null;
  return { file: receipt.file, expectedSha256: receipt.sha256, actualSha256: hash, ok: hash !== null && hash === receipt.sha256 };
}

export function verifyAuthoringProvenance(
  file: string,
  authoring: Partial<Authoring>,
  verify: (value: Receipt) => boolean = value => receipt(value).ok,
): Record<string, Receipt> {
  const fields = ['sourceManifest', 'sourceCatalog', 'generator'] as const;
  const present = fields.filter(field => Object.hasOwn(authoring, field));
  if ((file.endsWith('.resolved.json') || present.length) && present.length !== fields.length) throw new Error(`resolved作者清单缺少三项来源凭据：${file}`);
  const provenance: Record<string, Receipt> = {};
  for (const field of present) {
    const value = authoring[field];
    if (!value?.file || !value.sha256 || !verify(value)) throw new Error(`${field}来源凭据哈希不匹配：${value?.file ?? file}`);
    provenance[field] = value;
  }
  return provenance;
}

/** Hash decoded, alpha-trimmed RGBA pixels, so atlas coordinates/frame renaming cannot fake a new pose. */
function pixels(base: string, runtime: AnimeRuntimeManifest): Record<string, PixelFrame> {
  const code = `import json,sys,hashlib\nfrom pathlib import Path\nfrom PIL import Image\nbase=Path(sys.argv[1])\npages=json.loads(sys.argv[2])\nout={}\nfor page in pages:\n image=Image.open(base/page['image']).convert('RGBA')\n data=json.loads((base/page['data']).read_text(encoding='utf-8-sig'))\n for name,entry in data['frames'].items():\n  f=entry['frame']; tile=image.crop((f['x'],f['y'],f['x']+f['w'],f['y']+f['h']))\n  bounds=tile.getchannel('A').getbbox()\n  if bounds is not None: tile=tile.crop(bounds)\n  payload=str(tile.size).encode()+tile.tobytes()\n  out[name]={'sha256':hashlib.sha256(payload).hexdigest(),'width':tile.width,'height':tile.height,'empty':bounds is None}\nprint(json.dumps(out))`;
  return JSON.parse(execFileSync(process.env.OPF_PYTHON ?? 'python', ['-c', code, resolve(ROOT, base), JSON.stringify(animeAtlasPages(runtime))], { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 })) as Record<string, PixelFrame>;
}

const MULTI_POSE_STATES = new Set(['walk_fwd', 'walk_back', 'dash', 'backdash', 'roll_fwd', 'roll_back', 'getup', 'throw']);

const frameSourceIds = (frame: SourceFrame): string[] => [...new Set([frame.source, ...(frame.sourcePatches ?? []).map(patch => patch.source)])];

/** Every contributing PNG needs its own verified original, model evidence and prompt. */
export function inspectFrameSources(frame: SourceFrame | undefined, sources: readonly { id: string; ok: boolean; original: { file: string | null } }[]) {
  const source = sources.find(entry => entry.id === frame?.source);
  return {
    sourceId: frame?.source ?? null,
    sourceFile: source?.original.file ?? null,
    sourcePatches: (frame?.sourcePatches ?? []).map(patch => {
      const donor = sources.find(entry => entry.id === patch.source);
      return { sourceId: patch.source, sourceFile: donor?.original.file ?? null, rect: patch.rect, verified: donor?.ok ?? false };
    }),
    invalidSources: frame ? frameSourceIds(frame).filter(id => !sources.find(entry => entry.id === id)?.ok) : [],
  };
}

/** Current authoring references, not visual acceptance or inferred reuse of an unbuilt candidate. */
export function inspectSourceUsage(authoring: SourceUsageInput | undefined) {
  const frames = Object.entries(authoring?.frames ?? {});
  const animations = Object.entries(authoring?.anims ?? {});
  const referencedFrames = new Set(animations.flatMap(([, anim]) => anim.frames));
  const notBuilt = (['referenceFrames_NOT_BUILT', 'reviewFrames_NOT_BUILT'] as const).flatMap(collection =>
    Object.entries(authoring?.[collection] ?? {}).map(([id, frame]) => ({ id, collection, ...frame })));
  const sourceIds = new Set([...Object.keys(authoring?.sources ?? {}), ...frames.flatMap(([, frame]) => frameSourceIds(frame)), ...notBuilt.flatMap(frameSourceIds)]);
  return [...sourceIds].sort().map(id => {
    const sourceFrameIds = frames.filter(([, frame]) => frameSourceIds(frame).includes(id)).map(([frameId]) => frameId);
    return {
      id, sourceFile: authoring?.sources[id]?.file ?? null,
      mappedFrames: sourceFrameIds.filter(frameId => referencedFrames.has(frameId)).sort(),
      mappedAnimations: animations.filter(([, anim]) => anim.frames.some(frameId => sourceFrameIds.includes(frameId))).map(([name]) => name).sort(),
      unreferencedFrames: sourceFrameIds.filter(frameId => !referencedFrames.has(frameId)).sort(),
      notBuilt: notBuilt.filter(frame => frameSourceIds(frame).includes(id)),
    };
  });
}

export function inspectPoseOriginality(name: string, poseHashes: readonly string[], idleHashes: readonly string[], isMove: boolean): string[] {
  if (!poseHashes.length) return ['没有可核验的实际像素'];
  const unique = new Set(poseHashes);
  const issues: string[] = [];
  if (name !== 'idle' && name !== 'portrait' && poseHashes.every(hash => idleHashes.includes(hash))) issues.push('全部画面等同站立原图，不能计作该动作');
  if ((isMove || MULTI_POSE_STATES.has(name)) && unique.size < 2) issues.push('需要动作变化，但实际只有一种姿势；重复帧名不算补帧');
  return issues;
}

function stateDuration(def: FighterDef, name: string): { fixedTicks: number | null; text: string; source: string } {
  const fixed: Record<string, number> = { prejump: PREJUMP_FRAMES, landing: LANDING_FRAMES, knockdown: KNOCKDOWN_FRAMES, getup: GETUP_FRAMES, throw_tech: THROW_TECH_FRAMES, backdash: def.movement.backdashFrames, roll_fwd: def.movement.rollFrames, roll_back: def.movement.rollFrames };
  if (fixed[name] !== undefined) return { fixedTicks: fixed[name], text: `${fixed[name]}逻辑帧`, source: name.startsWith('roll') || name === 'backdash' ? `src/characters/${def.id}/def.ts` : 'src/core/FightSim.ts' };
  const descriptions: Record<string, string> = {
    idle: '随输入保持', walk_fwd: '随前进输入保持', walk_back: '随后退输入保持', crouch: '随下蹲输入保持', dash: '随冲刺输入/取消保持',
    jump_neutral: '由跳跃初速度、重力和落地决定；含小跳', jump_fwd: '由跳跃初速度、重力和落地决定；含小跳', jump_back: '由跳跃初速度、重力和落地决定；含小跳',
    block_stand: '由实际攻击的blockstun决定', block_crouch: '由实际攻击的blockstun决定', hit_stand: '由实际攻击的hitstun与反击奖励决定', hit_crouch: '由实际攻击的hitstun与反击奖励决定',
    hit_air: '由击飞、墙弹、落地与受身决定', throw: '由成功连接投技的duration/releaseFrame决定', thrown: '由对方成功投技流程决定', ko: '由回合结束与落地演出决定', win: '由回合/整场结算演出决定', portrait: '菜单静态展示，无战斗时长',
  };
  return { fixedTicks: null, text: descriptions[name] ?? '由当前逻辑状态决定', source: 'src/core/FightSim.ts' };
}

function attackPhases(move: MoveData): { startup: number | null; action: number | null; recovery: number; projectileCount: number } {
  let tick = 0;
  const activeStarts: number[] = [];
  for (const frame of move.frames) { if (frame.hitboxes?.length) activeStarts.push(tick); tick += frame.duration; }
  const releaseFrames = move.projectiles?.map(projectile => projectile.frame) ?? [];
  const first = [...activeStarts, ...releaseFrames].sort((a, b) => a - b)[0] ?? null;
  const recovery = move.frames.at(-1)!.duration;
  return { startup: first, action: first === null ? null : Math.max(0, tick - recovery - first), recovery, projectileCount: releaseFrames.length };
}

const STATE_NAMES: Record<string, string> = {
  idle: '站立', walk_fwd: '前进', walk_back: '后退', crouch: '蹲下', prejump: '起跳', jump_neutral: '垂直跳', jump_fwd: '前跳', jump_back: '后跳', landing: '落地', dash: '冲刺', backdash: '后撤步', roll_fwd: '前翻滚', roll_back: '后翻滚', block_stand: '站防', block_crouch: '蹲防', hit_stand: '站立受击', hit_crouch: '蹲下受击', hit_air: '空中受击', knockdown: '倒地', getup: '起身', throw: '投技连接', thrown: '被投', throw_tech: '拆投', ko: 'KO', win: '胜利', portrait: '菜单画像',
};

function inspectCharacter(def: FighterDef, owner: AuthoringOwner | undefined) {
  const authoring = owner?.authoring;
  const manifestHash = owner?.sha256;
  const base = `public/assets/characters/${def.id}/anime`;
  const runtimeFile = `${base}/runtime.json`;
  const raw: unknown = existsSync(resolve(ROOT, runtimeFile)) ? json(runtimeFile) : null;
  const runtime = isAnimeRuntimeManifest(raw) ? raw : null;
  const fileIssues: string[] = [];
  let decoded: Record<string, PixelFrame> = {};
  const pages: { id: string; image: string; data: string; width: number; height: number; sha256: string; rgbaBytes: number }[] = [];
  if (!runtime) fileIssues.push('runtime.json缺失或结构非法');
  if (!authoring) fileIssues.push('缺少显式作者素材清单');
  if (runtime) {
    try {
      for (const page of animeAtlasPages(runtime)) {
        const png = readFileSync(resolve(ROOT, base, page.image));
        const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
        const atlas = json<Atlas>(`${base}/${page.data}`);
        if (manifestHash && atlas.meta?.manifestSha256 !== manifestHash) fileIssues.push(`${page.id}记录的素材清单哈希与所属作者清单不一致`);
        if (width > 4096 || height > 4096) fileIssues.push(`${page.id}超过4096单页限制`);
        if ((page.width !== undefined && page.width !== width) || (page.height !== undefined && page.height !== height)) fileIssues.push(`${page.id}图片与声明尺寸不一致`);
        for (const [name, geometry] of Object.entries(runtime.attachments)) {
          if ((runtime.framePages?.[name] ?? 'p0') !== page.id) continue;
          const f = atlas.frames[name]?.frame;
          if (!f || f.w !== geometry.size.width || f.h !== geometry.size.height || f.x < 0 || f.y < 0 || f.x + f.w > width || f.y + f.h > height) fileIssues.push(`${name}图集几何不完整`);
        }
        pages.push({ id: page.id, image: `${base}/${page.image}`, data: `${base}/${page.data}`, width, height, sha256: sha(png), rgbaBytes: width * height * 4 });
      }
      decoded = pixels(base, runtime);
    } catch (error) { fileIssues.push(`实际图集读取/解码失败：${error instanceof Error ? error.message : String(error)}`); }
  }
  const sourceRecords = Object.entries(authoring?.sources ?? {}).map(([id, source]) => {
    const original = receipt(source), evidence = receipt(source.modelEvidence), prompt = receipt(source.prompt);
    return { id, model: source.model, provider: source.provider, generatedAt: source.generatedAt, sessionUrl: source.sessionUrl, original, modelEvidence: evidence, prompt,
      ok: original.ok && evidence.ok && prompt.ok && source.model === 'GPT Image 2.5' && source.provider === 'chatgpt-web' && /^https:\/\/chatgpt\.com\//.test(source.sessionUrl) };
  });
  const idleHashes = Object.entries(decoded).filter(([name]) => name.startsWith(`${def.id}/idle/`)).map(([, data]) => data.sha256);
  const rows = [...Object.keys(DEFAULT_ANIMS).filter(name => name !== 'portrait').map(id => ({ id, kind: 'state' as const, move: undefined as MoveData | undefined })), ...def.moves.map(move => ({ id: move.id, kind: 'move' as const, move }))].map(({ id, kind, move }) => {
    const anim = runtime?.anims[id];
    const sourceAnim = authoring?.anims[id];
    const errors: string[] = [];
    const frames = Array.from({ length: anim?.frames ?? 0 }, (_, index) => {
      const name = `${def.id}/${id}/${index}`;
      const sourceFrameId = sourceAnim?.frames[index];
      const sourceFrame = sourceFrameId ? authoring?.frames[sourceFrameId] : undefined;
      const frameSources = inspectFrameSources(sourceFrame, sourceRecords);
      if (!sourceFrame) errors.push(`${name}缺少作者帧来源`);
      for (const sourceId of frameSources.invalidSources) errors.push(`${name}来源 ${sourceId} 的原图/证据/提示词未通过哈希核验`);
      if (!decoded[name] || decoded[name]?.empty) errors.push(`${name}缺少实际非空像素`);
      return { name, sourceFrameId: sourceFrameId ?? null, ...frameSources, sourceCrop: sourceFrame?.crop ?? null, transform: sourceFrame?.transform ?? null, page: runtime?.framePages?.[name] ?? 'p0', pixels: decoded[name] ?? null };
    });
    if (anim && (!sourceAnim || sourceAnim.frames.length !== anim.frames || JSON.stringify(sourceAnim.exposures) !== JSON.stringify(anim.exposures) || sourceAnim.loop !== anim.loop || JSON.stringify(sourceAnim.throwExposures) !== JSON.stringify(anim.throwExposures))) errors.push('作者清单与运行时帧/时序不一致');
    if (anim && phaseIdentity(sourceAnim?.airbornePhases) !== phaseIdentity(anim.airbornePhases)) errors.push('作者清单与运行时跳跃阶段不一致');
    const hashes = frames.flatMap(frame => frame.pixels ? [frame.pixels.sha256] : []);
    if (anim) errors.push(...inspectPoseOriginality(id, hashes, idleHashes, !!move));
    const visualTicks = anim?.exposures?.reduce((sum, exposure) => sum + exposure.ticks, 0) ?? null;
    if (move && anim && visualTicks !== totalFrames(move)) errors.push('出招视觉时长与实际逻辑不一致');
    return {
      id, name: move?.name ?? STATE_NAMES[id] ?? id, kind,
      status: !anim ? 'missing' as const : errors.length ? 'invalid' as const : 'covered' as const,
      errors: [...new Set(errors)], declaredFrames: anim?.frames ?? 0, uniquePixelPoses: new Set(hashes).size,
      sourceFiles: [...new Set(frames.flatMap(frame => [frame.sourceFile, ...frame.sourcePatches.map(patch => patch.sourceFile)].filter((file): file is string => file !== null)))], frames,
      visual: anim ? { loop: anim.loop, exposureTicks: visualTicks, exposures: anim.exposures ?? [], throwExposures: anim.throwExposures ?? null, airbornePhases: anim.airbornePhases ?? null } : null,
      logic: move ? { fixedTicks: totalFrames(move), text: `${totalFrames(move)}逻辑帧`, source: `src/characters/${def.id}/moves.ts`, phases: attackPhases(move), connectedThrowTicks: move.throwData ? move.throwData.duration ?? totalFrames(move) : null }
        : { ...stateDuration(def, id), phases: null, connectedThrowTicks: null },
    };
  });
  const sharedPoses = new Map<string, string[]>();
  for (const row of rows) for (const frame of row.frames) {
    if (!frame.pixels) continue;
    const names = sharedPoses.get(frame.pixels.sha256) ?? [];
    names.push(frame.name); sharedPoses.set(frame.pixels.sha256, names);
  }
  const reusedPoseGroups = [...sharedPoses.entries()].filter(([, names]) => new Set(names.map(name => name.split('/')[1])).size > 1).map(([hash, frames]) => ({ sha256: hash, frames, note: '相同实际像素跨动作共享；前后步法倒放可合理，含义不同的姿势需逐项内部检查' }));
  const full = runtime ? validateFullCoverage(def, runtime) : null;
  const count = (kind: 'state' | 'move') => ({ covered: rows.filter(row => row.kind === kind && row.status === 'covered').length, required: rows.filter(row => row.kind === kind).length, invalid: rows.filter(row => row.kind === kind && row.status === 'invalid').length });
  const gateReady = !!full?.ok && !fileIssues.length && rows.every(row => row.status === 'covered');
  return {
    id: def.id, name: def.name, runtimeFile, runtimeSha256: existsSync(resolve(ROOT, runtimeFile)) ? sha(readFileSync(resolve(ROOT, runtimeFile))) : null,
    sourceManifest: owner ? { file: owner.file, sha256: owner.sha256 } : null,
    textureDensity: runtime?.textureDensity ?? null, pages, rgbaBytes: pages.reduce((sum, page) => sum + page.rgbaBytes, 0),
    runtimeCoverageValid: full?.ok ?? false, productionCoverageGateReady: gateReady,
    visualAcceptance: 'not-inferred-from-coverage', stateCount: count('state'), moveCount: count('move'), fileIssues,
    structuralErrors: full?.errors ?? ['runtime未通过验证'], sourceRecords, sourceUsage: inspectSourceUsage(authoring), reusedPoseGroups, rows,
    unmapped: Object.entries({ ...(authoring?.referenceFrames_NOT_BUILT ?? {}), ...(authoring?.reviewFrames_NOT_BUILT ?? {}) }).map(([id, frame]) => ({ id, ...frame, sourceFile: authoring?.sources[frame.source]?.file ?? null, adopted: false })),
  };
}

export interface CoverageOptions { authorManifests?: readonly string[]; characterIds?: readonly string[]; reportJson?: string; reportMd?: string }

export function runAnimeCoverage(options: CoverageOptions = {}): boolean {
  const manifestFiles = options.authorManifests ?? ['scripts/anime_manifest.json'];
  const reportJson = options.reportJson ?? REPORT_JSON;
  const reportMd = options.reportMd ?? REPORT_MD;
  const reportJsonLink = relative(dirname(resolve(ROOT, reportMd)), resolve(ROOT, reportJson)).replaceAll('\\', '/');
  const { inputs, owners } = loadAuthoringManifests(manifestFiles);
  if (inputs.length > 1 && (!options.reportJson || !options.reportMd)) {
    throw new Error('多作者清单覆盖审计必须显式指定独立 --report-json 与 --report-md，不能覆盖旧报告');
  }
  const selected = options.characterIds ? [...new Set(options.characterIds)] : Object.keys(characters);
  const unknown = selected.filter(id => !characters[id]);
  if (unknown.length) throw new Error(`未知角色：${unknown.join('、')}`);
  const characterReports = selected.map(id => inspectCharacter(characters[id]!, owners.get(id)));
  const ready = characterReports.every(report => report.productionCoverageGateReady);
  const report = {
    generatedAt: new Date().toISOString(),
    sourceManifest: inputs.length === 1 ? { file: inputs[0]!.file, sha256: inputs[0]!.sha256 } : null,
    sourceManifests: inputs.map(input => ({ file: input.file, sha256: input.sha256, characters: Object.keys(input.authoring.characters).sort(), provenance: input.provenance })),
    productionCoverageGateReady: ready, visualAcceptance: 'requires-normal-speed-in-game-review',
    rules: ['从实际角色招式表和DEFAULT_ANIMS枚举，不以文件名或动画数量代替全覆盖', '逐帧核验实际图集/源码裁切映射及原图、型号证据、提示词哈希', '解码图集并对去透明边后的RGBA像素做哈希；复制/改名同一idle不会增加覆盖', '移动/攻击必须有至少两种不同实际姿势；合法静态站防、蹲防、KO不因单张自动判错', '相似/复用姿势留待内部画面检查；覆盖通过不等于画面、听感或好玩通过'],
    characters: characterReports,
  };
  mkdirSync(dirname(resolve(ROOT, reportJson)), { recursive: true });
  writeFileSync(resolve(ROOT, reportJson), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const lines = ['# 全动作技能覆盖', '', `生成时间：${report.generatedAt}。命令：\`npx vite-node scripts/checkAnimeCoverage.ts\`。`, '',
    `**完整动漫比赛的素材覆盖门槛：${ready ? '通过（仍须正常速度画面验收）' : '未通过，不能解除完整比赛限制'}。**`, '',
    '这份报告核查实际动漫人物图集、作者清单、原始图片和来源记录。招式覆盖指新人物的出招动作；已有战斗规则、独立技能特效和声音另行验收。已覆盖仅表示结构与来源可核验，不表示动作已经精美或真人复玩合格。缺少的动作保持缺少，不采用旧像素人物或重复站立图填充。', '',
    '| 角色 | 基础状态 | 招式 | 无效项 | 解码纹理内存 | 完整覆盖 |', '|---|---:|---:|---:|---:|---|',
    ...characterReports.map(char => `| ${char.name} | ${char.stateCount.covered}/${char.stateCount.required} | ${char.moveCount.covered}/${char.moveCount.required} | ${char.stateCount.invalid + char.moveCount.invalid} | ${(char.rgbaBytes / 1024 / 1024).toFixed(2)} MiB | ${char.productionCoverageGateReady ? '通过' : '未通过'} |`), '',
    '## 判定口径', '', ...report.rules.map(rule => `- ${rule}`), '',
    '招式“逻辑时长”来自当前MoveData，包含起手、发力段（多段攻击含中间间隔）与收招；有投射物时另外列出真实发射数。基础动作中的受击、跳跃、防御通常没有固定时长，不能把贴图播放时长冒充逻辑时长。纹理内存为RGBA解码字节，不代表整个进程或显卡总占用。', ''];
  for (const char of characterReports) {
    lines.push(`## ${char.name}`, '', `密度：${char.textureDensity ?? '未知'}；图集页：${char.pages.map(page => `${page.id} ${page.width}×${page.height}`).join('；') || '无'}。`, '', '| 动作 / 招式 | 状态 | 帧数 / 不同像素姿势 | 实际逻辑时长 | 原图 |', '|---|---|---:|---|---|');
    for (const row of char.rows) {
      const sources = row.sourceFiles.map(path => path.split('/').at(-1)).join('、') || '—';
      const status = row.status === 'covered' ? '已覆盖，待画面验收' : row.status === 'missing' ? '缺失' : '无效';
      const phases = row.logic.phases;
      const phaseText = phases?.startup !== null && phases?.startup !== undefined ? `；起手${phases.startup}/发力${phases.action}/收招${phases.recovery}` : '';
      const count = phases?.projectileCount ? `；${phases.projectileCount}发` : '';
      lines.push(`| ${row.name} \`${row.id}\` | ${status} | ${row.declaredFrames} / ${row.uniquePixelPoses} | ${row.logic.text}${phaseText}${count} | ${sources} |`);
    }
    lines.push('', '来源记录：', '', '| 原图 | 原图/型号证据/提示词哈希 | 网页会话 |', '|---|---|---|', ...char.sourceRecords.map(source => `| ${source.original.file?.split('/').at(-1) ?? source.id} | ${source.ok ? '均匹配' : '未通过'} | ${source.sessionUrl} |`), '');
    const issues = [...char.fileIssues, ...char.structuralErrors, ...char.rows.flatMap(row => row.errors.map(error => `${row.id}：${error}`))];
    if (issues.length) lines.push('未通过项：', '', ...issues.map(issue => `- ${issue}`), '');
    if (char.reusedPoseGroups.length) lines.push('跨动作实际像素共享（不自动判为错误）：', '', ...char.reusedPoseGroups.map(group => `- ${group.frames.join('、')}`), '');
    lines.push(`NOT_BUILT 保留的参考/候选记录：${char.unmapped.map(entry => entry.id).join('、') || '无'}。这些记录不增加完成数，也不代表同名动作当前缺失；逐原图引用及原状态见下方复核。`, '');
  }
  const cell = (value: string): string => value.replaceAll('|', '\\|').replace(/\r?\n/g, ' ');
  lines.push('## 现有原图可复用性复核', '',
    '早期复核范围：本报告初版曾记录两角色 basics、路飞 reaction 与人物母版的裁切、支撑和候选用途。那些观察属于早期制作记录，不是本次扫描重新看图所得，也不作为当前缺失动作清单。', '',
    '当前引用情况：下表从本次素材清单的 anims → frames → sources 导出，逐帧同时计入原图与 sourcePatches 补图，补图仅用于 NOT_BUILT 时不算正式引用。已引用只表示作者清单有映射；实际图集、来源与时序是否通过以上方逐动作结果为准。NOT_BUILT 是保留的参考/候选记录，不代表整张原图未使用，也不代表同名动作当前缺失。旧候选与新采用帧即使同名，也不据此认为是同一裁切或已被采用。脚本不推断尚未制作姿势能否靠裁切补齐。', '');
  for (const char of characterReports) {
    lines.push(`### ${char.name}：当前原图引用`, '', '| 原图 | 已映射动作 / 招式 | 已引用 / 未引用帧定义 | NOT_BUILT 保留记录及原状态 |', '|---|---|---:|---|');
    for (const source of char.sourceUsage) {
      const candidates = source.notBuilt.map(frame => `${frame.collection === 'referenceFrames_NOT_BUILT' ? '参考' : '复核'}/${frame.id}（${frame.status ?? '未标注状态'}）`).join('；') || '无';
      lines.push(`| ${cell(source.sourceFile?.split('/').at(-1) ?? `${source.id}（来源未声明）`)} | ${source.mappedAnimations.join('、') || '无当前映射'} | ${source.mappedFrames.length} / ${source.unreferencedFrames.length} | ${cell(candidates)} |`);
    }
    const missing = char.rows.filter(row => row.status === 'missing').map(row => row.id);
    const invalid = char.rows.filter(row => row.status === 'invalid').map(row => row.id);
    lines.push('', `本次实际覆盖缺失：${missing.join('、') || '无'}。已声明但无效：${invalid.join('、') || '无'}。候选原备注和未引用帧定义保留在 JSON 的 sourceUsage 中；不由本段增加完成数。`, '');
  }
  lines.push(
    `完整逐帧像素哈希、原图裁切、连接来源、逻辑帧、分页与未采用候选见[JSON明细](${reportJsonLink})。`, '',
    '脚本退出码：覆盖未通过为1，覆盖及来源检查通过为0。退出码不表达主观美术验收结果。', '');
  mkdirSync(dirname(resolve(ROOT, reportMd)), { recursive: true });
  writeFileSync(resolve(ROOT, reportMd), lines.join('\n'), 'utf8');
  console.log(JSON.stringify({ productionCoverageGateReady: ready, sourceManifests: report.sourceManifests, reports: [relativePath(resolve(ROOT, reportJson)), relativePath(resolve(ROOT, reportMd))], characters: characterReports.map(char => ({ id: char.id, sourceManifest: char.sourceManifest, states: char.stateCount, moves: char.moveCount, fileIssues: char.fileIssues })) }));
  return ready;
}

if (process.env.VITEST !== 'true') {
  const { values } = parseArgs({ options: {
    'author-manifest': { type: 'string', multiple: true }, character: { type: 'string', multiple: true },
    'report-json': { type: 'string' }, 'report-md': { type: 'string' },
  }, allowPositionals: false });
  const options: CoverageOptions = {};
  if (values['author-manifest']) options.authorManifests = values['author-manifest'];
  if (values.character) options.characterIds = values.character;
  if (values['report-json']) options.reportJson = values['report-json'];
  if (values['report-md']) options.reportMd = values['report-md'];
  process.exitCode = runAnimeCoverage(options) ? 0 : 1;
}
