const SUPPORTED_LOCALES = new Set(['en', 'ru', 'de', 'fr', 'it', 'es']);

function normalizeLocale(locale) {
  return SUPPORTED_LOCALES.has(locale) ? locale : 'en';
}

module.exports = { SUPPORTED_LOCALES, normalizeLocale };
