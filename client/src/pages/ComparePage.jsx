import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Sparkles, Plus, X } from 'lucide-react';
import { compareApi } from '../api';
import ScoreRing from '../components/ScoreRing';
import styles from './ComparePage.module.css';
import { formatAmount } from '../utils/money';
import { useLang } from '../i18n/LanguageContext';
import { parseStringList } from '../utils/collections';
import { validFutureDates } from '../utils/dates';

const CHECK = '✓';
const CROSS = '✗';

function CellVal({ val, good, bad }) {
  const cls = good ? styles.cellGood : bad ? styles.cellBad : '';
  return <span className={cls}>{val}</span>;
}

export default function ComparePage({ compareList, setCompareList }) {
  const navigate = useNavigate();
  const { lang , l} = useLang();
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
  }, []);

  const runCompare = async () => {
    setLoading(true);
    setError(null);
    try {
      const ids = compareList.map(h => h.id);
      const res = await compareApi.compare(ids, checkIn, checkOut, lang, storedTrip.guests || 2, storedTrip.trip_purpose || 'leisure');
      setResult(res.data);
    } catch (e) {
      setError(l('Comparison failed. Make sure the server is running.', 'Ошибка сравнения. Проверьте что сервер запущен.'));
    } finally {
      setLoading(false);
    }
  };

  if (compareList.length < 2) {
    return (
      <div className={styles.page}>
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>⚖️</div>
          <h2>{l('Add at least 2 hotels to compare', 'Добавьте минимум 2 отеля для сравнения')}</h2>
          <p>{l('Choose Compare on the results page for hotels you like', 'На странице результатов нажмите «Сравнить» на понравившихся отелях')}</p>
          <Link to="/results?city=Singapore" className={styles.backBtn}>{l('← Back to search results', '← К результатам поиска')}</Link>
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
            <h1 className={styles.title}>{l('Compare options', 'Сравнение вариантов')}</h1>
            <p className={styles.sub}>{l('Singapore', 'Сингапур')} · {checkIn} – {checkOut} · {nights} {l('nights', 'ночей')}</p>
          </div>
          <div className={styles.headerActions}>
            <button className={styles.refreshBtn} onClick={runCompare} disabled={loading}>
              {loading ? (l('Refreshing...', 'Обновляю...')) : (l('Refresh comparison', 'Обновить сравнение'))}
            </button>
            <Link to="/results?city=Singapore" className={styles.addMoreBtn}>
              <Plus size={14} /> {l('Add hotel', 'Добавить отель')}
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
                <div className={styles.verdictTitle}>{l('AI verdict', 'Вердикт ИИ')}</div>
                <div className={styles.verdictWinner}>
                  {l('Best choice for you:', 'Лучший выбор для вас:')} <strong>{result.ai_verdict.winner_name}</strong>
                </div>
              </div>
            </div>
            <p className={styles.verdictText}>{result.ai_verdict.verdict}</p>
            <div className={styles.verdictTips}>
              {result.ai_verdict.budget_pick && (
                <div className={styles.verdictTip}>
                  <span className={styles.tipLabel}>💰 {l('Best value', 'Бюджетный')}</span>
                  {result.ai_verdict.budget_pick}
                </div>
              )}
              {result.ai_verdict.luxury_pick && (
                <div className={styles.verdictTip}>
                  <span className={styles.tipLabel}>✨ {l('Best luxury', 'Максимум')}</span>
                  {result.ai_verdict.luxury_pick}
                </div>
              )}
            </div>
          </div>
        )}

        {loading && (
          <div className={styles.loadingState}>
            <div className={styles.spinner} />
            <span>{l('AI is comparing your options...', 'ИИ сравнивает варианты...')}</span>
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
                          {isWinner && <div className={styles.winnerBadge}>✦ {l('AI recommendation', 'Рекомендация ИИ')}</div>}
                          <div
                            className={styles.colName}
                            onClick={() => navigate(`/hotel/${c.hotel.id}?check_in=${checkIn}&check_out=${checkOut}`)}
                          >
                            {c.hotel.name}
                          </div>
                          <div className={styles.colSub}>{c.hotel.location} · {c.hotel.stars}★</div>
                          <div className={styles.colPrice}>${formatAmount(c.bestPrice, lang)}</div>
                          <div className={styles.colPriceSub}>{l('/night · total', '/ночь · итого')} ${formatAmount(c.totalPrice, lang)}</div>
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
                    label: l('Guest rating', 'Рейтинг гостей'),
                    render: c => {
                      const best = Math.max(...result.comparison.map(x => x.reviews?.rating || 0));
                      return <CellVal val={c.reviews?.rating ? `${c.reviews.rating.toFixed(1)} ★` : '—'} good={c.reviews?.rating === best} />;
                    }
                  },
                  {
                    label: l('Breakfast', 'Завтрак'),
                    render: c => c.hasBreakfast
                      ? <span className={styles.checkMark}>{CHECK} {l('Included', 'Включён')}</span>
                      : <span className={styles.crossMark}>{CROSS} {l('No', 'Нет')}</span>
                  },
                  {
                    label: l('Free cancellation', 'Бесплатная отмена'),
                    render: c => c.hasFreeCancellation
                      ? <span className={styles.checkMark}>{CHECK} {l('Available', 'Есть')}</span>
                      : <span className={styles.crossMark}>{CROSS} {l('No', 'Нет')}</span>
                  },
                  {
                    label: l('Pool', 'Бассейн'),
                    render: c => {
                      const amenities = parseStringList(c.hotel.amenities);
                      const has = amenities.some(a => a.includes('pool'));
                      return has ? <span className={styles.checkMark}>{CHECK}</span> : <span className={styles.crossMark}>{CROSS}</span>;
                    }
                  },
                  {
                    label: l('Spa', 'Спа'),
                    render: c => {
                      const amenities = parseStringList(c.hotel.amenities);
                      const has = amenities.includes('spa');
                      return has ? <span className={styles.checkMark}>{CHECK}</span> : <span className={styles.crossMark}>{CROSS}</span>;
                    }
                  },
                  {
                    label: l('Price per night', 'Цена за ночь'),
                    render: c => {
                      const best = Math.min(...result.comparison.map(x => x.bestPrice || 99999));
                      return <CellVal val={`$${formatAmount(c.bestPrice, lang)}`} good={c.bestPrice === best} />;
                    }
                  },
                  {
                    label: l(`Total for ${nights} nights`, `Итого за ${nights} ночей`),
                    render: c => {
                      const best = Math.min(...result.comparison.map(x => x.totalPrice || 99999));
                      return <CellVal val={`$${formatAmount(c.totalPrice, lang)}`} good={c.totalPrice === best} bad={c.totalPrice > best * 1.5} />;
                    }
                  },
                  {
                    label: l('Reviews', 'Отзывов'),
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
                        {l('View details →', 'Подробнее →')}
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
