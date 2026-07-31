import React, { useState } from 'react';
import { Hotel, Plane, ShoppingBag, Trash2, X, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLang } from '../i18n/LanguageContext';
import { useTripBasket } from '../context/TripBasketContext';
import { interactionsApi, notificationsApi } from '../api';
import styles from './TripBasket.module.css';
import { formatAmount } from '../utils/money';

function money(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return `$${formatAmount(numeric)}`;
}

function BasketItem({ icon, title, subtitle, price, onRemove, emptyText }) {
  const { l } = useLang();
  return (
    <div className={styles.item}>
      <div className={styles.itemIcon}>{icon}</div>
      <div className={styles.itemBody}>
        <div className={styles.itemTitle}>{title || emptyText}</div>
        {subtitle && <div className={styles.itemSubtitle}>{subtitle}</div>}
      </div>
      <div className={styles.itemSide}>
        {price && <span className={styles.itemPrice}>{price}</span>}
        {onRemove && title && (
          <button type="button" className={styles.removeBtn} onClick={onRemove} aria-label={l('Remove', 'Удалить')}>
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

export default function TripBasket() {
  const navigate = useNavigate();
  const { lang , l} = useLang();
  const { basket, selectedCount, total, removeItem, clearBasket } = useTripBasket();
  const [open, setOpen] = useState(false);
  const [saveState, setSaveState] = useState('idle');
  const totalLabel = money(total);
  const selectedLegs = [basket.outboundFlight, basket.returnFlight].filter(Boolean);
  const tripFlightScore = selectedLegs.length > 1 && selectedLegs.every(flight => Number.isFinite(Number(flight.adjustedScore)))
    ? Math.round(
      (selectedLegs.reduce((sum, flight) => sum + Number(flight.adjustedScore), 0) / selectedLegs.length) * 0.8
      + Math.min(...selectedLegs.map(flight => Number(flight.adjustedScore))) * 0.2
    )
    : null;

  const hotelSubtitle = basket.hotel
    ? `${basket.hotel.city || basket.hotel.location || ''}${basket.hotel.nights ? ` · ${basket.hotel.nights} ${l('nights', 'ноч.')}` : ''}`
    : '';

  const flightSubtitle = (flight) => flight
    ? `${flight.originCode} → ${flight.destinationCode} · ${flight.date || ''} · ${flight.provider || ''}`
    : '';

  const removeBasketItem = (item) => {
    if (item === 'hotel' && basket.hotel?.id) {
      interactionsApi.track('trip_remove', { hotel_id: basket.hotel.id, context: { source: 'trip_basket' } }).catch(() => {});
    }
    removeItem(item);
  };

  const clearTripBasket = () => {
    if (basket.hotel?.id) interactionsApi.track('trip_remove', { hotel_id: basket.hotel.id, context: { source: 'clear_basket' } }).catch(() => {});
    clearBasket();
  };

  const startCheckout = () => {
    interactionsApi.track('checkout_started', { hotel_id: basket.hotel.id, context: { items: selectedCount, total } }).catch(() => {});
    setOpen(false);
    navigate('/booking/demo');
  };

  const saveTrip = async () => {
    const startDate = basket.outboundFlight?.date || basket.hotel?.checkIn;
    if (!startDate) { setSaveState('dates'); return; }
    setSaveState('saving');
    try {
      await notificationsApi.createTrip({
        title: basket.hotel?.city ? `${l('Trip', 'Поездка')}: ${basket.hotel.city}` : (l('My trip', 'Моя поездка')),
        destination: basket.hotel?.city || basket.outboundFlight?.destinationCode,
        start_date: startDate,
        end_date: basket.hotel?.checkOut || basket.returnFlight?.date || null,
        reminder_enabled: true,
        items: [
          basket.hotel && { type: 'hotel', external_id: basket.hotel.id, check_in_at: `${basket.hotel.checkIn}T12:00:00Z`, metadata: basket.hotel },
          basket.outboundFlight && { type: 'flight', provider: basket.outboundFlight.provider, external_id: basket.outboundFlight.flightId, departure_at: `${basket.outboundFlight.date}T${String(basket.outboundFlight.departureTime || '09:00').slice(0, 5)}:00Z`, metadata: basket.outboundFlight },
          basket.returnFlight && { type: 'flight', provider: basket.returnFlight.provider, external_id: basket.returnFlight.flightId, departure_at: `${basket.returnFlight.date}T${String(basket.returnFlight.departureTime || '09:00').slice(0, 5)}:00Z`, metadata: basket.returnFlight },
        ].filter(Boolean),
      });
      setSaveState('saved');
    } catch { setSaveState('error'); }
  };

  return (
    <>
      <button type="button" className={styles.tab} onClick={() => setOpen(true)}>
        <ShoppingBag size={18} />
        <span>{l('Trip', 'Поездка')}</span>
        <strong>{selectedCount}</strong>
      </button>
      {open && (
        <>
          <button
            type="button"
            className={styles.backdrop}
            onClick={() => setOpen(false)}
            aria-label={l('Close trip basket', 'Закрыть корзину')}
          />
          <div className={styles.drawer} role="dialog" aria-modal="true" data-testid="trip-basket-drawer">
          <div className={styles.header}>
            <div>
              <div className={styles.kicker}>{l('Trip basket', 'Корзина поездки')}</div>
              <h2>{l('Your selection', 'Ваш выбор')}</h2>
            </div>
            <button type="button" className={styles.closeBtn} onClick={() => setOpen(false)} aria-label={l('Close', 'Закрыть')}>
              <X size={18} />
            </button>
          </div>

          <div className={styles.items}>
            <BasketItem
              icon={<Hotel size={18} />}
              title={basket.hotel?.name}
              subtitle={hotelSubtitle}
              price={money(basket.hotel?.totalPrice)}
              emptyText={l('No hotel selected', 'Отель не выбран')}
              onRemove={() => removeBasketItem('hotel')}
            />
            <BasketItem
              icon={<Plane size={18} />}
              title={basket.outboundFlight?.title}
              subtitle={flightSubtitle(basket.outboundFlight)}
              price={money(basket.outboundFlight?.totalPrice)}
              emptyText={l('No outbound flight', 'Рейс туда не выбран')}
              onRemove={() => removeBasketItem('outboundFlight')}
            />
            <BasketItem
              icon={<Plane size={18} />}
              title={basket.returnFlight?.title}
              subtitle={flightSubtitle(basket.returnFlight)}
              price={money(basket.returnFlight?.totalPrice)}
              emptyText={l('No return flight', 'Рейс обратно не выбран')}
              onRemove={() => removeBasketItem('returnFlight')}
            />
          </div>

          {tripFlightScore !== null && (
            <div className={styles.tripScore}>
              <span>{l('Round-trip flight score', 'Индекс перелёта туда-обратно')}</span>
              <strong>{tripFlightScore}/100</strong>
              <small>{l('Combines both legs and the weaker itinerary', 'Учитывает оба сегмента и более слабый рейс')}</small>
            </div>
          )}

          <div className={styles.footer}>
            <div>
              <span>{l('Total', 'Итого')}</span>
              <strong>{totalLabel || (l('after selection', 'после выбора'))}</strong>
            </div>
            <button type="button" className={styles.clearBtn} onClick={clearTripBasket}>
              {l('Clear', 'Очистить')}
            </button>
          </div>
          <button type="button" className={styles.clearBtn} onClick={saveTrip} disabled={!selectedCount || saveState === 'saving'}>
            {saveState === 'saving' ? (l('Saving…', 'Сохраняем…')) : saveState === 'saved' ? (l('Trip saved', 'Поездка сохранена')) : saveState === 'dates' ? (l('Choose dates first', 'Сначала выберите даты')) : saveState === 'error' ? (l('Could not save', 'Не удалось сохранить')) : (l('Save trip and reminders', 'Сохранить поездку и напоминания'))}
          </button>
          <button
            type="button"
            className={styles.checkoutBtn}
            disabled={!basket.hotel || !basket.outboundFlight}
            onClick={startCheckout}
          >
            {l('Continue to demo booking', 'Перейти к демо-бронированию')} <ArrowRight size={16} />
          </button>
          {(!basket.hotel || !basket.outboundFlight) && <p className={styles.checkoutHint}>{l('Add a hotel and an outbound flight first', 'Добавьте отель и авиабилет туда')}</p>}
          </div>
        </>
      )}
    </>
  );
}
