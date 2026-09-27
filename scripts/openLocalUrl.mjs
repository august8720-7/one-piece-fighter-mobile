import { spawn } from 'node:child_process';

export function browserLaunch(url, platform = process.platform) {
  // Only launcher-owned loopback URLs enter a Windows command string.
  if (!/^http:\/\/127\.0\.0\.1:\d{1,5}\/(?:\?[a-zA-Z0-9_=&.-]*)?$/.test(url)) {
    throw new Error('Expected a local game URL.');
  }
  if (platform === 'win32') {
    return { command: 'cmd.exe', args: ['/d', '/s', '/c', `start "" "${url}"`], windowsVerbatimArguments: true };
  }
  return { command: platform === 'darwin' ? 'open' : 'xdg-open', args: [url], windowsVerbatimArguments: false };
}

export function openLocalUrl(url) {
  const launch = browserLaunch(url);
  const child = spawn(launch.command, launch.args, {
    windowsHide: true, windowsVerbatimArguments: launch.windowsVerbatimArguments, stdio: 'ignore',
  });
  const report = () => console.log(`请在浏览器打开：${url}`);
  child.once('error', report);
  child.once('exit', code => { if (code !== 0) report(); });
  // Keep the short OS handoff alive when an existing game server is reused.
}
