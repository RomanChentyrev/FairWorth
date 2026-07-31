import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { partnersApi } from '../api';
import { useLang } from '../i18n/LanguageContext';
export default function BookingReturnPage() {
  const [params] = useSearchParams(); const { lang , l} = useLang(); const [click, setClick] = useState(null); const [error, setError] = useState('');
  useEffect(() => {
    const id = params.get('click_id'); if (!id) { setError('Missing click_id'); return undefined; }
    let attempts = 0; let timer;
    const load = () => partnersApi.getClick(id).then(response => {
      setClick(response.data.click); attempts += 1;
      if (response.data.click.status !== 'booking_completed' && attempts < 10) timer = window.setTimeout(load, 3000);
    }).catch(e => setError(e.response?.data?.error || e.message));
    load(); return () => window.clearTimeout(timer);
  }, []);
  return <main className="system-page"><h1>{l('Back from provider', 'Возвращение от партнёра')}</h1>{error && <p>{error}</p>}{!click && !error && <p>{l('Checking booking status…', 'Проверяем статус…')}</p>}{click && <><p>{click.status === 'booking_completed' ? (l('The provider confirmed your booking.', 'Партнёр подтвердил бронирование.')) : (l('Your referral was recorded. Provider confirmation has not arrived yet.', 'Переход записан. Подтверждение партнёра ещё не получено.'))}</p><p>{click.booking_reference && `Reference: ${click.booking_reference}`}</p><Link to="/">{l('Back home', 'На главную')}</Link></>}</main>;
}
