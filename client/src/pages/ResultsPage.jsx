import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { ArrowRight, SlidersHorizontal, GitCompare, X, Search, ChevronDown, ChevronUp, Map, List } from 'lucide-react';
import { hotelsApi, interactionsApi, searchSessionId } from '../api';
import HotelCard from '../components/HotelCard';
import { useLang } from '../i18n/LanguageContext';
import styles from './ResultsPage.module.css';
import { defaultTravelDates, formatLocalDate, validFutureDates } from '../utils/dates';
import { formatAmount } from '../utils/money';
import useCapabilities from '../hooks/useCapabilities';
import ProviderUnavailable from '../components/ProviderUnavailable';
import {
  HOTEL_RESULTS_CACHE_KEY,
  HOTEL_RESULTS_CACHE_VERSION,
  compactCachedHotel,
  hotelResultsRequestKey,
  hotelResultsUserKey,
  readHotelResultsCache,
} from '../utils/hotelResultsCache';

function HotelMap({ hotels, hoveredId, checkIn, checkOut, lang }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef([]);

  useEffect(() => {
    if (mapInstanceRef.current) return;
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
    if (window.L) { initMap(); return; }
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => initMap();
    document.head.appendChild(script);
  }, []);

  const initMap = () => {
    if (!mapRef.current || mapInstanceRef.current) return;
    const L = window.L;
    const map = L.map(mapRef.current, { zoomControl: true, scrollWheelZoom: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
    mapInstanceRef.current = map;
    updateMarkers();
  };

  const updateMarkers = useCallback(() => {
    const L = window.L;
    if (!L || !mapInstanceRef.current) return;
    const map = mapInstanceRef.current;
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];
    if (!hotels.length) return;
    const bounds = [];
    const seenCoordinates = new Set();
    const visibleHotels = hotels.filter(hotel => {
      if (!hotel.latitude || !hotel.longitude) return false;
      const key = `${Number(hotel.latitude).toFixed(4)}:${Number(hotel.longitude).toFixed(4)}`;
      if (seenCoordinates.has(key)) return false;
      seenCoordinates.add(key);
      return true;
    }).slice(0, 60);
    visibleHotels.forEach(hotel => {
      if (!hotel.latitude || !hotel.longitude) return;
      const isHovered = hotel.id === hoveredId;
      const numericPrice = Number(hotel.min_price);
      const price = numericPrice > 0
        ? numericPrice >= 10000 ? `$${Math.round(numericPrice / 1000)}k` : `$${Math.round(numericPrice).toLocaleString('en-US')}`
        : '•';
      const markerContent = document.createElement('div');
      markerContent.textContent = price;
      Object.assign(markerContent.style, {
        background: isHovered ? '#1A2B4A' : '#fff', color: isHovered ? '#fff' : '#1A2B4A',
        border: '2px solid #1A2B4A', borderRadius: '20px', padding: '3px 7px', fontSize: '11px',
        fontWeight: '700', fontFamily: 'Inter, sans-serif', boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
        whiteSpace: 'nowrap', cursor: 'pointer',
      });
      const icon = L.divIcon({
        className: '',
        html: markerContent,
        iconAnchor: [20, 12],
      });
      const popup = document.createElement('div');
      popup.style.minWidth = '180px';
      const popupName = document.createElement('strong');
      popupName.textContent = hotel.name;
      const popupLocation = document.createElement('div');
      popupLocation.textContent = hotel.location;
      const popupPrice = document.createElement('div');
      popupPrice.textContent = numericPrice > 0 ? `${lang === 'ru' ? 'от' : 'from'} ${price}/${lang === 'ru' ? 'ночь' : 'night'}` : (lang === 'ru' ? 'Цена недоступна' : 'Price unavailable');
      const popupLink = document.createElement('a');
      popupLink.href = `/hotel/${encodeURIComponent(hotel.id)}?check_in=${encodeURIComponent(checkIn)}&check_out=${encodeURIComponent(checkOut)}`;
      popupLink.textContent = lang === 'ru' ? 'Подробнее' : 'View details';
      popup.append(popupName, popupLocation, popupPrice, popupLink);
      const marker = L.marker([hotel.latitude, hotel.longitude], { icon })
        .addTo(map)
        .bindPopup(popup, { maxWidth: 220 });
      markersRef.current.push(marker);
      bounds.push([hotel.latitude, hotel.longitude]);
    });
    if (bounds.length) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  }, [hotels, hoveredId, checkIn, checkOut]);

  useEffect(() => { if (window.L && mapInstanceRef.current) updateMarkers(); }, [hotels, hoveredId]);

  return <div ref={mapRef} className={styles.mapContainer} />;
}

const SORT_OPTIONS_KEYS = [
  { value: 'score', key: 'sort_score' },
  { value: 'price_asc', key: 'sort_price_asc' },
  { value: 'price_desc', key: 'sort_price_desc' },
  { value: 'rating', key: 'sort_rating' },
];

const AMENITY_OPTIONS = [
  { value: 'wifi', ru: 'Wi-Fi', en: 'Wi-Fi' },
  { value: 'pool', ru: 'Бассейн', en: 'Pool' },
  { value: 'parking', ru: 'Парковка', en: 'Parking' },
  { value: 'air_conditioning', ru: 'Кондиционер', en: 'Air conditioning' },
  { value: 'gym', ru: 'Фитнес', en: 'Fitness' },
  { value: 'beach', ru: 'Пляж', en: 'Beach' },
  { value: 'airport_shuttle', ru: 'Трансфер из аэропорта', en: 'Airport shuttle' },
  { value: 'tennis', ru: 'Теннисный корт', en: 'Tennis court' },
  { value: 'bathtub', ru: 'Ванна в номере', en: 'Bathtub' },
  { value: 'balcony', ru: 'Балкон', en: 'Balcony' },
  { value: 'kitchen', ru: 'Кухня', en: 'Kitchen' },
  { value: 'pets_allowed', ru: 'Можно с животными', en: 'Pet friendly' },
  { value: 'accessible', ru: 'Доступная среда', en: 'Accessible' },
];

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

function isAvailableOffer(hotel) {
  if (!(Number(hotel?.min_price) > 0)) return false;
  if (hotel.availability_status) return hotel.availability_status === 'available';
  return hotel.price_details?.is_displayable !== false
    && !hotel.price_details?.is_stale
    && !hotel.price_details?.is_demonstration;
}

function matchesLivePriceFilters(hotel, { priceRange, freeCancel, breakfastIncl }) {
  const price = Number(hotel.min_price);
  if (price < priceRange[0] || price > priceRange[1]) return false;
  if (freeCancel && !hotel.price_details?.refundable) return false;
  if (breakfastIncl && !hotel.price_details?.includes_breakfast) return false;
  return true;
}

function sortAvailableHotels(hotels, sort) {
  return [...hotels].sort((a, b) => {
    if (sort === 'score') return Number(b.top_pick_eligible) - Number(a.top_pick_eligible)
      || (b.adjusted_score || 0) - (a.adjusted_score || 0)
      || (b.fairworth_score || 0) - (a.fairworth_score || 0);
    if (sort === 'price_asc') return Number(a.min_price) - Number(b.min_price);
    if (sort === 'price_desc') return Number(b.min_price) - Number(a.min_price);
    if (sort === 'rating') return (b.rating || 0) - (a.rating || 0);
    return 0;
  });
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

export default function ResultsPage({ compareList, toggleCompare, isInCompare }) {
  const { t, lang } = useLang();
  const [searchParams, setSearchParams] = useSearchParams();
  const savedDates = savedTravelDates();
  const savedTrip = savedTravelTrip();
  const { capabilities, loading: capabilitiesLoading } = useCapabilities();

  const [city, setCity] = useState(searchParams.get('city') || 'Singapore');
  const [from] = useState(searchParams.get('from') || savedTrip.from || 'Moscow');
  const hasQueryDates = searchParams.get('check_in') && searchParams.get('check_out');
  const initialDates = hasQueryDates
    ? validFutureDates({ check_in: searchParams.get('check_in'), check_out: searchParams.get('check_out') })
    : savedDates;
  const [checkIn, setCheckIn] = useState(initialDates.check_in);
  const [checkOut, setCheckOut] = useState(initialDates.check_out);
  const [guests, setGuests] = useState(searchParams.get('guests') || '2');
  const [tripPurpose, setTripPurpose] = useState(searchParams.get('trip_purpose') || savedTrip.trip_purpose || 'leisure');
  const cacheSearch = { city, checkIn, checkOut, guests, tripPurpose };
  const cachedResults = useRef(readHotelResultsCache({ search: cacheSearch, language: lang })).current;
  const [searchOpen, setSearchOpen] = useState(false);

  const [hotels, setHotels] = useState(cachedResults?.hotels || []);
  const [loading, setLoading] = useState(!cachedResults);
  const [error, setError] = useState(null);
  const [aiMessage, setAiMessage] = useState(cachedResults?.aiMessage || '');
  const [hoveredId, setHoveredId] = useState(null);
  const [viewMode, setViewMode] = useState(cachedResults?.viewMode || 'list');

  const [sort, setSort] = useState(cachedResults?.filters?.sort || 'score');
  const [stars, setStars] = useState(cachedResults?.filters?.stars || []);
  const [priceRange, setPriceRange] = useState(cachedResults?.filters?.priceRange || [0, 2000]);
  const [ratingMin, setRatingMin] = useState(cachedResults?.filters?.ratingMin || 0);
  const [amenities, setAmenities] = useState(cachedResults?.filters?.amenities || []);
  const [districts, setDistricts] = useState(cachedResults?.filters?.districts || []);
  const [districtOptions, setDistrictOptions] = useState(cachedResults?.districtOptions || []);
  const [freeCancel, setFreeCancel] = useState(cachedResults?.filters?.freeCancel || false);
  const [breakfastIncl, setBreakfastIncl] = useState(cachedResults?.filters?.breakfastIncl || false);
  const [searchNonce, setSearchNonce] = useState(0);
  const explicitSearchRef = useRef(!cachedResults);
  const searchSessionRef = useRef(cachedResults?.searchSessionId || searchSessionId());
  const [hasMore, setHasMore] = useState(cachedResults?.hasMore ?? true);
  const [totalResults, setTotalResults] = useState(cachedResults?.totalResults || 0);
  const [catalogOffset, setCatalogOffset] = useState(cachedResults?.catalogOffset || 0);
  const [checkedCount, setCheckedCount] = useState(cachedResults?.checkedCount || 0);
  const [unavailableCount, setUnavailableCount] = useState(cachedResults?.unavailableCount || 0);
  const [loadingMore, setLoadingMore] = useState(false);
  const resultsScrollRef = useRef(null);

  const currentRequestKey = hotelResultsRequestKey({
    search: { city, checkIn, checkOut, guests, tripPurpose },
    filters: { sort, stars, priceRange, ratingMin, amenities, districts, freeCancel, breakfastIncl },
    language: lang,
  });
  const restoredRequestKeyRef = useRef(cachedResults
    ? hotelResultsRequestKey({ search: cachedResults.search, filters: cachedResults.filters, language: cachedResults.language })
    : null);

  const nights = Math.ceil((new Date(checkOut) - new Date(checkIn)) / (1000 * 60 * 60 * 24)) || 4;

  useEffect(() => {
    window.sessionStorage.setItem('fairworth_dates', JSON.stringify({
      check_in: checkIn,
      check_out: checkOut,
    }));
    window.sessionStorage.setItem('fairworth_trip', JSON.stringify({
      ...savedTravelTrip(),
      from,
      to: city,
      check_in: checkIn,
      check_out: checkOut,
      guests,
      trip_purpose: tripPurpose,
    }));
  }, [from, city, checkIn, checkOut, guests, tripPurpose]);

  useEffect(() => {
    if (!cachedResults || !resultsScrollRef.current) return;
    const frame = window.requestAnimationFrame(() => { resultsScrollRef.current.scrollTop = cachedResults.scrollTop || 0; });
    return () => window.cancelAnimationFrame(frame);
  }, [cachedResults]);

  useEffect(() => {
    if (loading || error) return;
    try {
      const existing = JSON.parse(window.sessionStorage.getItem(HOTEL_RESULTS_CACHE_KEY) || 'null');
      window.sessionStorage.setItem(HOTEL_RESULTS_CACHE_KEY, JSON.stringify({
        version: HOTEL_RESULTS_CACHE_VERSION,
        userKey: hotelResultsUserKey(),
        language: lang,
        search: { city, checkIn, checkOut, guests, tripPurpose }, hotels: hotels.map(compactCachedHotel), districtOptions, aiMessage, hasMore, totalResults,
        catalogOffset, checkedCount, unavailableCount, viewMode, searchSessionId: searchSessionRef.current,
        filters: { sort, stars, priceRange, ratingMin, amenities, districts, freeCancel, breakfastIncl },
        scrollTop: resultsScrollRef.current?.scrollTop ?? existing?.scrollTop ?? 0,
        savedAt: Date.now(),
      }));
    } catch (cacheError) {
      console.warn('Hotel results cache was skipped:', cacheError.message);
      window.sessionStorage.removeItem(HOTEL_RESULTS_CACHE_KEY);
    }
  }, [hotels, loading, error, aiMessage, districtOptions, hasMore, totalResults, catalogOffset, checkedCount, unavailableCount, viewMode, lang]);

  const checkRateBatch = useCallback(async (batch) => {
    const hotelIds = batch.map(hotel => hotel.id).filter(Boolean);
    if (!hotelIds.length) return { hotels: [], checked: 0, unavailable: 0 };
    const response = await hotelsApi.loadRateBatch({
      hotel_ids: hotelIds,
      check_in: checkIn,
      check_out: checkOut,
      guests,
      trip_purpose: tripPurpose,
      language: lang,
      breakfast: breakfastIncl,
      free_cancel: freeCancel,
    });
    const updates = new globalThis.Map((response.data.hotels || []).map(hotel => [hotel.id, hotel]));
    const rateAvailable = batch
      .filter(hotel => updates.has(hotel.id))
      .map(hotel => ({ ...hotel, ...updates.get(hotel.id) }))
      .filter(isAvailableOffer);
    const verified = rateAvailable
      .filter(hotel => matchesLivePriceFilters(hotel, { priceRange, freeCancel, breakfastIncl }));
    const checked = Number(response.data.checked ?? batch.length);
    return {
      hotels: sortAvailableHotels(verified, sort),
      checked,
      unavailable: Array.isArray(response.data.unavailable_hotel_ids)
        ? response.data.unavailable_hotel_ids.length
        : Math.max(0, checked - rateAvailable.length),
    };
  }, [checkIn, checkOut, guests, tripPurpose, lang, sort, priceRange, freeCancel, breakfastIncl]);

  const fetchHotels = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = { city, check_in: checkIn, check_out: checkOut, guests, trip_purpose: tripPurpose, sort, language: lang, search_session_id: searchSessionRef.current, limit: 30, offset: 0 };
      if (explicitSearchRef.current) params.search_event = '1';
      if (stars.length) params.stars = stars.join(',');
      if (amenities.length) params.amenities = amenities.join(',');
      if (districts.length) params.districts = districts.join(',');
      if (ratingMin > 0) params.rating_min = ratingMin;
      if (freeCancel) params.free_cancel = '1';
      if (breakfastIncl) params.breakfast = '1';
      if (priceRange[1] < 2000) params.max_price = priceRange[1];
      if (priceRange[0] > 0) params.min_price = priceRange[0];
      const res = await hotelsApi.search(params);
      const results = res.data.hotels || [];
      setDistrictOptions(res.data.facets?.locations || []);
      const verified = await checkRateBatch(results);
      if (verified.hotels.length) {
        interactionsApi.track('impression', {
          hotel_ids: verified.hotels.map(hotel => hotel.id),
          event_id: `impression:${searchSessionRef.current}:${JSON.stringify(params)}`,
          context: { city, check_in: checkIn, check_out: checkOut, sort },
        }).catch(() => {});
      }
      setHotels(verified.hotels);
      setHasMore(Boolean(res.data.has_more));
      setTotalResults(verified.hotels.length);
      setCatalogOffset(results.length);
      setCheckedCount(verified.checked);
      setUnavailableCount(verified.unavailable);
      explicitSearchRef.current = false;
    } catch (err) {
      setError(err.response?.data?.error || err.message || t('results_error'));
    }
    finally { setLoading(false); }
  }, [city, checkIn, checkOut, guests, tripPurpose, sort, stars, amenities, districts, priceRange, ratingMin, freeCancel, breakfastIncl, lang, searchNonce, checkRateBatch]);

  useEffect(() => {
    if (loading || sort !== 'score') return;
    const best = hotels.find(hotel => hotel.top_pick_eligible);
    if (!best) { setAiMessage(''); return; }
    const priceText = lang === 'ru'
      ? `Цена $${formatAmount(best.min_price, lang)}/ночь на ${nights} ночей.`
      : `$${formatAmount(best.min_price, lang)}/night for ${nights} nights.`;
    setAiMessage(lang === 'ru'
      ? `На основе ваших предпочтений лучший вариант с подтверждённой ценой — **${best.name}** (Score ${best.fairworth_score}/100). ${priceText}`
      : `Best option with a verified price for your preferences — **${best.name}** (Score ${best.fairworth_score}/100). ${priceText}`);
  }, [hotels, loading, sort, lang, nights]);

  const loadMoreHotels = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const params = { city, check_in: checkIn, check_out: checkOut, guests, sort, language: lang, search_session_id: searchSessionRef.current, limit: 30, offset: catalogOffset };
      if (stars.length) params.stars = stars.join(',');
      if (amenities.length) params.amenities = amenities.join(',');
      if (districts.length) params.districts = districts.join(',');
      if (ratingMin > 0) params.rating_min = ratingMin;
      if (freeCancel) params.free_cancel = '1';
      if (breakfastIncl) params.breakfast = '1';
      if (priceRange[1] < 2000) params.max_price = priceRange[1];
      if (priceRange[0] > 0) params.min_price = priceRange[0];
      const response = await hotelsApi.search(params);
      const nextHotels = response.data.hotels || [];
      const verified = await checkRateBatch(nextHotels);
      setHotels(current => {
        const existingIds = new Set(current.map(hotel => hotel.id));
        return sortAvailableHotels([...current, ...verified.hotels.filter(hotel => !existingIds.has(hotel.id))], sort);
      });
      setHasMore(Boolean(response.data.has_more));
      setCatalogOffset(current => current + nextHotels.length);
      setCheckedCount(current => current + verified.checked);
      setUnavailableCount(current => current + verified.unavailable);
      setTotalResults(current => current + verified.hotels.length);
    } catch (loadError) {
      setError(loadError.response?.data?.error || loadError.message);
    } finally { setLoadingMore(false); }
  };

  useEffect(() => {
    if (restoredRequestKeyRef.current === currentRequestKey && searchNonce === 0) return;
    restoredRequestKeyRef.current = null;
    const timer = window.setTimeout(fetchHotels, 500);
    return () => window.clearTimeout(timer);
  }, [fetchHotels, currentRequestKey, searchNonce]);

  const toggleStar = s => setStars(p => p.includes(s) ? p.filter(x => x !== s) : [...p, s]);
  const toggleAmenity = a => setAmenities(p => p.includes(a) ? p.filter(x => x !== a) : [...p, a]);
  const toggleDistrict = d => setDistricts(p => p.includes(d) ? p.filter(x => x !== d) : [...p, d]);

  const activeFiltersCount = stars.length + amenities.length + districts.length
    + (priceRange[0] > 0 || priceRange[1] < 2000 ? 1 : 0)
    + (ratingMin > 0 ? 1 : 0) + (freeCancel ? 1 : 0) + (breakfastIncl ? 1 : 0);

  const resetFilters = () => {
    setStars([]); setAmenities([]); setDistricts([]);
    setPriceRange([0, 2000]); setRatingMin(0);
    setFreeCancel(false); setBreakfastIncl(false);
  };

  const handleSearch = (e) => {
    e.preventDefault();
    explicitSearchRef.current = true;
    searchSessionRef.current = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.sessionStorage.setItem('fairworth_search_session', searchSessionRef.current);
    setSearchNonce(value => value + 1);
    setDistricts([]);
    setSearchParams({ from, city, to: city, check_in: checkIn, check_out: checkOut, guests, trip_purpose: tripPurpose });
    setSearchOpen(false);
  };

  const SORT_OPTIONS = [
    { value: 'score', label: lang === 'ru' ? 'Fairworth Score' : 'Fairworth Score' },
    { value: 'price_asc', label: lang === 'ru' ? 'Цена ↑' : 'Price ↑' },
    { value: 'price_desc', label: lang === 'ru' ? 'Цена ↓' : 'Price ↓' },
    { value: 'rating', label: lang === 'ru' ? 'Рейтинг' : 'Rating' },
  ];

  if (!capabilitiesLoading && capabilities?.hotels?.status !== 'ready') return <ProviderUnavailable capability="hotels" />;

  return (
    <div className={`${styles.page} ${styles.hotelResultsPage}`}>
      {/* Search bar */}
      <div className={styles.searchBar}>
        <div className={styles.searchBarInner}>
          {!searchOpen ? (
            <>
              <div className={styles.searchPills}>
                <div className={styles.pill}>
                  <span className={styles.pillLabel}>{t('results_direction')}</span>
                  <span className={styles.pillValue}>{city}</span>
                </div>
                <div className={styles.pillDiv} />
                <div className={styles.pill}>
                  <span className={styles.pillLabel}>{t('results_dates')}</span>
                  <span className={styles.pillValue}>{checkIn} — {checkOut} · {nights} {t('results_nights')}</span>
                </div>
                <div className={styles.pillDiv} />
                <div className={styles.pill}>
                  <span className={styles.pillLabel}>{t('results_guests')}</span>
                  <span className={styles.pillValue}>{guests} {t('results_adults')}</span>
                </div>
              </div>
              <div className={styles.searchBarRight}>
                <div className={styles.viewToggle}>
                  <button className={`${styles.viewBtn} ${viewMode === 'list' ? styles.viewBtnActive : ''}`} onClick={() => setViewMode('list')}><List size={14} /> {t('results_list')}</button>
                  <button className={`${styles.viewBtn} ${viewMode === 'map' ? styles.viewBtnActive : ''}`} onClick={() => setViewMode('map')}><Map size={14} /> {t('results_map')}</button>
                </div>
                <button className={styles.changeBtn} onClick={() => setSearchOpen(true)}><ChevronDown size={14} /> {t('results_change')}</button>
              </div>
            </>
          ) : (
            <form onSubmit={handleSearch} className={styles.inlineSearchForm}>
              <div className={styles.inlineField}><span className={styles.inlineLabel}>{t('results_direction')}</span><input className={styles.inlineInput} value={city} onChange={e => setCity(e.target.value)} /></div>
              <div className={styles.inlineDivider} />
              <div className={styles.inlineField}><span className={styles.inlineLabel}>{lang === 'ru' ? 'Тип поездки' : 'Trip type'}</span>
                <select className={styles.inlineInput} value={tripPurpose} onChange={e => setTripPurpose(e.target.value)}>
                  <option value="leisure">{lang === 'ru' ? 'Отдых' : 'Leisure'}</option><option value="business">{lang === 'ru' ? 'Командировка' : 'Business'}</option><option value="family">{lang === 'ru' ? 'Семья' : 'Family'}</option><option value="couple">{lang === 'ru' ? 'Вдвоём' : 'Couple'}</option>
                </select>
              </div>
              <div className={styles.inlineDivider} />
              <div className={styles.inlineField}><span className={styles.inlineLabel}>{t('home_checkin')}</span><input className={styles.inlineInput} type="date" min={formatLocalDate(new Date())} value={checkIn} onChange={e => setCheckIn(e.target.value)} /></div>
              <div className={styles.inlineDivider} />
              <div className={styles.inlineField}><span className={styles.inlineLabel}>{t('home_checkout')}</span><input className={styles.inlineInput} type="date" min={checkIn} value={checkOut} onChange={e => setCheckOut(e.target.value)} /></div>
              <div className={styles.inlineDivider} />
              <div className={styles.inlineField}><span className={styles.inlineLabel}>{t('results_guests')}</span>
                <select className={styles.inlineInput} value={guests} onChange={e => setGuests(e.target.value)}>
                  {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n} {lang === 'ru' ? (n===1?'взрослый':'взрослых') : (n===1?'adult':'adults')}</option>)}
                </select>
              </div>
              <button type="submit" className={styles.inlineSearchBtn}><Search size={15} /> {t('results_find')}</button>
              <button type="button" className={styles.inlineCancelBtn} onClick={() => setSearchOpen(false)}><X size={15} /></button>
            </form>
          )}
        </div>
      </div>

      <div className={`${styles.layout} ${styles.hotelLayout}`}>
        {/* Filters */}
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
                {SORT_OPTIONS.map(opt => (
                  <button key={opt.value} className={`${styles.sortItem} ${sort === opt.value ? styles.sortItemActive : ''}`} onClick={() => setSort(opt.value)}>
                    {sort === opt.value && <span className={styles.sortDot} />}
                    {opt.label}
                  </button>
                ))}
              </div>
            </FilterSection>

            <FilterSection title={t('results_price_night')}>
              <RangeSlider min={0} max={2000} step={50} value={priceRange} onChange={setPriceRange} />
            </FilterSection>

            <FilterSection title={t('results_stars')}>
              <div className={styles.starsRow}>
                {['1','2','3','4','5'].map(s => (
                  <button key={s} className={`${styles.starBtn} ${stars.includes(s) ? styles.starBtnOn : ''}`} onClick={() => toggleStar(s)}>
                    {'★'.repeat(Number(s))}
                  </button>
                ))}
              </div>
            </FilterSection>

            <FilterSection title={t('results_rating')}>
              <div className={styles.ratingBtns}>
                {[0, 3.5, 4.0, 4.5, 4.8].map(r => (
                  <button key={r} className={`${styles.ratingBtn} ${ratingMin === r ? styles.ratingBtnOn : ''}`} onClick={() => setRatingMin(r)}>
                    {r === 0 ? t('results_rating_any') : `${r}+`}
                  </button>
                ))}
              </div>
            </FilterSection>

            {districtOptions.length > 0 && <FilterSection title={t('results_district')} defaultOpen={false}>
              <div className={styles.checkList}>
                {districtOptions.map(d => (
                  <label key={d} className={styles.checkItem}>
                    <input type="checkbox" checked={districts.includes(d)} onChange={() => toggleDistrict(d)} className={styles.checkBox} />
                    <span>{d}</span>
                  </label>
                ))}
              </div>
            </FilterSection>}

            <FilterSection title={lang === 'ru' ? 'Обязательные удобства' : 'Required amenities'} defaultOpen={false}>
              <div className={styles.checkList}>
                {AMENITY_OPTIONS.map(a => (
                  <label key={a.value} className={styles.checkItem}>
                    <input type="checkbox" checked={amenities.includes(a.value)} onChange={() => toggleAmenity(a.value)} className={styles.checkBox} />
                    <span>{lang === 'ru' ? a.ru : a.en}</span>
                  </label>
                ))}
              </div>
            </FilterSection>

            <FilterSection title={t('results_conditions')} defaultOpen={false}>
              <div className={styles.checkList}>
                <label className={styles.checkItem}>
                  <input type="checkbox" checked={freeCancel} onChange={e => setFreeCancel(e.target.checked)} className={styles.checkBox} />
                  <span>{t('results_free_cancel')}</span>
                </label>
                <label className={styles.checkItem}>
                  <input type="checkbox" checked={breakfastIncl} onChange={e => setBreakfastIncl(e.target.checked)} className={styles.checkBox} />
                  <span>{t('results_breakfast')}</span>
                </label>
              </div>
            </FilterSection>
          </div>
        </aside>

        {/* Hotels */}
        <main className={styles.main} ref={resultsScrollRef} onScroll={event => {
          try {
            const cached = JSON.parse(window.sessionStorage.getItem(HOTEL_RESULTS_CACHE_KEY) || 'null');
            if (cached) window.sessionStorage.setItem(HOTEL_RESULTS_CACHE_KEY, JSON.stringify({ ...cached, scrollTop: event.currentTarget.scrollTop, savedAt: Date.now() }));
          } catch { /* Ignore unavailable session storage. */ }
        }}>
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
              {loading ? t('results_searching') : `${totalResults} ${t('results_count')} ${city}`}
            </span>
            {!loading && checkedCount > 0 && (
              <span className={styles.resultsMeta}>
                {checkedCount} {t('results_checked')} · {unavailableCount} {t('results_price_pending')}
              </span>
            )}
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
          {error && <div className={styles.errorMsg}><strong>⚠️ {error}</strong></div>}
          {!loading && !error && (
            <div className={styles.cards}>
              {hotels.map((hotel, i) => (
                <div key={hotel.id} onMouseEnter={() => setHoveredId(hotel.id)} onMouseLeave={() => setHoveredId(null)}>
                  <HotelCard
                    hotel={hotel}
                    isRecommended={i === 0 && sort === 'score' && hotel.top_pick_eligible}
                    inCompare={isInCompare(hotel.id)}
                    onToggleCompare={toggleCompare}
                    onHide={hotelId => setHotels(current => current.filter(item => item.id !== hotelId))}
                    checkIn={checkIn}
                    checkOut={checkOut}
                    guests={guests}
                    tripPurpose={tripPurpose}
                  />
                </div>
              ))}
              {hotels.length === 0 && <div className={styles.noResults}>{t('results_nothing')}</div>}
              {hasMore && (
                <button type="button" className={styles.loadMoreBtn} onClick={loadMoreHotels} disabled={loadingMore}>
                  {loadingMore ? (lang === 'ru' ? 'Загружаем…' : 'Loading…') : (lang === 'ru' ? 'Загрузить ещё 30 отелей' : 'Load 30 more hotels')}
                </button>
              )}
            </div>
          )}
        </main>

        {/* Map */}
        <div className={styles.mapPanel}>
          <div className={styles.mapSticky}>
            <HotelMap hotels={hotels} hoveredId={hoveredId} checkIn={checkIn} checkOut={checkOut} lang={lang} />
            {!loading && !error && hotels.length > 0 && (
              <div className={styles.mapStepNav}>
                <Link to={`/flights?${searchParams.toString()}`} className={styles.stepNavBtn}>
                  {lang === 'ru' ? 'Перейти к авиабилетам' : 'Continue to flights'}
                  <ArrowRight size={16} />
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {compareList.length > 0 && (
        <div className={styles.compareTray}>
          <span className={styles.trayLabel}>{t('results_compare_label')}</span>
          <div className={styles.trayItems}>
            {compareList.map(h => (
              <div key={h.id} className={styles.trayItem}>
                {h.name}
                <button onClick={() => toggleCompare(h)} className={styles.trayRemove}><X size={12} /></button>
              </div>
            ))}
          </div>
          <Link to="/compare" className={styles.trayGoBtn} data-testid="open-comparison"><GitCompare size={14} /> {t('results_compare_btn')} {compareList.length}</Link>
        </div>
      )}
    </div>
  );
}
