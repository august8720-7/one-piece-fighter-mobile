import { createHash } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Offline packaging only. Publishing remains an explicit, separate Git operation.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(root, process.argv[2] ?? '.local-releases/candidate-0913');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputRoot = path.resolve(process.argv[3] ?? path.join(root, '.local-releases', '公开部署-0914'));
const release = path.join(outputRoot, stamp);
const site = path.join(release, 'site');
const files = new Set(['index.html']);
const rollbackFiles = new Map();
const readJson = file => JSON.parse(readFileSync(file, 'utf8'));
const hash = data => createHash('sha256').update(data).digest('hex');
const safePath = (base, relative) => {
  if (!relative || relative.includes('\\') || relative.split('/').includes('..') || path.isAbsolute(relative)) throw new Error(`Unsafe path: ${relative}`);
  const resolved = path.resolve(base, relative);
  if (!resolved.startsWith(`${base}${path.sep}`)) throw new Error(`Path outside package: ${relative}`);
  return resolved;
};
const runtimeFile = /^(index\.html|delivery-build\.json|\.nojekyll|\.gitattributes|assets\/[a-zA-Z0-9_./-]+\.(js|css|json|png|webp|avif|bin|ogg|wav|mp3|txt))$/;
const loadFrozen = (flag, mount, allowNestedV1 = false) => {
  const snapshotIndex = process.argv.indexOf(flag);
  if (snapshotIndex < 0) return;
  if (!process.argv[snapshotIndex + 1]) throw new Error(`Missing ${flag} snapshot`);
  const snapshotRoot = path.resolve(process.argv[snapshotIndex + 1]);
  const verified = readJson(snapshotRoot + '-verified.json');
  if (!verified.verified || path.resolve(verified.destination) !== snapshotRoot || !Array.isArray(verified.files)) throw new Error(`Unverified ${mount} snapshot`);
  const seen = new Set();
  for (const entry of verified.files) {
    if (!entry || typeof entry.file !== 'string' || seen.has(entry.file)) throw new Error(`Invalid ${mount} snapshot inventory`);
    seen.add(entry.file);
    const candidate = allowNestedV1 && entry.file.startsWith('v1/') ? entry.file.slice(3) : entry.file;
    if (!runtimeFile.test(candidate) || (!allowNestedV1 && entry.file.startsWith('v1/')) || candidate.startsWith('v1/')) {
      throw new Error(`Not a runtime ${mount} file: ${entry.file}`);
    }
    const file = safePath(snapshotRoot, entry.file);
    const bytes = readFileSync(file);
    if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) throw new Error(`Frozen ${mount} changed: ${entry.file}`);
    const destination = `${mount}/${entry.file}`;
    if (rollbackFiles.has(destination)) throw new Error(`Duplicate frozen path: ${destination}`);
    rollbackFiles.set(destination, file);
  }
};
// Frozen versions come only from verified release snapshots, never the source tree.
loadFrozen('--v1', 'v1');
loadFrozen('--v2', 'v2', true);
const add = relative => { safePath(source, relative); files.add(relative); };
const html = readFileSync(path.join(source, 'index.html'), 'utf8');
for (const match of html.matchAll(/(?:src|href)="\.\/(assets\/[^"?#]+\.(?:js|css))"/g)) add(match[1]);
// Resolve only local compiled module dependencies, never old hashes or source maps.
for (const file of files) {
  if (!file.endsWith('.js') && !file.endsWith('.css')) continue;
  const text = readFileSync(safePath(source, file), 'utf8');
  for (const match of text.matchAll(/["']\.\/([^"'?#]+\.(?:js|css))["']/g)) add(path.posix.join(path.posix.dirname(file), match[1]));
}
const ui = readJson(path.join(root, 'src/render/anime/uiArtManifest.json'));
const disabledCharacters = Object.entries(ui.characters ?? {}).filter(([, record]) => record?.enabled === false);
if (disabledCharacters.length) {
  throw new Error(`Disabled character art cannot enter a formal runtime package: ${disabledCharacters.map(([id, record]) => `${id} (${record.reviewStatus ?? 'review blocked'})`).join(', ')}`);
}
const deliveryBuild = existsSync(path.join(source, 'delivery-build.json')) ? readJson(path.join(source, 'delivery-build.json')) : null;
const delivery = readJson(path.join(root, 'src/render/deliveryManifest.json'));
const characterIds = Object.keys(ui.characters ?? {});
if (!characterIds.length) throw new Error('No declared runtime characters');
const deliveryUrls = Object.keys(delivery.records);
const physicalDeliveryRecords = Object.entries(delivery.records).flatMap(([logical, record]) => {
  const alternate = record.avif;
  if (alternate && (!/^assets\/characters\/[a-z0-9_]+\/anime\/atlas(?:-p\d+)?\.webp$/.test(logical)
    || record.contentType !== 'image/webp' || alternate.contentType !== 'image/avif'
    || record.preserveRgba || record.slice || alternate.slice
    || alternate.source !== record.source || alternate.sourceSha256 !== record.sourceSha256)) {
    throw new Error(`Invalid alternate atlas record: ${logical}`);
  }
  return alternate ? [record, alternate] : [record];
});
const characterFxUrls = id => deliveryUrls.filter(url => url.startsWith(`assets/fx/${id}.`) || url.startsWith(`assets/fx/${id}/`));
if (deliveryBuild) {
  if (deliveryBuild.version !== delivery.version) throw new Error('Delivery build version differs from packaging manifest');
  for (const id of characterIds) {
    const runtime = `assets/characters/${id}/anime/runtime.json`;
    const uiImage = ui.characters[id]?.image;
    const fx = characterFxUrls(id);
    if (!delivery.records[runtime] || !uiImage || !delivery.records[uiImage]
      || !fx.some(url => url.endsWith('.json')) || !fx.some(url => /\.(png|webp)$/.test(url))) {
      throw new Error(`Incomplete declared delivery character: ${id}`);
    }
  }
  if (characterIds.some(id => !['luffy', 'akainu'].includes(id))) {
    for (const file of ['assets/fx/common/atlas.png', 'assets/fx/common/atlas.json']) {
      if (!delivery.records[file]) throw new Error(`Missing declared common resource: ${file}`);
    }
  }
  add('delivery-build.json');
  for (const record of physicalDeliveryRecords) {
    const bytes = readFileSync(safePath(source, record.file));
    if (bytes.length !== record.bytes || hash(bytes) !== record.sha256) throw new Error(`Delivery content mismatch: ${record.file}`);
    add(record.file);
  }
}
for (const id of ['luffy', 'akainu']) {
  const base = `assets/characters/${id}`;
  for (const name of ['atlas.png', 'atlas.json', 'placeholder.png', 'placeholder.json']) add(`${base}/${name}`);
}
if (!deliveryBuild) for (const id of characterIds) {
  const base = `assets/characters/${id}`;
  const runtimeFile = `${base}/anime/runtime.json`;
  const runtime = readJson(safePath(source, runtimeFile));
  if (runtime.characterId !== id || runtime.textureDensity !== 2 || !runtime.pages?.length) throw new Error(`Invalid anime bundle: ${id}`);
  add(runtimeFile);
  for (const page of runtime.pages) {
    add(`${base}/anime/${page.image}`);
    add(`${base}/anime/${page.data}`);
  }
  add(ui.characters[id].image);
  const fx = characterFxUrls(id);
  if (!fx.some(url => url.endsWith('.json')) || !fx.some(url => /\.(png|webp)$/.test(url))) throw new Error(`Incomplete declared FX bundle: ${id}`);
  for (const file of fx) add(file);
}
if (!deliveryBuild && characterIds.some(id => !['luffy', 'akainu'].includes(id))) {
  for (const file of ['assets/fx/common/atlas.png', 'assets/fx/common/atlas.json']) {
    if (!delivery.records[file]) throw new Error(`Missing declared common resource: ${file}`);
    add(file);
  }
}
if (!deliveryBuild) for (const name of ['backdrop', 'floor']) add(`assets/stages/marineford/${name}.webp`);
const samples = readJson(path.join(root, 'src/audio/sampleManifest.json'));
if (!deliveryBuild) for (const cue of Object.values(samples.cues)) for (const file of cue.files) add(file);
const music = readJson(path.join(root, 'src/audio/musicManifest.json'));
if (!deliveryBuild) for (const track of Object.values(music.tracks)) add(track.file);
add('assets/audio/music/CREDITS.txt');

const manifest = [...files, ...rollbackFiles.keys()].sort().map(file => {
  const data = readFileSync(rollbackFiles.get(file) ?? safePath(source, file));
  if (data.length > 100 * 1024 * 1024) throw new Error(`GitHub file limit: ${file}`);
  return { file, bytes: data.length, sha256: hash(data) };
});
// Keep each attempt intact, and write the full inventory before copying anything.
if (existsSync(release)) throw new Error(`Release already exists: ${release}`);
mkdirSync(release, { recursive: true });
writeFileSync(path.join(release, 'copy-before.json'), JSON.stringify({ source, files: manifest }, null, 2));
for (const entry of manifest) {
  const destination = safePath(site, entry.file);
  mkdirSync(path.dirname(destination), { recursive: true });
  copyFileSync(rollbackFiles.get(entry.file) ?? safePath(source, entry.file), destination);
  if (hash(readFileSync(destination)) !== entry.sha256) throw new Error(`Copy mismatch: ${entry.file}`);
}

// This runs synchronously before Vite modules read the presentation and canvas size.
const defaults = `    <script>
      (() => {
        const url = new URL(window.location.href);
        if (!url.searchParams.has('art')) {
          url.searchParams.set('art', 'anime');
          if (!url.searchParams.has('scope')) url.searchParams.set('scope', 'full');
          if (!url.searchParams.has('quality')) url.searchParams.set('quality', 'high');
          window.history.replaceState(null, '', url);
        }
      })();
    </script>\n`;
if (!html.includes('    <script type="module"')) throw new Error('Missing module entry');
writeFileSync(path.join(site, 'index.html'), html.replace('    <script type="module"', `${defaults}    <script type="module"`));
writeFileSync(path.join(site, '.nojekyll'), '');
writeFileSync(path.join(site, '.gitattributes'), '* -text\n');
const published = [...files, ...rollbackFiles.keys(), '.nojekyll', '.gitattributes'].sort().map(file => {
  const bytes = readFileSync(safePath(site, file));
  return { file, bytes: bytes.length, sha256: hash(bytes) };
});
const report = {
  createdAt: new Date().toISOString(), source, site,
  defaultPresentation: { art: 'anime', scope: 'full', quality: 'high' },
  gameCodeUnchanged: true,
  fileCount: published.length,
  totalBytes: published.reduce((total, item) => total + item.bytes, 0),
  files: published,
};
writeFileSync(path.join(release, 'package-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ release, site, fileCount: report.fileCount, totalBytes: report.totalBytes }, null, 2));
