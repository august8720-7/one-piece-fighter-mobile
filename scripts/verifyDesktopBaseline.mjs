import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function importedFile(root, relative) {
  if (typeof relative !== 'string' || !relative || /[\\\0:]/.test(relative) || relative.split('/').some(part => !part || part === '.' || part === '..')) throw new Error(`Invalid import path: ${relative}`);
  const absoluteRoot = path.resolve(root);
  let current = absoluteRoot;
  if (lstatSync(current).isSymbolicLink() || realpathSync(current) !== current) throw new Error('Linked project root');
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if (lstatSync(current).isSymbolicLink() || realpathSync(current) !== current) throw new Error(`Linked imported file: ${relative}`);
  }
  const stat = lstatSync(current);
  if (!stat.isFile()) throw new Error(`Not an imported file: ${relative}`);
  if (stat.nlink !== 1) throw new Error(`Linked imported file: ${relative}`);
  return current;
}

function immutableInventory(root) {
  const files = [];
  const visit = relative => {
    const absolute = path.join(root, ...relative.split('/'));
    if (lstatSync(absolute).isSymbolicLink() || realpathSync(absolute) !== absolute) throw new Error(`Linked immutable path: ${relative}`);
    for (const item of readdirSync(absolute, { withFileTypes: true })) {
      const file = `${relative}/${item.name}`;
      if (item.isDirectory()) visit(file);
      else if (item.isFile()) files.push(file);
      else throw new Error(`Unexpected immutable object: ${file}`);
    }
  };
  visit('src/core');
  visit('src/characters');
  return files;
}

export function verifyDesktopBaseline({ projectRoot = PROJECT_ROOT, manifestPath, includeRuntime = false } = {}) {
  const root = path.resolve(projectRoot);
  const manifest = JSON.parse(readFileSync(manifestPath ?? path.join(root, 'docs/桌面导入清单0927.json'), 'utf8'));
  if (!manifest || !Array.isArray(manifest.files) || !/^[a-f0-9]{40}$/.test(manifest.sourceCommit) || !/^[a-f0-9]{40}$/.test(manifest.pagesCommit)
    || manifest.files.some(row => !row || typeof row.file !== 'string' || typeof row.source !== 'string')) throw new Error('Invalid desktop import inventory');
  const selected = manifest.files.filter(row => row.file.startsWith('src/core/') || row.file.startsWith('src/characters/')
    || (includeRuntime && row.file.startsWith('public/assets/')));
  if (!selected.some(row => row.file.startsWith('src/core/')) || !selected.some(row => row.file.startsWith('src/characters/'))) throw new Error('Missing immutable core or character inventory');
  const seen = new Set();
  const checked = [];
  for (const row of selected) {
    if (seen.has(row.file) || !Number.isSafeInteger(row.bytes) || row.bytes < 0 || !/^[a-f0-9]{64}$/.test(row.sha256)) throw new Error(`Invalid duplicate or hash record: ${row.file}`);
    seen.add(row.file);
    if (row.file.startsWith('src/') && row.source !== `git:${manifest.sourceCommit}`) throw new Error(`Unexpected source revision: ${row.file}`);
    if (row.file.startsWith('public/assets/')) {
      const revision = row.source.slice('runtime-whitelist:'.length);
      if (row.source !== `git:${manifest.sourceCommit}` && !(row.source.startsWith('runtime-whitelist:') && /^[a-f0-9]{7,40}$/.test(revision) && manifest.pagesCommit.startsWith(revision))) throw new Error(`Unexpected runtime revision: ${row.file}`);
    }
    const bytes = readFileSync(importedFile(root, row.file));
    if (bytes.length !== row.bytes || hash(bytes) !== row.sha256) throw new Error(`Imported desktop bytes changed: ${row.file}`);
    checked.push(row.file);
  }
  if (immutableInventory(root).some(file => !seen.has(file))) throw new Error('Unlisted file in immutable core or character directories');
  return { sourceCommit: manifest.sourceCommit, pagesCommit: manifest.pagesCommit, includeRuntime, checkedCount: checked.length, checked };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== '--runtime') || args.length > 1) throw new Error('Usage: verifyDesktopBaseline [--runtime]');
    console.log(JSON.stringify(verifyDesktopBaseline({ includeRuntime: args.includes('--runtime') })));
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
