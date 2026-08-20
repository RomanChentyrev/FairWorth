import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin, Star, Plus, Check, EyeOff, X } from 'lucide-react';
import ScoreRing from './ScoreRing';
import ScoreReliability from './ScoreReliability';
import PriceConfidence from './PriceConfidence';
import { useLang } from '../i18n/LanguageContext';
import { useTripBasket } from '../context/TripBasketContext';
import styles from './HotelCard.module.css';
import { interactionsApi } from '../api';
import { formatAmount } from '../utils/money';
import { parseStringList } from '../utils/collections';

const HOTEL_GRADIENTS = [
  '#315f70',
  '#2f665f',
  '#705647',
  '#4f5d78',
  '#29536b',
];
function getGradient(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return HOTEL_GRADIENTS[Math.abs(hash) % HOTEL_GRADIENTS.length];
}

export default function HotelCard({ hotel, isRecommended, inCompare, onToggleCompare, onHide, checkIn, checkOut, guests = 2, tripPurpose = 'leisure' }) {
  const navigate = useNavigate();
  const { t, lang , l} = useLang();
  const { basket, selectHotel } = useTripBasket();
  const [hideMenuOpen, setHideMenuOpen] = useState(false);
  const [hideBusy, setHideBusy] = useState(false);

  const amenities = parseStringList(hotel.amenities);
  const hasBreakfast = amenities.includes('breakfast');
  const hasPool = amenities.some(a => a.includes('pool'));
  const hasSpa = amenities.includes('spa');
  const hasBeach = amenities.includes('beach');

  const nights = checkIn && checkOut
    ? Math.ceil((new Date(checkOut) - new Date(checkIn)) / (1000 * 60 * 60 * 24))
    : 4;
  const total = (hotel.min_price || 0) * nights;
  const isProviderPrice = ['liteapi', 'xotelo'].includes(hotel.price_source);
  const isCachedPrice = hotel.rate_freshness === 'cached';
  const hasPrice = Number(hotel.min_price) > 0;
  const taxLabels = l({ included: 'taxes included', not_included: 'taxes not included', unknown: 'tax status unknown' }, { included: 'налоги включены', not_included: 'налоги не включены', unknown: 'налоги неизвестны' });
  const rateTerms = hotel.price_details ? [
    hotel.price_details.refundable === true
      ? (l('free cancellation', 'бесплатная отмена'))
      : hotel.price_details.refundable === false
        ? (l('non-refundable', 'невозвратный тариф'))
        : (l('cancellation terms unknown', 'условия отмены уточняются')),
    hotel.price_details.includes_breakfast === true
      ? (l('breakfast included', 'завтрак включён'))
      : hotel.price_details.includes_breakfast === false
        ? (l('breakfast not included', 'без завтрака'))
        : (l('meal plan unknown', 'питание уточняется')),
  ] : [];
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
      context: { check_in: checkIn, check_out: checkOut, guests, trip_purpose: tripPurpose, destination: hotel.city, price_per_night: Number(hotel.min_price || 0) },
    }).catch(() => {});
  };
  const hideReasons = [
    ['too_expensive', l('Too expensive', 'Слишком дорого')],
    ['bad_location', l('Bad location', 'Не подходит район')],
    ['photos', l('Did not like the photos', 'Не понравились фотографии')],
    ['missing_pool', l('No pool', 'Нет бассейна')],
    ['low_stars', l('Too few stars', 'Низкая звёздность')],
    ['other', l('Other reason', 'Другая причина')],
  ];
  const handleHide = async (feedbackReason) => {
    setHideBusy(true);
    try {
      await interactionsApi.track('hide', {
        hotel_id: hotel.id,
        context: { feedback_reason: feedbackReason, check_in: checkIn, check_out: checkOut, guests, trip_purpose: tripPurpose, destination: hotel.city, location: hotel.location, price_per_night: Number(hotel.min_price || 0), stars: hotel.stars },
      });
      onHide?.(hotel.id);
    } finally {
      setHideBusy(false);
      setHideMenuOpen(false);
    }
  };

  return (
    <div
      className={`${styles.card} ${isRecommended ? styles.recommended : ''}`}
      data-testid={`hotel-card-${hotel.id}`}
      onClick={() => navigate(`/hotel/${hotel.id}?check_in=${checkIn}&check_out=${checkOut}&guests=${guests}&trip_purpose=${tripPurpose}`)}
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
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, flexShrink: 0 }}>
            <ScoreRing score={hotel.fairworth_score || 0} size={54} />
            <ScoreReliability
              value={hotel.score_reliability}
              level={hotel.score_reliability_level}
              adjustedScore={hotel.adjusted_score}
              lang={lang}
            />
            <PriceConfidence value={hotel.price_confidence} level={hotel.price_confidence_level} lang={lang} />
          </div>
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
          {hasBeach && <span className={`${styles.tag} ${styles.tagBlue}`}>{l('Beach', 'Пляж')}</span>}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }} title={hotel.score_explanation}>
          {hotel.price_details?.provider || hotel.price_details?.source || '—'} · {hotel.price_details?.currency || '—'}
          {` · ${taxLabels[hotel.price_details?.tax_status || 'unknown']}`}
          {hotel.price_details?.updated_at ? ` · ${new Date(hotel.price_details.updated_at).toLocaleString(lang)}` : ''}
          {` · Score v${hotel.score_version || '—'} · ${hotel.data_completeness?.score ?? 0}% ${l('data', 'данных')}`}
        </div>
        {rateTerms.length > 0 && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>{rateTerms.join(' · ')}</div>}
        {hotel.price_details?.price_warnings?.length > 0 && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>⚠ {hotel.price_details.price_warnings.join(', ')}</div>}
        <div className={styles.bottomRow}>
          <div className={styles.priceBlock}>
            {hasPrice ? <><span className={styles.priceLabel}>{t('card_from')}</span><span className={styles.price}>${formatAmount(hotel.min_price, lang)}</span><span className={styles.priceNote}>{t('card_per_night')} · {nights} {t('card_nights')} ${formatAmount(total, lang)}</span></> : <span className={styles.price}>{l('Price unavailable', 'Цена недоступна')}</span>}
            {isProviderPrice && (
              <span className={styles.liveBadge}>
                {isCachedPrice
                  ? (l('Cached price', 'Кешированная цена'))
                  : `${hotel.price_source === 'liteapi' ? 'LiteAPI' : 'Xotelo'} ${l('checked', 'проверено')}`}
              </span>
            )}
          </div>
          <div className={styles.actions} onClick={e => e.stopPropagation()}>
            <button className={styles.hideBtn} type="button" onClick={() => setHideMenuOpen(true)} title={l('Hide hotel', 'Скрыть отель')} aria-label={l('Hide hotel', 'Скрыть отель')} data-testid={`hotel-hide-${hotel.id}`}>
              <EyeOff size={15} />
            </button>
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
              onClick={() => navigate(`/hotel/${hotel.id}?check_in=${checkIn}&check_out=${checkOut}&guests=${guests}&trip_purpose=${tripPurpose}`)}
            >
              {t('card_details')}
            </button>
            <button
              className={`${styles.tripBtn} ${isSelectedHotel ? styles.tripBtnActive : ''}`}
              onClick={handleSelectHotel}
              disabled={!hasPrice}
            >
              {isSelectedHotel ? (l('Selected', 'В поездке')) : (l('Add', 'В поездку'))}
            </button>
          </div>
        </div>
      </div>
      {hideMenuOpen && (
        <div className={styles.hideOverlay} onClick={e => { e.stopPropagation(); setHideMenuOpen(false); }}>
          <div className={styles.hideMenu} role="dialog" aria-modal="true" aria-label={l('Reason for hiding', 'Причина скрытия')} onClick={e => e.stopPropagation()}>
            <div className={styles.hideMenuHeader}><strong>{l('Why hide this hotel?', 'Почему скрыть этот отель?')}</strong><button type="button" onClick={() => setHideMenuOpen(false)} aria-label={l('Close', 'Закрыть')}><X size={17} /></button></div>
            <div className={styles.hideReasons}>{hideReasons.map(([value, label]) => <button type="button" key={value} disabled={hideBusy} onClick={() => handleHide(value)}>{label}</button>)}</div>
          </div>
        </div>
      )}
    </div>
  );
}
