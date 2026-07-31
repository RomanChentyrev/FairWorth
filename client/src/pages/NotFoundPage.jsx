import React from 'react';
import { Link } from 'react-router-dom';
import { useLang } from '../i18n/LanguageContext';
export default function NotFoundPage() {
  const { lang , l} = useLang();
  return <main className="system-page"><h1>404</h1><p>{l('Page not found.', 'Страница не найдена.')}</p><Link to="/">{l('Back home', 'На главную')}</Link></main>;
}
