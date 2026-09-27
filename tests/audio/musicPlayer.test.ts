import { afterEach, describe, expect, it, vi } from 'vitest';
import { MusicPlayer } from '../../src/audio/MusicPlayer';

function rig() {
  function makeMedia() {
    const value = { src: '', preload: '', loop: false, paused: true, ended: false, currentTime: 0, duration: 90,
      onplaying: null as (() => void) | null, onwaiting: null as (() => void) | null, onended: null as (() => void) | null,
      onerror: null as (() => void) | null, error: null as { code: number; message: string } | null,
      pause: vi.fn(() => { value.paused = true; }), load: vi.fn(), removeAttribute: vi.fn(() => { value.src = ''; }),
      play: vi.fn(async () => { value.paused = false; value.onplaying?.(); }),
    };
    return value;
  }
  const media: ReturnType<typeof makeMedia>[] = [];
  const factory = () => { const value = makeMedia(); media.push(value); return value; };
  const gains: { value: number; cancelScheduledValues: ReturnType<typeof vi.fn>; setTargetAtTime: ReturnType<typeof vi.fn> }[] = [];
  const node = () => ({ connect: vi.fn(function (this: unknown) { return this; }), disconnect: vi.fn() });
  const context = { state: 'running', currentTime: 10, createMediaElementSource: vi.fn(node), createGain: vi.fn(() => {
    const gain = { value: 1, cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn() }; gains.push(gain); return { ...node(), gain };
  }) };
  const bus = node();
  const player = new MusicPlayer({ menu: { file: '/menu.ogg', loop: true, gain: 0.8, title: 'menu' }, battle: { file: '/battle.ogg', loop: true, gain: 1, title: 'battle' }, victory: { file: '/win.ogg', loop: false, gain: 1, title: 'win' } }, factory as unknown as () => HTMLAudioElement);
  player.attach(context as unknown as AudioContext, bus as unknown as GainNode);
  return { player, media, gains, context };
}
afterEach(() => vi.useRealTimers());

describe('streamed music lifecycle', () => {
  it('waits for unlock, keeps same-track round changes continuous and resumes from paused position', async () => {
    const { player, media, context } = rig();
    player.request('battle'); expect(media).toHaveLength(0);
    player.control(true, false); await Promise.resolve();
    media[0]!.currentTime = 34;
    player.request('battle'); expect(media).toHaveLength(1); expect(media[0]!.play).toHaveBeenCalledOnce();
    player.control(true, true); expect(media[0]!.paused).toBe(true);
    player.control(true, false); await Promise.resolve();
    expect(media[0]!.currentTime).toBe(34); expect(media[0]!.play).toHaveBeenCalledTimes(2);
    expect(context.createMediaElementSource).toHaveBeenCalledOnce(); player.destroy();
  });
  it('caps rapid scene switches at two streams and releases media URLs and nodes', async () => {
    vi.useFakeTimers(); const { player, media } = rig(); player.control(true, false);
    for (const id of ['menu', 'battle', 'victory', 'battle']) { player.request(id); await Promise.resolve(); expect(player.diagnostics().instances).toBeLessThanOrEqual(2); }
    vi.advanceTimersByTime(600); expect(player.diagnostics().instances).toBe(1);
    expect(media.slice(0, -1).every(m => m.paused && m.src === '')).toBe(true);
    player.stop(); expect(media.every(m => m.paused && m.src === '')).toBe(true);
    expect(player.diagnostics().instances).toBe(0);
  });
  it('does not resurrect a pending old track and permits an explicit retry after media failure', async () => {
    const { player, media } = rig(); player.control(true, false); player.request('menu'); await Promise.resolve();
    media[0]!.error = { code: 2, message: '404' }; media[0]!.onerror!();
    expect(player.state()).toBe('download_failed'); player.control(true, false);
    expect(media).toHaveLength(1); player.retry(); await Promise.resolve();
    expect(media).toHaveLength(2); expect(player.state()).toBe('ready');
    let complete!: () => void;
    media[1]!.play.mockImplementation(() => new Promise<void>(resolve => { complete = resolve; }));
    player.control(true, true); player.control(true, false); player.stop(); complete(); await Promise.resolve();
    expect(player.diagnostics().instances).toBe(0);
  });
  it('ducks music, auditions while the fight is paused, and stops that audition on cancel', async () => {
    const { player, media, gains } = rig(); player.control(true, false); player.request('battle'); await Promise.resolve();
    player.duck(true); expect(gains[0]!.setTargetAtTime).toHaveBeenLastCalledWith(0.5, 10, 0.04);
    player.duck(false); expect(gains[0]!.setTargetAtTime).toHaveBeenLastCalledWith(1, 10, 0.2);
    player.control(true, true); player.preview(); await Promise.resolve(); expect(media[0]!.paused).toBe(false);
    player.cancelPreview(); expect(media[0]!.paused).toBe(true);
    player.control(false, false); expect(media[0]!.paused).toBe(true); player.destroy();
  });
  it('times out stalled loads without repeatedly allocating, then recovers only on retry', async () => {
    vi.useFakeTimers(); const { player, media } = rig(); player.control(true, false); player.request('menu'); await Promise.resolve();
    media[0]!.onwaiting!(); vi.advanceTimersByTime(15000);
    expect(player.state()).toBe('download_failed'); player.control(true, false); expect(media).toHaveLength(1);
    player.retry(); await Promise.resolve(); expect(player.state()).toBe('ready'); player.destroy();
  });
});
