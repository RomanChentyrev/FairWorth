import { describe, expect, it } from 'vitest';
import { canonicalPlace, cleanPlace, localizedPlace } from './HomePage';

describe('home search place normalization', () => {
  it('sends the canonical catalog city for localized curated destinations', () => {
    expect(canonicalPlace('Париж (PAR)')).toBe('Paris');
    expect(canonicalPlace('Москва (MOW)')).toBe('Moscow');
  });

  it('keeps worldwide cities that are not in the curated catalog', () => {
    expect(canonicalPlace('Jakarta')).toBe('Jakarta');
    expect(cleanPlace('Paris (PAR)')).toBe('Paris');
  });

  it('shows curated city names in the selected interface language', () => {
    expect(localizedPlace('Paris', 'it')).toBe('Parigi');
    expect(localizedPlace('Moscow', 'it')).toBe('Mosca');
    expect(localizedPlace('Singapore', 'de')).toBe('Singapur');
    expect(localizedPlace('New York', 'es')).toBe('Nueva York');
    expect(localizedPlace('Paris', 'zh-CN')).toBe('巴黎');
    expect(localizedPlace('Beijing', 'zh-CN')).toBe('北京');
    expect(canonicalPlace('巴黎 (PAR)')).toBe('Paris');
    expect(localizedPlace('Dubai', 'ar')).toBe('دبي');
    expect(localizedPlace('Kuala Lumpur', 'ar')).toBe('كوالالمبور');
    expect(canonicalPlace('باريس (PAR)')).toBe('Paris');
    expect(canonicalPlace('Parigi (PAR)')).toBe('Paris');
  });
});
