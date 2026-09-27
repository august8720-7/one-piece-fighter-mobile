import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, mkdir, copyFile, stat } from 'node:fs/promises';
import { resolve, join, relative, sep } from 'node:path';

// Copy an existing verified release without replacing any prior snapshot.
const source = resolve(process.argv[2] ?? '.local-releases/加载提速-0915/playable');
const destination = resolve(process.argv[3] ?? '.local-releases/操作演出-0922/baseline/v1');
if (source === destination || destination.startsWith(source + sep)) throw new Error('Snapshot must be outside source');
try { await stat(destination); throw new Error('Snapshot already exists'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const hash = data => createHash('sha256').update(data).digest('hex');
const files = [];
async function walk(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (item.isSymbolicLink()) throw new Error('Symlinks are not permitted in a release');
    const file = join(directory, item.name);
    if (item.isDirectory()) await walk(file);
    else if (item.isFile()) {
      const bytes = await readFile(file);
      files.push({ file: relative(source, file).split(sep).join('/'), bytes: bytes.length, sha256: hash(bytes) });
    }
  }
}
await walk(source);
files.sort((a, b) => a.file.localeCompare(b.file));
await mkdir(resolve(destination, '..'), { recursive: true });
const report = { createdAt: new Date().toISOString(), source, destination, files };
await writeFile(destination + '-copy-before.json', JSON.stringify(report, null, 2), { flag: 'wx' });
for (const entry of files) {
  const target = join(destination, entry.file);
  await mkdir(resolve(target, '..'), { recursive: true });
  await copyFile(join(source, entry.file), target);
  if (hash(await readFile(target)) !== entry.sha256) throw new Error(`Snapshot verification failed: ${entry.file}`);
}
await writeFile(destination + '-verified.json', JSON.stringify({ ...report, verified: true }, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ destination, fileCount: files.length, bytes: files.reduce((sum, item) => sum + item.bytes, 0), verified: true }));
