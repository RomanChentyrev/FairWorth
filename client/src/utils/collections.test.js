import { describe, expect, it } from 'vitest';
import { parseStringList } from './collections';

describe('parseStringList', () => {
  it('accepts provider arrays, JSON strings and comma-separated strings', () => {
    expect(parseStringList(['pool', 'wifi'])).toEqual(['pool', 'wifi']);
    expect(parseStringList('["pool","wifi"]')).toEqual(['pool', 'wifi']);
    expect(parseStringList('pool, wifi')).toEqual(['pool', 'wifi']);
  });

  it('returns an empty list for unsupported values', () => {
    expect(parseStringList(null)).toEqual([]);
    expect(parseStringList('')).toEqual([]);
    expect(parseStringList('{"pool":true}')).toEqual([]);
  });
});
