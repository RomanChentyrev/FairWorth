import React, { useEffect, useState } from 'react';
import { useLang } from '../i18n/LanguageContext';

export default function ApiStatusBanner() {
  const [notice, setNotice] = useState(null);
  const { lang , l} = useLang();
  useEffect(() => {
    const handler = event => {
      const status = event.detail?.status;
      const fallback = status === 429
        ? (l('Too many requests. Wait a moment and try again.', 'Слишком много запросов. Подождите и попробуйте снова.'))
        : (l('Your session expired or access was denied.', 'Сессия истекла или доступ запрещён.'));
      setNotice({ status, message: event.detail?.message || fallback });
    };
    window.addEventListener('fairworth-api-status', handler);
    return () => window.removeEventListener('fairworth-api-status', handler);
  }, [lang]);
  if (!notice) return null;
  return <div role="alert" className="api-status-banner"><span>{notice.message}</span><button onClick={() => setNotice(null)} aria-label={l('Close', 'Закрыть')}>×</button></div>;
}
