import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { browserLaunch } from '../scripts/openLocalUrl.mjs';

const full = 'http://127.0.0.1:4177/?art=anime&scope=full&quality=high';

describe('local browser launch', () => {
  it.skipIf(process.platform !== 'win32')('passes all game parameters through the real Windows command parser', () => {
    const launch = browserLaunch(full, 'win32');
    // Replace only the OS-opening verb so this regression never opens a browser.
    const args = launch.args.map((value, i) => i === launch.args.length - 1 ? value.replace(/^start "" /, 'echo ') : value);
    const result = spawnSync(launch.command, args, { encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: launch.windowsVerbatimArguments });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toBe(`"${full}"`);
  });

  it('keeps the whole URL as one argument on Mac and Linux', () => {
    expect(browserLaunch(full, 'darwin')).toEqual({ command: 'open', args: [full], windowsVerbatimArguments: false });
    expect(browserLaunch(full, 'linux')).toEqual({ command: 'xdg-open', args: [full], windowsVerbatimArguments: false });
  });

  it('rejects shell metacharacters and external destinations before constructing a command', () => {
    for (const url of [full + '&x="test"', full + '&x=%PATH%', full + '\nwhoami', 'https://example.com/']) {
      expect(() => browserLaunch(url, 'win32')).toThrow('local game URL');
    }
  });
});
