import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { partnersApi } from '../api';
import { useLang } from '../i18n/LanguageContext';
export default function BookingReturnPage() {
  const [params] = useSearchParams(); const { lang } = useLang(); const [click, setClick] = useState(null); const [error, setError] = useState('');
  useEffect(() => {
    const id = params.get('click_id'); if (!id) { setError('Missing click_id'); return undefined; }
    let attempts = 0; let timer;
    const load = () => partnersApi.getClick(id).then(response => {
      setClick(response.data.click); attempts += 1;
      if (response.data.click.status !== 'booking_completed' && attempts < 10) timer = window.setTimeout(load, 3000);
    }).catch(e => setError(e.response?.data?.error || e.message));
    load(); return () => window.clearTimeout(timer);
  }, []);
  return <main className="system-page"><h1>{lang === 'ru' ? 'Возвращение от партнёра' : 'Back from provider'}</h1>{error && <p>{error}</p>}{!click && !error && <p>{lang === 'ru' ? 'Проверяем статус…' : 'Checking booking status…'}</p>}{click && <><p>{click.status === 'booking_completed' ? (lang === 'ru' ? 'Партнёр подтвердил бронирование.' : 'The provider confirmed your booking.') : (lang === 'ru' ? 'Переход записан. Подтверждение партнёра ещё не получено.' : 'Your referral was recorded. Provider confirmation has not arrived yet.')}</p><p>{click.booking_reference && `Reference: ${click.booking_reference}`}</p><Link to="/">{lang === 'ru' ? 'На главную' : 'Back home'}</Link></>}</main>;
}
