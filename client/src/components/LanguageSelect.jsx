import React from 'react';
import { Languages } from 'lucide-react';
import { useLang } from '../i18n/LanguageContext';
import { SUPPORTED_LANGUAGES } from '../i18n/languages';
import styles from './LanguageSelect.module.css';

export default function LanguageSelect({ compact = false, className = '' }) {
  const { lang, setLanguage, t } = useLang();

  return (
    <label className={`${styles.control} ${compact ? styles.compact : ''} ${className}`}>
      <Languages size={15} aria-hidden="true" />
      <span className={styles.srOnly}>{t('language_select')}</span>
      <select
        value={lang}
        onChange={event => setLanguage(event.target.value)}
        aria-label={t('language_select')}
      >
        {SUPPORTED_LANGUAGES.map(language => (
          <option key={language.code} value={language.code}>
            {language.flag} {compact ? language.shortLabel : language.label}
          </option>
        ))}
      </select>
    </label>
  );
}
