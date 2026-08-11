const { normalizeLocale } = require('../config/locales');

const catalogues = {
  en: require('./messages.en.json'),
  ru: require('./messages.ru.json'),
  de: require('./messages.de.json'),
  fr: require('./messages.fr.json'),
  it: require('./messages.it.json'),
  es: require('./messages.es.json'),
  'zh-CN': require('./messages.zh-CN.json'),
  ar: require('./messages.ar.json'),
};

function t(locale, key, replacements = {}) {
  const language = normalizeLocale(locale);
  const template = catalogues[language]?.[key] || catalogues.en[key] || key;
  return Object.entries(replacements).reduce(
    (value, [name, replacement]) => value.replaceAll(`{${name}}`, String(replacement)),
    template,
  );
}

module.exports = { catalogues, t };
