import React, { useState } from 'react';
import { Hotel, Plane, ShoppingBag, Trash2, X } from 'lucide-react';
import { useLang } from '../i18n/LanguageContext';
import { useTripBasket } from '../context/TripBasketContext';
import styles from './TripBasket.module.css';
import { formatAmount } from '../utils/money';

function money(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return `$${formatAmount(numeric)}`;
}

function BasketItem({ icon, title, subtitle, price, onRemove, emptyText }) {
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
          <button type="button" className={styles.removeBtn} onClick={onRemove} aria-label="Remove">
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

export default function TripBasket() {
  const { lang } = useLang();
  const { basket, selectedCount, total, removeItem, clearBasket } = useTripBasket();
  const [open, setOpen] = useState(false);
  const isRu = lang === 'ru';
  const totalLabel = money(total);

  const hotelSubtitle = basket.hotel
    ? `${basket.hotel.city || basket.hotel.location || ''}${basket.hotel.nights ? ` · ${basket.hotel.nights} ${isRu ? 'ноч.' : 'nights'}` : ''}`
    : '';

  const flightSubtitle = (flight) => flight
    ? `${flight.originCode} → ${flight.destinationCode} · ${flight.date || ''} · ${flight.provider || ''}`
    : '';

  return (
    <>
      <button type="button" className={styles.tab} onClick={() => setOpen(true)}>
        <ShoppingBag size={18} />
        <span>{isRu ? 'Поездка' : 'Trip'}</span>
        <strong>{selectedCount}</strong>
      </button>
      {open && (
        <div className={styles.drawer} role="dialog" aria-modal="true">
          <div className={styles.header}>
            <div>
              <div className={styles.kicker}>{isRu ? 'Корзина поездки' : 'Trip basket'}</div>
              <h2>{isRu ? 'Ваш выбор' : 'Your selection'}</h2>
            </div>
            <button type="button" className={styles.closeBtn} onClick={() => setOpen(false)} aria-label="Close">
              <X size={18} />
            </button>
          </div>

          <div className={styles.items}>
            <BasketItem
              icon={<Hotel size={18} />}
              title={basket.hotel?.name}
              subtitle={hotelSubtitle}
              price={money(basket.hotel?.totalPrice)}
              emptyText={isRu ? 'Отель не выбран' : 'No hotel selected'}
              onRemove={() => removeItem('hotel')}
            />
            <BasketItem
              icon={<Plane size={18} />}
              title={basket.outboundFlight?.title}
              subtitle={flightSubtitle(basket.outboundFlight)}
              price={money(basket.outboundFlight?.totalPrice)}
              emptyText={isRu ? 'Рейс туда не выбран' : 'No outbound flight'}
              onRemove={() => removeItem('outboundFlight')}
            />
            <BasketItem
              icon={<Plane size={18} />}
              title={basket.returnFlight?.title}
              subtitle={flightSubtitle(basket.returnFlight)}
              price={money(basket.returnFlight?.totalPrice)}
              emptyText={isRu ? 'Рейс обратно не выбран' : 'No return flight'}
              onRemove={() => removeItem('returnFlight')}
            />
          </div>

          <div className={styles.footer}>
            <div>
              <span>{isRu ? 'Итого' : 'Total'}</span>
              <strong>{totalLabel || (isRu ? 'после выбора' : 'after selection')}</strong>
            </div>
            <button type="button" className={styles.clearBtn} onClick={clearBasket}>
              {isRu ? 'Очистить' : 'Clear'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
