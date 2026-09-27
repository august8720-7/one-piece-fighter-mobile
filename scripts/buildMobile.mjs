import { existsSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyDesktopBaseline } from './verifyDesktopBaseline.mjs';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOBILE_ROOT = path.resolve('D:/one-piece-fighter-crossover-0922/mobile');

export function buildMobile({ projectRoot = PROJECT_ROOT, outputRoot = path.join(MOBILE_ROOT, 'candidate'), now = new Date(), run = spawnSync } = {}) {
  const root = path.resolve(projectRoot);
  const tsc = path.join(root, 'node_modules/typescript/bin/tsc');
  const vite = path.join(root, 'node_modules/vite/bin/vite.js');
  if (!existsSync(tsc) || !existsSync(vite)) throw new Error('Project-local TypeScript and Vite are required; no dependency installation is performed');
  const baseline = verifyDesktopBaseline({ projectRoot: root, includeRuntime: true });
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const release = path.resolve(outputRoot, `build-${stamp}`);
  if (existsSync(release)) throw new Error(`Build candidate already exists: ${release}`);
  let existing = path.resolve(outputRoot);
  while (!existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) throw new Error(`No existing output ancestor: ${outputRoot}`);
    existing = parent;
  }
  if (lstatSync(existing).isSymbolicLink() || realpathSync(existing) !== existing) throw new Error(`Linked build output ancestor: ${existing}`);
  mkdirSync(path.dirname(release), { recursive: true });
  mkdirSync(release);
  const site = path.join(release, 'site');
  const commands = [
    [tsc, ['--noEmit']],
    [vite, ['build', '--mode', 'delivery', '--outDir', site]],
  ];
  for (const [program, args] of commands) {
    const result = run(process.execPath, [program, ...args], { cwd: root, stdio: 'inherit', shell: false });
    if (result.error || result.status !== 0) {
      writeFileSync(path.join(release, 'build-failed.json'), JSON.stringify({ program, args, status: result.status, error: result.error?.message ?? null }, null, 2), { flag: 'wx' });
      throw new Error(`${path.basename(program)} failed; candidate directory retained: ${release}`);
    }
  }
  const report = { createdAt: now.toISOString(), projectRoot: root, release, site, mode: 'delivery', baseline, verified: false };
  writeFileSync(path.join(release, 'build-report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  return report;
}

function cliArgs(args) {
  if (!args.length) return {};
  if (args.length !== 2 || args[0] !== '--output-root' || !args[1]) throw new Error('Usage: buildMobile [--output-root <D:/.../mobile/candidate>]');
  const outputRoot = path.resolve(args[1]);
  const candidateRoot = path.join(MOBILE_ROOT, 'candidate');
  if (outputRoot !== candidateRoot && !outputRoot.startsWith(candidateRoot + path.sep)) throw new Error('CLI build output must remain under mobile/candidate');
  return { outputRoot };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = buildMobile(cliArgs(process.argv.slice(2)));
    console.log(JSON.stringify({ ...result, baseline: { sourceCommit: result.baseline.sourceCommit, pagesCommit: result.baseline.pagesCommit, checkedCount: result.baseline.checkedCount } }));
  }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
