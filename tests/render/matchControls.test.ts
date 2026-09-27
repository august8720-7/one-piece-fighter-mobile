import { describe, expect, it } from 'vitest';
import { matchControls } from '../../src/render/ui/matchControls';

describe('matchControls', () => {
  it('retains mixed local play and always keeps CPU/dummy commands classic', () => {
    expect(matchControls('versus', ['classic', 'simple'])).toEqual(['classic', 'simple']);
    expect(matchControls('cpu', ['simple', 'simple'])).toEqual(['simple', 'classic']);
    expect(matchControls('training', ['simple', 'simple'])).toEqual(['simple', 'classic']);
    expect(matchControls('training', ['simple', 'simple'], true)).toEqual(['classic', 'classic']);
  });
});
