import React from 'react';
import { Briefcase, Car, Clock, ShieldCheck, UserRound } from 'lucide-react';
import ScoreRing from './ScoreRing';
import { useLang } from '../i18n/LanguageContext';
import { useTripBasket } from '../context/TripBasketContext';
import styles from './TransferCard.module.css';
import { formatAmount } from '../utils/money';

export default function TransferCard({ transfer, isRecommended }) {
  const { t, lang } = useLang();
  const { basket, selectTransfer } = useTripBasket();
  const isSelected = basket.transfer?.id === transfer.id;

  const handleSelect = () => {
    selectTransfer({
      id: transfer.id,
      type: transfer.vehicle_type || 'taxi',
      title: `${transfer.provider} ${transfer.vehicle_name}`,
      subtitle: `${transfer.pickup_name}${transfer.pickup_code ? ` (${transfer.pickup_code})` : ''} → ${transfer.dropoff_name}`,
      price: Number(transfer.price || 0),
      currency: 'USD',
      duration: transfer.duration_label,
      passengers: transfer.max_passengers,
      luggage: transfer.max_luggage,
    });
  };

  return (
    <div className={`${styles.card} ${isRecommended ? styles.recommended : ''}`}>
      <div className={styles.vehiclePanel}>
        {isRecommended && <div className={styles.recBadge}>{t('card_top')}</div>}
        <div className={styles.vehicleIcon}><Car size={26} /></div>
        <div className={styles.provider}>{transfer.provider}</div>
        <div className={styles.vehicleName}>{transfer.vehicle_name}</div>
      </div>

      <div className={styles.body}>
        <div className={styles.topRow}>
          <div className={styles.routeBlock}>
            <div className={styles.routePoint}>
              <span className={styles.routeLabel}>{t('transfer_pickup')}</span>
              <strong>{transfer.pickup_name} {transfer.pickup_code ? `(${transfer.pickup_code})` : ''}</strong>
            </div>
            <div className={styles.routeLine} />
            <div className={styles.routePoint}>
              <span className={styles.routeLabel}>{t('transfer_dropoff')}</span>
              <strong>{transfer.dropoff_name}</strong>
            </div>
          </div>
          <ScoreRing score={transfer.fairworth_score || 0} size={54} />
        </div>

        <div className={styles.tags}>
          <span className={`${styles.tag} ${styles.tagBlue}`}><Clock size={12} /> {transfer.duration_label}</span>
          <span className={styles.tag}><UserRound size={12} /> {transfer.max_passengers} {t('transfer_passengers_short')}</span>
          <span className={styles.tag}><Briefcase size={12} /> {transfer.max_luggage} {t('transfer_luggage_short')}</span>
          {transfer.meet_and_greet ? <span className={`${styles.tag} ${styles.tagGreen}`}><ShieldCheck size={12} /> {t('transfer_meet')}</span> : null}
          {transfer.flight_tracking ? <span className={`${styles.tag} ${styles.tagGreen}`}>{t('transfer_tracking')}</span> : null}
        </div>

        <div className={styles.notes}>{transfer.notes}</div>

        <div className={styles.bottomRow}>
          <span className={styles.city}>{transfer.city}</span>
          <div className={styles.priceBlock}>
            <span className={styles.priceLabel}>{t('card_from')}</span>
            <span className={styles.price}>${formatAmount(transfer.price, lang)}</span>
            <span className={styles.priceNote}>{t('transfer_total')}</span>
          </div>
        </div>
        <button
          type="button"
          className={`${styles.selectBtn} ${isSelected ? styles.selectBtnActive : ''}`}
          onClick={handleSelect}
        >
          {isSelected
            ? (lang === 'ru' ? 'Выбрано для поездки' : 'Selected for trip')
            : (lang === 'ru' ? 'В поездку' : 'Add to trip')}
        </button>
      </div>
    </div>
  );
}
