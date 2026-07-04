import { describe, expect, it } from 'vitest';
import { translations } from './translations';

describe('RU/EN catalogue', () => {
  it('contains the same keys in both languages', () => {
    expect(Object.keys(translations.en).sort()).toEqual(Object.keys(translations.ru).sort());
  });
  it('has no blank interface strings', () => {
    for (const locale of ['en', 'ru']) for (const value of Object.values(translations[locale])) expect(String(value).trim()).not.toBe('');
  });
});
