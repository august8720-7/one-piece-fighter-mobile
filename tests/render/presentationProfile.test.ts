import { describe, expect, it } from 'vitest';
import { adoptPresentation, legacyPresentation, presentationFromQuery, readPresentation, resolvePresentation } from '../../src/render/presentation';

describe('presentation navigation', () => {
  it('keeps art and quality through scenes that have no new data, including settings return', () => {
    const values = new Map<string, unknown>();
    const registry = { get: (key: string) => values.get(key), set: (key: string, value: unknown) => values.set(key, value) };
    const profile = presentationFromQuery(new URLSearchParams('art=anime&quality=performance&scope=full'));
    adoptPresentation(registry, profile);
    for (let navigation = 0; navigation < 5; navigation++) expect(adoptPresentation(registry)).toEqual(profile);
    expect(readPresentation(registry)).toEqual(profile);
    expect(resolvePresentation({ scope: 'sample' }, profile)).toEqual({ ...profile, scope: 'sample' });
  });

  it('distinguishes an explicit training sample from a full anime request', () => {
    expect(presentationFromQuery(new URLSearchParams('art=anime&mode=training'))).toEqual({ art: 'anime', quality: 'high', scope: 'sample' });
    expect(presentationFromQuery(new URLSearchParams('art=anime&mode=training&scope=full')).scope).toBe('full');
    expect(presentationFromQuery(new URLSearchParams('art=anime&mode=cpu')).scope).toBe('full');
    expect(presentationFromQuery(new URLSearchParams('art=anime')).scope).toBe('full');
  });

  it('changes to legacy only through the explicit action and restores full mode', () => {
    const anime = presentationFromQuery(new URLSearchParams('art=anime&mode=training'));
    expect(legacyPresentation(anime)).toEqual({ art: 'legacy', scope: 'full', quality: 'high' });
    expect(anime.art).toBe('anime');
  });
});
