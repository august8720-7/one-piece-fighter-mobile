import { createHash } from 'node:crypto';
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOBILE_ROOT = 'D:/one-piece-fighter-crossover-0922/mobile';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = file => JSON.parse(readFileSync(file, 'utf8'));
const hashPattern = /^[a-f0-9]{64}$/;
const deliveryFilePattern = /^assets\/delivery\/[a-z0-9-]+\.(?:webp|avif|json|bin|ogg)$/;
const compiledFilePattern = /^assets\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:js|css)$/;
const legacyFilePattern = /^assets\/(?:characters\/(?:luffy|akainu)\/(?:atlas|placeholder)\.(?:png|json)|audio\/music\/CREDITS\.txt)$/;
const forbiddenFilePattern = /(?:^|\/)(?:src|sources?|assets-src|generated|reference|acceptance|node_modules)(?:\/|$)|(?:^|\/)(?:connection(?:-pair)?-check|connectionprobe|probe)(?:[._/-]|$)/i;

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function safeRelative(name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.includes('\0') || name.startsWith('/') || name.split('/').some(part => part === '' || part === '.' || part === '..')
    || forbiddenFilePattern.test(name) || !(['index.html', 'delivery-build.json', '.nojekyll'].includes(name) || compiledFilePattern.test(name) || deliveryFilePattern.test(name) || legacyFilePattern.test(name))) {
    throw new Error(`Not a mobile runtime path: ${name}`);
  }
  return name;
}

export function strictFile(root, relative) {
  const name = safeRelative(relative);
  const absoluteRoot = path.resolve(root);
  if (lstatSync(absoluteRoot).isSymbolicLink() || realpathSync(absoluteRoot) !== absoluteRoot) throw new Error(`Linked release root: ${absoluteRoot}`);
  let current = absoluteRoot;
  for (const component of name.split('/')) {
    current = path.join(current, component);
    if (lstatSync(current).isSymbolicLink() || realpathSync(current) !== current) throw new Error(`Linked release path: ${name}`);
  }
  const stat = lstatSync(current);
  if (!stat.isFile()) throw new Error(`Not a file: ${name}`);
  if (stat.nlink !== 1) throw new Error(`Linked release file: ${name}`);
  return current;
}

function assertUnlinkedOutput(outputRoot) {
  let existing = path.resolve(outputRoot);
  while (!existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) throw new Error(`No existing output ancestor: ${outputRoot}`);
    existing = parent;
  }
  if (lstatSync(existing).isSymbolicLink() || realpathSync(existing) !== existing) throw new Error(`Linked package output ancestor: ${existing}`);
}

function recordBytes(record, logical) {
  if (!isObject(record) || typeof record.file !== 'string' || !deliveryFilePattern.test(record.file) || !hashPattern.test(record.sha256)
    || !Number.isSafeInteger(record.bytes) || record.bytes <= 0 || typeof record.contentType !== 'string' || !record.contentType
    || typeof record.source !== 'string' || !record.source || !hashPattern.test(record.sourceSha256)) {
    throw new Error(`Invalid delivery record: ${logical}`);
  }
  return { file: safeRelative(record.file), bytes: record.bytes, sha256: record.sha256 };
}

function physicalDelivery(manifest) {
  if (!isObject(manifest) || !hashPattern.test(manifest.version) || !isObject(manifest.records) || !Object.keys(manifest.records).length) throw new Error('Invalid delivery manifest');
  const files = new Map();
  for (const [logical, definition] of Object.entries(manifest.records)) {
    if (!isObject(definition)) throw new Error(`Invalid delivery record: ${logical}`);
    for (const record of definition.avif ? [definition, definition.avif] : [definition]) {
      const entry = recordBytes(record, logical);
      const prior = files.get(entry.file);
      if (prior && (prior.bytes !== entry.bytes || prior.sha256 !== entry.sha256)) throw new Error(`Conflicting delivery bytes: ${entry.file}`);
      files.set(entry.file, entry);
    }
  }
  return files;
}

function legacyFiles() {
  return [
    ...['luffy', 'akainu'].flatMap(id => ['atlas.png', 'atlas.json', 'placeholder.png', 'placeholder.json'].map(file => `assets/characters/${id}/${file}`)),
    'assets/audio/music/CREDITS.txt',
  ];
}

function referencePaths(text) {
  const paths = [];
  for (const match of text.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/g)) {
    const ref = match[1];
    if (ref.startsWith('data:') || ref.startsWith('#')) continue;
    if (/^(?:https?:)?\/\//i.test(ref) || ref.startsWith('/')) throw new Error(`External or absolute HTML reference: ${ref}`);
    if (!ref.startsWith('./')) throw new Error(`Unexpected HTML reference: ${ref}`);
    paths.push(ref.slice(2).split(/[?#]/, 1)[0]);
  }
  return paths;
}

function resolveReference(owner, reference) {
  if (typeof reference !== 'string' || /[\\\0%]/.test(reference) || !/^(?:\.{1,2}\/|assets\/)/.test(reference)) throw new Error(`Unsupported compiled reference: ${reference}`);
  const ref = reference.split(/[?#]/, 1)[0];
  return safeRelative(ref.startsWith('assets/') ? ref : path.posix.normalize(path.posix.join(path.posix.dirname(owner), ref)));
}

function scriptAndStyleClosure(source, html, deliveryFiles) {
  const selected = new Set();
  const queue = [];
  for (const ref of referencePaths(html)) {
    if (ref === 'assets/audio/music/CREDITS.txt') continue;
    if (deliveryFiles.has(ref)) continue;
    if (!compiledFilePattern.test(ref)) throw new Error(`Unexpected HTML asset: ${ref}`);
    queue.push(ref);
  }
  if (!queue.some(file => file.endsWith('.js'))) throw new Error('No compiled JavaScript entry');
  while (queue.length) {
    const file = safeRelative(queue.shift());
    if (selected.has(file)) continue;
    if (!compiledFilePattern.test(file)) throw new Error(`Unexpected compiled dependency: ${file}`);
    const code = readFileSync(strictFile(source, file), 'utf8');
    selected.add(file);
    if (file.endsWith('.js')) {
      // Parse the compiled syntax, including escaped specifiers, without executing it.
      const parsed = ts.createSourceFile(file, code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
      if (parsed.parseDiagnostics.length) throw new Error(`Invalid compiled JavaScript: ${file}`);
      const addImport = specifier => {
        if (!specifier || !ts.isStringLiteralLike(specifier)) throw new Error(`Computed module import needs an explicit release rule: ${file}`);
        const nested = resolveReference(file, specifier.text);
        if (!compiledFilePattern.test(nested)) throw new Error(`Unexpected compiled dependency: ${nested}`);
        queue.push(nested);
      };
      const visit = node => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) addImport(node.moduleSpecifier);
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) addImport(node.arguments[0]);
        // Vite also lists lazy JS/CSS dependencies in __vite__mapDeps arrays.
        if (ts.isStringLiteralLike(node) && /^(?:\.{1,2}\/|assets\/).+\.(?:js|css)(?:[?#].*)?$/.test(node.text)) queue.push(resolveReference(file, node.text));
        ts.forEachChild(node, visit);
      };
      visit(parsed);
    } else {
      const addCssReference = ref => {
        if (ref.startsWith('data:') || ref.startsWith('#')) return;
        const nested = resolveReference(file, ref);
        if (nested.endsWith('.css')) queue.push(nested);
        else if (!deliveryFiles.has(nested)) throw new Error(`CSS asset needs an explicit release rule: ${nested}`);
      };
      for (const match of code.matchAll(/@import\s+["']([^"']+)["']/g)) addCssReference(match[1]);
      for (const match of code.matchAll(/url\(\s*["']?([^)'"\s]+)["']?\s*\)/g)) addCssReference(match[1]);
    }
  }
  return selected;
}

function timestamp(now) { return now.toISOString().replace(/[:.]/g, '-'); }

export function createMobilePackage({ projectRoot = PROJECT_ROOT, candidate, outputRoot = path.join(MOBILE_ROOT, 'candidate'), now = new Date() }) {
  if (!candidate) throw new Error('--candidate <site directory> is required');
  const root = path.resolve(projectRoot);
  const source = path.resolve(candidate);
  const manifestPath = path.join(root, 'src/render/deliveryManifest.json');
  const uiPath = path.join(root, 'src/render/anime/uiArtManifest.json');
  const deliveryBytes = readFileSync(manifestPath);
  const uiBytes = readFileSync(uiPath);
  const delivery = JSON.parse(deliveryBytes.toString('utf8'));
  const ui = JSON.parse(uiBytes.toString('utf8'));
  if (!isObject(ui) || !isObject(ui.characters) || !Object.keys(ui.characters).length) throw new Error('Missing character art inventory');
  if (Object.entries(ui.characters ?? {}).some(([, entry]) => entry?.enabled === false)) throw new Error('Disabled character art in release');
  const physical = physicalDelivery(delivery);
  for (const id of Object.keys(ui.characters ?? {})) {
    const runtime = `assets/characters/${id}/anime/runtime.json`;
    if (!delivery.records[runtime] || !delivery.records[ui.characters[id]?.image]) throw new Error(`Missing runtime or UI art for ${id}`);
  }
  const build = readJson(strictFile(source, 'delivery-build.json'));
  if (build.version !== delivery.version || !Array.isArray(build.files) || build.files.length !== new Set(build.files).size) throw new Error('Delivery build version or inventory mismatch');
  const expected = new Set([...physical.keys(), ...legacyFiles()]);
  if (build.files.length !== expected.size || build.files.some(file => !expected.has(file))) throw new Error('Delivery build does not match source manifest');
  const html = readFileSync(strictFile(source, 'index.html'), 'utf8');
  if (/connection-(?:pair-)?check|\/src\/main\.|\.map(?:["'?#]|$)/i.test(html)) throw new Error('Development entry in candidate');
  const code = scriptAndStyleClosure(source, html, physical);
  const files = new Set(['index.html', 'delivery-build.json', ...code, ...expected]);
  const before = [...files].sort().map(file => {
    const bytes = readFileSync(strictFile(source, file));
    const declared = physical.get(file);
    if (declared && (bytes.length !== declared.bytes || sha(bytes) !== declared.sha256)) throw new Error(`Delivery bytes changed: ${file}`);
    if (legacyFilePattern.test(file)) {
      const original = readFileSync(strictFile(path.join(root, 'public'), file));
      if (bytes.length !== original.length || sha(bytes) !== sha(original)) throw new Error(`Legacy runtime bytes changed: ${file}`);
    }
    if (bytes.length > 100 * 1024 * 1024) throw new Error(`Oversize runtime file: ${file}`);
    return { file, bytes: bytes.length, sha256: sha(bytes) };
  });
  const release = path.resolve(outputRoot, `package-${timestamp(now)}`);
  if (source === release || release.startsWith(source + path.sep) || existsSync(release)) throw new Error(`Unsafe or existing package destination: ${release}`);
  assertUnlinkedOutput(outputRoot);
  const site = path.join(release, 'site');
  mkdirSync(path.dirname(release), { recursive: true });
  mkdirSync(release);
  writeFileSync(path.join(release, 'copy-before.json'), JSON.stringify({ source, deliveryVersion: delivery.version, files: before }, null, 2), { flag: 'wx' });
  mkdirSync(site);
  for (const entry of before) {
    const target = path.join(site, ...entry.file.split('/'));
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(strictFile(source, entry.file), target, constants.COPYFILE_EXCL);
    const bytes = readFileSync(strictFile(site, entry.file));
    if (bytes.length !== entry.bytes || sha(bytes) !== entry.sha256) throw new Error(`Package copy changed: ${entry.file}`);
  }
  writeFileSync(path.join(site, '.nojekyll'), '', { flag: 'wx' });
  const after = [...before, { file: '.nojekyll', bytes: 0, sha256: sha(Buffer.alloc(0)) }].sort((a, b) => a.file.localeCompare(b.file));
  const packageManifest = {
    schemaVersion: 1, createdAt: now.toISOString(), source, site,
    deliveryVersion: delivery.version, deliveryManifestSha256: sha(deliveryBytes), uiManifestSha256: sha(uiBytes),
    fileCount: after.length, totalBytes: after.reduce((sum, entry) => sum + entry.bytes, 0), files: after,
  };
  writeFileSync(path.join(release, 'copy-after.json'), JSON.stringify({ site, files: after }, null, 2), { flag: 'wx' });
  writeFileSync(path.join(release, 'package-manifest.json'), JSON.stringify(packageManifest, null, 2), { flag: 'wx' });
  return { release, ...packageManifest };
}

export function verifyPackagedSite(release) {
  const root = path.resolve(release);
  if (lstatSync(root).isSymbolicLink() || realpathSync(root) !== root) throw new Error('Linked mobile package root');
  const manifestFile = path.join(root, 'package-manifest.json');
  if (lstatSync(manifestFile).isSymbolicLink() || realpathSync(manifestFile) !== manifestFile) throw new Error('Linked mobile package manifest');
  const manifest = readJson(manifestFile);
  const site = path.join(root, 'site');
  if (!isObject(manifest) || manifest.schemaVersion !== 1 || typeof manifest.site !== 'string' || path.resolve(manifest.site) !== site
    || !hashPattern.test(manifest.deliveryVersion) || !hashPattern.test(manifest.deliveryManifestSha256) || !hashPattern.test(manifest.uiManifestSha256)
    || !Array.isArray(manifest.files) || manifest.fileCount !== manifest.files.length || !Number.isSafeInteger(manifest.totalBytes) || manifest.totalBytes < 0) throw new Error('Invalid mobile package manifest');
  const seen = new Set();
  let totalBytes = 0;
  for (const entry of manifest.files) {
    if (!isObject(entry)) throw new Error('Invalid package entry');
    safeRelative(entry.file);
    if (seen.has(entry.file) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > 100 * 1024 * 1024 || !hashPattern.test(entry.sha256)) throw new Error(`Invalid package entry: ${entry.file}`);
    seen.add(entry.file);
    totalBytes += entry.bytes;
    const bytes = readFileSync(strictFile(site, entry.file));
    if (bytes.length !== entry.bytes || sha(bytes) !== entry.sha256) throw new Error(`Package bytes changed: ${entry.file}`);
  }
  if (totalBytes !== manifest.totalBytes || !['index.html', 'delivery-build.json', '.nojekyll'].every(file => seen.has(file))) throw new Error('Incomplete mobile package manifest');
  const build = readJson(strictFile(site, 'delivery-build.json'));
  if (!isObject(build) || build.version !== manifest.deliveryVersion || !Array.isArray(build.files) || build.files.length !== new Set(build.files).size
    || build.files.some(file => typeof file !== 'string' || !(deliveryFilePattern.test(file) || legacyFilePattern.test(file)))
    || !legacyFiles().every(file => build.files.includes(file))) throw new Error('Invalid packaged delivery inventory');
  const closure = scriptAndStyleClosure(site, readFileSync(strictFile(site, 'index.html'), 'utf8'), new Set(build.files));
  const expected = new Set(['index.html', 'delivery-build.json', '.nojekyll', ...build.files, ...closure]);
  if (seen.size !== expected.size || [...seen].some(file => !expected.has(file))) throw new Error('Package includes files outside the entry dependency closure');
  const actual = [];
  const walk = (directory, prefix = '') => {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, item.name);
      if (item.isSymbolicLink() || realpathSync(absolute) !== absolute) throw new Error(`Linked file in site: ${item.name}`);
      const relative = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) walk(path.join(directory, item.name), relative);
      else if (item.isFile()) actual.push(relative);
      else throw new Error(`Unexpected release object: ${relative}`);
    }
  };
  walk(site);
  if (actual.length !== seen.size || actual.some(file => !seen.has(file))) throw new Error('Unlisted file in mobile site');
  return manifest;
}

function cliArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--candidate' && !options.candidate && args[i + 1] && !args[i + 1].startsWith('--')) options.candidate = args[++i];
    else if (args[i] === '--output-root' && !options.outputRoot && args[i + 1] && !args[i + 1].startsWith('--')) options.outputRoot = args[++i];
    else throw new Error(`Unknown package option: ${args[i]}`);
  }
  if (!options.candidate || (args.includes('--output-root') && !options.outputRoot)) throw new Error('Usage: packageMobile --candidate <site> [--output-root <D:/.../mobile/candidate|publish>]');
  if (options.outputRoot) {
    const resolved = path.resolve(options.outputRoot);
    const candidateRoot = path.resolve(MOBILE_ROOT, 'candidate');
    const publishRoot = path.resolve(MOBILE_ROOT, 'publish');
    if (![candidateRoot, publishRoot].some(root => resolved === root || resolved.startsWith(root + path.sep))) throw new Error('CLI package output must remain under mobile/candidate or mobile/publish');
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = createMobilePackage(cliArgs(process.argv.slice(2)));
    console.log(JSON.stringify({ release: result.release, site: result.site, manifest: path.join(result.release, 'package-manifest.json'), fileCount: result.fileCount, totalBytes: result.totalBytes, deliveryVersion: result.deliveryVersion }));
  }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
