import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strictFile, verifyPackagedSite } from './packageMobile.mjs';

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif',
  '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.bin': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8',
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function requestPath(url) {
  const raw = (url ?? '/').split('?', 1)[0];
  let decoded;
  try { decoded = decodeURIComponent(raw); } catch { throw new Error('Malformed URL'); }
  if (!decoded.startsWith('/') || decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some(part => part === '..' || part === '.') || decoded.includes('//')) throw new Error('Unsafe URL path');
  return decoded === '/' ? 'index.html' : decoded.slice(1);
}

function byteRange(header, length) {
  if (header === undefined) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) throw new Error('Unsupported byte range');
  let start, end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) throw new Error('Invalid suffix range');
    start = Math.max(0, length - suffix);
    end = length - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : length - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= length || end < start) throw new Error('Unsatisfiable byte range');
  return { start, end: Math.min(end, length - 1) };
}

export function createMobileHandler(release) {
  const manifest = verifyPackagedSite(release);
  const site = path.resolve(release, 'site');
  const allowed = new Map(manifest.files.map(row => [row.file, row]));
  return (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return;
    }
    let file;
    try { file = requestPath(request.url); } catch { response.writeHead(400); response.end(); return; }
    const entry = allowed.get(file);
    if (!entry) { response.writeHead(404); response.end(); return; }
    let bytes;
    try { bytes = readFileSync(strictFile(site, file)); }
    catch { response.writeHead(409); response.end(); return; }
    if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) { response.writeHead(409); response.end(); return; }
    let range;
    // Range applies to GET; HEAD reports the same full representation metadata.
    try { range = byteRange(request.method === 'GET' ? request.headers.range : undefined, bytes.length); }
    catch { response.writeHead(416, { 'Content-Range': `bytes */${bytes.length}` }); response.end(); return; }
    const body = range ? bytes.subarray(range.start, range.end + 1) : bytes;
    const headers = { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream', 'Content-Length': body.length, 'Accept-Ranges': 'bytes' };
    if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${bytes.length}`;
    response.writeHead(range ? 206 : 200, headers);
    response.end(request.method === 'HEAD' ? undefined : body);
  };
}

export function lanAddresses(port) {
  return Object.values(networkInterfaces()).flatMap(entries => entries ?? [])
    .filter(item => item.family === 'IPv4' && !item.internal)
    .map(item => `http://${item.address}:${port}/`);
}

function cliArgs(args) {
  let release, port = 4184, lan = false;
  let hasPort = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--package' && !release && args[i + 1] && !args[i + 1].startsWith('--')) release = args[++i];
    else if (args[i] === '--port' && !hasPort && /^\d+$/.test(args[i + 1] ?? '')) { port = Number(args[++i]); hasPort = true; }
    else if (args[i] === '--lan' && !lan) lan = true;
    else throw new Error(`Unknown serve option: ${args[i]}`);
  }
  if (!release || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Usage: serveMobile --package <package root> [--port 4184] [--lan]');
  return { release, port, lan };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { release, port, lan } = cliArgs(process.argv.slice(2));
    const server = createServer(createMobileHandler(release));
    server.on('error', error => { console.error(`Local mobile server failed: ${error.message}`); process.exitCode = 1; });
    const host = lan ? '0.0.0.0' : '127.0.0.1';
    server.listen(port, host, () => {
      console.log(JSON.stringify({ host, port, local: `http://127.0.0.1:${port}/`, lan: lan ? lanAddresses(port) : [], package: path.resolve(release) }));
    });
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
