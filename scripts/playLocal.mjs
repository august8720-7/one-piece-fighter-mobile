import { createServer } from 'node:http';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openLocalUrl } from './openLocalUrl.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const portArg = process.argv.indexOf('--port');
const port = portArg < 0 ? 4173 : Number(process.argv[portArg + 1]);
const url = `http://127.0.0.1:${port}/`;
const noOpen = process.argv.includes('--no-open');
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.wav': 'audio/wav',
  '.webp': 'image/webp', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.webm': 'video/webm',
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const samePath = (left, right) => process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
const fileKey = path => relative(root, path).split(sep).join('/');
const files = new Map();

async function verifyLocation(path) {
  if (!samePath(await realpath(root), root) || (await lstat(root)).isSymbolicLink()) throw new Error('Build directory must not be a link.');
  let current = root;
  for (const part of relative(root, path).split(sep).filter(Boolean)) {
    current = resolve(current, part);
    if ((await lstat(current)).isSymbolicLink() || !samePath(await realpath(current), current)) throw new Error('Build files must not be links.');
  }
}

async function snapshot(directory) {
  for (const name of (await readdir(directory)).sort()) {
    const path = resolve(directory, name);
    await verifyLocation(path);
    const stat = await lstat(path);
    if (stat.isDirectory()) await snapshot(path);
    else if (stat.isFile()) {
      const data = await readFile(path);
      files.set(fileKey(path), { size: data.length, hash: hash(data) });
    } else throw new Error('Build contains an unsupported file.');
  }
}

function openGame() {
  console.log(`One Piece Fighter: ${url}`);
  console.log('Keep this window open while playing. Press Ctrl+C to stop the local server.');
  if (noOpen) return;
  openLocalUrl(url);
}

if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid local port.');
let identity;
try {
  await verifyLocation(root);
  await snapshot(root);
  if (!files.has('index.html')) throw new Error('Missing build index.');
  identity = hash(JSON.stringify([...files].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)));
} catch {
  console.error('The game build is missing or cannot be read safely. Restore a complete local build before starting.');
  process.exit(1);
}
const indexHash = files.get('index.html').hash;

const server = createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method ?? '')) { response.writeHead(405).end(); return; }
  let path;
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', url).pathname);
    path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  } catch { response.writeHead(400).end(); return; }
  if (!path.startsWith(root + sep)) { response.writeHead(403).end(); return; }
  const expected = files.get(fileKey(path));
  if (!expected) { response.writeHead(404).end('Not found'); return; }
  try {
    await verifyLocation(path);
    const data = await readFile(path);
    if (data.length !== expected.size || hash(data) !== expected.hash) {
      response.writeHead(409, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
        .end('Game build changed. Stop and restart the local game launcher.');
      return;
    }
    response.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'Content-Length': data.length, 'X-OPF-Build': identity });
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch { response.writeHead(404).end('Not found'); }
});

server.on('error', async (error) => {
  if (error.code === 'EADDRINUSE') {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000), cache: 'no-store' });
      if (response.ok && response.headers.get('x-opf-build') === identity && hash(Buffer.from(await response.arrayBuffer())) === indexHash) { openGame(); return; }
    } catch { /* Show the occupied-port message below. */ }
    console.error(`Port ${port} is serving another app or game build. Stop its old server, or run node scripts/playLocal.mjs --port 4174`);
  } else console.error(error.message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', openGame);
