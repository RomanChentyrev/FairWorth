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

export default function HotelCard({ hotel, isRecommended, inCompare, onToggleCompare, onHide, checkIn, checkOut, guests = 2, tripPurpose = 'leisure' }) {
  const navigate = useNavigate();
  const { t, lang } = useLang();
  const { basket, selectHotel } = useTripBasket();
  const [hideMenuOpen, setHideMenuOpen] = useState(false);
  const [hideBusy, setHideBusy] = useState(false);

  const amenities = JSON.parse(hotel.amenities || '[]');
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
  const taxLabels = lang === 'ru' ? { included: 'налоги включены', not_included: 'налоги не включены', unknown: 'налоги неизвестны' } : { included: 'taxes included', not_included: 'taxes not included', unknown: 'tax status unknown' };
  const rateTerms = hotel.price_details ? [
    hotel.price_details.refundable === true
      ? (lang === 'ru' ? 'бесплатная отмена' : 'free cancellation')
      : hotel.price_details.refundable === false
        ? (lang === 'ru' ? 'невозвратный тариф' : 'non-refundable')
        : (lang === 'ru' ? 'условия отмены уточняются' : 'cancellation terms unknown'),
    hotel.price_details.includes_breakfast === true
      ? (lang === 'ru' ? 'завтрак включён' : 'breakfast included')
      : hotel.price_details.includes_breakfast === false
        ? (lang === 'ru' ? 'без завтрака' : 'breakfast not included')
        : (lang === 'ru' ? 'питание уточняется' : 'meal plan unknown'),
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
    ['too_expensive', lang === 'ru' ? 'Слишком дорого' : 'Too expensive'],
    ['bad_location', lang === 'ru' ? 'Не подходит район' : 'Bad location'],
    ['photos', lang === 'ru' ? 'Не понравились фотографии' : 'Did not like the photos'],
    ['missing_pool', lang === 'ru' ? 'Нет бассейна' : 'No pool'],
    ['low_stars', lang === 'ru' ? 'Низкая звёздность' : 'Too few stars'],
    ['other', lang === 'ru' ? 'Другая причина' : 'Other reason'],
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
          {hasBeach && <span className={`${styles.tag} ${styles.tagBlue}`}>{lang === 'ru' ? 'Пляж' : 'Beach'}</span>}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }} title={hotel.score_explanation}>
          {hotel.price_details?.provider || hotel.price_details?.source || '—'} · {hotel.price_details?.currency || '—'}
          {` · ${taxLabels[hotel.price_details?.tax_status || 'unknown']}`}
          {hotel.price_details?.updated_at ? ` · ${new Date(hotel.price_details.updated_at).toLocaleString(lang)}` : ''}
          {` · Score v${hotel.score_version || '—'} · ${hotel.data_completeness?.score ?? 0}% ${lang === 'ru' ? 'данных' : 'data'}`}
        </div>
        {rateTerms.length > 0 && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>{rateTerms.join(' · ')}</div>}
        {hotel.price_details?.price_warnings?.length > 0 && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>⚠ {hotel.price_details.price_warnings.join(', ')}</div>}
        <div className={styles.bottomRow}>
          <div className={styles.priceBlock}>
            {hasPrice ? <><span className={styles.priceLabel}>{t('card_from')}</span><span className={styles.price}>${formatAmount(hotel.min_price, lang)}</span><span className={styles.priceNote}>{t('card_per_night')} · {nights} {t('card_nights')} ${formatAmount(total, lang)}</span></> : <span className={styles.price}>{lang === 'ru' ? 'Цена недоступна' : 'Price unavailable'}</span>}
            {isProviderPrice && (
              <span className={styles.liveBadge}>
                {isCachedPrice
                  ? (lang === 'ru' ? 'Кешированная цена' : 'Cached price')
                  : `${hotel.price_source === 'liteapi' ? 'LiteAPI' : 'Xotelo'} ${lang === 'ru' ? 'проверено' : 'checked'}`}
              </span>
            )}
          </div>
          <div className={styles.actions} onClick={e => e.stopPropagation()}>
            <button className={styles.hideBtn} type="button" onClick={() => setHideMenuOpen(true)} title={lang === 'ru' ? 'Скрыть отель' : 'Hide hotel'} aria-label={lang === 'ru' ? 'Скрыть отель' : 'Hide hotel'} data-testid={`hotel-hide-${hotel.id}`}>
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
              {isSelectedHotel ? (lang === 'ru' ? 'В поездке' : 'Selected') : (lang === 'ru' ? 'В поездку' : 'Add')}
            </button>
          </div>
        </div>
      </div>
      {hideMenuOpen && (
        <div className={styles.hideOverlay} onClick={e => { e.stopPropagation(); setHideMenuOpen(false); }}>
          <div className={styles.hideMenu} role="dialog" aria-modal="true" aria-label={lang === 'ru' ? 'Причина скрытия' : 'Reason for hiding'} onClick={e => e.stopPropagation()}>
            <div className={styles.hideMenuHeader}><strong>{lang === 'ru' ? 'Почему скрыть этот отель?' : 'Why hide this hotel?'}</strong><button type="button" onClick={() => setHideMenuOpen(false)} aria-label="Close"><X size={17} /></button></div>
            <div className={styles.hideReasons}>{hideReasons.map(([value, label]) => <button type="button" key={value} disabled={hideBusy} onClick={() => handleHide(value)}>{label}</button>)}</div>
          </div>
        </div>
      )}
    </div>
  );
}
