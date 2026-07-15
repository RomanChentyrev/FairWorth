import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronUp, Search, SlidersHorizontal, X } from 'lucide-react';
import { flightsApi } from '../api';
import FlightCard from '../components/FlightCard';
import { useLang } from '../i18n/LanguageContext';
import styles from './ResultsPage.module.css';
import { defaultTravelDates, formatLocalDate, validFutureDate, validFutureDates } from '../utils/dates';
import useCapabilities from '../hooks/useCapabilities';
import ProviderUnavailable from '../components/ProviderUnavailable';

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

function RangeSlider({ min, max, value, onChange, prefix = '$', step = 50 }) {
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
  { value: 'departure', ru: 'Вылет', en: 'Departure' },
];

const AIRLINES = ['Singapore Airlines', 'Emirates', 'Qatar Airways', 'Turkish Airlines', 'flydubai'];

const AIRLINE_NAMES = {
  EK: 'Emirates',
  QR: 'Qatar Airways',
  SQ: 'Singapore Airlines',
  TK: 'Turkish Airlines',
  FZ: 'flydubai',
  GF: 'Gulf Air',
  EY: 'Etihad Airways',
  CA: 'Air China',
  MU: 'China Eastern',
  SU: 'Aeroflot',
  HY: 'Uzbekistan Airways',
  HU: 'Hainan Airlines',
};

const CITY_CODES = {
  moscow: 'MOW',
  москва: 'MOW',
  singapore: 'SIN',
  сингапур: 'SIN',
  dubai: 'DXB',
  дубай: 'DXB',
  bangkok: 'BKK',
  бангкок: 'BKK',
  paris: 'PAR',
  париж: 'PAR',
  london: 'LON',
  лондон: 'LON',
  'new york': 'NYC',
  'нью-йорк': 'NYC',
  tokyo: 'TYO',
  токио: 'TYO',
};

function normalizePlaceInput(value) {
  return String(value || '').replace(/\s*\([^)]*\)/g, '').trim();
}

function isIataCode(value) {
  return /^[A-Z]{3}$/.test(String(value || '').trim().toUpperCase());
}

function formatTime(value) {
  if (!value) return '--:--';
  const match = String(value).match(/T(\d{2}:\d{2})/);
  return match ? match[1] : String(value).slice(0, 5);
}

function formatDateLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function durationLabel(minutes) {
  const safeMinutes = Number(minutes);
  if (!Number.isFinite(safeMinutes) || safeMinutes <= 0) return '—';
  const h = Math.floor(safeMinutes / 60);
  const m = safeMinutes % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

function addMinutes(dateValue, minutes) {
  if (!dateValue || !minutes) return null;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() + Number(minutes) * 60 * 1000).toISOString();
}

async function resolveIataCode(value) {
  const clean = normalizePlaceInput(value);
  const upper = clean.toUpperCase();
  if (isIataCode(upper)) return upper;
  const known = CITY_CODES[clean.toLowerCase()];
  if (known) return known;

  const res = await flightsApi.searchAirports(clean);
  const matches = res.data?.data || [];
  const best = matches.find(item => item.type === 'city') || matches[0];
  return best?.code || upper;
}

function normalizeTravelpayoutsTicket(ticket, context) {
  const originCode = ticket.origin_airport || ticket.origin || context.originCode;
  const destinationCode = ticket.destination_airport || ticket.destination || context.destinationCode;
  const airlineCode = ticket.airline || '';
  const airlineName = AIRLINE_NAMES[airlineCode] || airlineCode || 'Airline';
  const departureAt = ticket.departure_at;
  const duration = Number(ticket.duration_to || ticket.duration || 0);
  const arrivalAt = ticket.arrival_local_at || addMinutes(departureAt, duration);
  const rawStops = ticket.transfers ?? ticket.stops ?? (ticket.direct === true ? 0 : null);
  const stops = rawStops === null ? null : Number(rawStops);
  const confirmedCabin = ticket.cabin_class || ticket.cabin || ticket.trip_class_name || null;

  return {
    id: `tp-${originCode}-${destinationCode}-${airlineCode || 'air'}-${ticket.flight_number || 'flight'}-${departureAt || Math.random()}-${ticket.price || ''}`,
    airline: airlineName,
    airline_code: airlineCode,
    flight_number: ticket.flight_number ? `${airlineCode}${ticket.flight_number}`.trim() : 'Best fare',
    origin_city: context.fromLabel,
    origin_code: originCode,
    destination_city: context.toLabel,
    destination_code: destinationCode,
    departure_date: departureAt ? departureAt.slice(0, 10) : context.departureDate,
    departure_date_label: formatDateLabel(departureAt),
    departure_time: formatTime(departureAt),
    arrival_date: arrivalAt ? arrivalAt.slice(0, 10) : null,
    arrival_date_label: formatDateLabel(arrivalAt),
    arrival_time: formatTime(arrivalAt),
    duration_minutes: duration,
    duration_label: durationLabel(duration),
    stops,
    cabin_class: confirmedCabin ? String(confirmedCabin).toLowerCase() : null,
    requested_cabin_class: context.cabinClass,
    price: Number(ticket.price || 0),
    seats_left: null,
    aircraft: ticket.aircraft || ticket.plane || null,
    baggage: ticket.baggage_included === true ? 'Baggage included' : ticket.baggage_included === false ? 'No checked baggage' : null,
    fairworth_score: Number(ticket.fairworth_score || 0),
    adjusted_score: Number(ticket.adjusted_score || ticket.fairworth_score || 0),
    score_reliability: ticket.score_reliability,
    score_reliability_level: ticket.score_reliability_level,
    fare_confidence: ticket.fare_confidence,
    fare_confidence_level: ticket.fare_confidence_level,
    score_version: ticket.score_version,
    score_breakdown: ticket.score_breakdown,
    score_weights: ticket.score_weights,
    score_context: ticket.score_context,
    unknown_score_data: ticket.unknown_score_data || [],
    top_pick_eligible: Boolean(ticket.top_pick_eligible),
    price_details: ticket.price_details,
    source: 'travelpayouts',
    raw: ticket,
  };
}

function sortFlights(results, sortValue) {
  return [...results].sort((a, b) => {
    if (sortValue === 'score') return Number(b.top_pick_eligible) - Number(a.top_pick_eligible)
      || (b.adjusted_score || 0) - (a.adjusted_score || 0)
      || (b.fairworth_score || 0) - (a.fairworth_score || 0);
    if (sortValue === 'price_asc') return Number(a.price || 0) - Number(b.price || 0);
    if (sortValue === 'price_desc') return Number(b.price || 0) - Number(a.price || 0);
    if (sortValue === 'duration') return Number(a.duration_minutes || 0) - Number(b.duration_minutes || 0);
    if (sortValue === 'departure') return String(a.departure_time || '').localeCompare(String(b.departure_time || ''));
    return 0;
  });
}

function groupFlightFares(flights) {
  const groups = new Map();
  flights.forEach(flight => {
    const normalizedFlightNumber = String(flight.flight_number || '').replace(/\s+/g, '').toUpperCase();
    const key = [
      flight.airline_code || flight.airline,
      normalizedFlightNumber,
      flight.origin_code,
      flight.destination_code,
      flight.stops,
    ].join('|');

    const fare = {
      id: [
        normalizedFlightNumber,
        flight.departure_date,
        flight.departure_time,
        flight.arrival_date,
        flight.arrival_time,
        flight.raw?.gate || flight.aircraft,
        flight.price,
        flight.raw?.link,
      ].filter(Boolean).join('|'),
      operator: flight.raw?.gate || flight.aircraft || 'Provider',
      price: Number(flight.price || 0),
      baggage: flight.baggage,
      link: flight.raw?.link,
      source: flight.source,
      departure_date: flight.departure_date,
      departure_date_label: flight.departure_date_label,
      departure_time: flight.departure_time,
      arrival_date: flight.arrival_date,
      arrival_date_label: flight.arrival_date_label,
      arrival_time: flight.arrival_time,
      duration_minutes: flight.duration_minutes,
      duration_label: flight.duration_label,
    };

    if (!groups.has(key)) {
      groups.set(key, { ...flight, id: `flight-group-${key}`, fare_options: [fare] });
      return;
    }

    const group = groups.get(key);
    if (!group.fare_options.some(option => option.id === fare.id)) {
      group.fare_options.push(fare);
    }
  });

  return Array.from(groups.values()).map(group => {
    const fareOptions = group.fare_options.sort((a, b) => {
      const priceCompare = a.price - b.price;
      if (priceCompare !== 0) return priceCompare;
      return String(a.departure_date || '').localeCompare(String(b.departure_date || ''));
    });
    const cheapestFare = fareOptions[0];
    const prices = fareOptions.map(option => option.price).filter(Boolean);
    const priceMin = Math.min(...prices);
    const priceMax = Math.max(...prices);
    return {
      ...group,
      departure_date: cheapestFare?.departure_date || group.departure_date,
      departure_date_label: cheapestFare?.departure_date_label || group.departure_date_label,
      departure_time: cheapestFare?.departure_time || group.departure_time,
      arrival_date: cheapestFare?.arrival_date || group.arrival_date,
      arrival_date_label: cheapestFare?.arrival_date_label || group.arrival_date_label,
      arrival_time: cheapestFare?.arrival_time || group.arrival_time,
      duration_minutes: cheapestFare?.duration_minutes || group.duration_minutes,
      duration_label: cheapestFare?.duration_label || group.duration_label,
      fare_options: fareOptions,
      price: priceMin,
      price_min: priceMin,
      price_max: priceMax,
      fare_count: fareOptions.length,
      aircraft: fareOptions.length > 1 ? `${fareOptions.length} fares` : group.aircraft,
    };
  });
}

function savedTravelDates() {
  try {
    return validFutureDates(JSON.parse(window.sessionStorage.getItem('fairworth_dates') || '{}'));
  } catch {
    return defaultTravelDates();
  }
}

function savedTravelTrip() {
  try {
    return JSON.parse(window.sessionStorage.getItem('fairworth_trip') || '{}');
  } catch {
    return {};
  }
}

export default function FlightsPage() {
  const { t, lang } = useLang();
  const [searchParams, setSearchParams] = useSearchParams();
  const savedDates = savedTravelDates();
  const savedTrip = savedTravelTrip();
  const { capabilities, loading: capabilitiesLoading } = useCapabilities();

  const [from, setFrom] = useState(searchParams.get('from') || savedTrip.from || 'Moscow');
  const [to, setTo] = useState(searchParams.get('to') || savedTrip.to || 'Singapore');
  const [departureDate, setDepartureDate] = useState(validFutureDate(searchParams.get('departure_date') || searchParams.get('check_in'), savedDates.check_in));
  const [returnDate, setReturnDate] = useState(searchParams.get('return_date') || searchParams.get('check_out') || savedTrip.check_out || savedDates.check_out || '');
  const [passengers, setPassengers] = useState(searchParams.get('passengers') || savedTrip.guests || '1');
  const [cabinClass, setCabinClass] = useState(searchParams.get('cabin_class') || savedTrip.cabin_class || 'business');
  const [searchOpen, setSearchOpen] = useState(false);

  const [flights, setFlights] = useState([]);
  const [alternativeFlights, setAlternativeFlights] = useState([]);
  const [returnFlights, setReturnFlights] = useState([]);
  const [alternativeReturnFlights, setAlternativeReturnFlights] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [aiMessage, setAiMessage] = useState('');

  const [sort, setSort] = useState('score');
  const [priceRange, setPriceRange] = useState([0, 2500]);
  const [maxStops, setMaxStops] = useState('');
  const [airline, setAirline] = useState('');

  useEffect(() => {
    const queryFrom = searchParams.get('from');
    const queryTo = searchParams.get('to');
    const queryDeparture = searchParams.get('departure_date') || searchParams.get('check_in');
    const queryReturn = searchParams.get('return_date') || searchParams.get('check_out');
    const queryPassengers = searchParams.get('passengers');
    const queryCabinClass = searchParams.get('cabin_class');

    if (queryFrom && queryFrom !== from) setFrom(queryFrom);
    if (queryTo && queryTo !== to) setTo(queryTo);
    if (queryDeparture && queryDeparture !== departureDate) setDepartureDate(queryDeparture);
    if (queryReturn && queryReturn !== returnDate) setReturnDate(queryReturn);
    if (queryPassengers && queryPassengers !== passengers) setPassengers(queryPassengers);
    if (queryCabinClass && queryCabinClass !== cabinClass) setCabinClass(queryCabinClass);
  }, [searchParams, from, to, departureDate, returnDate, passengers, cabinClass]);

  useEffect(() => {
    const current = savedTravelDates();
    window.sessionStorage.setItem('fairworth_dates', JSON.stringify({
      ...current,
      check_in: departureDate,
      check_out: returnDate,
    }));
    window.sessionStorage.setItem('fairworth_trip', JSON.stringify({
      ...savedTravelTrip(),
      from,
      to,
      check_in: departureDate,
      check_out: returnDate,
      guests: passengers,
      cabin_class: cabinClass,
    }));
  }, [from, to, departureDate, returnDate, passengers, cabinClass]);

  const fetchFlights = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [originCode, destinationCode] = await Promise.all([
        resolveIataCode(from),
        resolveIataCode(to),
      ]);

      const buildFlightList = (items, maxItems = 5) => {
        let list = groupFlightFares(items);
        if (priceRange[0] > 0) list = list.filter(f => Number(f.price) >= priceRange[0]);
        if (priceRange[1] < 2500) list = list.filter(f => Number(f.price) <= priceRange[1]);
        if (airline) list = list.filter(f => String(f.airline).toLowerCase().includes(airline.toLowerCase()));
        list = sortFlights(list, sort);
        return maxStops !== '0' ? list.slice(0, maxItems) : list;
      };

      const loadLeg = async ({ legOriginCode, legDestinationCode, legFromLabel, legToLabel, legDate }) => {
        if (!legDate) return { results: [], alternatives: [] };

        const params = {
          origin: legOriginCode,
          destination: legDestinationCode,
          depart_date: legDate,
          currency: 'USD',
        };
        const res = await flightsApi.top({
          ...params,
          trip_days: departureDate && returnDate
            ? Math.max(0, Math.round((new Date(`${returnDate}T00:00:00Z`) - new Date(`${departureDate}T00:00:00Z`)) / 86400000))
            : undefined,
          passengers,
          cabin_class: cabinClass,
          max_stops: maxStops === '' ? undefined : maxStops,
          limit: 30,
          include_alternatives: true,
        });

        const rawTickets = res.data?.data || [];
        const normalizedTickets = rawTickets.map(ticket => {
          const normalized = normalizeTravelpayoutsTicket(ticket, {
            originCode: legOriginCode,
            destinationCode: legDestinationCode,
            fromLabel: legFromLabel,
            toLabel: legToLabel,
            departureDate: legDate,
            cabinClass,
          });
          return {
            ...normalized,
            is_alternative_date: Boolean(ticket.is_alternative_date) || normalized.departure_date !== legDate,
          };
        });

        const results = buildFlightList(
          /^\d{4}-\d{2}-\d{2}$/.test(legDate)
            ? normalizedTickets.filter(flight => flight.departure_date === legDate)
            : normalizedTickets.filter(flight => !flight.is_alternative_date)
        );

        const alternatives = results.length < 5
          ? buildFlightList(
            normalizedTickets.filter(flight => flight.departure_date !== legDate || flight.is_alternative_date),
            5 - results.length
          )
          : [];

        return { results, alternatives };
      };

      const outbound = await loadLeg({
        legOriginCode: originCode,
        legDestinationCode: destinationCode,
        legFromLabel: normalizePlaceInput(from) || originCode,
        legToLabel: normalizePlaceInput(to) || destinationCode,
        legDate: departureDate,
      });

      const inbound = returnDate
        ? await loadLeg({
          legOriginCode: destinationCode,
          legDestinationCode: originCode,
          legFromLabel: normalizePlaceInput(to) || destinationCode,
          legToLabel: normalizePlaceInput(from) || originCode,
          legDate: returnDate,
        })
        : { results: [], alternatives: [] };

      let results = outbound.results;
      const alternatives = outbound.alternatives;

      setFlights(results);
      setAlternativeFlights(alternatives);
      setReturnFlights(inbound.results);
      setAlternativeReturnFlights(inbound.alternatives);
      if (results.length) {
        const best = results[0];
        setAiMessage(lang === 'ru'
          ? `Лучший перелёт под ваши предпочтения — **${best.airline} ${best.flight_number}** (Score ${best.fairworth_score}/100). ${best.duration_label}, ${best.stops === 0 ? 'без пересадок' : `${best.stops} пересадка`}, от $${best.price}.`
          : `Best flight for your preferences — **${best.airline} ${best.flight_number}** (Score ${best.fairworth_score}/100). ${best.duration_label}, ${best.stops === 0 ? 'direct' : `${best.stops} stop`}, from $${best.price}.`);
      } else {
        setAiMessage('');
      }
    } catch (err) {
      console.error(err);
      setError(err.message || t('results_error'));
      setAlternativeFlights([]);
      setReturnFlights([]);
      setAlternativeReturnFlights([]);
    } finally {
      setLoading(false);
    }
  }, [from, to, departureDate, returnDate, passengers, cabinClass, sort, priceRange, maxStops, airline, lang]);

  useEffect(() => { fetchFlights(); }, [fetchFlights]);

  const activeFiltersCount = (priceRange[0] > 0 || priceRange[1] < 2500 ? 1 : 0)
    + (maxStops !== '' ? 1 : 0)
    + (airline ? 1 : 0);

  const resetFilters = () => {
    setPriceRange([0, 2500]);
    setMaxStops('');
    setAirline('');
  };

  const handleSearch = (e) => {
    e.preventDefault();
    setSearchParams({
      from,
      to,
      departure_date: departureDate,
      check_in: departureDate,
      return_date: returnDate,
      check_out: returnDate,
      passengers,
      cabin_class: cabinClass,
    });
    setSearchOpen(false);
  };

  if (!capabilitiesLoading && capabilities?.flights?.status !== 'ready') return <ProviderUnavailable capability="flights" />;

  return (
    <div className={styles.page}>
      <div className={styles.searchBar}>
        <div className={styles.searchBarInner}>
          {!searchOpen ? (
            <>
              <div className={styles.searchPills}>
                <div className={styles.pill}>
                  <span className={styles.pillLabel}>{t('home_from')}</span>
                  <span className={styles.pillValue}>{from}</span>
                </div>
                <div className={styles.pillDiv} />
                <div className={styles.pill}>
                  <span className={styles.pillLabel}>{t('home_to')}</span>
                  <span className={styles.pillValue}>{to}</span>
                </div>
                <div className={styles.pillDiv} />
                <div className={styles.pill}>
                  <span className={styles.pillLabel}>{t('flight_departure')}</span>
                  <span className={styles.pillValue}>
                    {departureDate}{returnDate ? ` → ${returnDate}` : ''} · {passengers} {t('results_adults')} · {t(`flight_class_${cabinClass}`)}
                  </span>
                </div>
              </div>
              <button className={styles.changeBtn} onClick={() => setSearchOpen(true)}><ChevronDown size={14} /> {t('results_change')}</button>
            </>
          ) : (
            <form onSubmit={handleSearch} className={styles.inlineSearchForm}>
              <div className={styles.inlineField}><span className={styles.inlineLabel}>{t('home_from')}</span><input className={styles.inlineInput} value={from} onChange={e => setFrom(e.target.value)} /></div>
              <div className={styles.inlineDivider} />
              <div className={styles.inlineField}><span className={styles.inlineLabel}>{t('home_to')}</span><input className={styles.inlineInput} value={to} onChange={e => setTo(e.target.value)} /></div>
              <div className={styles.inlineDivider} />
              <div className={styles.inlineField}><span className={styles.inlineLabel}>{t('flight_departure')}</span><input className={styles.inlineInput} type="date" min={formatLocalDate(new Date())} value={departureDate} onChange={e => setDepartureDate(e.target.value)} /></div>
              <div className={styles.inlineDivider} />
              <div className={styles.inlineField}><span className={styles.inlineLabel}>{lang === 'ru' ? 'Обратно' : 'Return'}</span><input className={styles.inlineInput} type="date" min={departureDate} value={returnDate} onChange={e => setReturnDate(e.target.value)} /></div>
              <div className={styles.inlineDivider} />
              <div className={styles.inlineField}><span className={styles.inlineLabel}>{t('results_guests')}</span>
                <select className={styles.inlineInput} value={passengers} onChange={e => setPassengers(e.target.value)}>
                  {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div className={styles.inlineDivider} />
              <div className={styles.inlineField}><span className={styles.inlineLabel}>{t('flight_class')}</span>
                <select className={styles.inlineInput} value={cabinClass} onChange={e => setCabinClass(e.target.value)}>
                  <option value="economy">{t('flight_class_economy')}</option>
                  <option value="business">{t('flight_class_business')}</option>
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

            <FilterSection title={t('flight_price_person')}>
              <RangeSlider min={0} max={2500} step={50} value={priceRange} onChange={setPriceRange} />
            </FilterSection>

            <FilterSection title={t('flight_stops_filter')}>
              <div className={styles.ratingBtns}>
                <button className={`${styles.ratingBtn} ${maxStops === '' ? styles.ratingBtnOn : ''}`} onClick={() => setMaxStops('')}>{t('results_rating_any')}</button>
                <button className={`${styles.ratingBtn} ${maxStops === '0' ? styles.ratingBtnOn : ''}`} onClick={() => setMaxStops('0')}>{t('flight_direct')}</button>
                <button className={`${styles.ratingBtn} ${maxStops === '1' ? styles.ratingBtnOn : ''}`} onClick={() => setMaxStops('1')}>1</button>
              </div>
            </FilterSection>

            <FilterSection title={t('prefs_airlines')} defaultOpen={false}>
              <div className={styles.checkList}>
                {AIRLINES.map(name => (
                  <label key={name} className={styles.checkItem}>
                    <input type="radio" checked={airline === name} onChange={() => setAirline(name)} className={styles.checkBox} />
                    <span>{name}</span>
                  </label>
                ))}
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
              {loading
                ? t('results_searching')
                : `${flights.length} ${t('flight_results_count')} ${from} → ${to}${returnDate ? ` · ${returnFlights.length} ${lang === 'ru' ? 'обратно' : 'return'}` : ''}`}
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
          {!loading && !error && (
            <div className={styles.flightColumns}>
              <section className={styles.flightColumn}>
                <div className={styles.flightSectionHeader}>
                  <span className={styles.flightSectionTitle}>{lang === 'ru' ? 'Туда' : 'Outbound'}</span>
                  <span className={styles.flightSectionNote}>{from} → {to} · {departureDate}</span>
                </div>
                <div className={styles.cards}>
                  {flights.map((flight, i) => (
                    <FlightCard key={flight.id} flight={flight} isRecommended={i === 0 && sort === 'score' && flight.top_pick_eligible} compact leg="outbound" passengers={passengers} />
                  ))}
                  {flights.length === 0 && alternativeFlights.length === 0 && (
                    <div className={styles.noResults}>
                      {lang === 'ru' ? 'Рейсы туда на выбранную дату не найдены.' : 'No outbound flights found for the selected date.'}
                    </div>
                  )}
                </div>
                {alternativeFlights.length > 0 && (
                  <section className={styles.altSection}>
                    <div className={styles.altHeader}>
                      <span className={styles.altTitle}>
                        {lang === 'ru' ? 'Альтернативные даты туда' : 'Alternative outbound dates'}
                      </span>
                      <span className={styles.altNote}>
                        {lang === 'ru'
                          ? `На ${departureDate} найдено ${flights.length} из 5 вариантов`
                          : `${flights.length} of 5 options found for ${departureDate}`}
                      </span>
                    </div>
                    <div className={styles.cards}>
                      {alternativeFlights.map(flight => (
                        <FlightCard key={`alt-${flight.id}`} flight={flight} compact leg="outbound" passengers={passengers} />
                      ))}
                    </div>
                  </section>
                )}
              </section>

              {returnDate && (
                <section className={styles.flightColumn}>
                  <div className={styles.flightSectionHeader}>
                    <span className={styles.flightSectionTitle}>{lang === 'ru' ? 'Обратно' : 'Return'}</span>
                    <span className={styles.flightSectionNote}>{to} → {from} · {returnDate}</span>
                  </div>
                  <div className={styles.cards}>
                    {returnFlights.map((flight, i) => (
                      <FlightCard key={`return-${flight.id}`} flight={flight} isRecommended={i === 0 && sort === 'score' && flight.top_pick_eligible} compact leg="return" passengers={passengers} />
                    ))}
                    {returnFlights.length === 0 && alternativeReturnFlights.length === 0 && (
                      <div className={styles.noResults}>
                        {lang === 'ru' ? 'Обратные рейсы на выбранную дату не найдены.' : 'No return flights found for the selected date.'}
                      </div>
                    )}
                  </div>
                  {alternativeReturnFlights.length > 0 && (
                    <section className={styles.altSection}>
                      <div className={styles.altHeader}>
                        <span className={styles.altTitle}>
                          {lang === 'ru' ? 'Альтернативные даты обратно' : 'Alternative return dates'}
                        </span>
                        <span className={styles.altNote}>
                          {lang === 'ru'
                            ? `На ${returnDate} найдено ${returnFlights.length} из 5 вариантов`
                            : `${returnFlights.length} of 5 options found for ${returnDate}`}
                        </span>
                      </div>
                      <div className={styles.cards}>
                        {alternativeReturnFlights.map(flight => (
                          <FlightCard key={`return-alt-${flight.id}`} flight={flight} compact leg="return" passengers={passengers} />
                        ))}
                      </div>
                    </section>
                  )}
                </section>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
