import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronUp, Search, SlidersHorizontal, X } from 'lucide-react';
import { transfersApi } from '../api';
import TransferCard from '../components/TransferCard';
import { useLang } from '../i18n/LanguageContext';
import { useTripBasket } from '../context/TripBasketContext';
import styles from './ResultsPage.module.css';

function FilterSection({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={styles.filterSection}>
      <button className={styles.filterSectionHeader} onClick={() => setOpen(o => !o)}>
        <span className={styles.filterSectionTitle}>{title}</span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && <div className={styles.filterSectionBody}>{children}</div>}
    </div>
  );
}

function RangeSlider({ min, max, value, onChange, prefix = '$', step = 10 }) {
  return (
    <div className={styles.rangeWrap}>
      <div className={styles.rangeValues}>
        <span>{prefix}{value[0].toLocaleString()}</span>
        <span>{prefix}{value[1].toLocaleString()}</span>
      </div>
      <div className={styles.rangeTrack}>
        <input type="range" min={min} max={max} step={step} value={value[0]}
          onChange={e => onChange([Math.min(Number(e.target.value), value[1] - step), value[1]])}
          className={styles.rangeInput} />
        <input type="range" min={min} max={max} step={step} value={value[1]}
          onChange={e => onChange([value[0], Math.max(Number(e.target.value), value[0] + step)])}
          className={styles.rangeInput} />
      </div>
    </div>
  );
}

const SORTS = [
  { value: 'score', ru: 'Fairworth Score', en: 'Fairworth Score' },
  { value: 'price_asc', ru: 'Цена ↑', en: 'Price ↑' },
  { value: 'price_desc', ru: 'Цена ↓', en: 'Price ↓' },
  { value: 'duration', ru: 'Время в пути', en: 'Duration' },
  { value: 'capacity', ru: 'Вместимость', en: 'Capacity' },
];

export default function TransfersPage() {
  const { t, lang } = useLang();
  const { basket } = useTripBasket();
  const [searchParams, setSearchParams] = useSearchParams();
  const basketAirport = basket.outboundFlight?.destinationCode;
  const basketHotel = basket.hotel?.name;
  const basketPassengers = basket.outboundFlight?.passengers || basket.hotel?.guests;

  const [airport, setAirport] = useState(searchParams.get('airport') || basketAirport || 'SIN');
  const [hotel, setHotel] = useState(searchParams.get('hotel') || basketHotel || 'Mandarin Oriental Singapore');
  const [passengers, setPassengers] = useState(searchParams.get('passengers') || String(basketPassengers || '2'));
  const [luggage, setLuggage] = useState(searchParams.get('luggage') || '2');
  const [searchOpen, setSearchOpen] = useState(false);

  const [transfers, setTransfers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [providerUnavailable, setProviderUnavailable] = useState(false);
  const [aiMessage, setAiMessage] = useState('');

  const [sort, setSort] = useState('score');
  const [priceRange, setPriceRange] = useState([0, 180]);
  const [vehicleType, setVehicleType] = useState('');
  const [meetAndGreet, setMeetAndGreet] = useState(false);

  useEffect(() => {
    const nextAirport = searchParams.get('airport') || basketAirport;
    const nextHotel = searchParams.get('hotel') || basketHotel;
    const nextPassengers = searchParams.get('passengers') || (basketPassengers ? String(basketPassengers) : '');
    if (nextAirport && nextAirport !== airport) setAirport(nextAirport);
    if (nextHotel && nextHotel !== hotel) setHotel(nextHotel);
    if (nextPassengers && nextPassengers !== passengers) setPassengers(nextPassengers);
  }, [basketAirport, basketHotel, basketPassengers, searchParams, airport, hotel, passengers]);

  useEffect(() => {
    if (!basketAirport && !basketHotel) return;
    const next = new URLSearchParams(searchParams);
    let changed = false;
    if (basketAirport && !searchParams.get('airport')) {
      next.set('airport', basketAirport);
      changed = true;
    }
    if (basketHotel && !searchParams.get('hotel')) {
      next.set('hotel', basketHotel);
      changed = true;
    }
    if (basketPassengers && !searchParams.get('passengers')) {
      next.set('passengers', String(basketPassengers));
      changed = true;
    }
    if (changed) setSearchParams(next, { replace: true });
  }, [basketAirport, basketHotel, basketPassengers, searchParams, setSearchParams]);

  const fetchTransfers = useCallback(async () => {
    setLoading(true);
    setError(null);
    setProviderUnavailable(false);
    try {
      const params = { airport, hotel, passengers, luggage, sort };
      if (priceRange[1] < 180) params.max_price = priceRange[1];
      if (vehicleType) params.vehicle_type = vehicleType;
      if (meetAndGreet) params.meet_and_greet = '1';
      const res = await transfersApi.search(params);
      let results = res.data.transfers || [];
      if (priceRange[0] > 0) results = results.filter(t => Number(t.price) >= priceRange[0]);
      setTransfers(results);
      if (results.length) {
        const best = results[0];
        setAiMessage(lang === 'ru'
          ? `Лучший трансфер — **${best.provider} ${best.vehicle_name}** (Score ${best.fairworth_score}/100). ${best.duration_label}, до ${best.max_passengers} пассажиров, от $${best.price}.`
          : `Best transfer — **${best.provider} ${best.vehicle_name}** (Score ${best.fairworth_score}/100). ${best.duration_label}, up to ${best.max_passengers} passengers, from $${best.price}.`);
      } else {
        setAiMessage('');
      }
    } catch (requestError) {
      if (requestError.response?.data?.code === 'TRANSFER_PROVIDER_UNAVAILABLE') {
        setTransfers([]);
        setAiMessage('');
        setProviderUnavailable(true);
      } else {
        setError(requestError.response?.data?.error || t('results_error'));
      }
    } finally {
      setLoading(false);
    }
  }, [airport, hotel, passengers, luggage, sort, priceRange, vehicleType, meetAndGreet, lang]);

  useEffect(() => { fetchTransfers(); }, [fetchTransfers]);

  const activeFiltersCount = (priceRange[0] > 0 || priceRange[1] < 180 ? 1 : 0)
    + (vehicleType ? 1 : 0)
    + (meetAndGreet ? 1 : 0);

  const resetFilters = () => {
    setPriceRange([0, 180]);
    setVehicleType('');
    setMeetAndGreet(false);
  };

  const handleSearch = (e) => {
    e.preventDefault();
    setSearchParams({ airport, hotel, passengers, luggage });
    setSearchOpen(false);
  };

  return (
    <div className={styles.page}>
      <div className={styles.searchBar}>
        <div className={styles.searchBarInner}>
          {!searchOpen ? (
            <>
              <div className={styles.searchPills}>
                <div className={styles.pill}>
                  <span className={styles.pillLabel}>{t('transfer_pickup')}</span>
                  <span className={styles.pillValue}>{airport}</span>
                </div>
                <div className={styles.pillDiv} />
                <div className={styles.pill}>
                  <span className={styles.pillLabel}>{t('transfer_dropoff')}</span>
                  <span className={styles.pillValue}>{hotel}</span>
                </div>
                <div className={styles.pillDiv} />
                <div className={styles.pill}>
                  <span className={styles.pillLabel}>{t('results_guests')}</span>
                  <span className={styles.pillValue}>{passengers} {t('results_adults')} · {luggage} {t('transfer_luggage_short')}</span>
                </div>
              </div>
              <button className={styles.changeBtn} onClick={() => setSearchOpen(true)}><ChevronDown size={14} /> {t('results_change')}</button>
            </>
          ) : (
            <form onSubmit={handleSearch} className={styles.inlineSearchForm}>
              <div className={styles.inlineField}><span className={styles.inlineLabel}>{t('transfer_airport')}</span><input className={styles.inlineInput} value={airport} onChange={e => setAirport(e.target.value)} /></div>
              <div className={styles.inlineDivider} />
              <div className={styles.inlineField}><span className={styles.inlineLabel}>{t('transfer_hotel')}</span><input className={styles.inlineInput} value={hotel} onChange={e => setHotel(e.target.value)} /></div>
              <div className={styles.inlineDivider} />
              <div className={styles.inlineField}><span className={styles.inlineLabel}>{t('results_guests')}</span>
                <select className={styles.inlineInput} value={passengers} onChange={e => setPassengers(e.target.value)}>
                  {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div className={styles.inlineDivider} />
              <div className={styles.inlineField}><span className={styles.inlineLabel}>{t('transfer_luggage')}</span>
                <select className={styles.inlineInput} value={luggage} onChange={e => setLuggage(e.target.value)}>
                  {[0,1,2,3,4,5,6].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <button type="submit" className={styles.inlineSearchBtn}><Search size={15} /> {t('results_find')}</button>
              <button type="button" className={styles.inlineCancelBtn} onClick={() => setSearchOpen(false)}><X size={15} /></button>
            </form>
          )}
        </div>
      </div>

      <div className={`${styles.layout} ${styles.flightLayout}`}>
        <aside className={styles.sidebar}>
          <div className={styles.filterCard}>
            <div className={styles.filterHeader}>
              <div className={styles.filterHeaderLeft}>
                <SlidersHorizontal size={15} />
                {t('results_filters')}
                {activeFiltersCount > 0 && <span className={styles.filterBadge}>{activeFiltersCount}</span>}
              </div>
              {activeFiltersCount > 0 && <button className={styles.resetBtn} onClick={resetFilters}>{t('results_reset')}</button>}
            </div>

            <FilterSection title={t('results_sort')}>
              <div className={styles.sortList}>
                {SORTS.map(opt => (
                  <button key={opt.value} className={`${styles.sortItem} ${sort === opt.value ? styles.sortItemActive : ''}`} onClick={() => setSort(opt.value)}>
                    {sort === opt.value && <span className={styles.sortDot} />}
                    {lang === 'ru' ? opt.ru : opt.en}
                  </button>
                ))}
              </div>
            </FilterSection>

            <FilterSection title={t('transfer_price')}>
              <RangeSlider min={0} max={180} step={10} value={priceRange} onChange={setPriceRange} />
            </FilterSection>

            <FilterSection title={t('transfer_vehicle')}>
              <div className={styles.ratingBtns}>
                {[
                  ['', t('results_rating_any')],
                  ['sedan', t('transfer_sedan')],
                  ['van', t('transfer_van')],
                  ['luxury', t('transfer_luxury')],
                ].map(([value, label]) => (
                  <button key={value || 'any'} className={`${styles.ratingBtn} ${vehicleType === value ? styles.ratingBtnOn : ''}`} onClick={() => setVehicleType(value)}>
                    {label}
                  </button>
                ))}
              </div>
            </FilterSection>

            <FilterSection title={t('results_conditions')} defaultOpen={false}>
              <div className={styles.checkList}>
                <label className={styles.checkItem}>
                  <input type="checkbox" checked={meetAndGreet} onChange={e => setMeetAndGreet(e.target.checked)} className={styles.checkBox} />
                  <span>{t('transfer_meet')}</span>
                </label>
              </div>
            </FilterSection>
          </div>
        </aside>

        <main className={styles.main}>
          {aiMessage && !loading && (
            <div className={styles.aiBanner}>
              <div className={styles.aiDot} />
              <div className={styles.aiText}>
                {aiMessage.split('**').map((part, i) => i % 2 === 1 ? <strong key={i}>{part}</strong> : part)}
              </div>
            </div>
          )}
          <div className={styles.resultsHeader}>
            <span className={styles.resultsCount}>
              {loading ? t('results_searching') : `${transfers.length} ${t('transfer_results_count')}`}
            </span>
          </div>
          {loading && (
            <div className={styles.cards}>
              {[1,2,3].map(i => (
                <div key={i} className={styles.skeletonCard}>
                  <div className={`skeleton ${styles.skeletonImg}`} />
                  <div className={styles.skeletonBody}>
                    <div className={`skeleton ${styles.skeletonLine}`} style={{ width: '60%', height: 20 }} />
                    <div className={`skeleton ${styles.skeletonLine}`} style={{ width: '40%', height: 14 }} />
                    <div className={`skeleton ${styles.skeletonLine}`} style={{ width: '80%', height: 14 }} />
                  </div>
                </div>
              ))}
            </div>
          )}
          {error && <div className={styles.errorMsg}><strong>{error}</strong></div>}
          {!loading && providerUnavailable && (
            <div className={styles.unavailableState}>
              <div className={styles.unavailableIcon}>🚕</div>
              <h2>{t('transfer_unavailable_title')}</h2>
              <p>{t('transfer_unavailable_text')}</p>
              <div className={styles.unavailableRoute}>{airport} → {hotel}</div>
            </div>
          )}
          {!loading && !error && !providerUnavailable && (
            <div className={styles.cards}>
              {transfers.map((transfer, i) => (
                <TransferCard key={transfer.id} transfer={transfer} isRecommended={i === 0 && sort === 'score'} />
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
