import React, { createContext, useContext, useEffect, useState } from 'react';
import { translations } from './translations';
import { SUPPORTED_LANGUAGE_CODES } from './languages';
import dePhrases from './phrases/de.json';
import esPhrases from './phrases/es.json';
import frPhrases from './phrases/fr.json';
import itPhrases from './phrases/it.json';
import ruPhrases from './phrases/ru.json';
import zhCNPhrases from './phrases/zh-CN.json';
import arPhrases from './phrases/ar.json';
import { usersApi } from '../api';

export const LanguageContext = createContext();
const phraseCatalogues = {
  de: dePhrases,
  es: esPhrases,
  fr: frPhrases,
  it: itPhrases,
  ru: ruPhrases,
  'zh-CN': zhCNPhrases,
  ar: arPhrases,
};
const phraseEntries = Object.fromEntries(
  Object.entries(phraseCatalogues).map(([locale, catalogue]) => [
    locale,
    Object.entries(catalogue)
      .filter(([source]) => source.length >= 4)
      .sort(([left], [right]) => right.length - left.length),
  ]),
);
const translatedProps = ['aria-label', 'placeholder', 'title'];

function translateText(value, lang) {
  if (lang === 'en' || typeof value !== 'string') return value;
  const catalogue = phraseCatalogues[lang] || {};
  if (catalogue[value]) return catalogue[value];

  return (phraseEntries[lang] || [])
    .filter(([source]) => value.includes(source))
    .reduce(
      (result, [source, translation]) => result.replaceAll(source, translation),
      value,
    );
}

function translateValue(value, lang) {
  if (typeof value === 'string') return translateText(value, lang);
  if (Array.isArray(value)) return value.map(item => translateValue(item, lang));
  if (React.isValidElement(value)) {
    const props = {};
    for (const name of translatedProps) {
      if (typeof value.props[name] === 'string') props[name] = translateText(value.props[name], lang);
    }
    if (value.props.children !== undefined) props.children = React.Children.map(
      value.props.children,
      child => translateValue(child, lang),
    );
    return React.cloneElement(value, props);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, translateValue(item, lang)]),
    );
  }
  return value;
}

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(() => {
    // One-time migration: English became the product default in language schema v2.
    if (localStorage.getItem('fw_language_version') !== '2') {
      localStorage.setItem('fw_language_version', '2');
      localStorage.setItem('fw_lang', 'en');
      return 'en';
    }
    const stored = localStorage.getItem('fw_lang') || 'en';
    return SUPPORTED_LANGUAGE_CODES.has(stored) ? stored : 'en';
  });

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);

  const setLanguage = (next) => {
    const supported = SUPPORTED_LANGUAGE_CODES.has(next) ? next : 'en';
    setLang(supported);
    localStorage.setItem('fw_lang', supported);
    if (localStorage.getItem('fw_user')) usersApi.updateLocale(supported).catch(() => {});
  };

  const toggleLang = () => setLanguage(lang === 'ru' ? 'en' : 'ru');
  const t = (key, replacements = {}) => {
    const value = translations[lang]?.[key] || translations.en?.[key] || key;
    return Object.entries(replacements).reduce(
      (result, [name, replacement]) => result.replaceAll(`{${name}}`, replacement),
      value,
    );
  };
  const l = (english, russian = english) => {
    if (lang === 'en') return english;
    if (lang === 'ru') return russian;
    return translateValue(english, lang);
  };

  return (
    <LanguageContext.Provider value={{ lang, setLanguage, toggleLang, t, l }}>
      {children}
    </LanguageContext.Provider>
  );
}

export const useLang = () => useContext(LanguageContext);
