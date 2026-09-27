import { describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../../src/audio/AudioEngine';
import { createCueCatalog } from '../../src/audio/audioCues';
import sampleManifest from '../../src/audio/sampleManifest.json';
import voiceSelection from '../../scripts/voice_manifest.json';
import type { CueCatalog } from '../../src/audio/audioTypes';

function audioDevice() {
  const gains: { gain: { value: number }; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
  const sources: { buffer: AudioBuffer | null; loop: boolean; onended: (() => void) | null; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
  const analysers: { fftSize: number; getFloatTimeDomainData: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
  const buffer = (): AudioBuffer => ({
    duration: 1, length: 1000, numberOfChannels: 1, sampleRate: 1000,
    getChannelData: () => new Float32Array(1000), copyFromChannel: () => {}, copyToChannel: () => {},
  });
  const device = {
    state: 'suspended', sampleRate: 1000, destination: {},
    resume: vi.fn(async () => { device.state = 'running'; }),
    close: vi.fn(async () => { device.state = 'closed'; }),
    decodeAudioData: vi.fn(async (_bytes: ArrayBuffer) => buffer()),
    createBuffer: vi.fn(() => buffer()),
    createAnalyser: vi.fn(() => {
      const value = analysers.length === 0 ? 0.5 : 0.3;
      const analyser = { fftSize: 2048, getFloatTimeDomainData: vi.fn((data: Float32Array) => data.fill(value)), disconnect: vi.fn() };
      analysers.push(analyser);
      return analyser;
    }),
    createGain: vi.fn(() => {
      const gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
      gain.connect.mockReturnValue(gain);
      gains.push(gain);
      return gain;
    }),
    createBufferSource: vi.fn(() => {
      const source = { buffer: null as AudioBuffer | null, loop: false, onended: null as (() => void) | null, start: vi.fn(), stop: vi.fn(), connect: vi.fn(), disconnect: vi.fn() };
      source.connect.mockImplementation((destination: unknown) => destination);
      source.stop.mockImplementation(() => source.onended?.());
      sources.push(source);
      return source;
    }),
  };
  return { device, context: device as unknown as AudioContext, sources, gains, analysers };
}

const sampleCatalog: CueCatalog = {
  hit_light: { files: ['/assets/audio/sfx/hit.wav'], group: 'sfx', cooldownMs: 0, maxInstances: 3 },
  'voice.luffy.sp_gatling': { files: ['/assets/audio/voice/luffy/gatling.wav'], group: 'voice', characterId: 'luffy', cooldownMs: 0 },
  'voice.luffy.hurt': { files: ['/assets/audio/voice/luffy/hurt.wav'], group: 'voice', characterId: 'luffy', cooldownMs: 0 },
  'voice.luffy.ko': { files: ['/assets/audio/voice/luffy/ko.wav'], group: 'voice', characterId: 'luffy', cooldownMs: 0 },
  marineford_ambient: { files: ['/assets/audio/sfx/sea.wav'], group: 'ambient', loop: true },
};

function setup(catalog = sampleCatalog, fetcher = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([1, 2, 3])))) {
  const fake = audioDevice();
  let time = 0;
  const factory = vi.fn(() => fake.context);
  const engine = new AudioEngine({ contextFactory: factory, fetch: fetcher, storage: null, catalog, now: () => time });
  return { ...fake, engine, factory, fetcher, advance: (ms = 100) => { time += ms; } };
}

describe('sample-first playback and cache', () => {
  it('announces final round only from explicit match state, including extra rounds after draws', async () => {
    const rig = setup(Object.fromEntries(['round1', 'round2', 'round3', 'nextRound'].map(id => [
      `announcer.${id}`, { files: [`/${id}.wav`], group: 'voice', priority: 95, cooldownMs: 0 },
    ])));
    await rig.engine.preload(); await rig.engine.unlock();
    const heard = vi.fn(); rig.engine.onVoice(heard);
    for (const [round, finalRound, expected] of [[1, false, 'round1'], [2, false, 'round2'], [3, false, 'nextRound'], [4, false, 'nextRound'], [5, true, 'round3']] as const) {
      expect(rig.engine.playPresentation({ phase: 'round', key: `round-${round}`, round, finalRound })).toBe(true);
      expect(heard).toHaveBeenLastCalledWith(expect.objectContaining({ cueId: `announcer.${expected}` }));
    }
    expect(rig.engine.playPresentation({ phase: 'round', key: 'legacy-round-3', round: 3 })).toBe(true);
    expect(heard).toHaveBeenLastCalledWith(expect.objectContaining({ cueId: 'announcer.nextRound' }));
    await rig.engine.destroy();
  });

  it('preloads both first-selection replies before combat, decodes on the title gesture and speaks on the first confirmation', async () => {
    const rig = setup({
      menu_move: { files: ['/menu-move.wav'], group: 'sfx' },
      menu_confirm: { files: ['/menu-confirm.wav'], group: 'sfx' },
      'voice.luffy.select': { files: ['/luffy-select.wav'], group: 'voice', characterId: 'luffy', cooldownMs: 0 },
      'voice.akainu.select': { files: ['/akainu-select.wav'], group: 'voice', characterId: 'akainu', cooldownMs: 0 },
      'voice.luffy.attack': { files: ['/combat-only.wav'], group: 'voice', characterId: 'luffy' },
    });
    // PreloadScene menu gate has no AudioContext yet, and must not wait for combat.
    expect(await rig.engine.preloadMenu()).toEqual({ fetched: 4, decoded: 0, failed: [] });
    expect(rig.fetcher.mock.calls.map(([url]) => url)).toEqual(['/menu-move.wav', '/menu-confirm.wav', '/luffy-select.wav', '/akainu-select.wav']);
    expect(rig.factory).not.toHaveBeenCalled();
    // Title's actual user gesture unlocks and decodes the minimal menu package.
    await rig.engine.unlock();
    expect(rig.device.decodeAudioData).toHaveBeenCalledTimes(4);
    const heard = vi.fn();
    rig.engine.onVoice(heard);
    for (const [player, characterId] of [[0, 'luffy'], [1, 'akainu']] as const) {
      expect(rig.engine.playPresentation({ phase: 'select', key: `select-${player}`, player, characterId })).toBe(true);
      expect(heard).toHaveBeenLastCalledWith(expect.objectContaining({ cueId: `voice.${characterId}.select`, file: `/${characterId}-select.wav`, player }));
    }
    expect(rig.fetcher).toHaveBeenCalledTimes(4);
    // Returning from a match clears instance keys but keeps decoded menu replies.
    rig.engine.clearFightSounds();
    expect(rig.engine.playPresentation({ phase: 'select', key: 'select-0', player: 0, characterId: 'luffy' })).toBe(true);
    expect(rig.engine.playPresentation({ phase: 'select', key: 'select-0', player: 0, characterId: 'luffy' })).toBe(false);
    expect(rig.device.decodeAudioData).toHaveBeenCalledTimes(4);
    await rig.engine.destroy();
  });

  it('preloads the adopted crossover selection clips and captions the exact file for either player', async () => {
    const rig = setup(createCueCatalog(sampleManifest.cues as CueCatalog));
    const heard = vi.fn();
    rig.engine.onVoice(heard);
    const report = await rig.engine.preloadMenu();
    expect(report).toEqual({ fetched: 4, decoded: 0, failed: [] });
    const urls = rig.fetcher.mock.calls.map(([url]) => url);
    expect(urls.filter(url => String(url).includes('/voice/labubu/'))).toEqual(['assets/audio/voice/labubu/select-0926.wav']);
    expect(urls.filter(url => String(url).includes('/voice/twinkle/'))).toEqual(['assets/audio/voice/twinkle/select-0926.mp3']);
    expect(urls.some(url => String(url).includes('/sources/'))).toBe(false);
    await rig.engine.unlock();
    for (const player of [0, 1] as const) {
      for (const [characterId, file, text] of [
        ['labubu', 'assets/audio/voice/labubu/select-0926.wav', '嘿嘿，来追我呀！'],
        ['twinkle', 'assets/audio/voice/twinkle/select-0926.mp3', '一起闪闪发光吧。'],
      ] as const) {
        rig.engine.clearFightSounds();
        expect(rig.engine.playPresentation({ phase: 'select', key: `${characterId}-${player}`, characterId, player })).toBe(true);
        expect(heard).toHaveBeenLastCalledWith(expect.objectContaining({
          cueId: `voice.${characterId}.select`, file, text, transcriptVerified: true, player,
        }));
      }
    }
    expect(rig.fetcher).toHaveBeenCalledTimes(4);
    expect(rig.device.decodeAudioData).toHaveBeenCalledTimes(4);
    await rig.engine.destroy();
  });

  it('keeps adopted crossover voices owned by the selected character during fight loading', async () => {
    const rig = setup(createCueCatalog(sampleManifest.cues as CueCatalog));
    await rig.engine.preload(['labubu']);
    const voices = rig.fetcher.mock.calls.map(([url]) => String(url)).filter(url => url.includes('/voice/'));
    expect(voices.every(file => file.startsWith('assets/audio/voice/labubu/'))).toBe(true);
    expect(voices).toEqual(expect.arrayContaining(['assets/audio/voice/labubu/attack-0927.mp3', 'assets/audio/voice/labubu/ko-0927.mp3', 'assets/audio/voice/labubu/select-0926.wav']));
    await rig.engine.destroy();
  });

  it('plays internally reviewed attack and win lines with exact-file captions and the attack cooldown', async () => {
    const rig = setup(createCueCatalog(sampleManifest.cues as CueCatalog));
    await rig.engine.preload(['labubu', 'twinkle']);
    await rig.engine.unlock();
    const heard = vi.fn();
    rig.engine.onVoice(heard);
    const attack = (moveInstance: number) => rig.engine.playEvent({
      phase: 'start', characterId: 'labubu', player: 0, moveId: 'sp_pounce_rush', moveInstance,
    });
    attack(1);
    expect(heard).toHaveBeenLastCalledWith(expect.objectContaining({
      cueId: 'voice.labubu.attack', file: 'assets/audio/voice/labubu/attack-0927.mp3',
      text: '看招！', transcriptVerified: true, player: 0,
    }));
    rig.advance(899);
    attack(2);
    expect(heard.mock.calls.filter(([voice]) => voice?.cueId === 'voice.labubu.attack')).toHaveLength(1);
    rig.advance(1);
    attack(3);
    expect(heard.mock.calls.filter(([voice]) => voice?.cueId === 'voice.labubu.attack')).toHaveLength(2);
    const starAttack = (moveInstance: number) => rig.engine.playEvent({
      phase: 'start', characterId: 'twinkle', player: 1, moveId: 'sp_tiny_star', moveInstance,
    });
    starAttack(1);
    expect(heard).toHaveBeenLastCalledWith(expect.objectContaining({
      cueId: 'voice.twinkle.attack', file: 'assets/audio/voice/twinkle/attack-0927.mp3',
      text: '星星，出击。', transcriptVerified: true, player: 1,
    }));
    rig.advance(1999);
    starAttack(2);
    expect(heard.mock.calls.filter(([voice]) => voice?.cueId === 'voice.twinkle.attack')).toHaveLength(1);
    rig.advance(1);
    starAttack(3);
    expect(heard.mock.calls.filter(([voice]) => voice?.cueId === 'voice.twinkle.attack')).toHaveLength(2);
    for (const player of [0, 1] as const) {
      expect(rig.engine.playPresentation({ phase: 'win', key: `twinkle-win-${player}`, characterId: 'twinkle', player })).toBe(true);
      expect(heard).toHaveBeenLastCalledWith(expect.objectContaining({
        cueId: 'voice.twinkle.win', file: 'assets/audio/voice/twinkle/win-0927.mp3',
        text: '星星赢啦', transcriptVerified: true, player,
      }));
    }
    rig.engine.clearFightSounds();
    for (const player of [0, 1] as const) {
      expect(rig.engine.playPresentation({ phase: 'win', key: `labubu-win-${player}`, characterId: 'labubu', player })).toBe(true);
      expect(heard).toHaveBeenLastCalledWith(expect.objectContaining({
        cueId: 'voice.labubu.win', file: 'assets/audio/voice/labubu/win-0927.mp3',
        text: '我赢啦。', transcriptVerified: true, player,
      }));
    }
    await rig.engine.destroy();
  });

  it('uses each reviewed short hurt clip for the actual defender and respects its full-length cooldown', async () => {
    const rig = setup(createCueCatalog(sampleManifest.cues as CueCatalog));
    await rig.engine.preload(['labubu', 'twinkle']);
    await rig.engine.unlock();
    const heard = vi.fn();
    rig.engine.onVoice(heard);
    for (const [defenderId, cooldownMs] of [['labubu', 1100], ['twinkle', 700]] as const) {
      const clip = voiceSelection.cues.find(cue => cue.character === defenderId && cue.event === 'hurt')!.clips[0]!;
      expect(cooldownMs).toBeGreaterThanOrEqual((clip.source_end_seconds - clip.source_start_seconds) * 1000);
      for (const defenderPlayer of [0, 1] as const) {
        rig.engine.clearFightSounds();
        const hit = () => rig.engine.playEvent({
          phase: 'hit', characterId: defenderId === 'labubu' ? 'twinkle' : 'labubu', player: defenderPlayer === 0 ? 1 : 0,
          defenderId, defenderPlayer, moveId: 'st_a', damage: 34,
        });
        hit();
        expect(heard).toHaveBeenLastCalledWith(expect.objectContaining({
          cueId: `voice.${defenderId}.hurt`, file: `assets/audio/voice/${defenderId}/hurt-0927.wav`,
          text: '哎呀', transcriptVerified: true, player: defenderPlayer,
        }));
        rig.advance(cooldownMs - 1);
        hit();
        expect(heard.mock.calls.filter(([voice]) => voice?.cueId === `voice.${defenderId}.hurt` && voice.player === defenderPlayer)).toHaveLength(1);
        rig.advance(1);
        hit();
        expect(heard.mock.calls.filter(([voice]) => voice?.cueId === `voice.${defenderId}.hurt` && voice.player === defenderPlayer)).toHaveLength(2);
      }
    }
    await rig.engine.destroy();
  });

  it.each([
    ['labubu', '哼！', 650], ['twinkle', '呀', 900],
  ] as const)('plays %s normal effort with observed wording and a cooldown covering its native clip', async (characterId, text, cooldownMs) => {
    const catalog = createCueCatalog(sampleManifest.cues as CueCatalog);
    const rig = setup(catalog);
    const clip = voiceSelection.cues.find(cue => cue.character === characterId && cue.event === 'effort')!.clips[0]!;
    expect(catalog[`voice.${characterId}.effort`]!.cooldownMs).toBe(cooldownMs);
    expect(cooldownMs).toBeGreaterThanOrEqual((clip.source_end_seconds - clip.source_start_seconds) * 1000);
    await rig.engine.preload([characterId]);
    await rig.engine.unlock();
    const heard = vi.fn();
    rig.engine.onVoice(heard);
    for (const player of [0, 1] as const) {
      rig.engine.clearFightSounds();
      const normal = (moveInstance: number) => rig.engine.playEvent({ phase: 'start', characterId, player, moveId: 'st_a', moveInstance });
      normal(1);
      expect(heard).toHaveBeenLastCalledWith(expect.objectContaining({
        cueId: `voice.${characterId}.effort`, file: `assets/audio/voice/${characterId}/effort-0927.wav`,
        text, transcriptVerified: true, player,
      }));
      rig.advance(cooldownMs - 1);
      normal(2);
      expect(heard.mock.calls.filter(([voice]) => voice?.cueId === `voice.${characterId}.effort` && voice.player === player)).toHaveLength(1);
      rig.advance(1);
      normal(3);
      expect(heard.mock.calls.filter(([voice]) => voice?.cueId === `voice.${characterId}.effort` && voice.player === player)).toHaveLength(2);
    }
    await rig.engine.destroy();
  });

  it('uses each defeated character KO file and protects it from lower-priority hurt speech', async () => {
    const rig = setup(createCueCatalog(sampleManifest.cues as CueCatalog));
    await rig.engine.preload(['labubu', 'twinkle']);
    await rig.engine.unlock();
    const heard = vi.fn();
    rig.engine.onVoice(heard);
    for (const [characterId, player, text] of [
      ['labubu', 0, '我还会回来的。'], ['twinkle', 1, '星星先休息一下。'],
    ] as const) {
      rig.engine.clearFightSounds();
      rig.engine.playEvent({ phase: 'ko', characterId, player });
      expect(heard).toHaveBeenLastCalledWith(expect.objectContaining({
        cueId: `voice.${characterId}.ko`, file: `assets/audio/voice/${characterId}/ko-0927.mp3`,
        text, transcriptVerified: true, player,
      }));
      expect(rig.engine.playCue(`voice.${characterId}.hurt`, { player })).toBe(false);
      expect(rig.engine.diagnostics().playing.some(sound => sound.cueId === `voice.${characterId}.ko`)).toBe(true);
    }
    await rig.engine.destroy();
  });

  it('keeps reviewed idle replies below combat speech and captions their actual words', async () => {
    const rig = setup(createCueCatalog(sampleManifest.cues as CueCatalog));
    await rig.engine.preload(['labubu', 'twinkle']);
    await rig.engine.unlock();
    const heard = vi.fn();
    rig.engine.onVoice(heard);
    for (const [characterId, player, text] of [
      ['labubu', 0, '快来陪我玩呀！'], ['twinkle', 1, '让星光陪你玩。'],
    ] as const) {
      rig.engine.clearFightSounds();
      expect(rig.engine.playCue(`voice.${characterId}.idle`, { player })).toBe(true);
      expect(heard).toHaveBeenLastCalledWith(expect.objectContaining({
        cueId: `voice.${characterId}.idle`, file: `assets/audio/voice/${characterId}/idle-0927.mp3`,
        text, transcriptVerified: true, player,
      }));
      rig.engine.playEvent({ phase: 'start', characterId, player, moveId: characterId === 'labubu' ? 'sp_pounce_rush' : 'sp_tiny_star', moveInstance: player + 1 });
      expect(rig.engine.diagnostics().playing.some(sound => sound.cueId.endsWith('.idle'))).toBe(false);
      const otherCharacter = characterId === 'labubu' ? 'twinkle' : 'labubu';
      expect(rig.engine.playCue(`voice.${otherCharacter}.idle`, { player: player === 0 ? 1 : 0 })).toBe(false);
    }
    await rig.engine.destroy();
  });

  it('emits captions only for successfully started samples and clears them when interrupted', async () => {
    const rig = setup();
    const heard = vi.fn();
    const unsubscribe = rig.engine.onVoice(heard);
    expect(rig.engine.playCue('voice.luffy.sp_gatling', { player: 0 })).toBe(false);
    expect(heard).not.toHaveBeenCalled();
    await rig.engine.preload(); await rig.engine.unlock();
    expect(rig.engine.playCue('voice.luffy.sp_gatling', { player: 0 })).toBe(true);
    expect(heard).toHaveBeenLastCalledWith({ cueId: 'voice.luffy.sp_gatling', file: '/assets/audio/voice/luffy/gatling.wav', player: 0, text: '', transcriptVerified: false, durationMs: 1000 });
    rig.engine.pause();
    expect(heard).toHaveBeenLastCalledWith(null);
    unsubscribe();
    await rig.engine.destroy();
  });

  it('deduplicates presentation events without queueing muted or unavailable announcements', async () => {
    const rig = setup({ 'announcer.fight': { files: ['/fight.wav'], group: 'voice', priority: 95, cooldownMs: 0 } });
    await rig.engine.preload(); await rig.engine.unlock();
    expect(rig.engine.playPresentation({ phase: 'fight', key: 'round-1' })).toBe(true);
    expect(rig.engine.playPresentation({ phase: 'fight', key: 'round-1' })).toBe(false);
    rig.engine.clearFightSounds();
    rig.engine.toggleMute();
    expect(rig.engine.playPresentation({ phase: 'fight', key: 'round-2' })).toBe(false);
    rig.engine.toggleMute();
    expect(rig.engine.playPresentation({ phase: 'fight', key: 'round-2' })).toBe(false);
    expect(rig.engine.diagnostics().playing).toHaveLength(0);
    await rig.engine.destroy();
  });

  it('downloads at most four samples together and reports all completed files', async () => {
    const pending: (() => void)[] = [];
    let active = 0; let peak = 0;
    const fetcher = vi.fn<typeof fetch>(async () => {
      peak = Math.max(peak, ++active);
      await new Promise<void>(resolve => pending.push(resolve));
      active--;
      return new Response(new Uint8Array([1, 2, 3]));
    });
    const rig = setup(sampleCatalog, fetcher);
    const progress = vi.fn();
    const loading = rig.engine.preload(undefined, progress);
    expect(fetcher).toHaveBeenCalledTimes(4);
    for (let round = 0; round < 3; round++) {
      pending.splice(0).forEach(done => done());
      for (let tick = 0; tick < 30; tick++) await Promise.resolve();
    }
    expect(await loading).toEqual({ fetched: 5, decoded: 0, failed: [] });
    expect(peak).toBe(4);
    expect(progress).toHaveBeenLastCalledWith(5, 5);
    rig.engine.destroy();
  });

  it('chatter yields to either speaker and combat cancels it even when the new voice is unavailable', async () => {
    const rig = setup({
      'voice.luffy.idle': { files: ['/idle.wav'], group: 'voice', priority: 10, cooldownMs: 0 },
      'voice.akainu.idle': { files: ['/idle2.wav'], group: 'voice', priority: 10, cooldownMs: 0 },
      'voice.akainu.effort': { files: ['/effort.wav'], group: 'voice', priority: 50, cooldownMs: 0 },
    });
    await rig.engine.preload(); await rig.engine.unlock();
    expect(rig.engine.playCue('voice.luffy.idle', { player: 0 })).toBe(true);
    expect(rig.engine.playCue('voice.akainu.idle', { player: 1 })).toBe(false);
    rig.engine.playEvent({ phase: 'start', characterId: 'luffy', player: 0, moveId: 'st_a', moveInstance: 1 });
    expect(rig.engine.diagnostics().playing).toHaveLength(0);
    rig.engine.playEvent({ phase: 'start', characterId: 'akainu', player: 1, moveId: 'st_a', moveInstance: 1 });
    expect(rig.engine.diagnostics().playing.map(s => s.cueId)).toEqual(['voice.akainu.effort']);
    expect(rig.engine.playCue('voice.luffy.idle', { player: 0 })).toBe(false);
  });

  it('adds only the music default to an old save and keeps each original volume and mute setting', () => {
    const storage = { getItem: () => JSON.stringify({ muted: true, volume: 0, groups: { sfx: 0.2, voice: 0.7, ambient: 0 } }), setItem: vi.fn() };
    const engine = new AudioEngine({ storage, catalog: {} });
    expect(engine.settings()).toEqual({ muted: true, volume: 0, groups: { sfx: 0.2, voice: 0.7, ambient: 0, music: 0.5 } });
    expect(storage.setItem).not.toHaveBeenCalled();
    engine.toggleMute(); expect(engine.hudState('music')).toBe('master_zero');
    engine.setVolume(0.4); engine.setGroupVolume('music', 0); expect(engine.hudState('music')).toBe('group_zero');
  });

  it('preloads without creating a context, decodes once after a gesture, and actually plays the decoded sample', async () => {
    const rig = setup({ hit_light: sampleCatalog.hit_light! });
    await rig.engine.preload();
    await rig.engine.preload();
    expect(rig.factory).not.toHaveBeenCalled();
    expect(rig.fetcher).toHaveBeenCalledTimes(1);
    await rig.engine.unlock();
    await rig.engine.preload();
    expect(rig.device.decodeAudioData).toHaveBeenCalledTimes(1);
    rig.engine.play('hit_light');
    rig.engine.play('hit_light');
    expect(rig.device.createBuffer).not.toHaveBeenCalled();
    expect(rig.sources[0]!.buffer).toBe(rig.sources[1]!.buffer);
    expect(rig.engine.diagnostics()).toMatchObject({ sampledPlays: 2, fallbackPlays: 0 });
  });

  it('uses synthesis only for a failed effect and never fabricates a missing voice', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 404 }));
    const rig = setup(sampleCatalog, fetcher);
    const report = await rig.engine.preload();
    expect(report.failed).toHaveLength(5);
    await rig.engine.unlock();
    rig.engine.play('hit_light');
    expect(rig.engine.playCue('voice.luffy.sp_gatling')).toBe(false);
    expect(rig.engine.diagnostics()).toMatchObject({ sampledPlays: 0, fallbackPlays: 1 });
    expect(rig.engine.diagnostics().playing).toHaveLength(1);
  });

  it('drops locked combat sounds instead of replaying a backlog on unlock', async () => {
    const rig = setup();
    for (let i = 0; i < 100; i++) rig.engine.play('hit_light');
    expect(rig.engine.diagnostics().pending).toBe(0);
    await rig.engine.unlock();
    expect(rig.sources).toHaveLength(0);
  });

  it('reports decode failures and falls back without repeated downloads', async () => {
    const rig = setup({ hit_light: sampleCatalog.hit_light! });
    rig.device.decodeAudioData.mockRejectedValue(new Error('unsupported encoding'));
    await rig.engine.unlock();
    await rig.engine.preload();
    rig.engine.play('hit_light');
    await rig.engine.preload();
    expect(rig.fetcher).toHaveBeenCalledTimes(1);
    expect(rig.engine.diagnostics().samples[0]!.error).toBe('unsupported encoding');
    expect(rig.engine.diagnostics().fallbackPlays).toBe(1);
  });

  it('creates the context synchronously inside the first unlock gesture and coalesces repeated unlocks', async () => {
    const rig = setup();
    const first = rig.engine.unlock();
    expect(rig.factory).toHaveBeenCalledOnce();
    expect(rig.device.resume).toHaveBeenCalledOnce();
    const second = rig.engine.unlock();
    expect(second).toBe(first);
    await first;
    expect(rig.engine.hudState()).toBe('ready');
  });

  it('a later real gesture recovers a never-settled resume while activation, downloads and decoding remain shared', async () => {
    const rig = setup({ hit_light: sampleCatalog.hit_light! });
    await rig.engine.preload();
    rig.engine.setVolume(0.4); rig.engine.setGroupVolume('sfx', 0.6);
    const settings = rig.engine.settings();
    let rejectOld!: (error: Error) => void;
    const oldRequest = new Promise<void>((_resolve, reject) => { rejectOld = reject; });
    let inGesture = false;
    rig.device.resume.mockImplementation(() => {
      // Models browser activation at the synchronous resume call, not later.
      if (!inGesture) return oldRequest;
      rig.device.state = 'running';
      return Promise.resolve();
    });
    let finishDecode!: (buffer: AudioBuffer) => void;
    rig.device.decodeAudioData.mockImplementation(() => new Promise(resolve => { finishDecode = resolve; }));
    const first = rig.engine.unlock();
    expect(rig.engine.hudState()).toBe('locked');
    expect(rig.engine.playCue('hit_light')).toBe(false);
    inGesture = true;
    const second = rig.engine.unlock();
    inGesture = false;
    expect(rig.device.resume).toHaveBeenCalledTimes(2);
    expect(second).toBe(first);
    for (let tick = 0; tick < 6; tick++) await Promise.resolve();
    const concurrentPreload = rig.engine.preload();
    expect(rig.engine.unlock()).toBe(first);
    expect(rig.device.decodeAudioData).toHaveBeenCalledOnce();
    expect(rig.factory).toHaveBeenCalledOnce();
    expect(rig.gains).toHaveLength(5);
    finishDecode(rig.device.createBuffer());
    await Promise.all([first, second, concurrentPreload]);
    expect(rig.engine.hudState()).toBe('ready');
    expect(rig.fetcher).toHaveBeenCalledOnce();
    expect(rig.sources).toHaveLength(0); // The locked hit did not queue a backlog.
    expect(rig.engine.settings()).toEqual(settings);
    expect(rig.engine.playCue('hit_light')).toBe(true);
    expect(rig.engine.diagnostics()).toMatchObject({ sampledPlays: 1, fallbackPlays: 0, activationError: null });
    rejectOld(new Error('late rejection from the blocked request'));
    await Promise.resolve(); await Promise.resolve();
    expect(rig.engine.hudState()).toBe('ready');
    expect(rig.engine.diagnostics().activationError).toBeNull();
  });

  it('an old resume rejection cannot settle activation while the newer gesture is still pending', async () => {
    const rig = setup({});
    let rejectOld!: (error: Error) => void;
    let finishNew!: () => void;
    rig.device.resume.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; }))
      .mockImplementationOnce(() => new Promise(resolve => { finishNew = resolve; }));
    const first = rig.engine.unlock();
    expect(rig.engine.unlock()).toBe(first);
    let settled = false;
    void first.then(() => { settled = true; });
    rejectOld(new Error('old gesture failed'));
    for (let tick = 0; tick < 6; tick++) await Promise.resolve();
    expect(settled).toBe(false);
    expect(rig.engine.diagnostics().activationError).toBeNull();
    rig.device.state = 'running'; finishNew();
    await first;
    expect(rig.engine.hudState()).toBe('ready');
  });

  it('can finish shared activation from the running context even if its original resume promise never settles', async () => {
    const rig = setup({});
    rig.device.resume.mockImplementationOnce(() => new Promise(() => {}));
    const first = rig.engine.unlock();
    rig.device.state = 'running';
    expect(rig.engine.unlock()).toBe(first);
    await first;
    expect(rig.device.resume).toHaveBeenCalledOnce();
    expect(rig.engine.hudState()).toBe('ready');
  });

  it.each(['paused', 'muted', 'zero', 'exited'] as const)('a recovered gesture respects %s playback state and never revives a delayed combat sound', async condition => {
    const rig = setup({ hit_light: sampleCatalog.hit_light!, marineford_ambient: sampleCatalog.marineford_ambient! });
    await rig.engine.preload();
    rig.device.resume.mockImplementationOnce(() => new Promise(() => {}));
    const first = rig.engine.unlock();
    rig.engine.playCue('marineford_ambient'); rig.engine.playCue('hit_light');
    if (condition === 'paused') rig.engine.pause();
    if (condition === 'muted') rig.engine.toggleMute();
    if (condition === 'zero') rig.engine.setVolume(0);
    if (condition === 'exited') rig.engine.stopAll();
    const settings = rig.engine.settings();
    expect(rig.engine.unlock()).toBe(first);
    await first;
    expect(rig.engine.settings()).toEqual(settings);
    expect(rig.engine.diagnostics().playing).toEqual([]);
    expect(rig.engine.hudState()).toBe(condition === 'exited' ? 'ready' : condition === 'zero' ? 'master_zero' : condition);
    if (condition === 'paused') {
      rig.engine.resume();
      expect(rig.engine.diagnostics().playing.map(sound => sound.cueId)).toEqual(['marineford_ambient']);
      await rig.engine.unlock();
      expect(rig.engine.diagnostics().playing).toHaveLength(1);
    }
  });

  it('destroy releases shared activation without waiting for a blocked browser resume and ignores its late rejection', async () => {
    const rig = setup({ hit_light: sampleCatalog.hit_light! });
    await rig.engine.preload();
    let rejectOld!: (error: Error) => void;
    rig.device.resume.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; }));
    const pending = rig.engine.unlock();
    await rig.engine.destroy(); await pending;
    rejectOld(new Error('closed context'));
    await Promise.resolve(); await rig.engine.unlock();
    expect(rig.device.resume).toHaveBeenCalledOnce();
    expect(rig.device.decodeAudioData).not.toHaveBeenCalled();
    expect(rig.engine.diagnostics()).toMatchObject({ destroyed: true, state: 'destroyed', activationError: null, playing: [] });
  });

  it('coalesces shared source URLs across families and only preloads selected character cues', async () => {
    const rig = setup({
      'sfx.luffy.stretch.start': { files: ['/shared.wav'], group: 'sfx' },
      'sfx.luffy.stretch.release': { files: ['/shared.wav'], group: 'sfx' },
      'sfx.akainu.daifunka.start': { files: ['/magma.wav'], group: 'sfx' },
      marineford_ambient: sampleCatalog.marineford_ambient!,
    });
    const report = await rig.engine.preload(['luffy']);
    expect(report.fetched).toBe(2);
    expect(rig.fetcher.mock.calls.map(([url]) => url)).toEqual(['/shared.wav', '/assets/audio/sfx/sea.wav']);
    await rig.engine.unlock();
    expect(rig.device.decodeAudioData).toHaveBeenCalledTimes(2);
  });

  it('uses a decoded same-character generic shout when the exact move voice file failed', async () => {
    const rig = setup({
      'voice.luffy.sp_gatling': { files: ['/missing.wav'], group: 'voice' },
      'voice.luffy.attack': { files: ['/attack.wav'], group: 'voice' },
    }, vi.fn<typeof fetch>(async (url) => String(url).includes('missing') ? new Response(null, { status: 404 }) : new Response(new Uint8Array([1]))));
    await rig.engine.unlock();
    await rig.engine.preload();
    rig.engine.playEvent({ phase: 'start', characterId: 'luffy', moveId: 'sp_gatling', moveInstance: 1, player: 0 });
    expect(rig.engine.diagnostics().playing.filter((sound) => sound.group === 'voice').map((sound) => sound.cueId)).toEqual(['voice.luffy.attack']);
  });
});

describe('voice and sound lifecycle', () => {
  it('announces a move once per player/instance, including mirrored characters and a fresh round', async () => {
    const rig = setup();
    await rig.engine.unlock();
    await rig.engine.preload();
    const event = { phase: 'start' as const, characterId: 'luffy', player: 0 as const, moveId: 'sp_gatling', moveInstance: 1 };
    rig.engine.playEvent(event);
    rig.engine.playEvent(event);
    expect(rig.engine.diagnostics().sampledPlays).toBe(1);
    rig.engine.playEvent({ ...event, player: 1 });
    expect(rig.engine.diagnostics().playing.filter((voice) => voice.group === 'voice')).toHaveLength(2);
    rig.engine.playEvent({ ...event, moveInstance: 2 });
    expect(rig.engine.diagnostics().sampledPlays).toBe(3);
    rig.engine.play('round_start');
    rig.engine.playEvent(event);
    expect(rig.engine.diagnostics().sampledPlays).toBe(4);
  });

  it('does not let a hurt grunt interrupt the same character KO line', async () => {
    const rig = setup();
    await rig.engine.unlock();
    await rig.engine.preload();
    rig.engine.playCue('voice.luffy.ko', { player: 0 });
    expect(rig.engine.playCue('voice.luffy.hurt', { player: 0 })).toBe(false);
    expect(rig.engine.diagnostics().playing.map((sound) => sound.cueId)).toEqual(['voice.luffy.ko']);
  });

  it('plays each multi-hit swing segment once without repeating the move-start voice', async () => {
    const rig = setup();
    await rig.engine.unlock();
    await rig.engine.preload();
    const event = { characterId: 'luffy', player: 0 as const, moveId: 'sp_gatling', moveInstance: 9 };
    rig.engine.playEvent({ ...event, phase: 'start', segmentId: 0 });
    rig.advance();
    rig.engine.playEvent({ ...event, phase: 'start', segmentId: 1 });
    expect(rig.engine.diagnostics().sampledPlays).toBe(1);
    const before = rig.engine.diagnostics().fallbackPlays;
    for (const segmentId of [0, 1, 2, 3, 4]) {
      rig.advance();
      rig.engine.playEvent({ ...event, phase: 'swing', segmentId });
      rig.advance();
      rig.engine.playEvent({ ...event, phase: 'swing', segmentId });
    }
    expect(rig.engine.diagnostics().fallbackPlays - before).toBe(5);
  });

  it('plays a real phase sample once for each active segment and once for final recovery', async () => {
    const rig = setup({
      'sfx.luffy.gatling.release': { files: ['/punch.wav'], group: 'sfx' },
      'sfx.luffy.gatling.end': { files: ['/retract.wav'], group: 'sfx' },
    });
    await rig.engine.unlock();
    await rig.engine.preload();
    const event = { characterId: 'luffy', player: 0 as const, moveId: 'sp_gatling', moveInstance: 4 };
    for (const segmentId of ['4:1', '4:3', '4:5']) {
      rig.engine.playEvent({ ...event, phase: 'swing', segmentId });
      rig.advance();
      rig.engine.playEvent({ ...event, phase: 'swing', segmentId });
    }
    for (const segmentId of [0, 1, 2]) {
      rig.advance();
      rig.engine.playEvent({ ...event, phase: 'recover', segmentId });
    }
    expect(rig.engine.diagnostics()).toMatchObject({ sampledPlays: 4, fallbackPlays: 0 });
    rig.engine.stopAll();
    rig.engine.playEvent({ ...event, phase: 'recover' });
    expect(rig.engine.diagnostics().sampledPlays).toBe(5);
  });

  it('pause stops combat and voices, permits menu feedback, and resumes only requested ambience', async () => {
    const rig = setup();
    await rig.engine.unlock();
    await rig.engine.preload();
    rig.engine.playCue('marineford_ambient');
    rig.engine.play('hit_light');
    rig.engine.playCue('voice.luffy.sp_gatling', { player: 0 });
    rig.engine.pause();
    expect(rig.engine.diagnostics().playing).toHaveLength(0);
    expect(rig.sources.every((source) => source.stop.mock.calls.length === 1)).toBe(true);
    rig.engine.play('hit_light');
    rig.engine.play('menu_move');
    expect(rig.engine.diagnostics().playing.map((sound) => sound.cueId)).toEqual(['menu_move']);
    rig.engine.resume();
    expect(rig.engine.diagnostics().playing.map((sound) => sound.cueId)).toEqual(['menu_move', 'marineford_ambient']);
    rig.engine.stopAll();
    rig.engine.resume();
    expect(rig.engine.diagnostics().playing).toHaveLength(0);
  });

  it('mute stops an already playing sample; unmute does not replay the voice', async () => {
    const rig = setup();
    await rig.engine.unlock();
    await rig.engine.preload();
    rig.engine.playCue('voice.luffy.sp_gatling');
    rig.engine.toggleMute();
    expect(rig.sources[0]!.stop).toHaveBeenCalledOnce();
    expect(rig.engine.diagnostics().playing).toHaveLength(0);
    rig.engine.toggleMute();
    expect(rig.sources).toHaveLength(1);
  });

  it('does not restart an ambient fetch that finished after scene exit', async () => {
    let complete!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>(() => new Promise((resolve) => { complete = resolve; }));
    const rig = setup({ marineford_ambient: sampleCatalog.marineford_ambient! }, fetcher);
    await rig.engine.unlock();
    const pending = rig.engine.preload();
    rig.engine.playCue('marineford_ambient');
    rig.engine.stopAll();
    complete(new Response(new Uint8Array([1, 2, 3])));
    await pending;
    expect(rig.engine.diagnostics().samples[0]!.decoded).toBe(true);
    expect(rig.sources).toHaveLength(0);
  });

  it('limits repeated hit overlap and releases ended nodes', async () => {
    const rig = setup({ hit_light: sampleCatalog.hit_light! });
    await rig.engine.unlock();
    await rig.engine.preload();
    for (let i = 0; i < 30; i++) { rig.engine.play('hit_light'); rig.advance(); }
    expect(rig.engine.diagnostics().playing).toHaveLength(3);
    expect(rig.sources.filter((source) => source.stop.mock.calls.length)).toHaveLength(27);
    for (const source of rig.sources.slice(-3)) source.onended?.();
    expect(rig.engine.diagnostics().playing).toHaveLength(0);
  });

  it('updates only the chosen group and restores saved group/master settings', async () => {
    const values = new Map<string, string>([['opf.audio.v1', JSON.stringify({ volume: 0.4, muted: false })]]);
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const rig = audioDevice();
    const engine = new AudioEngine({ storage, contextFactory: () => rig.context, catalog: {} });
    await engine.unlock();
    engine.setGroupVolume('voice', 0.2);
    expect(rig.gains[0]!.gain.value).toBe(0.4);
    expect(rig.gains[1]!.gain.value).toBe(0.8);
    expect(rig.gains[2]!.gain.value).toBe(0.2);
    const restored = new AudioEngine({ storage, catalog: {} });
    expect(restored.volume).toBe(0.4);
    expect(restored.groupVolume('voice')).toBe(0.2);
    restored.setVolume(Number.NaN);
    expect(restored.volume).toBe(0.4);
  });

  it('turning voice volume to zero stops speech and does not replay it when restored', async () => {
    const rig = setup();
    await rig.engine.unlock();
    await rig.engine.preload();
    rig.engine.playCue('marineford_ambient');
    rig.engine.playCue('voice.luffy.sp_gatling');
    rig.engine.setGroupVolume('voice', 0);
    expect(rig.engine.diagnostics().playing.map((sound) => sound.cueId)).toEqual(['marineford_ambient']);
    rig.engine.setGroupVolume('voice', 0.9);
    expect(rig.engine.diagnostics().playing.map((sound) => sound.cueId)).toEqual(['marineford_ambient']);
  });

  it('keeps the sound group bounded and protects high-priority impacts from a low-priority tail', async () => {
    const catalog: CueCatalog = {};
    for (let i = 0; i < 10; i++) catalog[`impact.${i}`] = { files: ['/hit.wav'], group: 'sfx', priority: 90 };
    catalog.tail = { files: ['/tail.wav'], group: 'sfx', priority: 10 };
    const rig = setup(catalog);
    await rig.engine.unlock();
    await rig.engine.preload();
    for (let i = 0; i < 10; i++) rig.engine.playCue(`impact.${i}`);
    expect(rig.engine.playCue('tail')).toBe(false);
    expect(rig.engine.diagnostics().playing).toHaveLength(10);
    expect(rig.sources.every((source) => source.stop.mock.calls.length === 0)).toBe(true);
  });

  it('permanent teardown closes the device, stops nodes, and prevents late fetches or unlocks from reviving audio', async () => {
    let complete!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>(() => new Promise((resolve) => { complete = resolve; }));
    const rig = setup({ marineford_ambient: sampleCatalog.marineford_ambient! }, fetcher);
    await rig.engine.unlock();
    rig.engine.play('hit_light');
    const pending = rig.engine.preload();
    rig.engine.playCue('marineford_ambient');
    const requestSignal = rig.fetcher.mock.calls[0]![1]!.signal!;
    await rig.engine.destroy();
    expect(requestSignal.aborted).toBe(true);
    expect(rig.sources[0]!.stop).toHaveBeenCalledOnce();
    expect(rig.device.close).toHaveBeenCalledOnce();
    complete(new Response(new Uint8Array([1])));
    await pending;
    await rig.engine.destroy();
    await rig.engine.unlock();
    rig.engine.resume();
    expect(rig.engine.playCue('marineford_ambient')).toBe(false);
    expect(rig.factory).toHaveBeenCalledOnce();
    expect(rig.device.decodeAudioData).not.toHaveBeenCalled();
    expect(rig.engine.diagnostics()).toMatchObject({ destroyed: true, playing: [], samples: [], pending: 0 });
  });
});

describe('audio recovery, honest status and same-bus preview', () => {
  it('counts actual downloads and decodes once per URL, while retained bytes await a gesture separately', async () => {
    let complete!: (response: Response) => void;
    const rig = setup({ hit_light: sampleCatalog.hit_light! }, vi.fn<typeof fetch>(() => new Promise(resolve => { complete = resolve; })));
    const pending = rig.engine.preload();
    expect(rig.engine.diagnostics()).toMatchObject({ pending: 1, downloading: 1, decoding: 0, waitingForUnlock: 0 });
    complete(new Response(new Uint8Array([1])));
    await pending;
    expect(rig.engine.diagnostics()).toMatchObject({ pending: 0, downloading: 0, decoding: 0, waitingForUnlock: 1 });
    let decode!: (buffer: AudioBuffer) => void;
    let started!: () => void;
    const decodingStarted = new Promise<void>(resolve => { started = resolve; });
    rig.device.decodeAudioData.mockImplementation(() => new Promise(resolve => { decode = resolve; started(); }));
    const activating = rig.engine.unlock();
    await decodingStarted;
    expect(rig.engine.diagnostics()).toMatchObject({ pending: 1, downloading: 0, decoding: 1, waitingForUnlock: 0 });
    decode(rig.device.createBuffer());
    await activating;
    expect(rig.engine.diagnostics()).toMatchObject({ pending: 0, decoding: 0, waitingForUnlock: 0 });
  });

  it('reports failed downloads and retries them explicitly without redownloading successful URLs', async () => {
    let online = false;
    const fetcher = vi.fn<typeof fetch>(async url => !online && String(url).includes('hit.wav')
      ? new Response(null, { status: 404 }) : new Response(new Uint8Array([1])));
    const rig = setup({ hit_light: sampleCatalog.hit_light!, marineford_ambient: sampleCatalog.marineford_ambient! }, fetcher);
    await rig.engine.unlock();
    await rig.engine.preload();
    expect(rig.engine.hudState()).toBe('download_failed');
    expect(rig.engine.diagnostics().samples[0]).toMatchObject({ errorKind: 'download', error: 'HTTP 404' });
    online = true;
    const report = await rig.engine.retryFailed();
    expect(report).toEqual({ fetched: 1, decoded: 1, failed: [] });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/assets/audio/sfx/hit.wav', '/assets/audio/sfx/sea.wav', '/assets/audio/sfx/hit.wav']);
    expect(rig.engine.hudState()).toBe('ready');
    expect(rig.engine.playCue('hit_light')).toBe(true);
    expect(rig.engine.diagnostics().sampledPlays).toBe(1);
  });

  it('refetches a corrupt HTTP-200 sample on explicit retry so a repaired file can recover', async () => {
    let repaired = false;
    const rig = setup({ hit_light: sampleCatalog.hit_light! }, vi.fn<typeof fetch>(async () =>
      new Response(new Uint8Array([repaired ? 2 : 1]))));
    rig.device.decodeAudioData.mockImplementation(async bytes => {
      if (new Uint8Array(bytes)[0] !== 2) throw new Error('bad encoding');
      return rig.device.createBuffer();
    });
    await rig.engine.unlock();
    await rig.engine.preload();
    expect(rig.engine.hudState()).toBe('decode_failed');
    expect(rig.engine.diagnostics().samples[0]).toMatchObject({ fetched: true, decoded: false, errorKind: 'decode' });
    repaired = true;
    expect(await rig.engine.retryFailed()).toEqual({ fetched: 1, decoded: 1, failed: [] });
    expect(rig.fetcher).toHaveBeenCalledTimes(2);
    expect(rig.fetcher.mock.calls[1]![1]!.cache).toBe('reload');
    expect(rig.device.decodeAudioData).toHaveBeenCalledTimes(2);
    expect(rig.engine.hudState()).toBe('ready');
  });

  it('retains a resume failure until a later real unlock succeeds', async () => {
    const rig = setup({});
    rig.device.resume.mockRejectedValueOnce(new Error('blocked by browser'));
    await rig.engine.unlock();
    expect(rig.engine.hudState()).toBe('resume_failed');
    expect(rig.engine.diagnostics().activationError).toEqual({ kind: 'resume_failed', message: 'blocked by browser' });
    await rig.engine.enableSound();
    expect(rig.engine.hudState()).toBe('ready');
    expect(rig.engine.diagnostics().activationError).toBeNull();
  });

  it('can recover after context creation failed and does not silently claim unlocked', async () => {
    const rig = setup({});
    rig.factory.mockImplementationOnce(() => { throw new Error('no output device'); });
    await rig.engine.unlock();
    expect(rig.engine.hudState()).toBe('unavailable');
    expect(rig.engine.diagnostics().contextState).toBe('not_created');
    await rig.engine.unlock();
    expect(rig.engine.hudState()).toBe('ready');
  });

  it('coalesces concurrent failed-download retries instead of creating duplicate requests', async () => {
    const rig = setup({ hit_light: sampleCatalog.hit_light! }, vi.fn<typeof fetch>(async () => new Response(null, { status: 404 })));
    await rig.engine.preload();
    let complete!: (response: Response) => void;
    rig.fetcher.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const first = rig.engine.retryFailed();
    const second = rig.engine.retryFailed();
    expect(rig.engine.diagnostics().pending).toBe(1);
    expect(rig.fetcher).toHaveBeenCalledTimes(2);
    complete(new Response(new Uint8Array([1])));
    await Promise.all([first, second]);
    expect(rig.engine.diagnostics()).toMatchObject({ pending: 0, waitingForUnlock: 1 });
  });

  it('captures playback-start exceptions, releases failed nodes and permits a new attempt', async () => {
    const rig = setup({});
    await rig.engine.unlock();
    rig.device.createBufferSource.mockImplementationOnce(() => {
      const source = { buffer: null as AudioBuffer | null, loop: false, onended: null as (() => void) | null, start: vi.fn(() => { throw new Error('device lost'); }), stop: vi.fn(), connect: vi.fn((value: unknown) => value), disconnect: vi.fn() };
      rig.sources.push(source);
      return source;
    });
    expect(rig.engine.playCue('hit_light')).toBe(false);
    expect(rig.engine.hudState()).toBe('start_failed');
    expect(rig.engine.diagnostics().playing).toEqual([]);
    expect(rig.sources[0]!.disconnect).toHaveBeenCalledOnce();
    expect(rig.engine.playCue('hit_light')).toBe(true);
    expect(rig.engine.hudState()).toBe('ready');
  });

  it('does not claim ready or start inaudible nodes at zero master/group volume, and does not reset them on enable', async () => {
    const rig = setup({});
    await rig.engine.unlock();
    rig.engine.setVolume(0);
    expect(rig.engine.hudState()).toBe('master_zero');
    expect(rig.engine.playCue('hit_light')).toBe(false);
    rig.engine.toggleMute();
    await rig.engine.enableSound();
    expect(rig.engine.settings()).toMatchObject({ muted: false, volume: 0 });
    expect(rig.engine.hudState()).toBe('master_zero');
    rig.engine.setVolume(0.4);
    rig.engine.setGroupVolume('sfx', 0);
    expect(rig.engine.hudState()).toBe('group_zero');
    expect(await rig.engine.preview()).toBe(false);
    expect(rig.sources).toHaveLength(0);
    rig.engine.restoreDefaults();
    expect(rig.engine.settings()).toEqual({ muted: false, volume: 0.6, groups: { sfx: 0.8, voice: 0.9, ambient: 0.3, music: 0.5 } });
    expect(rig.engine.hudState()).toBe('ready');
  });

  it('plays a paused-menu preview through the real selected group and master without unpausing combat', async () => {
    const rig = setup({ hit_light: sampleCatalog.hit_light! });
    await rig.engine.unlock();
    rig.engine.setVolume(0.4);
    rig.engine.setGroupVolume('sfx', 0.2);
    rig.engine.pause();
    expect(await rig.engine.preview('hit_light')).toBe(true);
    expect(rig.engine.hudState()).toBe('paused');
    expect(rig.gains[0]!.gain.value).toBe(0.4);
    expect(rig.gains[1]!.gain.value).toBe(0.2);
    expect(rig.sources[0]!.connect).toHaveBeenCalledWith(rig.gains[5]);
    expect(rig.gains[5]!.connect).toHaveBeenCalledWith(rig.gains[1]);
    expect(rig.gains[1]!.connect).toHaveBeenCalledWith(rig.gains[0]);
    expect(rig.gains[0]!.connect).toHaveBeenCalledWith(rig.device.destination);
    rig.engine.toggleMute();
    expect(await rig.engine.preview('hit_light')).toBe(false);
    expect(rig.engine.diagnostics().playing).toEqual([]);
  });

  it('cancels a pending preview on exit so a completed download cannot speak in the next scene', async () => {
    let complete!: (response: Response) => void;
    let started!: () => void;
    const fetching = new Promise<void>(resolve => { started = resolve; });
    const rig = setup({ hit_light: sampleCatalog.hit_light! }, vi.fn<typeof fetch>(() => new Promise(resolve => { complete = resolve; started(); })));
    await rig.engine.unlock();
    const pending = rig.engine.preview('hit_light');
    await fetching;
    rig.engine.stopAll();
    complete(new Response(new Uint8Array([1])));
    expect(await pending).toBe(false);
    expect(rig.sources).toHaveLength(0);
  });

  it('closing the audio UI cancels a pending audition without stopping ordinary menu feedback', async () => {
    let complete!: (response: Response) => void;
    let started!: () => void;
    const fetching = new Promise<void>(resolve => { started = resolve; });
    const rig = setup({ hit_light: sampleCatalog.hit_light! }, vi.fn<typeof fetch>(() => new Promise(resolve => { complete = resolve; started(); })));
    await rig.engine.unlock();
    rig.engine.play('menu_confirm');
    const menuSource = rig.sources[0]!;
    const pending = rig.engine.preview('hit_light');
    await fetching;
    rig.engine.cancelPreview();
    complete(new Response(new Uint8Array([1])));
    expect(await pending).toBe(false);
    expect(rig.engine.diagnostics().playing.map(sound => sound.cueId)).toEqual(['menu_confirm']);
    expect(menuSource.stop).not.toHaveBeenCalled();
    expect(rig.sources).toHaveLength(1);
    expect(await rig.engine.preview('hit_light')).toBe(true);
  });

  it('closing the audio UI stops only its started audition, preserving ambience and the same combat cue', async () => {
    const rig = setup({ hit_light: sampleCatalog.hit_light!, marineford_ambient: sampleCatalog.marineford_ambient! });
    await rig.engine.unlock();
    await rig.engine.preload();
    rig.engine.playCue('marineford_ambient');
    rig.engine.play('hit_light');
    rig.engine.play('menu_confirm');
    const regularSources = [...rig.sources];
    expect(await rig.engine.preview('hit_light')).toBe(true);
    const auditionSource = rig.sources.at(-1)!;
    rig.engine.cancelPreview();
    rig.engine.cancelPreview();
    expect(auditionSource.stop).toHaveBeenCalledOnce();
    expect(auditionSource.disconnect).toHaveBeenCalledOnce();
    expect(regularSources.every(source => source.stop.mock.calls.length === 0)).toBe(true);
    expect(rig.engine.diagnostics().playing.map(sound => sound.cueId)).toEqual(['marineford_ambient', 'hit_light', 'menu_confirm']);
    expect(rig.engine.diagnostics().paused).toBe(false);
  });

  it('only captures bounded traces/meters on demand and removes the taps without duplicating the output route', async () => {
    const rig = setup({});
    await rig.engine.unlock();
    rig.engine.play('hit_light');
    expect(rig.engine.diagnostics().recent).toEqual([]);
    expect(rig.device.createAnalyser).not.toHaveBeenCalled();
    rig.engine.setDiagnosticsEnabled(true);
    for (let i = 0; i < 100; i++) rig.engine.play('hit_light');
    expect(rig.engine.diagnostics().recent).toHaveLength(64);
    expect(rig.engine.diagnostics().recent.at(-1)).toMatchObject({ kind: 'drop', detail: 'cooldown', cueId: 'hit_light' });
    expect(rig.engine.diagnostics().output?.beforeMaster.rms).toBeCloseTo(0.5);
    expect(rig.engine.diagnostics().output?.afterMaster.rms).toBeCloseTo(0.3);
    expect(rig.gains[0]!.connect.mock.calls.filter(([target]) => target === rig.device.destination)).toHaveLength(1);
    rig.engine.setDiagnosticsEnabled(false);
    expect(rig.engine.diagnostics()).toMatchObject({ recent: [], output: null, diagnosticsEnabled: false });
    expect(rig.gains[0]!.disconnect).toHaveBeenCalledWith(rig.analysers[1]);
    expect(rig.analysers.every(analyser => analyser.disconnect.mock.calls.length === 1)).toBe(true);
  });

  it('stretch heavy uses three distinct samples once, with impacts still waiting for real contact', async () => {
    const rig = setup(Object.fromEntries(['start', 'release', 'end'].map(stage => [`sfx.luffy.stretch.${stage}`, { files: [`/${stage}.wav`], group: 'sfx' as const }])));
    await rig.engine.unlock();
    await rig.engine.preload();
    for (const phase of ['start', 'swing', 'recover'] as const) {
      const event = { phase, player: 0 as const, characterId: 'luffy', moveId: 'st_c', moveInstance: 7 };
      rig.engine.playEvent(event);
      rig.advance();
      rig.engine.playEvent(event);
    }
    expect(rig.engine.diagnostics()).toMatchObject({ sampledPlays: 3, fallbackPlays: 0 });
    expect(rig.engine.diagnostics().playing.map(sound => sound.cueId)).toEqual(['sfx.luffy.stretch.start', 'sfx.luffy.stretch.release', 'sfx.luffy.stretch.end']);
    expect(new Set(rig.sources.map(source => source.buffer)).size).toBe(3);
  });
});
