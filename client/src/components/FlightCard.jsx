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
  const stopsLabel = flight.stops === 0
    ? t('flight_direct')
    : `${flight.stops} ${t('flight_stops')}`;
  const meta = flight.source === 'travelpayouts'
    ? 'Travelpayouts fare'
    : `${flight.seats_left} ${t('flight_seats_left')}`;
  const hasFareRange = fareOptions.length > 1 && flight.price_min !== flight.price_max;
  const priceLabel = hasFareRange
    ? `$${formatAmount(flight.price_min, lang)}-$${formatAmount(flight.price_max, lang)}`
    : `$${formatAmount(flight.price, lang)}`;
  const selectedPrice = selectedFare ? `$${formatAmount(selectedFare.price, lang)}` : priceLabel;
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
          <ScoreRing score={flight.fairworth_score || 0} size={54} />
        </div>

        <div className={styles.tags}>
          <span className={`${styles.tag} ${styles.tagGreen}`}><Route size={12} /> {stopsLabel}</span>
          <span className={`${styles.tag} ${styles.tagBlue}`}><Armchair size={12} /> {t(`flight_class_${flight.cabin_class}`)}</span>
          <span className={styles.tag}><Briefcase size={12} /> {flight.baggage}</span>
          <span className={styles.tag}>{flight.aircraft}</span>
        </div>

        <div className={styles.bottomRow}>
          <div className={styles.meta}>
            {meta}
          </div>
          <div className={styles.priceBlock}>
            <span className={styles.priceLabel}>{hasFareRange ? 'selected' : t('card_from')}</span>
            <span className={styles.price}>{selectedPrice}</span>
            <span className={styles.priceNote}>{hasFareRange ? `${priceLabel} range` : t('flight_per_person')}</span>
          </div>
        </div>
        {fareOptions.length > 0 && (
          <div className={styles.fares}>
            <button
              type="button"
              className={styles.faresToggle}
              onClick={() => setFaresOpen(open => !open)}
            >
              <span>{fareOptions.length} {fareOptions.length === 1 ? 'fare' : 'fares'} available</span>
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
