import { describe, expect, it } from 'vitest';
import { MOBILE_PROTOCOL, RULESET_ID, parseChoice, parseHello, parseLobby, parseNetworkSetup } from '../../src/mobile/matchProtocol';

const setup = { type: 'setup', protocol: MOBILE_PROTOCOL, ruleset: RULESET_ID, sessionId: 'a'.repeat(32), seed: 0xffffffff, p1: 'labubu', p2: 'twinkle' };
describe('mobile pairing packets', () => {
  it('accepts only this ruleset and four known fighters with an exact bounded seed', () => {
    expect(parseNetworkSetup(setup)).toEqual(setup);
    for (const change of [{ protocol: 2 }, { ruleset: 'old' }, { seed: 2 ** 32 }, { seed: -1 }, { seed: 1.5 }, { p1: '../unknown' }, { extra: true }, { sessionId: 'old-round' }]) {
      expect(parseNetworkSetup({ ...setup, ...change })).toBeNull();
    }
  });
  it('does not accept a connection opening as an unchecked hello', () => {
    const hello = { type: 'hello', protocol: MOBILE_PROTOCOL, ruleset: RULESET_ID, role: 'guest', character: 'luffy' };
    expect(parseHello(hello)).toEqual(hello);
    expect(parseHello({ ...hello, ruleset: 'incompatible' })).toBeNull();
    expect(parseHello({ ...hello, role: 'spectator' })).toBeNull();
    expect(parseHello({ ...hello, character: 'unknown' })).toBeNull();
  });
  it('requires a real boolean ready flag, bounded sequence, and epoch on return to lobby', () => {
    const choice = { type: 'choice', seq: 1, character: 'akainu', ready: true };
    expect(parseChoice(choice)).toEqual(choice);
    expect(parseChoice({ ...choice, ready: 'true' })).toBeNull();
    expect(parseChoice({ ...choice, seq: 0 })).toBeNull();
    expect(parseChoice({ ...choice, seq: 1_000_001 })).toBeNull();
    expect(parseLobby({ type: 'lobby', sessionId: setup.sessionId })).not.toBeNull();
    expect(parseLobby({ type: 'lobby' })).toBeNull();
  });
});
