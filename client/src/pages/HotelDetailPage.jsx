import React, { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { Star, MapPin, Sparkles, Plus, Check, ArrowLeft, Bookmark, BookmarkCheck, Bell, BellOff } from 'lucide-react';
import { hotelsApi, usersApi, interactionsApi, partnersApi, notificationsApi } from '../api';
import ScoreRing from '../components/ScoreRing';
import ScoreReliability from '../components/ScoreReliability';
import PriceConfidence from '../components/PriceConfidence';
import styles from './HotelDetailPage.module.css';
import { useLang } from '../i18n/LanguageContext';
import { validFutureDates } from '../utils/dates';
import { formatAmount } from '../utils/money';
import useCapabilities from '../hooks/useCapabilities';
import ProviderUnavailable from '../components/ProviderUnavailable';

const HOTEL_GRADIENTS = [
  'linear-gradient(160deg, #0d2d45 0%, #1a4a6e 40%, #0a2038 100%)',
  'linear-gradient(160deg, #1a3a1e 0%, #2a5a2e 50%, #1a4a22 100%)',
  'linear-gradient(160deg, #3a1a0a 0%, #5a2a0e 50%, #3a1a0a 100%)',
  'linear-gradient(160deg, #1a0a3a 0%, #2a1a5a 50%, #1a0a3a 100%)',
  'linear-gradient(160deg, #0a2a40 0%, #0a3a50 50%, #0a2030 100%)',
];
function getGradient(id = '') {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return HOTEL_GRADIENTS[Math.abs(hash) % HOTEL_GRADIENTS.length];
}

function stringList(value) {
  let parsed = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { parsed = value.split(','); }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(item => typeof item === 'string' || typeof item === 'number').map(item => String(item).trim()).filter(Boolean);
}

const SCORE_FIELD_LABELS = {
  star_rating: { ru: 'звёздность отеля', en: 'hotel star rating' },
  price: { ru: 'цена', en: 'price' },
  room_type: { ru: 'предпочитаемый тип номера', en: 'preferred room type' },
  room_view: { ru: 'предпочитаемый вид из номера', en: 'preferred room view' },
  noise_level: { ru: 'уровень шума', en: 'noise level' },
  travel_tier: { ru: 'соответствие выбранному классу отдыха', en: 'selected travel tier match' },
  wifi: { ru: 'Wi-Fi', en: 'Wi-Fi' }, pool: { ru: 'бассейн', en: 'pool' },
  parking: { ru: 'парковка', en: 'parking' }, air_conditioning: { ru: 'кондиционер', en: 'air conditioning' },
  spa: { ru: 'SPA', en: 'SPA' }, gym: { ru: 'фитнес', en: 'fitness facilities' },
  restaurant: { ru: 'ресторан', en: 'restaurant' }, beach: { ru: 'пляж', en: 'beach access' },
  airport_shuttle: { ru: 'трансфер из аэропорта', en: 'airport shuttle' }, tennis: { ru: 'теннисный корт', en: 'tennis court' },
  bathtub: { ru: 'ванна в номере', en: 'in-room bathtub' }, balcony: { ru: 'балкон', en: 'balcony' },
  kitchen: { ru: 'кухня', en: 'kitchen' }, soundproofing: { ru: 'звукоизоляция', en: 'soundproofing' },
  family_rooms: { ru: 'семейная инфраструктура', en: 'family facilities' }, pets_allowed: { ru: 'размещение с животными', en: 'pet-friendly policy' },
  accessible: { ru: 'доступная среда', en: 'accessibility' },
  star_fit: { ru: 'звёздность внутри класса отдыха', en: 'star rating within travel tier' },
  verified_quality: { ru: 'подтверждённое качество', en: 'verified quality' },
  service: { ru: 'качество обслуживания', en: 'service quality' },
  room_size: { ru: 'площадь номера', en: 'room size' },
  premium_amenities: { ru: 'премиальные удобства', en: 'premium amenities' },
  brand: { ru: 'репутация бренда', en: 'brand reputation' },
  room_category: { ru: 'премиальная категория номера', en: 'premium room category' },
  room_condition: { ru: 'состояние номеров', en: 'room condition' },
  breakfast_quality: { ru: 'качество завтрака', en: 'breakfast quality' },
  luxury_review_sentiment: { ru: 'luxury-семантика отзывов', en: 'luxury review sentiment' },
  renovation_freshness: { ru: 'свежесть ремонта', en: 'renovation freshness' },
  rating: { ru: 'общий рейтинг', en: 'overall rating' },
  cleanliness: { ru: 'чистота', en: 'cleanliness' },
  location: { ru: 'расположение', en: 'location' },
  style_facilities: { ru: 'инфраструктура для стиля поездки', en: 'travel-style facilities' },
  review_freshness: { ru: 'актуальность отзывов', en: 'review freshness' },
  latest_review: { ru: 'дата последнего отзыва', en: 'latest review date' },
  recent_review_share: { ru: 'доля свежих отзывов', en: 'recent review share' },
  rating_trend: { ru: 'динамика рейтинга', en: 'rating trend' },
  renovation: { ru: 'дата ремонта', en: 'renovation date' },
  review_volume: { ru: 'объём отзывов', en: 'review volume' },
  source_consistency: { ru: 'согласованность площадок', en: 'source consistency' },
  verified_stays: { ru: 'подтверждённые проживания', en: 'verified stays' },
  review_integrity: { ru: 'целостность отзывов', en: 'review integrity' },
};

function scoreFieldLabel(field, isRu) {
  const [type, value] = String(field).split(':');
  const key = ['amenity', 'travel_tier', 'quality', 'review_freshness'].includes(type) ? value : type;
  return SCORE_FIELD_LABELS[key]?.[isRu ? 'ru' : 'en'] || String(key || field || '').replace(/_/g, ' ');
}

export default function HotelDetailPage({ compareList, toggleCompare, isInCompare }) {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { lang } = useLang();
  const isRu = lang === 'ru';
  const { capabilities, loading: capabilitiesLoading } = useCapabilities();
  const aiReady = capabilities?.ai?.status === 'ready';
  const partnerBookingReady = capabilities?.partner_booking?.status === 'ready';
  const dates = validFutureDates({ check_in: searchParams.get('check_in'), check_out: searchParams.get('check_out') });
  const guests = Math.max(1, Number(searchParams.get('guests')) || 2);
  const tripPurpose = searchParams.get('trip_purpose') || 'leisure';
  const checkIn = dates.check_in;
  const checkOut = dates.check_out;

  const [data, setData] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [bookmarked, setBookmarked] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [showAllAmenities, setShowAllAmenities] = useState(false);
  const [priceWatch, setPriceWatch] = useState(null);
  const [watchBusy, setWatchBusy] = useState(false);
  const visitStartedAt = useRef(Date.now());
  const dwellSent = useRef(false);
  const dwellEventId = useRef(`hotel-dwell:${crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`}`);
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  const nights = Math.ceil((new Date(checkOut) - new Date(checkIn)) / (1000 * 60 * 60 * 24));

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [res, bookmarksRes, watchesRes] = await Promise.all([
          hotelsApi.get(id, { check_in: checkIn, check_out: checkOut, guests, language: lang }),
          usersApi.getBookmarks(),
          notificationsApi.watches(),
        ]);
        setData(res.data);
        setActiveImageIndex(0);
        setBookmarked((bookmarksRes.data.bookmarks || []).some(bookmark => bookmark.id === id));
        setPriceWatch((watchesRes.data.watches || []).find(watch => watch.hotel_id === id && watch.check_in === checkIn && watch.check_out === checkOut && watch.active) || null);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [id, checkIn, checkOut, guests, lang]);

  useEffect(() => {
    visitStartedAt.current = Date.now();
    dwellSent.current = false;
    dwellEventId.current = `hotel-dwell:${crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`}`;
    interactionsApi.track('view', {
      hotel_id: id,
      context: { check_in: checkIn, check_out: checkOut, guests, trip_purpose: tripPurpose },
    }).catch(() => {});
    const sendDwell = () => {
      if (dwellSent.current) return;
      dwellSent.current = true;
      const seconds = Math.round((Date.now() - visitStartedAt.current) / 1000);
      if (seconds < 20) return;
      interactionsApi.track('dwell_time', {
        hotel_id: id,
        event_id: dwellEventId.current,
        context: { seconds, check_in: checkIn, check_out: checkOut, guests, trip_purpose: tripPurpose },
      }).catch(() => {});
    };
    window.addEventListener('pagehide', sendDwell);
    return () => {
      window.removeEventListener('pagehide', sendDwell);
      sendDwell();
    };
  }, [id, checkIn, checkOut, guests, tripPurpose]);

  const runAnalysis = async () => {
    if (!aiReady) return;
    setAnalysisLoading(true);
    setAnalysis(null);
    try {
      const res = await hotelsApi.analyze(id, { check_in: checkIn, check_out: checkOut, guests, trip_purpose: tripPurpose, language: lang });
      setAnalysis(res.data.analysis);
    } catch (e) {
      console.error(e);
      const message = e.response?.data?.error || e.message || (isRu ? 'Проверьте OPENROUTER_API_KEY в server/.env' : 'Check OPENROUTER_API_KEY in server/.env');
      setAnalysis({ error: `${isRu ? 'Не удалось получить ИИ-анализ.' : 'Could not generate the AI analysis.'} ${message}` });
    } finally {
      setAnalysisLoading(false);
    }
  };

  const toggleBookmark = async () => {
    try {
      const res = await usersApi.toggleBookmark(id);
      setBookmarked(res.data.bookmarked);
      interactionsApi.track(res.data.bookmarked ? 'bookmark_add' : 'bookmark_remove', {
        hotel_id: id,
      }).catch(() => {});
    } catch (e) { console.error(e); }
  };

  const togglePriceWatch = async () => {
    setWatchBusy(true);
    try {
      if (priceWatch) {
        await notificationsApi.updateWatch(priceWatch.id, { active: false });
        setPriceWatch(null);
      } else {
        const response = await notificationsApi.createWatch({ hotel_id: id, check_in: checkIn, check_out: checkOut, guests: Number(searchParams.get('guests') || 2), currency: 'USD', notify_on_drop: true, notify_on_rise: true });
        setPriceWatch(response.data.watch);
      }
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setWatchBusy(false); }
  };

  const handleBooking = async () => {
    if (!partnerBookingReady) return;
    const bookingUrl = officialPrice?.url || hotel.tripadvisor_url;
    if (!bookingUrl) return;
    interactionsApi.track('booking_intent', {
      hotel_id: id,
      context: {
        provider: officialPrice?.operator || 'Tripadvisor',
        price_per_night: Number(officialPrice?.price_per_night || 0),
        check_in: checkIn,
        check_out: checkOut,
      },
    }).catch(() => {});
    try {
      const response = await partnersApi.createClick({
        hotel_id: id, provider: officialPrice?.operator || 'Tripadvisor', destination_url: bookingUrl,
        amount: Number(officialPrice?.price_per_night || 0), currency: officialPrice?.currency || 'USD',
        metadata: { check_in: checkIn, check_out: checkOut },
      });
      window.open(response.data.redirect_url, '_blank', 'noopener,noreferrer');
    } catch (error) { setError(error.response?.data?.error || error.message); }
  };

  if (!capabilitiesLoading && capabilities?.hotels?.status !== 'ready') return <ProviderUnavailable capability="hotels" />;

  if (loading) return (
    <div className={styles.page}>
      <div className={styles.loadingWrap}>
        <div className={`skeleton ${styles.skeletonHero}`} />
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px', display: 'grid', gridTemplateColumns: '1fr 360px', gap: 28 }}>
          <div className={`skeleton`} style={{ height: 300, borderRadius: 14 }} />
          <div className={`skeleton`} style={{ height: 300, borderRadius: 14 }} />
        </div>
      </div>
    </div>
  );

  if (error || !data) return (
    <div className={styles.page}>
      <div style={{ padding: '80px 32px', textAlign: 'center', color: 'var(--red)' }}>
        {isRu ? 'Ошибка загрузки отеля. Убедитесь что сервер запущен.' : 'Could not load the hotel. Make sure the server is running.'}
      </div>
    </div>
  );

  const { hotel, rooms, prices, reviews } = data;
  const amenities = stringList(hotel.amenities);
  const galleryImages = (data.images || []).filter(image => image?.url);
  const activeImage = galleryImages[activeImageIndex] || galleryImages[0] || null;
  const photoAttributions = [...new Map(galleryImages
    .flatMap(image => image.attribution || [])
    .filter(item => item.displayName || item.uri)
    .map(item => [item.uri || item.displayName, item])).values()];
  const livePrices = prices?.filter(p => p.source === 'xotelo') || [];
  const bestPrice = prices?.reduce((min, p) => p.price_per_night < min.price_per_night ? p : min, prices[0]);
  const officialPrice = livePrices[0] || prices?.find(p => p.operator === 'Official Website') || bestPrice;

  const score = data.scoring?.fairworth_score || 75;

  return (
    <div className={styles.page}>
      {/* Hero */}
      <div
        className={`${styles.hero} ${activeImage ? styles.heroWithPhoto : ''}`}
        style={activeImage ? {
          backgroundImage: `linear-gradient(180deg, rgba(10, 22, 38, 0.28), rgba(10, 22, 38, 0.84)), url(${activeImage.url})`,
        } : { background: getGradient(id) }}
      >
        <div className={styles.heroContent}>
          <div className={styles.breadcrumb}>
            <button type="button" onClick={() => navigate(-1)} className={styles.backLink}>
              <ArrowLeft size={14} /> {isRu ? 'Результаты поиска' : 'Search results'}
            </button>
            <span className={styles.breadSep}>/</span>
            <span>{hotel.name}</span>
          </div>

          <div className={styles.heroBottom}>
            <div>
              <div className={styles.heroStars}>
                {Array.from({ length: hotel.stars }).map((_, i) => (
                  <Star key={i} size={13} fill="#C9A84C" color="#C9A84C" />
                ))}
              </div>
              <h1 className={styles.heroTitle}>{hotel.name}</h1>
              <div className={styles.heroMeta}>
                <span className={styles.heroLocation}><MapPin size={13} />{hotel.location}, {hotel.city}</span>
                {reviews && (
                  <span className={styles.heroRating}>
                    <Star size={13} fill="#C9A84C" color="#C9A84C" />
                    {reviews.rating.toFixed(1)} · {reviews.count.toLocaleString()} {isRu ? 'отзывов' : 'reviews'}
                  </span>
                )}
              </div>
            </div>
            <div className={styles.heroActions}>
              <button className={styles.bookmarkBtn} onClick={toggleBookmark}>
                {bookmarked ? <BookmarkCheck size={18} /> : <Bookmark size={18} />}
              </button>
              <button className={styles.bookmarkBtn} onClick={togglePriceWatch} disabled={watchBusy} title={isRu ? 'Отслеживать цену' : 'Track price'}>
                {priceWatch ? <BellOff size={18} /> : <Bell size={18} />}
              </button>
              <button
                className={`${styles.compareHeroBtn} ${isInCompare(id) ? styles.compareHeroBtnActive : ''}`}
                onClick={() => toggleCompare({ id: hotel.id, name: hotel.name })}
              >
                {isInCompare(id) ? <Check size={14} /> : <Plus size={14} />}
                {isInCompare(id) ? (isRu ? 'В сравнении' : 'Comparing') : (isRu ? 'Сравнить' : 'Compare')}
              </button>
            </div>
          </div>
          {galleryImages.length > 1 && (
            <div className={styles.galleryRail} aria-label={isRu ? 'Фотографии отеля' : 'Hotel photos'}>
              {galleryImages.slice(0, 8).map((image, index) => (
                <button
                  key={`${image.provider || 'photo'}-${image.url}-${index}`}
                  type="button"
                  className={`${styles.galleryThumb} ${index === activeImageIndex ? styles.galleryThumbActive : ''}`}
                  onClick={() => {
                    setActiveImageIndex(index);
                    interactionsApi.track('gallery_view', { hotel_id: id, context: { image_index: index, provider: image.provider || null } }).catch(() => {});
                  }}
                  aria-label={isRu ? `Фото ${index + 1}` : `Photo ${index + 1}`}
                >
                  <img src={image.url} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          )}
          {photoAttributions.length > 0 && (
            <div className={styles.photoAttribution}>
              {isRu ? 'Фото' : 'Photo'}:{' '}
              {photoAttributions.slice(0, 3).map((item, index) => (
                <React.Fragment key={item.uri || item.displayName}>
                  {index > 0 ? ', ' : ''}
                  {item.uri ? (
                    <a href={item.uri.startsWith('//') ? `https:${item.uri}` : item.uri} target="_blank" rel="noreferrer">
                      {item.displayName || item.uri}
                    </a>
                  ) : item.displayName}
                </React.Fragment>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className={styles.tabsBar}>
        <div className={styles.tabsInner}>
          {['overview', 'rooms', 'prices', 'reviews'].map(t => (
            <button
              key={t}
              className={`${styles.tab} ${activeTab === t ? styles.tabActive : ''}`}
              onClick={() => {
                setActiveTab(t);
                if (t === 'rooms') interactionsApi.track('rooms_open', { hotel_id: id }).catch(() => {});
              }}
            >
              {(isRu
                ? { overview: 'Обзор', rooms: 'Номера', prices: 'Цены', reviews: 'Отзывы' }
                : { overview: 'Overview', rooms: 'Rooms', prices: 'Prices', reviews: 'Reviews' })[t]}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className={styles.body}>
        <div className={styles.left}>

          {/* AI Analysis card */}
          <div className={styles.aiCard}>
            <div className={styles.aiCardHeader}>
              <div className={styles.aiIconWrap}><Sparkles size={18} /></div>
              <div>
                <div className={styles.aiCardTitle}>{isRu ? 'ИИ-анализ отеля' : 'AI hotel analysis'}</div>
                <div className={styles.aiCardSub}>{isRu ? 'Персонализировано под ваши предпочтения' : 'Personalised to your preferences'}</div>
              </div>
              {!analysis && (
                <button
                  className={styles.runAiBtn}
                  onClick={runAnalysis}
                  disabled={analysisLoading || !aiReady}
                >
                  {analysisLoading ? (
                    <><span className={styles.spinner} /> {isRu ? 'Анализирую...' : 'Analysing...'}</>
                  ) : (
                    <><Sparkles size={13} /> {isRu ? 'Запустить анализ' : 'Run analysis'}</>
                  )}
                </button>
              )}
            </div>

            {!capabilitiesLoading && !aiReady && <ProviderUnavailable capability="ai" compact />}

            {!analysis && !analysisLoading && aiReady && (
              <p className={styles.aiPlaceholder}>
                {isRu ? 'Нажмите «Запустить анализ» — ИИ оценит отель с учётом ваших предпочтений, порекомендует лучший номер, объяснит риски и выберет оптимального туроператора.' : 'Select “Run analysis” and AI will evaluate this hotel for your preferences, recommend a room, explain risks, and choose the best booking provider.'}
              </p>
            )}

            {analysisLoading && (
              <div className={styles.aiLoading}>
                <div className={styles.aiLoadingDots}>
                  <span /><span /><span />
                </div>
                <span>{isRu ? 'ИИ анализирует доступные данные отеля и ваши предпочтения…' : 'AI is analysing available hotel data and your preferences…'}</span>
              </div>
            )}

            {analysis && !analysis.error && (
              <div className={styles.aiInsights}>
                <div className={styles.aiInsight}>
                  <div className={styles.aiInsightLabel}>🏆 {isRu ? 'Вывод' : 'Verdict'}</div>
                  <div className={styles.aiInsightText}>{analysis.verdict}</div>
                </div>
                {analysis.personalization_match && (
                  <div className={styles.aiInsight}>
                    <div className={styles.aiInsightLabel}>✅ {isRu ? 'Соответствие вашим предпочтениям' : 'Match with your preferences'}</div>
                    <div className={styles.matchTags}>
                      {analysis.personalization_match.matches?.map((m, i) => (
                        <span key={i} className={styles.matchTagGreen}>{m}</span>
                      ))}
                      {analysis.personalization_match.mismatches?.map((m, i) => (
                        <span key={i} className={styles.matchTagRed}>{m}</span>
                      ))}
                    </div>
                  </div>
                )}
                {analysis.best_room && (
                  <div className={styles.aiInsight}>
                    <div className={styles.aiInsightLabel}>🛏 {isRu ? 'Какой номер выбрать' : 'Which room to choose'}</div>
                    <div className={styles.aiInsightText}>
                      <strong>{analysis.best_room.name}</strong> ({isRu ? 'от' : 'from'} ${formatAmount(analysis.best_room.price_per_night, lang)}/{isRu ? 'ночь' : 'night'}) — {analysis.best_room.why}
                    </div>
                  </div>
                )}
                {analysis.booking_timing && (
                  <div className={styles.aiInsight}>
                    <div className={styles.aiInsightLabel}>📅 {isRu ? 'Когда бронировать' : 'When to book'}</div>
                    <div className={styles.aiInsightText}>{analysis.booking_timing}</div>
                  </div>
                )}
                {analysis.warnings?.length > 0 && (
                  <div className={styles.aiInsight}>
                    <div className={styles.aiInsightLabel}>⚠️ {isRu ? 'На что обратить внимание' : 'Things to consider'}</div>
                    {analysis.warnings.map((w, i) => (
                      <div key={i} className={styles.aiInsightText}>• {w}</div>
                    ))}
                  </div>
                )}
                {analysis.weather_note && (
                  <div className={styles.aiInsight}>
                    <div className={styles.aiInsightLabel}>🌡 {isRu ? 'Погода и сезон' : 'Weather and season'}</div>
                    <div className={styles.aiInsightText}>{analysis.weather_note}</div>
                  </div>
                )}
                {analysis.best_operator && (
                  <div className={styles.aiInsight}>
                    <div className={styles.aiInsightLabel}>💡 {isRu ? 'Рекомендуемый оператор' : 'Recommended provider'}</div>
                    <div className={styles.aiInsightText}>
                      <strong>{analysis.best_operator.name}</strong> — {analysis.best_operator.why}
                    </div>
                  </div>
                )}
              </div>
            )}

            {analysis?.error && (
              <div className={styles.aiError}>{analysis.error}</div>
            )}
          </div>

          {/* Description */}
          <div className={styles.descCard}>
            <h2 className={styles.sectionTitle}>{isRu ? 'Об отеле' : 'About the hotel'}</h2>
            <p className={styles.descText}>{hotel.description}</p>
            <div className={styles.amenityGrid}>
              {(showAllAmenities ? amenities : amenities.slice(0, 24)).map((a, index) => (
                <div key={`${a}-${index}`} className={styles.amenityItem}>
                  <span className={styles.amenityDot} />
                  {a.replace(/[-_]/g, ' ')}
                </div>
              ))}
            </div>
            {amenities.length > 24 && (
              <button type="button" className={styles.amenitiesToggle} onClick={() => setShowAllAmenities(value => !value)}>
                {showAllAmenities
                  ? (isRu ? 'Скрыть часть удобств' : 'Show fewer amenities')
                  : (isRu ? `Показать все удобства (${amenities.length})` : `Show all amenities (${amenities.length})`)}
              </button>
            )}
          </div>

          {/* Rooms */}
          <div className={styles.roomsSection}>
            <h2 className={styles.sectionTitle}>{isRu ? 'Номера и цены' : 'Rooms and prices'}</h2>
            <div className={styles.roomsGrid}>
              {rooms?.map(room => {
                const isRecommended = analysis?.best_room?.name === room.name;
                return (
                  <div key={room.id} className={`${styles.roomCard} ${isRecommended ? styles.roomCardBest : ''}`}>
                    {isRecommended && <div className={styles.roomBestBadge}>✦ {isRu ? 'Рекомендация ИИ' : 'AI recommendation'}</div>}
                    <div className={styles.roomName}>{room.name}</div>
                    <div className={styles.roomFeatures}>
                      <span>👥 {room.max_guests} {isRu ? 'чел.' : 'guests'}</span>
                      <span>📐 {room.size_sqm} {isRu ? 'м²' : 'm²'}</span>
                      <span>🌅 {room.view_type}</span>
                    </div>
                    {stringList(room.amenities).slice(0, 3).map((a, index) => (
                      <span key={`${a}-${index}`} className={styles.roomTag}>{a.replace(/[-_]/g, ' ')}</span>
                    ))}
                    <div className={styles.roomPrice}>
                      <span className={styles.roomPriceVal}>${formatAmount(room.base_price_per_night, lang)}</span>
                      <span className={styles.roomPricePer}>/{isRu ? 'ночь' : 'night'}</span>
                      <span className={styles.roomPriceTotal}>· {isRu ? 'итого' : 'total'} ${formatAmount(room.base_price_per_night * nights, lang)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Reviews breakdown */}
          {reviews && (
            <div className={styles.reviewsCard}>
              <h2 className={styles.sectionTitle}>{isRu ? 'Оценки гостей' : 'Guest scores'}</h2>
              <div className={styles.reviewsGrid}>
                {[
                  { label: isRu ? 'Чистота' : 'Cleanliness', val: reviews.cleanliness },
                  { label: isRu ? 'Сервис' : 'Service', val: reviews.service },
                  { label: isRu ? 'Расположение' : 'Location', val: reviews.location_score },
                  { label: isRu ? 'Ценность' : 'Value', val: reviews.value },
                ].map(r => (
                  <div key={r.label} className={styles.reviewRow}>
                    <span className={styles.reviewLabel}>{r.label}</span>
                    <div className={styles.reviewBar}>
                      <div className={styles.reviewBarFill} style={{ width: `${(r.val / 5) * 100}%` }} />
                    </div>
                    <span className={styles.reviewVal}>{r.val?.toFixed(1)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className={styles.sidebar}>
          <div className={styles.bookingCard}>
            {/* Score */}
            <div className={styles.scoreRow}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, flexShrink: 0 }}>
                <ScoreRing score={score} size={72} strokeWidth={5} />
                <ScoreReliability
                  value={data.scoring?.score_reliability}
                  level={data.scoring?.score_reliability_level}
                  adjustedScore={data.scoring?.adjusted_score}
                  lang={lang}
                />
                <PriceConfidence value={data.scoring?.price_confidence} level={data.scoring?.price_confidence_level} lang={lang} />
              </div>
              <div className={styles.scoreBreakdown}>
                {analysis?.score_breakdown ? (
                  <>
                    {[
                      { label: isRu ? 'Ценность' : 'Value', val: analysis.score_breakdown.value },
                      { label: isRu ? 'Качество' : 'Quality', val: analysis.score_breakdown.quality },
                      { label: isRu ? 'Доверие' : 'Trust', val: analysis.score_breakdown.trust },
                    ].map(s => (
                      <div key={s.label}>
                        <div className={styles.sbRow}>
                          <span className={styles.sbLabel}>{s.label}</span>
                          <span className={styles.sbVal}>{s.val}</span>
                        </div>
                        <div className={styles.sbBar}><div className={styles.sbBarFill} style={{ width: `${s.val}%` }} /></div>
                      </div>
                    ))}
                    <div className={styles.riskBadge} style={{
                      color: analysis.score_breakdown.risk === 'low' ? 'var(--green)' : analysis.score_breakdown.risk === 'high' ? 'var(--red)' : '#B8860B',
                      background: analysis.score_breakdown.risk === 'low' ? 'var(--green-bg)' : analysis.score_breakdown.risk === 'high' ? 'var(--red-bg)' : 'var(--gold-bg)',
                    }}>
                      {isRu ? 'Риск' : 'Risk'}: {(isRu ? { low: 'Низкий', medium: 'Средний', high: 'Высокий' } : { low: 'Low', medium: 'Medium', high: 'High' })[analysis.score_breakdown.risk] || '—'}
                    </div>
                  </>
                ) : (
                  <p className={styles.sbHint}>{isRu ? 'Запустите ИИ-анализ для детальной оценки' : 'Run AI analysis for a detailed score'}</p>
                )}
              </div>
            </div>

            <div className={styles.divider} />

            {data.scoring && (
              <div style={{ fontSize: 12, lineHeight: 1.55, color: 'var(--text-secondary)' }}>
                <strong>{isRu ? 'Почему такой Score' : 'Why this Score'}</strong>
                <p>{data.scoring.score_explanation}</p>
                <div>{isRu ? 'Версия формулы' : 'Formula version'}: {data.scoring.score_version} · {isRu ? 'рассчитано' : 'calculated'}: {new Date(data.scoring.calculated_at).toLocaleString(lang)}</div>
                <div>{isRu ? 'Полнота данных' : 'Data completeness'}: {data.scoring.data_completeness?.score}%</div>
                <div>{isRu ? 'Уверенность в индексе' : 'Score reliability'}: {data.scoring.score_reliability}% ({isRu ? { high: 'высокая', medium: 'средняя', low: 'низкая' }[data.scoring.score_reliability_level] : { high: 'high', medium: 'medium', low: 'low' }[data.scoring.score_reliability_level]})</div>
                <div>{isRu ? 'Контекстное обучение' : 'Contextual learning'}: {Math.round((data.scoring.calculation_parameters?.contextual_learning_confidence || 0) * 100)}%</div>
                {(data.scoring.calculation_parameters?.active_learning_contexts || []).length > 0 && <div>{isRu ? 'Применённые контексты' : 'Applied contexts'}: {data.scoring.calculation_parameters.active_learning_contexts.join(', ')}</div>}
                <div>{isRu ? 'Оценка для сортировки' : 'Adjusted ranking score'}: {data.scoring.adjusted_score}/100</div>
                <div>{isRu ? 'Уверенность в цене' : 'Price confidence'}: {data.scoring.price_confidence}% ({isRu ? { high: 'высокая', medium: 'средняя', low: 'низкая' }[data.scoring.price_confidence_level] : data.scoring.price_confidence_level})</div>
                <div>{isRu ? 'Допущен к AI Top Pick' : 'Eligible for AI Top Pick'}: {data.scoring.top_pick_eligible ? (isRu ? 'да' : 'yes') : (isRu ? 'нет' : 'no')}</div>
                {data.scoring.room_preference_match && (
                  <div style={{ marginTop: 8 }}>
                    <strong>{isRu ? 'Совпадение номера' : 'Room preference match'}</strong>
                    <div>{isRu ? 'Тип' : 'Type'}: {data.scoring.room_preference_match.type?.score == null ? '—' : `${data.scoring.room_preference_match.type.wanted} → ${data.scoring.room_preference_match.type.actual}: ${data.scoring.room_preference_match.type.score}/100`}</div>
                    <div>{isRu ? 'Вид' : 'View'}: {data.scoring.room_preference_match.view?.score == null ? '—' : `${data.scoring.room_preference_match.view.wanted} → ${data.scoring.room_preference_match.view.actual}: ${data.scoring.room_preference_match.view.score}/100`}</div>
                  </div>
                )}
                {data.scoring.quality_breakdown && (
                  <div style={{ marginTop: 8 }}>
                    <strong>{isRu ? 'Качество для вашего типа поездки' : 'Quality for your travel style'}: {data.scoring.score_breakdown?.quality ?? '—'}/100</strong>
                    <div>{isRu ? 'Профили' : 'Profiles'}: {(data.scoring.quality_profiles || []).join(', ')}</div>
                    {Object.entries(data.scoring.quality_breakdown).map(([key, value]) => value === null ? null : (
                      <div key={key}>{scoreFieldLabel(`quality:${key}`, isRu)}: {value}/100 · {isRu ? 'вес' : 'weight'} {Math.round((data.scoring.quality_weights?.[key] || 0) * 100)}%</div>
                    ))}
                  </div>
                )}
                {data.scoring.review_freshness_breakdown && (
                  <div style={{ marginTop: 8 }}>
                    <strong>{isRu ? 'Актуальность отзывов' : 'Review freshness'}: {data.scoring.quality_breakdown?.review_freshness ?? '—'}/100</strong>
                    <div>{isRu ? 'Надёжность данных о свежести' : 'Freshness data reliability'}: {data.scoring.review_freshness_reliability}%</div>
                    <div>{isRu ? 'Последний отзыв' : 'Latest review'}: {data.scoring.latest_review_at ? new Date(data.scoring.latest_review_at).toLocaleDateString(lang) : '—'}</div>
                    <div>{isRu ? 'Свежие отзывы за 12 месяцев' : 'Reviews from the last 12 months'}: {data.scoring.recent_review_share === null || data.scoring.recent_review_share === undefined ? '—' : `${Math.round(data.scoring.recent_review_share * 100)}%`}</div>
                    <div>{isRu ? 'Динамика рейтинга' : 'Rating trend'}: {data.scoring.rating_trend === null || data.scoring.rating_trend === undefined ? '—' : `${data.scoring.rating_trend > 0 ? '+' : ''}${Number(data.scoring.rating_trend).toFixed(1)}`} ({(isRu ? { sharp_decline: 'резкое ухудшение', decline: 'ухудшение', stable: 'стабильно', improvement: 'улучшение', sharp_improvement: 'резкое улучшение', unknown: 'нет данных' } : { sharp_decline: 'sharp decline', decline: 'decline', stable: 'stable', improvement: 'improvement', sharp_improvement: 'sharp improvement', unknown: 'unknown' })[data.scoring.rating_trend_direction] || '—'})</div>
                    {Object.entries(data.scoring.review_freshness_breakdown).map(([key, value]) => value === null ? null : (
                      <div key={key}>{scoreFieldLabel(`review_freshness:${key}`, isRu)}: {value}/100</div>
                    ))}
                  </div>
                )}
                {data.scoring.review_confidence_breakdown && (
                  <div style={{ marginTop: 8 }}>
                    <strong>{isRu ? 'Доверие к отзывам' : 'Review confidence'}: {data.scoring.review_confidence ?? '—'}/100</strong>
                    <div>{isRu ? 'Надёжность оценки доверия' : 'Confidence assessment reliability'}: {data.scoring.review_confidence_reliability}%</div>
                    <div>{isRu ? 'Площадок с отзывами' : 'Review sources'}: {data.scoring.review_source_count || '—'}</div>
                    {Object.entries(data.scoring.review_confidence_breakdown).map(([key, value]) => (
                      <div key={key}>{scoreFieldLabel(key, isRu)}: {value === null ? (isRu ? 'нет данных' : 'no data') : `${value}/100`} {value !== null && `· ${isRu ? 'вес' : 'weight'} ${Math.round((data.scoring.review_confidence_weights?.[key] || 0) * 100)}%`}</div>
                    ))}
                    <p>{isRu
                      ? 'Неизвестные признаки структуры исключаются из расчёта; процент надёжности показывает полноту проверки.'
                      : 'Unknown review-structure signals are excluded; the reliability percentage shows how complete the assessment is.'}</p>
                  </div>
                )}
                {data.scoring.travel_tier_score !== null && data.scoring.travel_tier_score !== undefined && (
                  <div style={{ marginTop: 8 }}>
                    <strong>{isRu ? 'Соответствие классу отдыха' : 'Travel tier match'}: {data.scoring.travel_tier_score}/100</strong>
                    {Object.entries(data.scoring.travel_tier_breakdown || {}).map(([key, value]) => value === null ? null : (
                      <div key={key}>
                        {(isRu ? {
                          star_fit: 'Звёздность', verified_quality: 'Подтверждённое качество', service: 'Сервис',
                          room_size: 'Размер номера', premium_amenities: 'Премиальные удобства', brand: 'Бренд',
                          room_category: 'Категория номера', room_condition: 'Состояние номера',
                          breakfast_quality: 'Качество завтрака', luxury_review_sentiment: 'Luxury-семантика отзывов',
                          renovation_freshness: 'Свежесть ремонта', market_price: 'Позиция цены',
                        } : {
                          star_fit: 'Star rating', verified_quality: 'Verified quality', service: 'Service',
                          room_size: 'Room size', premium_amenities: 'Premium amenities', brand: 'Brand',
                          room_category: 'Room category', room_condition: 'Room condition',
                          breakfast_quality: 'Breakfast quality', luxury_review_sentiment: 'Luxury review sentiment',
                          renovation_freshness: 'Renovation freshness', market_price: 'Market price position',
                        })[key] || key}: {value}/100
                      </div>
                    ))}
                  </div>
                )}
                <div>{isRu ? 'Источник цены' : 'Price source'}: {data.scoring.price_details?.provider || data.scoring.price_details?.source || '—'}</div>
                <div>{isRu ? 'Валюта' : 'Currency'}: {data.scoring.price_details?.currency || '—'} · {isRu ? 'Налоги' : 'Taxes'}: {({ included: isRu ? 'включены' : 'included', not_included: isRu ? 'не включены' : 'not included', unknown: isRu ? 'неизвестно' : 'unknown' })[data.scoring.price_details?.tax_status || 'unknown']}</div>
                <div>{isRu ? 'За ночь: база / сборы / итог' : 'Per night: base / taxes & fees / total'}: {formatAmount(data.scoring.price_details?.base_price, lang)} / {formatAmount(data.scoring.price_details?.taxes_and_fees_per_night, lang)} / {formatAmount(data.scoring.price_details?.nightly_total_price, lang)}</div>
                <div>{isRu ? 'Итого за период' : 'Stay total'}: {formatAmount(data.scoring.price_details?.stay_total_price, lang)} {data.scoring.price_details?.currency || ''}</div>
                <div>{isRu ? 'Сопоставимая цена для индекса' : 'Comparable price used by the index'}: {formatAmount(data.scoring.comparable_price, lang)} {data.scoring.price_details?.currency || ''} {isRu ? 'за ночь' : 'per night'}</div>
                <div>{isRu ? 'Условия тарифа' : 'Rate conditions'}: {data.scoring.price_details?.refundable ? (isRu ? 'возвратный' : 'refundable') : (isRu ? 'невозвратный' : 'non-refundable')} · {data.scoring.price_details?.includes_breakfast ? (isRu ? 'завтрак включён' : 'breakfast included') : (isRu ? 'без завтрака' : 'breakfast not included')} · {data.scoring.price_details?.requested_guests || guests} {isRu ? 'гост.' : 'guests'}</div>
                {data.scoring.price_details?.comparison_adjustments?.length > 0 && <div>{isRu ? 'Поправки сопоставимости' : 'Comparability adjustments'}: {data.scoring.price_details.comparison_adjustments.join(', ')}</div>}
                {data.scoring.market_price_benchmark && (
                  <div style={{ marginTop: 6 }}>
                    <strong>{isRu ? 'Рыночный ориентир' : 'Market benchmark'}</strong>
                    <div>{isRu ? 'Сегмент' : 'Segment'}: {data.scoring.market_price_benchmark.segment} · {isRu ? 'отелей в выборке' : 'sample'}: {data.scoring.market_price_benchmark.sample_size}</div>
                    <div>P25 / median / P75: {formatAmount(data.scoring.market_price_benchmark.p25, lang)} / {formatAmount(data.scoring.market_price_benchmark.median, lang)} / {formatAmount(data.scoring.market_price_benchmark.p75, lang)} {data.scoring.market_price_benchmark.currency}</div>
                  </div>
                )}
                <div>{isRu ? 'Обновлено' : 'Updated'}: {data.scoring.price_details?.updated_at ? new Date(data.scoring.price_details.updated_at).toLocaleString(lang) : '—'}</div>
                {data.scoring.price_details?.price_warnings?.length > 0 && <div style={{ color: 'var(--red)' }}>⚠ {data.scoring.price_details.price_warnings.join(', ')}</div>}
                <div>{isRu ? 'Доступные признаки' : 'Available features'}: {data.scoring.feature_availability?.available.join(', ')}</div>
                <div>{isRu ? 'Недоступные признаки' : 'Unavailable features'}: {data.scoring.feature_availability?.unavailable.join(', ')}</div>
                {data.scoring.unknown_preference_data?.length > 0 && (
                  <div className={styles.scoreUnknown}>
                    <strong>{isRu ? 'Не подтверждено провайдером' : 'Not confirmed by the provider'}</strong>
                    <p>{isRu
                      ? 'Эти параметры исключены из расчёта и не снижают Score:'
                      : 'These items were excluded from the calculation and do not reduce the Score:'}</p>
                    <ul>
                      {data.scoring.unknown_preference_data.map(field => <li key={field}>{scoreFieldLabel(field, isRu)}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <div className={styles.divider} />

            {/* Operators */}
            <div className={styles.opSection}>
              <div className={styles.opHeader}>
                {isRu ? 'Где бронировать' : 'Where to book'}
                {livePrices.length > 0 && <span className={styles.livePriceBadge}>Xotelo live</span>}
              </div>
              {prices?.map(p => (
                <div key={p.id} className={`${styles.opRow} ${p.id === officialPrice?.id ? styles.opRowBest : ''}`}>
                  <div>
                    <div className={styles.opName}>{p.operator}</div>
                    <div className={styles.opMeta}>
                      {p.source === 'xotelo'
                        ? `${p.currency || 'USD'} · ${p.tax_status === 'included' ? (isRu ? 'налоги включены' : 'taxes included') : p.tax_status === 'not_included' ? (isRu ? 'налоги не включены' : 'taxes not included') : (isRu ? 'налоги неизвестны' : 'tax status unknown')} · ${p.provider_code || 'provider'}`
                        : `${p.includes_breakfast ? (isRu ? '🍳 Завтрак' : '🍳 Breakfast') : ''}${p.cancellation_policy === 'free_cancellation' ? (isRu ? ' · Бесплатная отмена' : ' · Free cancellation') : (isRu ? ' · Невозвратный' : ' · Non-refundable')}`}
                    </div>
                  </div>
                  <div className={styles.opRight}>
                    <div className={styles.opPrice}>${formatAmount(p.price_per_night, lang)}</div>
                    {p.id === officialPrice?.id && (
                      <span className={styles.opBestBadge}>{isRu ? 'Лучшая' : 'Best'}</span>
                    )}
                    {p.source === 'xotelo' && (
                      <span className={styles.opPackageBadge}>Live</span>
                    )}
                    {p.operator === 'Expedia' && p.source !== 'xotelo' && (
                      <span className={styles.opPackageBadge}>{isRu ? 'Пакет' : 'Package'}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className={styles.divider} />

            {/* Total */}
            <div className={styles.totalRow}>
              <span>{isRu ? `Итого за ${nights} ночей` : `Total for ${nights} nights`}</span>
              <span className={styles.totalPrice}>${formatAmount(officialPrice?.stay_total_price || (officialPrice?.price_per_night || 0) * nights, lang)}</span>
            </div>

            <button className={styles.bookBtn} data-testid="continue-at-provider" onClick={handleBooking} disabled={!partnerBookingReady || (!officialPrice?.url && !hotel.tripadvisor_url)}>
              {partnerBookingReady ? <>{isRu ? 'Перейти к партнёру' : 'Continue at provider'} — ${formatAmount(officialPrice?.price_per_night || 0, lang)}/{isRu ? 'ночь' : 'night'}</> : (isRu ? 'Бронирование скоро будет доступно' : 'Booking will be soon')}
            </button>
            <p className={styles.bookNote}>
              {!partnerBookingReady ? (isRu ? 'Сейчас Fairworth показывает и сравнивает реальные цены, но не перенаправляет к бронированию.' : 'Fairworth currently displays and compares live prices but does not redirect to booking.') : livePrices.length > 0 ? (isRu ? `Цены Xotelo · обновление до ${data.price_meta?.ttl_hours || 12} часов` : `Xotelo prices · refreshed within ${data.price_meta?.ttl_hours || 12} hours`) : (isRu ? 'Проверьте итоговые условия у поставщика' : 'Confirm final terms with the provider')}
            </p>

            <button
              className={`${styles.compareCardBtn} ${isInCompare(id) ? styles.compareCardBtnActive : ''}`}
              onClick={() => toggleCompare({ id: hotel.id, name: hotel.name })}
            >
              {isInCompare(id) ? <Check size={14} /> : <Plus size={14} />}
              {isInCompare(id) ? (isRu ? 'Добавлено в сравнение' : 'Added to compare') : (isRu ? 'Добавить в сравнение' : 'Add to compare')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
