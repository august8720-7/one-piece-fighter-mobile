import { createHash } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { linkSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createMobilePackage, verifyPackagedSite, type MobilePackageManifest } from '../../scripts/packageMobile.mjs';
import { createMobileHandler } from '../../scripts/serveMobile.mjs';
import { verifyDesktopBaseline } from '../../scripts/verifyDesktopBaseline.mjs';

const hash = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const write = (root: string, relative: string, data: Buffer | string) => {
  const file = path.join(root, ...relative.split('/'));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, data);
  return file;
};

function fixture() {
  // Keep fixtures for failure inspection; no user directory is removed by these tests.
  const root = mkdtempSync(path.join(os.tmpdir(), 'opf-mobile-release-'));
  const project = path.join(root, 'project');
  const candidate = path.join(root, 'candidate', 'site');
  const outputRoot = path.join(root, 'packages');
  mkdirSync(project, { recursive: true });
  mkdirSync(candidate, { recursive: true });
  const delivery = new Map<string, [string, string]>([
    ['assets/characters/labubu/anime/runtime.json', ['assets/delivery/runtime-test.json', '{"characterId":"labubu"}']],
    ['assets/characters/labubu/anime/ui.png', ['assets/delivery/ui-test.webp', 'webp-test-bytes']],
  ]);
  const records: Record<string, unknown> = {};
  for (const [logical, [physical, content]] of delivery) {
    records[logical] = { file: physical, bytes: Buffer.byteLength(content), sha256: hash(content), contentType: physical.endsWith('.json') ? 'application/json' : 'image/webp', source: logical, sourceSha256: hash(`original-${logical}`) };
    write(candidate, physical, content);
  }
  const legacy = [
    ...['luffy', 'akainu'].flatMap(id => ['atlas.png', 'atlas.json', 'placeholder.png', 'placeholder.json'].map(name => `assets/characters/${id}/${name}`)),
    'assets/audio/music/CREDITS.txt',
  ];
  for (const file of legacy) {
    write(candidate, file, `fixture:${file}`);
    write(project, `public/${file}`, `fixture:${file}`);
  }
  const version = 'a'.repeat(64);
  write(project, 'src/render/deliveryManifest.json', JSON.stringify({ version, records }));
  write(project, 'src/render/anime/uiArtManifest.json', JSON.stringify({ characters: { labubu: { image: 'assets/characters/labubu/anime/ui.png', enabled: true } } }));
  write(candidate, 'delivery-build.json', JSON.stringify({ version, files: [...delivery.values()].map(value => value[0]).concat(legacy).sort() }));
  write(candidate, 'index.html', '<!doctype html><link href="./assets/main.css" rel="stylesheet"><script type="module" src="./assets/index.js"></script>');
  write(candidate, 'assets/index.js', 'import "./chunk.js"; window.game = true;');
  write(candidate, 'assets/chunk.js', 'export const play = true;');
  write(candidate, 'assets/main.css', 'body{background:#000}');
  write(candidate, 'assets/index.js.map', 'source map must not ship');
  write(candidate, 'connection-check.html', 'developer probe must not ship');
  return { root, project, candidate, outputRoot, delivery };
}

describe('mobile release boundary', () => {
  const servers: ReturnType<typeof createServer>[] = [];
  afterAll(async () => { await Promise.all(servers.map(server => new Promise<void>(resolve => server.close(() => resolve())))); });

  it('packages only compiled entry closure and hash-verified delivery inventory', () => {
    const f = fixture();
    const result = createMobilePackage({ projectRoot: f.project, candidate: f.candidate, outputRoot: f.outputRoot, now: new Date('2026-09-27T12:00:00Z') });
    expect(result.files.map((entry: { file: string }) => entry.file)).toContain('assets/chunk.js');
    expect(result.files.map((entry: { file: string }) => entry.file)).not.toContain('connection-check.html');
    expect(result.files.map((entry: { file: string }) => entry.file)).not.toContain('assets/index.js.map');
    expect(verifyPackagedSite(result.release).fileCount).toBe(result.files.length);
    const before = JSON.parse(readFileSync(path.join(result.release, 'copy-before.json'), 'utf8')) as { files: Array<{ file: string; sha256: string }> };
    expect(before.files.find(row => row.file === 'assets/index.js')?.sha256).toBe(hash('import "./chunk.js"; window.game = true;'));
  });

  it('rejects delivery corruption, unexpected inventory and development entry', () => {
    const f = fixture();
    write(f.candidate, 'assets/delivery/ui-test.webp', 'corrupt');
    expect(() => createMobilePackage({ projectRoot: f.project, candidate: f.candidate, outputRoot: f.outputRoot })).toThrow(/Delivery bytes changed/);
    const good = fixture();
    write(good.candidate, 'delivery-build.json', JSON.stringify({ version: 'a'.repeat(64), files: ['connection-check.html'] }));
    expect(() => createMobilePackage({ projectRoot: good.project, candidate: good.candidate, outputRoot: good.outputRoot })).toThrow(/inventory|match/);
    const dev = fixture();
    write(dev.candidate, 'index.html', '<script src="./connection-check.html"></script>');
    expect(() => createMobilePackage({ projectRoot: dev.project, candidate: dev.candidate, outputRoot: dev.outputRoot })).toThrow(/Development entry/);
    const legacy = fixture();
    write(legacy.candidate, 'assets/characters/luffy/atlas.png', 'changed old runtime');
    expect(() => createMobilePackage({ projectRoot: legacy.project, candidate: legacy.candidate, outputRoot: legacy.outputRoot })).toThrow(/Legacy runtime bytes changed/);
  });

  it('recurses dynamic JS, escaped specifiers, Vite dependency arrays and CSS imports', () => {
    const f = fixture();
    write(f.candidate, 'assets/index.js', 'import "./chunks/entry.js"; const lazy = () => import("./la\\u007ay.js"); const deps = ["assets/lazy.css"]; /* "./not-a-dependency.js" */');
    write(f.candidate, 'assets/chunks/entry.js', 'export { play } from "../deep.js";');
    write(f.candidate, 'assets/deep.js', 'export const play = true;');
    write(f.candidate, 'assets/lazy.js', 'export const lazy = true;');
    write(f.candidate, 'assets/lazy.css', '@import "./styles/theme.css";');
    write(f.candidate, 'assets/styles/theme.css', '@import url("../palette.css"); body{background-image:url("../delivery/ui-test.webp")}');
    write(f.candidate, 'assets/palette.css', 'body{color:white}');
    const result = createMobilePackage({ projectRoot: f.project, candidate: f.candidate, outputRoot: f.outputRoot });
    expect(result.files.map(entry => entry.file)).toEqual(expect.arrayContaining([
      'assets/chunks/entry.js', 'assets/deep.js', 'assets/lazy.js', 'assets/lazy.css', 'assets/styles/theme.css', 'assets/palette.css',
    ]));
    expect(result.files.map(entry => entry.file)).not.toContain('assets/chunk.js');
    expect(verifyPackagedSite(result.release).fileCount).toBe(result.fileCount);
  });

  it.each(['./connection-check.js', './ConnectionProbe-hidden.js', './probe.js', './sources/raw.js', '../outside.js', 'https://example.invalid/module.js', '/assets/chunk.js', 'node:fs', './source.ts'])(
    'rejects a forbidden compiled dependency %s', reference => {
      const f = fixture();
      write(f.candidate, 'assets/index.js', `import ${JSON.stringify(reference)};`);
      expect(() => createMobilePackage({ projectRoot: f.project, candidate: f.candidate, outputRoot: f.outputRoot })).toThrow(/runtime path|compiled reference|compiled dependency/);
    },
  );

  it('rejects computed imports, undeclared HTML preload and undeclared CSS media', () => {
    const f = fixture();
    write(f.candidate, 'assets/index.js', 'void import(window.modulePath);');
    expect(() => createMobilePackage({ projectRoot: f.project, candidate: f.candidate, outputRoot: f.outputRoot })).toThrow(/Computed module import/);
    const html = fixture();
    write(html.candidate, 'index.html', '<script src="./assets/index.js"></script><link href="./assets/delivery/not-in-inventory.webp">');
    expect(() => createMobilePackage({ projectRoot: html.project, candidate: html.candidate, outputRoot: html.outputRoot })).toThrow(/Unexpected HTML asset/);
    const css = fixture();
    write(css.candidate, 'assets/main.css', 'body{background:url("./delivery/not-in-inventory.webp")}');
    expect(() => createMobilePackage({ projectRoot: css.project, candidate: css.candidate, outputRoot: css.outputRoot })).toThrow(/explicit release rule/);
  });

  it('refuses linked source directories, hard links and linked output roots', () => {
    const linked = fixture();
    const external = path.join(linked.root, 'external');
    write(external, 'escape.js', 'export const secret = false;');
    symlinkSync(external, path.join(linked.candidate, 'assets/linked'), process.platform === 'win32' ? 'junction' : 'dir');
    write(linked.candidate, 'assets/index.js', 'import "./linked/escape.js";');
    expect(() => createMobilePackage({ projectRoot: linked.project, candidate: linked.candidate, outputRoot: linked.outputRoot })).toThrow(/Linked release path/);
    const hard = fixture();
    linkSync(path.join(hard.candidate, 'assets/chunk.js'), path.join(hard.root, 'retained-hardlink.js'));
    expect(() => createMobilePackage({ projectRoot: hard.project, candidate: hard.candidate, outputRoot: hard.outputRoot })).toThrow(/Linked release file/);
    const output = fixture();
    const linkedOutput = path.join(output.root, 'linked-output');
    mkdirSync(output.outputRoot);
    symlinkSync(output.outputRoot, linkedOutput, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => createMobilePackage({ projectRoot: output.project, candidate: output.candidate, outputRoot: linkedOutput })).toThrow(/Linked package output ancestor/);
  });

  it('does not overwrite an existing time-stamped package', () => {
    const f = fixture();
    const options = { projectRoot: f.project, candidate: f.candidate, outputRoot: f.outputRoot, now: new Date('2026-09-27T12:00:00Z') };
    const result = createMobilePackage(options);
    const originalManifest = readFileSync(path.join(result.release, 'package-manifest.json'));
    expect(() => createMobilePackage(options)).toThrow(/existing package destination/);
    expect(readFileSync(path.join(result.release, 'package-manifest.json')).equals(originalManifest)).toBe(true);
  });

  it('serves only listed immutable bytes with GET, HEAD and single ranges', async () => {
    const f = fixture();
    const result = createMobilePackage({ projectRoot: f.project, candidate: f.candidate, outputRoot: f.outputRoot });
    const server = createServer(createMobileHandler(result.release));
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No local test address');
    const base = `http://127.0.0.1:${address.port}`;
    const page = await fetch(base);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('assets/index.js');
    const head = await fetch(`${base}/assets/index.js`, { method: 'HEAD', headers: { Range: 'bytes=0-5' } });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-type')).toContain('javascript');
    expect(head.headers.get('content-length')).toBe(String(Buffer.byteLength('import "./chunk.js"; window.game = true;')));
    expect(await head.text()).toBe('');
    const post = await fetch(`${base}/`, { method: 'POST' });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD');
    const partial = await fetch(`${base}/assets/index.js`, { headers: { Range: 'bytes=0-5' } });
    expect(partial.status).toBe(206);
    expect(partial.headers.get('content-range')).toMatch(/^bytes 0-5\//);
    expect(await partial.text()).toBe('import');
    expect((await fetch(`${base}/connection-check.html`)).status).toBe(404);
    expect((await fetch(`${base}/assets/index.js.map`)).status).toBe(404);
    const suffix = await fetch(`${base}/assets/index.js`, { headers: { Range: 'bytes=-5' } });
    expect(suffix.status).toBe(206);
    expect(await suffix.text()).toBe('true;');
    const open = await fetch(`${base}/assets/index.js`, { headers: { Range: 'bytes=7-' } });
    expect(open.status).toBe(206);
    expect(await open.text()).toBe('"./chunk.js"; window.game = true;');
    const capped = await fetch(`${base}/assets/index.js`, { headers: { Range: 'bytes=0-9999' } });
    expect(capped.status).toBe(206);
    expect(await capped.text()).toBe('import "./chunk.js"; window.game = true;');
    for (const range of ['', 'bytes=9000-10000', 'bytes=1-0', 'bytes=-0', 'bytes=0-1,5-6', 'bytes=9007199254740992-']) {
      expect((await fetch(`${base}/assets/index.js`, { headers: { Range: range } })).status).toBe(416);
    }
    for (const rawPath of ['/%2e%2e/assets/index.js', '/assets/../index.js', '/assets%5cindex.js', '/assets/%00index.js', '/assets/%ZZ', '//assets/index.js']) {
      const traversalStatus = await new Promise<number>((resolve, reject) => {
        const request = httpRequest({ hostname: '127.0.0.1', port: address.port, path: rawPath }, response => {
          response.resume();
          response.on('end', () => resolve(response.statusCode ?? 0));
        });
        request.on('error', reject);
        request.end();
      });
      expect(traversalStatus).toBe(400);
    }
    linkSync(path.join(result.site, 'assets/chunk.js'), path.join(f.root, 'linked-after-start.js'));
    expect((await fetch(`${base}/assets/chunk.js`)).status).toBe(409);
    write(path.join(result.release, 'site'), 'assets/index.js', 'tampered after server start');
    expect((await fetch(`${base}/assets/index.js`)).status).toBe(409);
  });

  it('refuses files added outside the package manifest', () => {
    const f = fixture();
    const result = createMobilePackage({ projectRoot: f.project, candidate: f.candidate, outputRoot: f.outputRoot });
    write(path.join(result.release, 'site'), 'connection-check.html', 'not allowed');
    expect(() => verifyPackagedSite(result.release)).toThrow(/Unlisted file/);
  });

  it('rejects forged manifest totals and entries outside the actual dependency closure', () => {
    const f = fixture();
    const result = createMobilePackage({ projectRoot: f.project, candidate: f.candidate, outputRoot: f.outputRoot });
    const manifestPath = path.join(result.release, 'package-manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as MobilePackageManifest;
    manifest.totalBytes += 1;
    writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(() => verifyPackagedSite(result.release)).toThrow(/Incomplete mobile package manifest/);
    manifest.totalBytes -= 1;
    const content = 'export const unreferenced = true;';
    write(result.site, 'assets/unreferenced.js', content);
    manifest.files.push({ file: 'assets/unreferenced.js', bytes: Buffer.byteLength(content), sha256: hash(content) });
    manifest.fileCount += 1;
    manifest.totalBytes += Buffer.byteLength(content);
    writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(() => verifyPackagedSite(result.release)).toThrow(/outside the entry dependency closure/);
  });

  it('validates immutable imported source bytes and optional runtime files', () => {
    const f = fixture();
    const source = 'export const RULES = 60;';
    write(f.project, 'src/core/rules.ts', source);
    write(f.project, 'src/characters/labubu/def.ts', 'export const hp = 1000;');
    write(f.project, 'public/assets/delivery/runtime-test.json', 'runtime');
    const imported: Array<[string, string, string]> = [
      ['src/core/rules.ts', source, 'git:' + 'b'.repeat(40)],
      ['src/characters/labubu/def.ts', 'export const hp = 1000;', 'git:' + 'b'.repeat(40)],
      ['public/assets/delivery/runtime-test.json', 'runtime', 'runtime-whitelist:ccccccc'],
      ['public/assets/characters/luffy/placeholder.png', 'fixture:assets/characters/luffy/placeholder.png', 'git:' + 'b'.repeat(40)],
    ];
    const files = imported.map(([file, data, sourceKind]) => ({ file, bytes: Buffer.byteLength(data), sha256: hash(data), source: sourceKind }));
    const manifestPath = write(f.project, 'docs/桌面导入清单0927.json', JSON.stringify({ sourceCommit: 'b'.repeat(40), pagesCommit: 'c'.repeat(40), files }));
    expect(verifyDesktopBaseline({ projectRoot: f.project, manifestPath }).checkedCount).toBe(2);
    expect(verifyDesktopBaseline({ projectRoot: f.project, includeRuntime: true }).checkedCount).toBe(4);
    write(f.project, 'src/core/rules.ts', 'changed');
    expect(() => verifyDesktopBaseline({ projectRoot: f.project, manifestPath })).toThrow(/bytes changed/);
    write(f.project, 'src/core/rules.ts', source);
    write(f.project, 'src/core/unlisted.ts', 'export const changedRules = true;');
    expect(() => verifyDesktopBaseline({ projectRoot: f.project, manifestPath })).toThrow(/Unlisted file/);
  });
});
