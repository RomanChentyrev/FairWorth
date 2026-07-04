import React, { useState, useEffect } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { Star, MapPin, Sparkles, Plus, Check, ArrowLeft, Bookmark, BookmarkCheck } from 'lucide-react';
import { hotelsApi, usersApi, interactionsApi, partnersApi } from '../api';
import ScoreRing from '../components/ScoreRing';
import styles from './HotelDetailPage.module.css';
import { useLang } from '../i18n/LanguageContext';
import { validFutureDates } from '../utils/dates';
import { formatAmount } from '../utils/money';

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

export default function HotelDetailPage({ compareList, toggleCompare, isInCompare }) {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { lang } = useLang();
  const isRu = lang === 'ru';
  const dates = validFutureDates({ check_in: searchParams.get('check_in'), check_out: searchParams.get('check_out') });
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

  const nights = Math.ceil((new Date(checkOut) - new Date(checkIn)) / (1000 * 60 * 60 * 24));

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [res, bookmarksRes] = await Promise.all([
          hotelsApi.get(id, { check_in: checkIn, check_out: checkOut, language: lang }),
          usersApi.getBookmarks(),
        ]);
        setData(res.data);
        setBookmarked((bookmarksRes.data.bookmarks || []).some(bookmark => bookmark.id === id));
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [id, checkIn, checkOut, lang]);

  useEffect(() => {
    interactionsApi.track('view', {
      hotel_id: id,
      context: { check_in: checkIn, check_out: checkOut },
    }).catch(() => {});
  }, [id, checkIn, checkOut]);

  const runAnalysis = async () => {
    setAnalysisLoading(true);
    setAnalysis(null);
    try {
      const res = await hotelsApi.analyze(id, { check_in: checkIn, check_out: checkOut, language: lang });
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

  const handleBooking = async () => {
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
  const amenities = JSON.parse(hotel.amenities || '[]');
  const livePrices = prices?.filter(p => p.source === 'xotelo') || [];
  const bestPrice = prices?.reduce((min, p) => p.price_per_night < min.price_per_night ? p : min, prices[0]);
  const officialPrice = livePrices[0] || prices?.find(p => p.operator === 'Official Website') || bestPrice;

  const score = data.scoring?.fairworth_score || 75;

  return (
    <div className={styles.page}>
      {/* Hero */}
      <div className={styles.hero} style={{ background: getGradient(id) }}>
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
              <button
                className={`${styles.compareHeroBtn} ${isInCompare(id) ? styles.compareHeroBtnActive : ''}`}
                onClick={() => toggleCompare({ id: hotel.id, name: hotel.name })}
              >
                {isInCompare(id) ? <Check size={14} /> : <Plus size={14} />}
                {isInCompare(id) ? (isRu ? 'В сравнении' : 'Comparing') : (isRu ? 'Сравнить' : 'Compare')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className={styles.tabsBar}>
        <div className={styles.tabsInner}>
          {['overview', 'rooms', 'prices', 'reviews'].map(t => (
            <button
              key={t}
              className={`${styles.tab} ${activeTab === t ? styles.tabActive : ''}`}
              onClick={() => setActiveTab(t)}
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
                  disabled={analysisLoading}
                >
                  {analysisLoading ? (
                    <><span className={styles.spinner} /> {isRu ? 'Анализирую...' : 'Analysing...'}</>
                  ) : (
                    <><Sparkles size={13} /> {isRu ? 'Запустить анализ' : 'Run analysis'}</>
                  )}
                </button>
              )}
            </div>

            {!analysis && !analysisLoading && (
              <p className={styles.aiPlaceholder}>
                {isRu ? 'Нажмите «Запустить анализ» — ИИ оценит отель с учётом ваших предпочтений, порекомендует лучший номер, объяснит риски и выберет оптимального туроператора.' : 'Select “Run analysis” and AI will evaluate this hotel for your preferences, recommend a room, explain risks, and choose the best booking provider.'}
              </p>
            )}

            {analysisLoading && (
              <div className={styles.aiLoading}>
                <div className={styles.aiLoadingDots}>
                  <span /><span /><span />
                </div>
                <span>{isRu ? 'ИИ анализирует 847 источников данных...' : 'AI is analysing 847 data sources...'}</span>
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
              {(showAllAmenities ? amenities : amenities.slice(0, 24)).map(a => (
                <div key={a} className={styles.amenityItem}>
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
                    {JSON.parse(room.amenities || '[]').slice(0, 3).map(a => (
                      <span key={a} className={styles.roomTag}>{a.replace(/-/g, ' ')}</span>
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
              <ScoreRing score={score} size={72} strokeWidth={5} />
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
                <div>{isRu ? 'Источник цены' : 'Price source'}: {data.scoring.price_details?.provider || data.scoring.price_details?.source || '—'}</div>
                <div>{isRu ? 'Валюта' : 'Currency'}: {data.scoring.price_details?.currency || '—'} · {isRu ? 'Налоги' : 'Taxes'}: {({ included: isRu ? 'включены' : 'included', not_included: isRu ? 'не включены' : 'not included', unknown: isRu ? 'неизвестно' : 'unknown' })[data.scoring.price_details?.tax_status || 'unknown']}</div>
                <div>{isRu ? 'За ночь: база / сборы / итог' : 'Per night: base / taxes & fees / total'}: {formatAmount(data.scoring.price_details?.base_price, lang)} / {formatAmount(data.scoring.price_details?.taxes_and_fees_per_night, lang)} / {formatAmount(data.scoring.price_details?.nightly_total_price, lang)}</div>
                <div>{isRu ? 'Итого за период' : 'Stay total'}: {formatAmount(data.scoring.price_details?.stay_total_price, lang)} {data.scoring.price_details?.currency || ''}</div>
                <div>{isRu ? 'Обновлено' : 'Updated'}: {data.scoring.price_details?.updated_at ? new Date(data.scoring.price_details.updated_at).toLocaleString(lang) : '—'}</div>
                {data.scoring.price_details?.price_warnings?.length > 0 && <div style={{ color: 'var(--red)' }}>⚠ {data.scoring.price_details.price_warnings.join(', ')}</div>}
                <div>{isRu ? 'Доступные признаки' : 'Available features'}: {data.scoring.feature_availability?.available.join(', ')}</div>
                <div>{isRu ? 'Недоступные признаки' : 'Unavailable features'}: {data.scoring.feature_availability?.unavailable.join(', ')}</div>
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

            <button className={styles.bookBtn} data-testid="continue-at-provider" onClick={handleBooking} disabled={!officialPrice?.url && !hotel.tripadvisor_url}>
              {isRu ? 'Перейти к партнёру' : 'Continue at provider'} — ${formatAmount(officialPrice?.price_per_night || 0, lang)}/{isRu ? 'ночь' : 'night'}
            </button>
            <p className={styles.bookNote}>
              {livePrices.length > 0 ? (isRu ? `Цены Xotelo · обновление до ${data.price_meta?.ttl_hours || 12} часов` : `Xotelo prices · refreshed within ${data.price_meta?.ttl_hours || 12} hours`) : (isRu ? 'Бесплатная отмена · Без скрытых комиссий' : 'Free cancellation · No hidden fees')}
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
