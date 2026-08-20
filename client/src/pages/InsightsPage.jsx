import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Flame, MapPin, Sparkles, Star, TrendingUp, TriangleAlert } from 'lucide-react';
import { hotelsApi } from '../api';
import { useLang } from '../i18n/LanguageContext';
import styles from './InsightsPage.module.css';
import useCapabilities from '../hooks/useCapabilities';
import ProviderUnavailable from '../components/ProviderUnavailable';
import { defaultTravelDates } from '../utils/dates';
import { formatAmount } from '../utils/money';
import { destinationVisual } from '../utils/destinationVisuals';

const SECTION_ICONS = {
  hot: Flame,
  popular: TrendingUp,
  value: Sparkles,
};

function defaultDates() {
  const checkIn = new Date(`${defaultTravelDates().check_in}T00:00:00`);
  const checkOut = new Date(checkIn);
  checkOut.setDate(checkOut.getDate() + 4);
  return {
    checkIn: checkIn.toISOString().slice(0, 10),
    checkOut: checkOut.toISOString().slice(0, 10),
  };
}

function OfferCard({ offer, sectionKey }) {
  const navigate = useNavigate();
  const { t, lang , l} = useLang();
  const dates = useMemo(defaultDates, []);
  const hasHotelPrice = offer.has_hotel_price !== false && Number(offer.min_price) > 0;
  const departureDate = offer.departure_date || dates.checkIn;
  const nights = offer.nights || 7;
  const visual = destinationVisual(offer.city, lang);

  const openOffer = () => {
    if (hasHotelPrice) {
      const checkOut = offer.return_date || dates.checkOut;
      navigate(`/results?city=${encodeURIComponent(offer.city)}&check_in=${departureDate}&check_out=${checkOut}&guests=2&sort=score`);
      return;
    }

    navigate(`/flights?from=Dubai&to=${encodeURIComponent(offer.destination_code || offer.city)}&departure_date=${departureDate}&passengers=1&cabin_class=economy`);
  };

  return (
    <button
      type="button"
      className={styles.offerCard}
      onClick={openOffer}
      style={{ '--offer-image': `url("${visual.image}")` }}
    >
      <span className={styles.offerShade} aria-hidden="true" />
      <div className={styles.offerTop}>
        <span className={`${styles.badge} ${styles[`badge_${sectionKey}`]}`}>
          {t(`insights_badge_${sectionKey}`)}
        </span>
        <span className={styles.arrow}><ArrowRight size={18} /></span>
      </div>

      <div className={styles.offerContent}>
        <div className={styles.locationLine}><MapPin size={13} />{offer.country || offer.destination_code}</div>
        <h3 className={styles.city}>{offer.city}</h3>

        <div className={styles.stats}>
          <span><Star size={12} fill="currentColor" /> {offer.avg_rating}</span>
          <span>{hasHotelPrice ? `${offer.hotel_count} ${t('home_popular_hotels')}` : (offer.destination_code || 'Live route')}</span>
          <span>{offer.discount_percent}% {t('insights_discount')}</span>
        </div>

        <div className={styles.reason}>{offer.ai_reason}</div>

        <div className={styles.priceRow}>
          <div>
            <span className={styles.priceLabel}>
              {hasHotelPrice
                ? `${t('insights_package_from')} · ${nights} ${l('nights', 'ночей')}`
                : (l('Flights from', 'Перелеты от'))}
            </span>
            <strong>${formatAmount(offer.package_price, lang)}</strong>
          </div>
          <div className={styles.nightly}>
            {hasHotelPrice
              ? `${t('card_from')} $${formatAmount(offer.min_price, lang)}${t('card_per_night')}`
              : (l('Hotels soon', 'Отели скоро'))}
          </div>
        </div>
      </div>
    </button>
  );
}

export default function InsightsPage() {
  const { t, lang, l } = useLang();
  const { capabilities, loading: capabilitiesLoading } = useCapabilities();
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    if (!capabilities || capabilities.hotels?.status !== 'ready' || capabilities.flights?.status !== 'ready') return undefined;
    let cancelled = false;
    let timer;
    let attempts = 0;
    const load = async () => {
      try {
        const response = await hotelsApi.insights({ signal: AbortSignal.timeout(8000) });
        if (cancelled) return;
        if (response.status === 202 || response.data.status === 'refreshing') {
          attempts += 1;
          if (attempts >= 9) {
            setLoading(false); setEmpty(true); setRefreshing(false);
            return;
          }
          setRefreshing(true);
          timer = window.setTimeout(load, Number(response.data.retry_after_seconds || 3) * 1000);
          return;
        }
        const nextSections = (response.data.sections || []).filter(section => section.offers?.length);
        setSections(nextSections);
        setEmpty(nextSections.length === 0);
        setRefreshing(Boolean(response.data.refreshing));
        setError('');
        setLoading(false);
      } catch (requestError) {
        if (cancelled) return;
        setError(requestError.response?.data?.error || (l('Could not load Insights.', 'Не удалось загрузить Insights.')));
        setLoading(false); setRefreshing(false);
      }
    };
    load();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [capabilities, lang]);

  const retry = async () => {
    setError(''); setEmpty(false); setLoading(true); setRefreshing(true);
    try { await hotelsApi.refreshInsights(); window.setTimeout(() => window.location.reload(), 1200); }
    catch (requestError) { setLoading(false); setRefreshing(false); setError(requestError.response?.data?.error || requestError.message); }
  };

  if (!capabilitiesLoading && capabilities?.hotels?.status !== 'ready') return <ProviderUnavailable capability="hotels" />;
  if (!capabilitiesLoading && capabilities?.flights?.status !== 'ready') return <ProviderUnavailable capability="flights" />;

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.eyebrow}><Sparkles size={14} /> {t('insights_eyebrow')}</div>
        <h1>{t('insights_title')}</h1>
        <p>{t('insights_sub')}</p>
      </section>

      {!loading && refreshing && sections.length > 0 && <div className={styles.refreshNotice}>{l('Showing the latest snapshot · refreshing in the background', 'Показываем последние данные · обновляем в фоне')}</div>}

      {loading && (
        <div className={styles.sections}>
          {[1,2,3].map(section => (
            <section key={section} className={styles.section}>
              <div className={`skeleton ${styles.skeletonTitle}`} />
              <div className={styles.grid}>
                {[1,2,3,4].map(card => <div key={card} className={`skeleton ${styles.skeletonCard}`} />)}
              </div>
            </section>
          ))}
        </div>
      )}

      {error && <div className={styles.stateCard}><div className={styles.stateIcon}><TriangleAlert size={28} /></div><h2>{l('Insights are temporarily unavailable', 'Insights временно недоступны')}</h2><p>{error}</p><button onClick={retry}>{l('Try again', 'Попробовать снова')}</button></div>}

      {!loading && !error && empty && <div className={styles.stateCard}><div className={styles.stateIcon}><Sparkles size={28} /></div><h2>{l('No insights available yet', 'Пока нет доступных предложений')}</h2><p>{l('We did not receive enough fresh supplier data. Try refreshing the calculation again shortly.', 'Мы не получили достаточно свежих данных от поставщиков. Попробуйте обновить расчёт немного позже.')}</p><button onClick={retry}>{l('Refresh Insights', 'Обновить Insights')}</button></div>}

      {!loading && !error && !empty && (
        <div className={styles.sections}>
          {sections.map(section => {
            const Icon = SECTION_ICONS[section.key] || Sparkles;
            return (
              <section key={section.key} className={styles.section}>
                <div className={styles.sectionHeader}>
                  <div className={styles.sectionTitleWrap}>
                    <span className={styles.sectionIcon}><Icon size={17} /></span>
                    <div>
                      <h2>{t(`insights_section_${section.key}`)}</h2>
                      <p>{t(`insights_section_${section.key}_sub`)}</p>
                    </div>
                  </div>
                </div>
                <div className={styles.grid}>
                  {section.offers.map(offer => (
                    <OfferCard key={`${section.key}-${offer.city}-${offer.country}`} offer={offer} sectionKey={section.key} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
