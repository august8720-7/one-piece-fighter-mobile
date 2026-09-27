import { createServer } from 'node:http';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openLocalUrl } from './openLocalUrl.mjs';

const releaseIndex = process.argv.indexOf('--release');
const release = releaseIndex < 0 ? 'candidate-0912' : process.argv[releaseIndex + 1];
if (!['candidate-0912', 'candidate-0913', 'candidate-0914', 'candidate-0915', 'candidate-0922', 'candidate-crossover-0922', 'classic-1', 'classic-2'].includes(release)) throw new Error('Unknown local candidate release.');
const full = process.argv.includes('--full');
if (full && release === 'candidate-0912') throw new Error('--full requires a complete candidate release.');
const releasePaths = { 'candidate-0922': '操作演出-0922/playable', 'classic-1': '操作演出-0922/baseline/v1', 'candidate-0915': '加载提速-0915/playable', 'candidate-0914': '声音修复-0914/candidate' };
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const crossoverRoot = resolve(process.env.OPF_CROSSOVER_ROOT ?? 'D:/one-piece-fighter-crossover-0922');
const externalPaths = { 'candidate-crossover-0922': resolve(crossoverRoot, 'playable'), 'classic-2': resolve(crossoverRoot, 'baseline/v2') };
const root = externalPaths[release] ?? resolve(projectRoot, '.local-releases', releasePaths[release] ?? release);
const portIndex = process.argv.indexOf('--port');
const defaultPorts = { 'candidate-crossover-0922': 4182, 'classic-2': 4183, 'candidate-0922': 4180, 'classic-1': 4181, 'candidate-0915': 4179, 'candidate-0914': 4178, 'candidate-0913': 4177 };
const port = portIndex < 0 ? defaultPorts[release] ?? 4176 : Number(process.argv[portIndex + 1]);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid local port.');
const origin = `http://127.0.0.1:${port}`;
const url = `${origin}/${full ? '?art=anime&scope=full&quality=high' : '?art=anime&mode=training'}`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.webm': 'video/webm',
};
const samePath = (left, right) => process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
const fileKey = path => relative(root, path).split(sep).join('/');
const files = new Map();
class CandidateBoundaryError extends Error {}

/** Reject links in the root, its ancestors, and every requested path component. */
async function verifyLocation(path) {
  if (!samePath(await realpath(root), root) || (await lstat(root)).isSymbolicLink()) {
    throw new CandidateBoundaryError('候选目录不能使用符号链接或目录联接。');
  }
  let current = root;
  for (const part of relative(root, path).split(sep).filter(Boolean)) {
    current = resolve(current, part);
    if ((await lstat(current)).isSymbolicLink() || !samePath(await realpath(current), current)) {
      throw new CandidateBoundaryError('候选文件不能使用符号链接或目录联接。');
    }
  }
}

async function snapshot(directory) {
  for (const name of (await readdir(directory)).sort()) {
    const path = resolve(directory, name);
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !samePath(await realpath(path), path)) {
      throw new CandidateBoundaryError(`候选目录含链接，无法启动：${fileKey(path)}`);
    }
    if (stat.isDirectory()) await snapshot(path);
    else if (stat.isFile()) {
      const data = await readFile(path);
      files.set(fileKey(path), { size: data.length, hash: hash(data) });
    } else throw new CandidateBoundaryError(`候选目录含非常规文件：${fileKey(path)}`);
  }
}

let identity;
try {
  await verifyLocation(root);
  await snapshot(root);
  if (!files.has('index.html')) throw new Error('Missing candidate index');
  // Static public files have stable names, so the complete bundle owns the identity.
  identity = hash(JSON.stringify([...files].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)));
} catch (error) {
  console.error(error instanceof CandidateBoundaryError ? error.message : '新版候选尚未构建或无法完整读取。旧可玩版可运行 node scripts/playLocal.mjs 启动。');
  process.exit(1);
}
const indexHash = files.get('index.html').hash;

function openCandidate() {
  const label = release === 'classic-1' ? '冻结1.0完整动漫版' : release === 'classic-2' ? '冻结2.0完整动漫版' : full ? '完整动漫候选' : '新版限定动作样板';
  console.log(`${label}：${url}`);
  console.log('保留此窗口；按 Ctrl+C 停止本地服务。此入口不会构建、安装依赖或发布。');
  if (process.argv.includes('--no-open')) return;
  openLocalUrl(url);
}

const server = createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method ?? '')) { response.writeHead(405).end(); return; }
  let path;
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', origin).pathname);
    path = resolve(root, `.${pathname.endsWith('/') ? pathname + 'index.html' : pathname}`);
  } catch { response.writeHead(400).end(); return; }
  if (!path.startsWith(root + sep)) { response.writeHead(403).end(); return; }
  const expected = files.get(fileKey(path));
  if (!expected) { response.writeHead(404).end('Not found'); return; }
  try {
    await verifyLocation(path);
    const data = await readFile(path);
    if (data.length !== expected.size || hash(data) !== expected.hash) {
      response.writeHead(409, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
        .end('候选文件已变更，请停止并重新启动此候选入口。');
      return;
    }
    response.writeHead(200, {
      'Content-Type': types[extname(path)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store', 'Content-Length': data.length,
      'X-OPF-Candidate': identity,
    });
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch (error) {
    response.writeHead(error instanceof CandidateBoundaryError ? 403 : 404).end('Not found');
  }
});

server.on('error', async error => {
  if (error.code === 'EADDRINUSE') {
    try {
      const response = await fetch(`${origin}/`, { signal: AbortSignal.timeout(2000), cache: 'no-store' });
      if (response.ok && response.headers.get('x-opf-candidate') === identity && hash(Buffer.from(await response.arrayBuffer())) === indexHash) {
        openCandidate(); return;
      }
    } catch { /* Report a different or unreachable local server below. */ }
    console.error(`端口 ${port} 已被其他服务占用。请关闭其他服务，或尝试 node scripts/playCandidate.mjs --release ${release}${full ? ' --full' : ''} --port ${port === 65535 ? 65534 : port + 1}。`);
  } else console.error(error.message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', openCandidate);
