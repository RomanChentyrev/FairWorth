import React from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin, Star, Plus, Check } from 'lucide-react';
import ScoreRing from './ScoreRing';
import { useLang } from '../i18n/LanguageContext';
import { useTripBasket } from '../context/TripBasketContext';
import styles from './HotelCard.module.css';
import { interactionsApi } from '../api';
import { formatAmount } from '../utils/money';

const HOTEL_GRADIENTS = [
  'linear-gradient(135deg, #1a3a5c 0%, #2d6b8a 100%)',
  'linear-gradient(135deg, #2a4a2e 0%, #3a6a3e 100%)',
  'linear-gradient(135deg, #4a2a1a 0%, #6a3a1a 100%)',
  'linear-gradient(135deg, #2a1a4a 0%, #3a2a6a 100%)',
  'linear-gradient(135deg, #1a3050 0%, #0a4060 100%)',
];
function getGradient(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return HOTEL_GRADIENTS[Math.abs(hash) % HOTEL_GRADIENTS.length];
}

export default function HotelCard({ hotel, isRecommended, inCompare, onToggleCompare, checkIn, checkOut }) {
  const navigate = useNavigate();
  const { t, lang } = useLang();
  const { basket, selectHotel } = useTripBasket();

  const amenities = JSON.parse(hotel.amenities || '[]');
  const hasBreakfast = amenities.includes('breakfast');
  const hasPool = amenities.some(a => a.includes('pool'));
  const hasSpa = amenities.includes('spa');

  const nights = checkIn && checkOut
    ? Math.ceil((new Date(checkOut) - new Date(checkIn)) / (1000 * 60 * 60 * 24))
    : 4;
  const total = (hotel.min_price || 0) * nights;
  const isLivePrice = ['liteapi', 'xotelo'].includes(hotel.price_source);
  const hasPrice = Number(hotel.min_price) > 0;
  const taxLabels = lang === 'ru' ? { included: 'налоги включены', not_included: 'налоги не включены', unknown: 'налоги неизвестны' } : { included: 'taxes included', not_included: 'taxes not included', unknown: 'tax status unknown' };
  const isSelectedHotel = basket.hotel?.id === hotel.id;
  const handleSelectHotel = () => {
    selectHotel({
      id: hotel.id,
      name: hotel.name,
      city: hotel.city,
      location: hotel.location,
      checkIn,
      checkOut,
      nights,
      pricePerNight: Number(hotel.min_price || 0),
      totalPrice: total,
      currency: 'USD',
    });
    interactionsApi.track('trip_add', {
      hotel_id: hotel.id,
      context: { check_in: checkIn, check_out: checkOut, price_per_night: Number(hotel.min_price || 0) },
    }).catch(() => {});
  };

  return (
    <div
      className={`${styles.card} ${isRecommended ? styles.recommended : ''}`}
      data-testid={`hotel-card-${hotel.id}`}
      onClick={() => navigate(`/hotel/${hotel.id}?check_in=${checkIn}&check_out=${checkOut}`)}
    >
      <div className={styles.imgArea} style={{ background: hotel.image_url ? `${getGradient(hotel.id)} center/cover, url(${hotel.image_url}) center/cover` : getGradient(hotel.id), backgroundImage: hotel.image_url ? `url(${hotel.image_url})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center' }}>
        {isRecommended && <div className={styles.recBadge}>{t('card_top')}</div>}
        <div className={styles.stars}>
          {Array.from({ length: hotel.stars }).map((_, i) => (
            <Star key={i} size={11} fill="#C9A84C" color="#C9A84C" />
          ))}
        </div>
      </div>
      <div className={styles.body}>
        <div className={styles.topRow}>
          <div className={styles.nameBlock}>
            <h3 className={styles.name}>{hotel.name}</h3>
            <div className={styles.location}>
              <MapPin size={12} />{hotel.location} · {hotel.city}
            </div>
          </div>
          <ScoreRing score={hotel.fairworth_score || 0} size={54} />
        </div>
        <div className={styles.tags}>
          {hotel.rating && (
            <span className={`${styles.tag} ${styles.tagGold}`}>
              ★ {hotel.rating.toFixed(1)} ({(hotel.review_count || 0).toLocaleString()})
            </span>
          )}
          {hasBreakfast && <span className={`${styles.tag} ${styles.tagGreen}`}>{t('card_breakfast')}</span>}
          {hasPool && <span className={`${styles.tag} ${styles.tagBlue}`}>{t('card_pool')}</span>}
          {hasSpa && <span className={`${styles.tag} ${styles.tagBlue}`}>{t('card_spa')}</span>}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }} title={hotel.score_explanation}>
          {hotel.price_details?.provider || hotel.price_details?.source || '—'} · {hotel.price_details?.currency || '—'}
          {` · ${taxLabels[hotel.price_details?.tax_status || 'unknown']}`}
          {hotel.price_details?.updated_at ? ` · ${new Date(hotel.price_details.updated_at).toLocaleString(lang)}` : ''}
          {` · Score v${hotel.score_version || '—'} · ${hotel.data_completeness?.score ?? 0}% ${lang === 'ru' ? 'данных' : 'data'}`}
        </div>
        {hotel.price_details?.price_warnings?.length > 0 && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>⚠ {hotel.price_details.price_warnings.join(', ')}</div>}
        <div className={styles.bottomRow}>
          <div className={styles.priceBlock}>
            {hasPrice ? <><span className={styles.priceLabel}>{t('card_from')}</span><span className={styles.price}>${formatAmount(hotel.min_price, lang)}</span><span className={styles.priceNote}>{t('card_per_night')} · {nights} {t('card_nights')} ${formatAmount(total, lang)}</span></> : <span className={styles.price}>{lang === 'ru' ? 'Цена недоступна' : 'Price unavailable'}</span>}
            {isLivePrice && <span className={styles.liveBadge}>{hotel.price_source === 'liteapi' ? 'LiteAPI live' : 'Xotelo live'}</span>}
          </div>
          <div className={styles.actions} onClick={e => e.stopPropagation()}>
            <button
              className={`${styles.compareBtn} ${inCompare ? styles.compareBtnActive : ''}`}
              data-testid={`hotel-compare-${hotel.id}`}
              onClick={() => onToggleCompare({ id: hotel.id, name: hotel.name })}
            >
              {inCompare ? <Check size={13} /> : <Plus size={13} />}
              {inCompare ? t('card_added') : t('card_compare')}
            </button>
            <button
              className={styles.viewBtn}
              data-testid={`hotel-details-${hotel.id}`}
              onClick={() => navigate(`/hotel/${hotel.id}?check_in=${checkIn}&check_out=${checkOut}`)}
            >
              {t('card_details')}
            </button>
            <button
              className={`${styles.tripBtn} ${isSelectedHotel ? styles.tripBtnActive : ''}`}
              onClick={handleSelectHotel}
              disabled={!hasPrice}
            >
              {isSelectedHotel ? (lang === 'ru' ? 'В поездке' : 'Selected') : (lang === 'ru' ? 'В поездку' : 'Add')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
