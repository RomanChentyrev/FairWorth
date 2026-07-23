import React, { useEffect, useState } from 'react';
import { Armchair, Briefcase, Check, ChevronDown, Clock, Plane, Route } from 'lucide-react';
import ScoreRing from './ScoreRing';
import { useLang } from '../i18n/LanguageContext';
import { useTripBasket } from '../context/TripBasketContext';
import styles from './FlightCard.module.css';
import { formatAmount } from '../utils/money';

export default function FlightCard({ flight, isRecommended, compact = false, leg, passengers = 1 }) {
  const { t, lang } = useLang();
  const { basket, selectFlight } = useTripBasket();
  const [faresOpen, setFaresOpen] = useState(false);
  const [selectedFareId, setSelectedFareId] = useState(flight.fare_options?.[0]?.id || null);
  const fareOptions = flight.fare_options || [];
  const selectedFare = fareOptions.find(option => option.id === selectedFareId) || fareOptions[0];

  useEffect(() => {
    setSelectedFareId(flight.fare_options?.[0]?.id || null);
  }, [flight.id, flight.fare_options]);
  const stopsLabel = flight.stops === null || flight.stops === undefined
    ? (lang === 'ru' ? 'Пересадки неизвестны' : 'Stops unknown')
    : flight.stops === 0
    ? t('flight_direct')
    : `${flight.stops} ${t('flight_stops')}`;
  const liveOffer = flight.fare_type === 'live_offer';
  const currentMetasearch = flight.fare_type === 'current_metasearch_fare' || flight.source === 'searchapi';
  const meta = liveOffer
    ? (lang === 'ru' ? 'Подтверждаемое предложение' : 'Revalidatable offer')
    : currentMetasearch
      ? (lang === 'ru' ? 'Актуальная цена Google Flights' : 'Current Google Flights fare')
      : (lang === 'ru' ? 'Ориентировочная цена Travelpayouts' : 'Travelpayouts indicative fare');
  const hasFareRange = fareOptions.length > 1 && flight.price_min !== flight.price_max;
  const priceLabel = hasFareRange
    ? `$${formatAmount(flight.price_min, lang)}-$${formatAmount(flight.price_max, lang)}`
    : `$${formatAmount(flight.price, lang)}`;
  const selectedPrice = selectedFare ? `$${formatAmount(selectedFare.price, lang)}` : priceLabel;
  const fareObservedAt = selectedFare?.fare_observed_at || flight.fare_observed_at;
  const fareReceivedAt = selectedFare?.fare_received_at || flight.fare_received_at || fareObservedAt;
  const fareConfidence = selectedFare?.fare_confidence ?? flight.fare_confidence;
  const observedLabel = fareObservedAt
    ? new Date(fareObservedAt).toLocaleString(lang)
    : (lang === 'ru' ? 'время не передано' : 'time unavailable');
  const receivedLabel = fareReceivedAt
    ? new Date(fareReceivedAt).toLocaleString(lang)
    : (lang === 'ru' ? 'время не передано' : 'time unavailable');
  const hasDistinctObservation = fareObservedAt && fareReceivedAt && new Date(fareObservedAt).getTime() !== new Date(fareReceivedAt).getTime();
  const basketKey = leg === 'return' ? 'returnFlight' : 'outboundFlight';
  const selectedInBasket = leg && basket[basketKey]?.flightId === flight.id && basket[basketKey]?.fareId === selectedFare?.id;

  const handleSelectFlight = () => {
    if (!leg || !selectedFare) return;
    const passengerCount = Number(passengers) || 1;
    selectFlight(leg, {
      flightId: flight.id,
      fareId: selectedFare.id,
      title: `${flight.airline} ${flight.flight_number}`,
      airline: flight.airline,
      flightNumber: flight.flight_number,
      originCode: flight.origin_code,
      destinationCode: flight.destination_code,
      date: selectedFare.departure_date || flight.departure_date,
      departureTime: selectedFare.departure_time || flight.departure_time,
      arrivalTime: selectedFare.arrival_time || flight.arrival_time,
      duration: selectedFare.duration_label || flight.duration_label,
      stops: flight.stops,
      cabinClass: flight.cabin_class,
      provider: selectedFare.operator,
      pricePerPerson: Number(selectedFare.price || flight.price || 0),
      passengers: passengerCount,
      totalPrice: Number(selectedFare.price || flight.price || 0) * passengerCount,
      currency: 'USD',
      fairworthScore: flight.fairworth_score,
      adjustedScore: flight.adjusted_score,
      scoreReliability: flight.score_reliability,
      fareConfidence: flight.fare_confidence,
      fareType: flight.fare_type || 'indicative',
      fareObservedAt,
      fareReceivedAt,
      availabilityConfirmed: flight.availability_confirmed === true,
      scoreVersion: flight.score_version,
    });
  };

  return (
    <div className={`${styles.card} ${compact ? styles.compact : ''} ${isRecommended ? styles.recommended : ''}`}>
      <div className={styles.timeline}>
        {isRecommended && <div className={styles.recBadge}>{t('card_top')}</div>}
        <div className={styles.airlineMark}>
          <Plane size={22} />
        </div>
        <div className={styles.airline}>{flight.airline}</div>
        <div className={styles.flightNumber}>{flight.flight_number}</div>
      </div>

      <div className={styles.body}>
        <div className={styles.topRow}>
          <div className={styles.route}>
            <div className={styles.point}>
              <span className={styles.date}>{selectedFare?.departure_date_label || flight.departure_date_label || flight.departure_date}</span>
              <span className={styles.time}>{selectedFare?.departure_time || flight.departure_time}</span>
              <span className={styles.code}>{flight.origin_code}</span>
              <span className={styles.city}>{flight.origin_city}</span>
            </div>
            <div className={styles.path}>
              <span className={styles.pathLine} />
              <Plane size={15} />
              <span className={styles.pathLine} />
              <span className={styles.duration}><Clock size={12} /> {selectedFare?.duration_label || flight.duration_label}</span>
            </div>
            <div className={styles.point}>
              <span className={styles.date}>{selectedFare?.arrival_date_label || flight.arrival_date_label || flight.arrival_date || ''}</span>
              <span className={styles.time}>{selectedFare?.arrival_time || flight.arrival_time}</span>
              <span className={styles.code}>{flight.destination_code}</span>
              <span className={styles.city}>{flight.destination_city}</span>
            </div>
          </div>
          <div className={styles.scoreBlock}>
            <ScoreRing score={flight.fairworth_score || 0} size={54} />
            <span className={styles.reliability}>
              {lang === 'ru' ? 'Уверенность' : 'Confidence'}: {flight.score_reliability ?? '—'}%
            </span>
            <span className={styles.adjustedScore}>
              {lang === 'ru' ? 'Для рейтинга' : 'Ranking'}: {flight.adjusted_score ?? flight.fairworth_score}/100
            </span>
          </div>
        </div>

        <div className={styles.tags}>
          <span className={`${styles.tag} ${styles.tagGreen}`}><Route size={12} /> {stopsLabel}</span>
          <span className={`${styles.tag} ${styles.tagBlue}`}><Armchair size={12} /> {flight.cabin_class
            ? t(`flight_class_${flight.cabin_class}`)
            : (lang === 'ru' ? 'Класс не подтверждён' : 'Cabin not confirmed')}</span>
          <span className={styles.tag}><Briefcase size={12} /> {flight.baggage || (lang === 'ru' ? 'Багаж неизвестен' : 'Baggage unknown')}</span>
          {flight.connection_airports?.length > 0 && <span className={styles.tag}><Route size={12} /> {lang === 'ru' ? 'через' : 'via'} {flight.connection_airports.join(', ')}</span>}
          {flight.self_transfer && <span className={styles.tag}>{lang === 'ru' ? 'Самостоятельная пересадка' : 'Self-transfer'}</span>}
          {flight.aircraft && <span className={styles.tag}>{flight.aircraft}</span>}
        </div>
        {flight.score_breakdown && (
          <details className={styles.scoreDetails}>
            <summary>{lang === 'ru' ? 'Почему такой Score' : 'Why this Score'}</summary>
            <div className={styles.scoreGrid}>
              <span>{lang === 'ru' ? 'Ценность' : 'Value'} <strong>{flight.score_breakdown.value ?? '—'}</strong></span>
              <span>{lang === 'ru' ? 'Маршрут' : 'Itinerary'} <strong>{flight.score_breakdown.itinerary ?? '—'}</strong></span>
              <span>{lang === 'ru' ? 'Предпочтения' : 'Preferences'} <strong>{flight.score_breakdown.preferences ?? '—'}</strong></span>
              <span>{lang === 'ru' ? 'Расписание' : 'Schedule'} <strong>{flight.score_breakdown.schedule ?? '—'}</strong></span>
              <span>{lang === 'ru' ? 'Надёжность тарифа' : 'Fare confidence'} <strong>{flight.fare_confidence ?? '—'}%</strong></span>
              {flight.score_context?.group_seating_score !== null && flight.score_context?.group_seating_score !== undefined && (
                <span>{lang === 'ru' ? 'Размещение группы' : 'Group seating'} <strong>{flight.score_context.group_seating_score}</strong></span>
              )}
              {flight.score_context?.connection_score !== null && flight.score_context?.connection_score !== undefined && (
                <span>{lang === 'ru' ? 'Качество пересадки' : 'Connection quality'} <strong>{flight.score_context.connection_score}</strong></span>
              )}
            </div>
            {flight.unknown_score_data?.length > 0 && (
              <p className={styles.unknownData}>
                {lang === 'ru' ? 'Провайдер не передал: ' : 'Provider data unavailable: '}
                {flight.unknown_score_data.join(', ')}. {lang === 'ru' ? 'Это не снижает базовый Score.' : 'This does not lower the base Score.'}
              </p>
            )}
            <div className={styles.scoreMeta}>v{flight.score_version || '—'}</div>
          </details>
        )}

        <div className={styles.bottomRow}>
          <div className={styles.meta}>
            <strong>{meta}</strong>
            <span>{lang === 'ru' ? 'Получено Fairworth' : 'Received by Fairworth'}: {receivedLabel}</span>
            {hasDistinctObservation && <span>{lang === 'ru' ? 'Наблюдение источника' : 'Provider observation'}: {observedLabel}</span>}
            <span>{lang === 'ru' ? 'Уверенность в цене' : 'Fare confidence'}: {fareConfidence ?? '—'}%</span>
          </div>
          <div className={styles.priceBlock}>
            <span className={styles.priceLabel}>{liveOffer || currentMetasearch
              ? (hasFareRange ? (lang === 'ru' ? 'выбранный тариф' : 'selected fare') : (lang === 'ru' ? 'цена за пассажира' : 'price per passenger'))
              : (hasFareRange ? (lang === 'ru' ? 'выбранный ориентир' : 'selected estimate') : (lang === 'ru' ? 'ориентир от' : 'estimate from'))}</span>
            <span className={styles.price}>{selectedPrice}</span>
            <span className={styles.priceNote}>{hasFareRange ? `${priceLabel} ${lang === 'ru' ? 'диапазон' : 'range'}` : t('flight_per_person')}</span>
          </div>
        </div>
        <div className={styles.fareWarning}>
          {liveOffer
            ? (lang === 'ru'
              ? 'Цена и наличие актуальны на момент поиска. Перед оформлением предложение будет проверено повторно.'
              : 'Price and availability are current at search time. The offer must be revalidated before checkout.')
            : currentMetasearch
              ? (lang === 'ru'
                ? 'Цена получена из Google Flights на момент поиска. Наличие места и финальная сумма требуют проверки у продавца.'
                : 'This fare was found in Google Flights at search time. Seat availability and the final total require seller verification.')
            : (lang === 'ru'
              ? 'Финальная цена и наличие места не подтверждены. Проверьте их у поставщика перед оформлением.'
              : 'Final price and seat availability are not confirmed. Verify both with the provider before booking.')}
        </div>
        {fareOptions.length > 0 && (
          <div className={styles.fares}>
            <button
              type="button"
              className={styles.faresToggle}
              onClick={() => setFaresOpen(open => !open)}
            >
              <span>{fareOptions.length} {liveOffer || currentMetasearch
                ? (lang === 'ru' ? 'актуальных тарифов' : fareOptions.length === 1 ? 'current fare' : 'current fares')
                : (lang === 'ru' ? 'ориентировочных тарифов' : fareOptions.length === 1 ? 'indicative fare' : 'indicative fares')}</span>
              <ChevronDown size={14} className={faresOpen ? styles.chevronOpen : ''} />
            </button>
            {faresOpen && (
              <div className={styles.fareList}>
                {fareOptions.map(option => {
                  const selected = selectedFareId === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      className={`${styles.fareOption} ${selected ? styles.fareOptionSelected : ''}`}
                      onClick={() => setSelectedFareId(option.id)}
                    >
                      <span className={styles.fareProvider}>{option.departure_date_label} · {option.operator}</span>
                      <span className={styles.farePrice}>${formatAmount(option.price, lang)}</span>
                      {selected && <Check size={13} />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {leg && (
          <button
            type="button"
            className={`${styles.selectBtn} ${selectedInBasket ? styles.selectBtnActive : ''}`}
            onClick={handleSelectFlight}
          >
            {selectedInBasket
              ? (lang === 'ru' ? 'Выбрано для поездки' : 'Selected for trip')
              : (lang === 'ru' ? 'В поездку' : 'Add to trip')}
          </button>
        )}
      </div>
    </div>
  );
}
