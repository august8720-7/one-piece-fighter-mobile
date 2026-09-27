const startup = new URL(location.href);
startup.searchParams.set('art', 'anime'); startup.searchParams.set('scope', 'full');
if (!startup.searchParams.has('quality')) startup.searchParams.set('quality', 'high');
history.replaceState(null, '', startup);
document.body.dataset.art = 'anime';
// Import after choosing presentation so render constants see the actual mobile profile.
void import('./mobile/MobileApp').then(({ MobileApp }) => new MobileApp(document.getElementById('app')!))
  .catch(error => { document.getElementById('app')!.textContent = '游戏启动失败，请刷新重试'; console.error(error); });
