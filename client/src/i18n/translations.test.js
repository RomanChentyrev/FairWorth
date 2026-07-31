import { describe, expect, it } from 'vitest';
import { translations } from './translations';
import dePhrases from './phrases/de.json';
import esPhrases from './phrases/es.json';
import frPhrases from './phrases/fr.json';
import itPhrases from './phrases/it.json';
import ruPhrases from './phrases/ru.json';

const phraseCatalogues = { ru: ruPhrases, de: dePhrases, fr: frPhrases, it: itPhrases, es: esPhrases };
const placeholders = value => [...String(value).matchAll(/\{([^}]+)\}/g)].map(match => match[1]).sort();

describe('interface translation catalogues', () => {
  it('contains the same keys in every supported language', () => {
    for (const locale of ['ru', 'de', 'fr', 'it', 'es']) {
      expect(Object.keys(translations[locale]).sort()).toEqual(Object.keys(translations.en).sort());
    }
  });
  it('has no blank interface strings', () => {
    for (const locale of ['en', 'ru', 'de', 'fr', 'it', 'es']) {
      for (const value of Object.values(translations[locale])) expect(String(value).trim()).not.toBe('');
    }
  });
  it('contains every legacy UI phrase in every locale', () => {
    const expected = Object.keys(phraseCatalogues.ru).sort();
    for (const catalogue of Object.values(phraseCatalogues)) {
      expect(Object.keys(catalogue).sort()).toEqual(expected);
      for (const value of Object.values(catalogue)) expect(String(value).trim()).not.toBe('');
    }
  });
  it('preserves interpolation placeholders', () => {
    for (const locale of ['ru', 'de', 'fr', 'it', 'es']) {
      for (const key of Object.keys(translations.en)) {
        expect(placeholders(translations[locale][key])).toEqual(placeholders(translations.en[key]));
      }
      for (const [source, translated] of Object.entries(phraseCatalogues[locale])) {
        expect(placeholders(translated)).toEqual(placeholders(source));
      }
    }
  });
});
