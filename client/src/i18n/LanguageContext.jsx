import React, { createContext, useContext, useEffect, useState } from 'react';
import { translations } from './translations';

const LanguageContext = createContext();

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(() => {
    // One-time migration: English became the product default in language schema v2.
    if (localStorage.getItem('fw_language_version') !== '2') {
      localStorage.setItem('fw_language_version', '2');
      localStorage.setItem('fw_lang', 'en');
      return 'en';
    }
    return localStorage.getItem('fw_lang') || 'en';
  });

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const toggleLang = () => {
    const next = lang === 'ru' ? 'en' : 'ru';
    setLang(next);
    localStorage.setItem('fw_lang', next);
  };

  const t = (key) => translations[lang]?.[key] || translations.en?.[key] || key;

  return (
    <LanguageContext.Provider value={{ lang, toggleLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export const useLang = () => useContext(LanguageContext);
