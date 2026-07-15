import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { notificationsApi } from '../api';
import { useLang } from '../i18n/LanguageContext';

export default function UnsubscribePage() {
  const [params] = useSearchParams(); const { lang } = useLang(); const [state, setState] = useState('loading');
  useEffect(() => {
    const token = params.get('token');
    if (!token) { setState('error'); return; }
    notificationsApi.unsubscribe(token).then(() => setState('done')).catch(() => setState('error'));
  }, [params]);
  return <main className="system-page"><h1>{lang === 'ru' ? 'Настройки уведомлений' : 'Notification settings'}</h1>
    <p>{state === 'loading' ? (lang === 'ru' ? 'Обновляем настройки…' : 'Updating your settings…') : state === 'done' ? (lang === 'ru' ? 'Email-уведомления и отслеживания цен отключены.' : 'Email notifications and price watches have been disabled.') : (lang === 'ru' ? 'Ссылка недействительна или уже использована.' : 'This link is invalid or has already been used.')}</p>
    <Link to="/preferences">{lang === 'ru' ? 'Открыть настройки' : 'Open settings'}</Link>
  </main>;
}
