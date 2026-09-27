import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const children: ChildProcess[] = [];
afterEach(() => { for (const child of children.splice(0)) child.kill(); });

describe('2.0 and frozen 1.0 local routing', () => {
  it('serves the separate frozen page and refuses runtime mutation without restarting', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'opf-v2-rollback-'));
    await mkdir(resolve(root, 'scripts'));
    for (const name of ['playCandidate.mjs', 'openLocalUrl.mjs']) await copyFile(resolve('scripts', name), resolve(root, 'scripts', name));
    const build = resolve(root, '.local-releases/操作演出-0922/playable');
    await mkdir(resolve(build, 'v1'), { recursive: true });
    await writeFile(resolve(build, 'index.html'), '<h1>2.0</h1>');
    await writeFile(resolve(build, 'v1/index.html'), '<h1>1.0 frozen</h1>');
    const allocator = createServer();
    await new Promise<void>(done => allocator.listen(0, '127.0.0.1', done));
    const address = allocator.address();
    if (!address || typeof address === 'string') throw new Error('Missing test port');
    await new Promise<void>(done => allocator.close(() => done()));
    const child = spawn(process.execPath, [resolve(root, 'scripts/playCandidate.mjs'), '--release', 'candidate-0922', '--full', '--no-open', '--port', String(address.port)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    let log = '';
    child.stdout?.on('data', data => { log += String(data); });
    child.stderr?.on('data', data => { log += String(data); });
    await expect.poll(() => log, { timeout: 5000 }).toContain('完整动漫候选');
    const base = `http://127.0.0.1:${address.port}`;
    expect(await (await fetch(base + '/')).text()).toBe('<h1>2.0</h1>');
    expect(await (await fetch(base + '/v1/')).text()).toBe('<h1>1.0 frozen</h1>');
    const first = await fetch(base + '/v1/index.html');
    expect(first.headers.get('x-opf-candidate')).toMatch(/^[a-f0-9]{64}$/);
    await writeFile(resolve(build, 'v1/index.html'), 'accidental overwrite');
    expect((await fetch(base + '/v1/')).status).toBe(409);
    expect((await fetch(base + '/not-in-snapshot.txt')).status).toBe(404);
  }, 10000);
});
