import React from 'react';
import { Link } from 'react-router-dom';
import { useLang } from '../i18n/LanguageContext';
export default function NotFoundPage() {
  const { lang } = useLang();
  return <main className="system-page"><h1>404</h1><p>{lang === 'ru' ? 'Страница не найдена.' : 'Page not found.'}</p><Link to="/">{lang === 'ru' ? 'На главную' : 'Back home'}</Link></main>;
}
