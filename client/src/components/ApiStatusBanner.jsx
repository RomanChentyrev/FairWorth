import React, { useEffect, useState } from 'react';
import { useLang } from '../i18n/LanguageContext';

export default function ApiStatusBanner() {
  const [notice, setNotice] = useState(null);
  const { lang } = useLang();
  useEffect(() => {
    const handler = event => {
      const status = event.detail?.status;
      const fallback = status === 429
        ? (lang === 'ru' ? 'Слишком много запросов. Подождите и попробуйте снова.' : 'Too many requests. Wait a moment and try again.')
        : (lang === 'ru' ? 'Сессия истекла или доступ запрещён.' : 'Your session expired or access was denied.');
      setNotice({ status, message: event.detail?.message || fallback });
    };
    window.addEventListener('fairworth-api-status', handler);
    return () => window.removeEventListener('fairworth-api-status', handler);
  }, [lang]);
  if (!notice) return null;
  return <div role="alert" className="api-status-banner"><span>{notice.message}</span><button onClick={() => setNotice(null)} aria-label="Close">×</button></div>;
}
