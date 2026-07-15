import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Sparkles, Plus, X } from 'lucide-react';
import { compareApi } from '../api';
import ScoreRing from '../components/ScoreRing';
import styles from './ComparePage.module.css';
import { formatAmount } from '../utils/money';
import { useLang } from '../i18n/LanguageContext';
import { validFutureDates } from '../utils/dates';

const CHECK = '✓';
const CROSS = '✗';

function CellVal({ val, good, bad }) {
  const cls = good ? styles.cellGood : bad ? styles.cellBad : '';
  return <span className={cls}>{val}</span>;
}

export default function ComparePage({ compareList, setCompareList }) {
  const navigate = useNavigate();
  const { lang } = useLang();
  const isRu = lang === 'ru';
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  let storedDates = {};
  try { storedDates = JSON.parse(window.sessionStorage.getItem('fairworth_dates') || '{}'); } catch {}
  const dates = validFutureDates(storedDates);
  const checkIn = dates.check_in;
  const checkOut = dates.check_out;
  let storedTrip = {};
  try { storedTrip = JSON.parse(window.sessionStorage.getItem('fairworth_trip') || '{}'); } catch {}

  useEffect(() => {
    if (compareList.length >= 2) {
      runCompare();
    }
  }, []); // eslint-disable-line

  const runCompare = async () => {
    setLoading(true);
    setError(null);
    try {
      const ids = compareList.map(h => h.id);
      const res = await compareApi.compare(ids, checkIn, checkOut, lang, storedTrip.guests || 2, storedTrip.trip_purpose || 'leisure');
      setResult(res.data);
    } catch (e) {
      setError(isRu ? 'Ошибка сравнения. Проверьте что сервер запущен.' : 'Comparison failed. Make sure the server is running.');
    } finally {
      setLoading(false);
    }
  };

  if (compareList.length < 2) {
    return (
      <div className={styles.page}>
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>⚖️</div>
          <h2>{isRu ? 'Добавьте минимум 2 отеля для сравнения' : 'Add at least 2 hotels to compare'}</h2>
          <p>{isRu ? 'На странице результатов нажмите «Сравнить» на понравившихся отелях' : 'Choose Compare on the results page for hotels you like'}</p>
          <Link to="/results?city=Singapore" className={styles.backBtn}>{isRu ? '← К результатам поиска' : '← Back to search results'}</Link>
        </div>
      </div>
    );
  }

  const nights = Math.ceil((new Date(checkOut) - new Date(checkIn)) / (1000 * 60 * 60 * 24));

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.headerInner}>
          <div>
            <h1 className={styles.title}>{isRu ? 'Сравнение вариантов' : 'Compare options'}</h1>
            <p className={styles.sub}>{isRu ? 'Сингапур' : 'Singapore'} · {checkIn} – {checkOut} · {nights} {isRu ? 'ночей' : 'nights'}</p>
          </div>
          <div className={styles.headerActions}>
            <button className={styles.refreshBtn} onClick={runCompare} disabled={loading}>
              {loading ? (isRu ? 'Обновляю...' : 'Refreshing...') : (isRu ? 'Обновить сравнение' : 'Refresh comparison')}
            </button>
            <Link to="/results?city=Singapore" className={styles.addMoreBtn}>
              <Plus size={14} /> {isRu ? 'Добавить отель' : 'Add hotel'}
            </Link>
          </div>
        </div>
      </div>

      <div className={styles.content}>
        {/* AI Verdict */}
        {result?.ai_verdict && (
          <div className={styles.verdictCard}>
            <div className={styles.verdictHeader}>
              <div className={styles.verdictIcon}><Sparkles size={20} /></div>
              <div>
                <div className={styles.verdictTitle}>{isRu ? 'Вердикт ИИ' : 'AI verdict'}</div>
                <div className={styles.verdictWinner}>
                  {isRu ? 'Лучший выбор для вас:' : 'Best choice for you:'} <strong>{result.ai_verdict.winner_name}</strong>
                </div>
              </div>
            </div>
            <p className={styles.verdictText}>{result.ai_verdict.verdict}</p>
            <div className={styles.verdictTips}>
              {result.ai_verdict.budget_pick && (
                <div className={styles.verdictTip}>
                  <span className={styles.tipLabel}>💰 {isRu ? 'Бюджетный' : 'Best value'}</span>
                  {result.ai_verdict.budget_pick}
                </div>
              )}
              {result.ai_verdict.luxury_pick && (
                <div className={styles.verdictTip}>
                  <span className={styles.tipLabel}>✨ {isRu ? 'Максимум' : 'Best luxury'}</span>
                  {result.ai_verdict.luxury_pick}
                </div>
              )}
            </div>
          </div>
        )}

        {loading && (
          <div className={styles.loadingState}>
            <div className={styles.spinner} />
            <span>{isRu ? 'ИИ сравнивает варианты...' : 'AI is comparing your options...'}</span>
          </div>
        )}

        {error && <div className={styles.errorMsg}>{error}</div>}

        {/* Comparison table */}
        {result?.comparison && (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.thEmpty} />
                  {result.comparison.map((c, i) => {
                    const isWinner = result.ai_verdict?.winner_id === c.hotel.id;
                    return (
                      <th key={c.hotel.id} className={`${styles.th} ${isWinner ? styles.thWinner : ''}`}>
                        <div className={styles.colHead}>
                          {isWinner && <div className={styles.winnerBadge}>✦ {isRu ? 'Рекомендация ИИ' : 'AI recommendation'}</div>}
                          <div
                            className={styles.colName}
                            onClick={() => navigate(`/hotel/${c.hotel.id}?check_in=${checkIn}&check_out=${checkOut}`)}
                          >
                            {c.hotel.name}
                          </div>
                          <div className={styles.colSub}>{c.hotel.location} · {c.hotel.stars}★</div>
                          <div className={styles.colPrice}>${formatAmount(c.bestPrice, lang)}</div>
                          <div className={styles.colPriceSub}>{isRu ? '/ночь · итого' : '/night · total'} ${formatAmount(c.totalPrice, lang)}</div>
                          <ScoreRing score={c.score || 0} size={48} strokeWidth={4} />
                          <button
                            className={styles.removeBtn}
                            onClick={() => setCompareList(prev => prev.filter(h => h.id !== c.hotel.id))}
                          ><X size={12} /></button>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {[
                  {
                    label: 'Fairworth Score',
                    render: c => {
                      const best = Math.max(...result.comparison.map(x => x.score || 0));
                      return <CellVal val={`${c.score}/100`} good={c.score === best} />;
                    }
                  },
                  {
                    label: isRu ? 'Рейтинг гостей' : 'Guest rating',
                    render: c => {
                      const best = Math.max(...result.comparison.map(x => x.reviews?.rating || 0));
                      return <CellVal val={c.reviews?.rating ? `${c.reviews.rating.toFixed(1)} ★` : '—'} good={c.reviews?.rating === best} />;
                    }
                  },
                  {
                    label: isRu ? 'Завтрак' : 'Breakfast',
                    render: c => c.hasBreakfast
                      ? <span className={styles.checkMark}>{CHECK} {isRu ? 'Включён' : 'Included'}</span>
                      : <span className={styles.crossMark}>{CROSS} {isRu ? 'Нет' : 'No'}</span>
                  },
                  {
                    label: isRu ? 'Бесплатная отмена' : 'Free cancellation',
                    render: c => c.hasFreeCancellation
                      ? <span className={styles.checkMark}>{CHECK} {isRu ? 'Есть' : 'Available'}</span>
                      : <span className={styles.crossMark}>{CROSS} {isRu ? 'Нет' : 'No'}</span>
                  },
                  {
                    label: isRu ? 'Бассейн' : 'Pool',
                    render: c => {
                      const amenities = JSON.parse(c.hotel.amenities || '[]');
                      const has = amenities.some(a => a.includes('pool'));
                      return has ? <span className={styles.checkMark}>{CHECK}</span> : <span className={styles.crossMark}>{CROSS}</span>;
                    }
                  },
                  {
                    label: isRu ? 'Спа' : 'Spa',
                    render: c => {
                      const amenities = JSON.parse(c.hotel.amenities || '[]');
                      const has = amenities.includes('spa');
                      return has ? <span className={styles.checkMark}>{CHECK}</span> : <span className={styles.crossMark}>{CROSS}</span>;
                    }
                  },
                  {
                    label: isRu ? 'Цена за ночь' : 'Price per night',
                    render: c => {
                      const best = Math.min(...result.comparison.map(x => x.bestPrice || 99999));
                      return <CellVal val={`$${formatAmount(c.bestPrice, lang)}`} good={c.bestPrice === best} />;
                    }
                  },
                  {
                    label: isRu ? `Итого за ${nights} ночей` : `Total for ${nights} nights`,
                    render: c => {
                      const best = Math.min(...result.comparison.map(x => x.totalPrice || 99999));
                      return <CellVal val={`$${formatAmount(c.totalPrice, lang)}`} good={c.totalPrice === best} bad={c.totalPrice > best * 1.5} />;
                    }
                  },
                  {
                    label: isRu ? 'Отзывов' : 'Reviews',
                    render: c => {
                      const best = Math.max(...result.comparison.map(x => x.reviews?.count || 0));
                      return <CellVal val={(c.reviews?.count || 0).toLocaleString()} good={c.reviews?.count === best} />;
                    }
                  },
                  {
                    label: '',
                    render: c => (
                      <button
                        className={styles.bookRowBtn}
                        data-testid={`comparison-details-${c.hotel.id}`}
                        onClick={() => navigate(`/hotel/${c.hotel.id}?check_in=${checkIn}&check_out=${checkOut}`)}
                      >
                        {isRu ? 'Подробнее →' : 'View details →'}
                      </button>
                    )
                  },
                ].map((row, ri) => (
                  <tr key={ri} className={row.label ? styles.tr : styles.trAction}>
                    <td className={styles.tdLabel}>{row.label}</td>
                    {result.comparison.map(c => {
                      const isWinner = result.ai_verdict?.winner_id === c.hotel.id;
                      return (
                        <td key={c.hotel.id} className={`${styles.td} ${isWinner ? styles.tdWinner : ''}`}>
                          {row.render(c)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
