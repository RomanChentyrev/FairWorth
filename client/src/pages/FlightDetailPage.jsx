import React, { useMemo } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CalendarDays, Check, Clock3, Plane, Route, ShieldCheck, Users } from 'lucide-react';
import ScoreRing from '../components/ScoreRing';
import { useTripBasket } from '../context/TripBasketContext';
import { useLang } from '../i18n/LanguageContext';
import { formatAmount } from '../utils/money';
import styles from './FlightDetailPage.module.css';

function savedFlight(id) {
  try {
    return JSON.parse(window.sessionStorage.getItem(`tripalora-flight-${id}`) || 'null');
  } catch {
    return null;
  }
}

function dateTimeLabel(value, lang) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(lang, {
    weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function durationLabel(minutes) {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value <= 0) return null;
  return `${Math.floor(value / 60)}h ${String(value % 60).padStart(2, '0')}m`;
}

export default function FlightDetailPage() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { lang, l } = useLang();
  const { basket, selectFlight } = useTripBasket();
  const persisted = useMemo(() => savedFlight(id), [id]);
  const flight = location.state?.flight || persisted?.flight;
  const context = location.state?.context || persisted?.context || {};

  if (!flight) {
    return <main className={styles.missing}>
      <Plane size={30} />
      <h1>{l('This fare needs a fresh search', 'Для этого тарифа нужен новый поиск')}</h1>
      <p>{l('Dynamic flight offers can expire. Open the flight search to check the route again.', 'Предложения перелётов могут устаревать. Откройте поиск, чтобы повторно проверить маршрут.')}</p>
      <button type="button" onClick={() => navigate('/flights')}>{l('Open flight search', 'Открыть поиск перелётов')}</button>
    </main>;
  }

  const travelers = Number(context.travelers || 1);
  const selected = basket.outboundFlight?.flightId === flight.id;
  const searchQuery = new URLSearchParams({
    from: context.origin || flight.origin,
    to: context.destination || flight.destination,
    departure_date: context.date_start || flight.departure_at?.slice(0, 10) || '',
    return_date: context.date_end || '',
    passengers: String(travelers),
    cabin_class: context.cabin_class || 'economy',
  });
  const stops = flight.stops === 0
    ? l('Direct', 'Без пересадок')
    : flight.stops == null ? l('Stops not confirmed', 'Пересадки не подтверждены') : l(`${flight.stops} stop${flight.stops === 1 ? '' : 's'}`, `${flight.stops} пересадок`);

  const addToTrip = () => selectFlight('outbound', {
    flightId: flight.id,
    title: `${flight.airline} ${flight.flight_number || ''}`.trim(),
    airline: flight.airline,
    flightNumber: flight.flight_number,
    originCode: flight.origin,
    destinationCode: flight.destination,
    date: flight.departure_at?.slice(0, 10) || context.date_start,
    departureTime: flight.departure_at,
    arrivalTime: flight.arrival_at,
    duration: durationLabel(flight.duration),
    stops: flight.stops,
    provider: flight.source,
    pricePerPerson: flight.price,
    passengers: travelers,
    totalPrice: Number(flight.price || 0) * travelers,
    currency: flight.currency || 'USD',
    fairworthScore: flight.score,
    adjustedScore: flight.adjusted_score,
    fareConfidence: flight.fare_confidence,
  });

  return <main className={styles.page}>
    <button className={styles.back} type="button" onClick={() => navigate(-1)}><ArrowLeft size={17} />{l('Back to AI Mode', 'Назад в AI Mode')}</button>
    <section className={styles.hero}>
      <div className={styles.airlineMark}><Plane size={28} /></div>
      <div className={styles.heading}>
        <span>{l('Selected flight', 'Выбранный перелёт')}</span>
        <h1>{flight.airline}{flight.flight_number ? ` · ${flight.flight_number}` : ''}</h1>
        <p>{flight.origin} <span>→</span> {flight.destination}</p>
      </div>
      <ScoreRing score={flight.score || 0} size={76} />
    </section>

    <section className={styles.routePanel}>
      <div className={styles.routePoint}><span>{flight.origin}</span><strong>{dateTimeLabel(flight.departure_at, lang) || context.date_start}</strong><small>{l('Departure', 'Вылет')}</small></div>
      <div className={styles.routeLine}><span /><Plane size={18} /><span /><strong>{durationLabel(flight.duration) || l('Duration pending', 'Время в пути уточняется')}</strong></div>
      <div className={styles.routePoint}><span>{flight.destination}</span><strong>{dateTimeLabel(flight.arrival_at, lang) || l('Arrival time pending', 'Время прибытия уточняется')}</strong><small>{l('Arrival', 'Прибытие')}</small></div>
    </section>

    <div className={styles.detailsLayout}>
      <section className={styles.details}>
        <h2>{l('Flight details', 'Детали перелёта')}</h2>
        <div className={styles.detailGrid}>
          <div><CalendarDays size={18} /><span><small>{l('Travel dates', 'Даты поездки')}</small><strong>{context.date_start}{context.date_end ? ` – ${context.date_end}` : ''}</strong></span></div>
          <div><Route size={18} /><span><small>{l('Itinerary', 'Маршрут')}</small><strong>{stops}</strong></span></div>
          <div><Users size={18} /><span><small>{l('Travelers', 'Путешественники')}</small><strong>{travelers}</strong></span></div>
          <div><ShieldCheck size={18} /><span><small>{l('Fare confidence', 'Уверенность тарифа')}</small><strong>{flight.fare_confidence == null ? l('Not provided', 'Не указана') : `${flight.fare_confidence}%`}</strong></span></div>
          <div><Clock3 size={18} /><span><small>{l('Source', 'Источник')}</small><strong>{flight.source || l('Connected provider', 'Подключённый поставщик')}</strong></span></div>
        </div>
        <div className={styles.notice}><ShieldCheck size={17} /><p>{l('The price was received from a connected provider. Final price and seat availability must be checked again before booking.', 'Цена получена от подключённого поставщика. Перед бронированием необходимо повторно проверить итоговую цену и наличие мест.')}</p></div>
      </section>

      <aside className={styles.summary}>
        <span>{l('Price per traveler', 'Цена за пассажира')}</span>
        <strong>{formatAmount(flight.price, lang)} {flight.currency || 'USD'}</strong>
        <small>{travelers} × {formatAmount(flight.price, lang)} {flight.currency || 'USD'}</small>
        <div className={styles.total}><span>{l('Trip total', 'Итого')}</span><strong>{formatAmount(Number(flight.price || 0) * travelers, lang)} {flight.currency || 'USD'}</strong></div>
        <button type="button" className={styles.primary} onClick={addToTrip}>{selected ? <><Check size={17} />{l('Added to trip', 'Добавлено в поездку')}</> : <><Plane size={17} />{l('Add to trip', 'Добавить в поездку')}</>}</button>
        <button type="button" className={styles.secondary} onClick={() => navigate(`/flights?${searchQuery}`)}>{l('Recheck this route', 'Повторно проверить маршрут')}</button>
      </aside>
    </div>
  </main>;
}
