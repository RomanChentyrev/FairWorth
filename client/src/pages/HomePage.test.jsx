import { describe, expect, it } from 'vitest';
import { canonicalPlace, cleanPlace } from './HomePage';

describe('home search place normalization', () => {
  it('sends the canonical catalog city for localized curated destinations', () => {
    expect(canonicalPlace('Париж (PAR)')).toBe('Paris');
    expect(canonicalPlace('Москва (MOW)')).toBe('Moscow');
  });

  it('keeps worldwide cities that are not in the curated catalog', () => {
    expect(canonicalPlace('Jakarta')).toBe('Jakarta');
    expect(cleanPlace('Paris (PAR)')).toBe('Paris');
  });
});
