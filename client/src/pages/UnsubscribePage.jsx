import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { notificationsApi } from '../api';
import { useLang } from '../i18n/LanguageContext';

export default function UnsubscribePage() {
  const [params] = useSearchParams(); const { lang , l} = useLang(); const [state, setState] = useState('loading');
  useEffect(() => {
    const token = params.get('token');
    if (!token) { setState('error'); return; }
    notificationsApi.unsubscribe(token).then(() => setState('done')).catch(() => setState('error'));
  }, [params]);
  return <main className="system-page"><h1>{l('Notification settings', 'Настройки уведомлений')}</h1>
    <p>{state === 'loading' ? (l('Updating your settings…', 'Обновляем настройки…')) : state === 'done' ? (l('Email notifications and price watches have been disabled.', 'Email-уведомления и отслеживания цен отключены.')) : (l('This link is invalid or has already been used.', 'Ссылка недействительна или уже использована.'))}</p>
    <Link to="/preferences">{l('Open settings', 'Открыть настройки')}</Link>
  </main>;
}
