const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeLocale } = require('../config/locales');
const { languageName, supportedLanguage } = require('../services/ai');
const { catalogues, t } = require('../i18n');

const placeholders = value => [...String(value).matchAll(/\{([^}]+)\}/g)].map(match => match[1]).sort();

test('all product locales are accepted by API and AI services', () => {
  assert.deepEqual(
    ['en', 'ru', 'de', 'fr', 'it', 'es', 'zh-CN', 'ar'].map(locale => normalizeLocale(locale)),
    ['en', 'ru', 'de', 'fr', 'it', 'es', 'zh-CN', 'ar'],
  );
  assert.equal(languageName('de'), 'German');
  assert.equal(languageName('fr'), 'French');
  assert.equal(languageName('it'), 'Italian');
  assert.equal(languageName('es'), 'Spanish');
  assert.equal(languageName('zh-CN'), 'Simplified Chinese');
  assert.equal(languageName('ar'), 'Modern Standard Arabic');
});

test('unknown locales safely fall back to English', () => {
  assert.equal(normalizeLocale('xx'), 'en');
  assert.equal(supportedLanguage('xx'), 'en');
});

test('server message catalogues are complete and preserve placeholders', () => {
  const expected = Object.keys(catalogues.en).sort();
  for (const locale of ['ru', 'de', 'fr', 'it', 'es', 'zh-CN', 'ar']) {
    assert.deepEqual(Object.keys(catalogues[locale]).sort(), expected);
    for (const key of expected) {
      assert.ok(String(catalogues[locale][key]).trim());
      assert.deepEqual(placeholders(catalogues[locale][key]), placeholders(catalogues.en[key]));
    }
  }
  assert.match(t('de', 'notification.trip_body', { date: '2026-08-01', label: '24h' }), /2026-08-01/);
});
