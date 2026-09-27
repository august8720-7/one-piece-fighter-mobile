import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const children: ChildProcess[] = [];
afterEach(() => { for (const child of children.splice(0)) child.kill(); });

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'opf-launcher-identity-'));
  await mkdir(resolve(root, 'scripts'));
  await mkdir(resolve(root, 'dist'));
  await copyFile(resolve('scripts/playLocal.mjs'), resolve(root, 'scripts/playLocal.mjs'));
  await copyFile(resolve('scripts/openLocalUrl.mjs'), resolve(root, 'scripts/openLocalUrl.mjs'));
  await writeFile(resolve(root, 'dist/index.html'), '<title>One Piece Fighter</title><script src="game.js"></script>');
  await writeFile(resolve(root, 'dist/game.js'), 'const revision = 1;');
  return root;
}

async function freePort() {
  const server = createServer();
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test port');
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  return address.port;
}

function launch(root: string, port: number) {
  const child = spawn(process.execPath, [resolve(root, 'scripts/playLocal.mjs'), '--port', String(port), '--no-open'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let output = '';
  child.stdout?.on('data', data => { output += String(data); });
  child.stderr?.on('data', data => { output += String(data); });
  const exited = new Promise<number | null>((done, reject) => { child.once('error', reject); child.once('exit', done); });
  return { child, exited, output: () => output };
}

async function waitStarted(run: ReturnType<typeof launch>) {
  await expect.poll(run.output, { timeout: 5000, interval: 30 }).toContain('One Piece Fighter: http://127.0.0.1:');
}

describe('local game launcher build identity', () => {
  it('reuses the identical full build and refuses a new build behind the same title and index', async () => {
    const root = await fixture(); const port = await freePort();
    const running = launch(root, port); await waitStarted(running);
    const before = await fetch(`http://127.0.0.1:${port}/`);
    expect(before.status).toBe(200);
    expect(before.headers.get('x-opf-build')).toMatch(/^[a-f0-9]{64}$/);
    expect(before.headers.get('cache-control')).toBe('no-store');
    const repeated = launch(root, port);
    expect(await repeated.exited).toBe(0);
    expect(repeated.output()).toContain('One Piece Fighter:');
    await writeFile(resolve(root, 'dist/game.js'), 'const revision = 2;');
    const newer = launch(root, port);
    expect(await newer.exited).toBe(1);
    expect(newer.output()).toContain('another app or game build');
    const stale = await fetch(`http://127.0.0.1:${port}/game.js`);
    expect(stale.status).toBe(409);
    expect(await stale.text()).toContain('Stop and restart');
  }, 10000);

  it('rejects a same-title server without verified build identity', async () => {
    const root = await fixture();
    const server = createServer((_request, response) => response.end('<title>One Piece Fighter</title><script src="game.js"></script>'));
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing port');
      const rejected = launch(root, address.port);
      expect(await rejected.exited).toBe(1);
      expect(rejected.output()).toContain('another app or game build');
    } finally { await new Promise<void>(done => server.close(() => done())); }
  }, 10000);
});
