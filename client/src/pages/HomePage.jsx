import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, BadgeCheck, BrainCircuit, LocateFixed, LoaderCircle, Scale, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { useLang } from '../i18n/LanguageContext';
import { hotelsApi } from '../api';
import PriceCalendar from '../components/PriceCalendar';
import styles from './HomePage.module.css';
import { defaultTravelDates, formatLocalDate } from '../utils/dates';
import { formatAmount } from '../utils/money';
import useCapabilities from '../hooks/useCapabilities';
import ProviderUnavailable from '../components/ProviderUnavailable';
import { destinationVisual, selectFeaturedDestinations } from '../utils/destinationVisuals';

const CITIES = [
  { name: 'Сингапур', nameEn: 'Singapore', names: { de: 'Singapur', fr: 'Singapour', it: 'Singapore', es: 'Singapur', 'zh-CN': '新加坡', ar: 'سنغافورة' }, code: 'SIN', country: 'Сингапур', countryEn: 'Singapore', countries: { de: 'Singapur', fr: 'Singapour', it: 'Singapore', es: 'Singapur', 'zh-CN': '新加坡', ar: 'سنغافورة' }, flag: '🇸🇬' },
  { name: 'Дубай', nameEn: 'Dubai', names: { de: 'Dubai', fr: 'Dubaï', it: 'Dubai', es: 'Dubái', 'zh-CN': '迪拜', ar: 'دبي' }, code: 'DXB', country: 'ОАЭ', countryEn: 'UAE', countries: { de: 'Vereinigte Arabische Emirate', fr: 'Émirats arabes unis', it: 'Emirati Arabi Uniti', es: 'Emiratos Árabes Unidos', 'zh-CN': '阿联酋', ar: 'الإمارات العربية المتحدة' }, flag: '🇦🇪' },
  { name: 'Абу-Даби', nameEn: 'Abu Dhabi', names: { de: 'Abu Dhabi', fr: 'Abou Dabi', it: 'Abu Dhabi', es: 'Abu Dabi', 'zh-CN': '阿布扎比', ar: 'أبوظبي' }, code: 'AUH', country: 'ОАЭ', countryEn: 'UAE', countries: { de: 'Vereinigte Arabische Emirate', fr: 'Émirats arabes unis', it: 'Emirati Arabi Uniti', es: 'Emiratos Árabes Unidos', 'zh-CN': '阿联酋', ar: 'الإمارات العربية المتحدة' }, flag: '🇦🇪' },
  { name: 'Париж', nameEn: 'Paris', names: { de: 'Paris', fr: 'Paris', it: 'Parigi', es: 'París', 'zh-CN': '巴黎', ar: 'باريس' }, code: 'PAR', country: 'Франция', countryEn: 'France', countries: { de: 'Frankreich', fr: 'France', it: 'Francia', es: 'Francia', 'zh-CN': '法国', ar: 'فرنسا' }, flag: '🇫🇷' },
  { name: 'Нью-Йорк', nameEn: 'New York', names: { de: 'New York', fr: 'New York', it: 'New York', es: 'Nueva York', 'zh-CN': '纽约', ar: 'نيويورك' }, code: 'NYC', country: 'США', countryEn: 'USA', countries: { de: 'USA', fr: 'États-Unis', it: 'Stati Uniti', es: 'Estados Unidos', 'zh-CN': '美国', ar: 'الولايات المتحدة' }, flag: '🇺🇸' },
  { name: 'Москва', nameEn: 'Moscow', names: { de: 'Moskau', fr: 'Moscou', it: 'Mosca', es: 'Moscú', 'zh-CN': '莫斯科', ar: 'موسكو' }, code: 'MOW', country: 'Россия', countryEn: 'Russia', countries: { de: 'Russland', fr: 'Russie', it: 'Russia', es: 'Rusia', 'zh-CN': '俄罗斯', ar: 'روسيا' }, flag: '🇷🇺' },
  { name: 'Пекин', nameEn: 'Beijing', names: { de: 'Peking', fr: 'Pékin', it: 'Pechino', es: 'Pekín', 'zh-CN': '北京', ar: 'بكين' }, code: 'BJS', country: 'Китай', countryEn: 'China', countries: { de: 'China', fr: 'Chine', it: 'Cina', es: 'China', 'zh-CN': '中国', ar: 'الصين' }, flag: '🇨🇳' },
  { name: 'Шанхай', nameEn: 'Shanghai', names: { de: 'Shanghai', fr: 'Shanghai', it: 'Shanghai', es: 'Shanghái', 'zh-CN': '上海', ar: 'شنغهاي' }, code: 'SHA', country: 'Китай', countryEn: 'China', countries: { de: 'China', fr: 'Chine', it: 'Cina', es: 'China', 'zh-CN': '中国', ar: 'الصين' }, flag: '🇨🇳' },
  { name: 'Нячанг', nameEn: 'Nha Trang', names: { de: 'Nha Trang', fr: 'Nha Trang', it: 'Nha Trang', es: 'Nha Trang', 'zh-CN': '芽庄', ar: 'نها ترانغ' }, code: 'NHA', country: 'Вьетнам', countryEn: 'Vietnam', countries: { de: 'Vietnam', fr: 'Viêt Nam', it: 'Vietnam', es: 'Vietnam', 'zh-CN': '越南', ar: 'فيتنام' }, flag: '🇻🇳' },
  { name: 'Дананг', nameEn: 'Da Nang', names: { de: 'Da Nang', fr: 'Da Nang', it: 'Da Nang', es: 'Da Nang', 'zh-CN': '岘港', ar: 'دا نانغ' }, code: 'DAD', country: 'Вьетнам', countryEn: 'Vietnam', countries: { de: 'Vietnam', fr: 'Viêt Nam', it: 'Vietnam', es: 'Vietnam', 'zh-CN': '越南', ar: 'فيتنام' }, flag: '🇻🇳' },
  { name: 'Куала-Лумпур', nameEn: 'Kuala Lumpur', names: { de: 'Kuala Lumpur', fr: 'Kuala Lumpur', it: 'Kuala Lumpur', es: 'Kuala Lumpur', 'zh-CN': '吉隆坡', ar: 'كوالالمبور' }, code: 'SZB', country: 'Малайзия', countryEn: 'Malaysia', countries: { de: 'Malaysia', fr: 'Malaisie', it: 'Malesia', es: 'Malasia', 'zh-CN': '马来西亚', ar: 'ماليزيا' }, flag: '🇲🇾' },
];

function cityNames(city) {
  return [city.name, city.nameEn, ...Object.values(city.names || {})];
}

function countryNames(city) {
  return [city.country, city.countryEn, ...Object.values(city.countries || {})];
}

function localizedCityName(city, lang) {
  if (lang === 'ru') return city.name;
  if (lang === 'en') return city.nameEn;
  return city.names?.[lang] || city.nameEn;
}

function localizedCountryName(city, lang) {
  if (lang === 'ru') return city.country;
  if (lang === 'en') return city.countryEn;
  return city.countries?.[lang] || city.countryEn;
}

function knownCity(value) {
  const normalized = cleanPlace(value).toLocaleLowerCase();
  return CITIES.find(city => (
    city.code.toLocaleLowerCase() === normalized
    || cityNames(city).some(name => name.toLocaleLowerCase() === normalized)
  ));
}

const SUPPORTED_CITY_NAMES = new Set(CITIES.flatMap(cityNames).map(name => name.toLocaleLowerCase()));

export function cleanPlace(value = '') {
  return String(value).replace(/\s*\([^)]*\)/, '').trim();
}

export function canonicalPlace(value = '') {
  const cleaned = cleanPlace(value);
  return knownCity(cleaned)?.nameEn || cleaned;
}

export function localizedPlace(value = '', lang = 'en') {
  const city = knownCity(value);
  return city ? localizedCityName(city, lang) : cleanPlace(value);
}

let worldCitiesPromise;

function loadWorldCities() {
  if (!worldCitiesPromise) {
    worldCitiesPromise = fetch('/data/world-cities.json')
      .then(response => {
        if (!response.ok) throw new Error(`Could not load city index (${response.status})`);
        return response.json();
      });
  }
  return worldCitiesPromise;
}

function countryFlag(countryCode) {
  if (!/^[A-Z]{2}$/.test(countryCode || '')) return '';
  return String.fromCodePoint(...countryCode.split('').map(letter => 127397 + letter.charCodeAt(0)));
}

function distanceSquared(city, latitude, longitude) {
  const latitudeScale = 111.32;
  const longitudeScale = latitudeScale * Math.cos(latitude * Math.PI / 180);
  return ((city.y - latitude) * latitudeScale) ** 2
    + ((city.x - longitude) * longitudeScale) ** 2;
}

function CityDropdown({
  value,
  onChange,
  placeholder,
  label,
  error,
  worldwide = false,
  geolocation = false,
}) {
  const { lang, l, t } = useLang();
  const [query, setQuery] = useState(value || '');
  const [open, setOpen] = useState(false);
  const [worldCities, setWorldCities] = useState([]);
  const [cityIndexLoading, setCityIndexLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  const availableCities = worldwide && worldCities.length > 0 ? worldCities : CITIES;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const suggestions = normalizedQuery.length >= 1
    ? availableCities.filter(city => {
        if (city.n) {
          return city.n.toLocaleLowerCase().includes(normalizedQuery)
            || city.c.toLocaleLowerCase().includes(normalizedQuery)
            || city.a?.toLocaleLowerCase().includes(normalizedQuery)
            || city.cc.toLocaleLowerCase() === normalizedQuery;
        }
        return cityNames(city).some(name => name.toLocaleLowerCase().includes(normalizedQuery))
          || city.code.toLocaleLowerCase().includes(normalizedQuery)
          || countryNames(city).some(country => country.toLocaleLowerCase().includes(normalizedQuery));
      }).slice(0, 7)
    : availableCities.slice(0, 6);

  const ensureWorldCities = async () => {
    if (!worldwide || worldCities.length > 0) return worldCities;
    setCityIndexLoading(true);
    try {
      const cities = await loadWorldCities();
      setWorldCities(cities);
      return cities;
    } finally {
      setCityIndexLoading(false);
    }
  };

  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    const city = knownCity(value);
    setQuery(city ? `${localizedCityName(city, lang)} (${city.code})` : (value || ''));
  }, [value, lang]);

  const handleSelect = (city) => {
    const isWorldCity = Boolean(city.n);
    const curatedCity = isWorldCity ? knownCity(city.n) : city;
    const displayName = curatedCity ? localizedCityName(curatedCity, lang) : city.n;
    const val = isWorldCity ? displayName : `${displayName} (${city.code})`;
    setQuery(val);
    onChange(val);
    setLocationError('');
    setOpen(false);
  };

  const handleFocus = () => {
    setOpen(true);
    ensureWorldCities().catch(() => {});
  };

  const handleLocate = async () => {
    setLocationError('');
    if (!navigator.geolocation) {
      setLocationError(t('home_location_unsupported'));
      return;
    }

    setLocating(true);
    try {
      const cities = await ensureWorldCities();
      if (!cities.length) throw new Error('city_index_unavailable');
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: 10000,
          maximumAge: 300000,
        });
      });
      const { latitude, longitude } = position.coords;
      const nearestCity = cities.reduce((nearest, city) => (
        !nearest || distanceSquared(city, latitude, longitude) < distanceSquared(nearest, latitude, longitude)
          ? city
          : nearest
      ), null);
      if (!nearestCity) throw new Error('city_not_found');
      handleSelect(nearestCity);
    } catch (locationFailure) {
      setLocationError(
        locationFailure?.code === 1
          ? t('home_location_denied')
          : t('home_location_failed'),
      );
    } finally {
      setLocating(false);
    }
  };

  return (
    <div className={styles.field} ref={wrapRef}>
      <label className={styles.label}>{label}</label>
      <div className={styles.autocompleteWrap}>
        <input
          ref={inputRef}
          className={`${styles.input} ${error ? styles.inputError : ''}`}
          value={query}
          onChange={e => { setQuery(e.target.value); onChange(e.target.value); setOpen(true); }}
          onFocus={handleFocus}
          placeholder={placeholder}
          autoComplete="off"
        />
        {geolocation && (
          <button
            type="button"
            className={styles.locationButton}
            onClick={handleLocate}
            title={t('home_use_location')}
            aria-label={t('home_use_location')}
            disabled={locating}
          >
            {locating
              ? <LoaderCircle size={16} className={styles.locationSpinner} />
              : <LocateFixed size={16} />}
          </button>
        )}
        {open && (suggestions.length > 0 || cityIndexLoading) && (
          <div className={styles.dropdown}>
            {query.length < 1 && (
              <div className={styles.dropdownHint}>
                {worldwide ? t('home_world_cities') : l('Popular destinations', 'Популярные направления')}
              </div>
            )}
            {cityIndexLoading && <div className={styles.dropdownLoading}>{t('home_loading_cities')}</div>}
            {!cityIndexLoading && suggestions.map(city => (
              <button key={city.i || city.code} className={styles.dropdownItem} onMouseDown={() => handleSelect(city)} type="button">
                <span className={styles.cityFlag}>{city.n ? countryFlag(city.cc) : city.flag}</span>
                <div className={styles.cityInfo}>
                  <span className={styles.cityName}>{city.n ? localizedPlace(city.n, lang) : localizedCityName(city, lang)}</span>
                  <span className={styles.cityMeta}>
                    {city.n ? city.c : localizedCountryName(city, lang)}
                    {!city.n && ` · ${city.code}`}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      {locationError && <span className={styles.locationError} role="status">{locationError}</span>}
    </div>
  );
}

export default function HomePage() {
  const navigate = useNavigate();
  const { t, lang, l } = useLang();
  const [tab, setTab] = useState(0);
  const [popularDestinations, setPopularDestinations] = useState([]);
  const [destinationsLoading, setDestinationsLoading] = useState(true);
  const [errors, setErrors] = useState({});
  const { capabilities, loading: capabilitiesLoading } = useCapabilities();
  const hotelReady = capabilities?.hotels?.status === 'ready';
  const flightReady = capabilities?.flights?.status === 'ready';
  const activeReady = tab === 0 ? hotelReady : tab === 1 ? flightReady : false;
  const initialDates = defaultTravelDates();
  const [form, setForm] = useState({
    from: '',
    city: '',
    check_in: initialDates.check_in,
    check_out: initialDates.check_out,
    guests: '2',
    trip_purpose: 'leisure',
    cabin_class: 'business',
  });

  const TABS = [t('home_tab_hotel'), t('home_tab_flights'), t('home_tab_package')];

  const isSupportedCity = (value) => SUPPORTED_CITY_NAMES.has(cleanPlace(value).toLowerCase());

  const validateSearch = () => {
    const nextErrors = {};
    const origin = cleanPlace(form.from);
    const destination = cleanPlace(form.city);
    const checkInTime = form.check_in ? new Date(`${form.check_in}T00:00:00`).getTime() : NaN;
    const checkOutTime = form.check_out ? new Date(`${form.check_out}T00:00:00`).getTime() : NaN;

    if (!origin) nextErrors.from = true;
    if (!destination) nextErrors.city = true;
    if (destination && !isSupportedCity(form.city)) nextErrors.city = true;
    if (!form.check_in) nextErrors.check_in = true;
    if (!form.check_out) nextErrors.check_out = true;
    if (form.check_in && form.check_out && checkOutTime <= checkInTime) {
      nextErrors.check_in = true;
      nextErrors.check_out = true;
      nextErrors.dates = true;
    }
    if (!form.guests || Number(form.guests) < 1) nextErrors.guests = true;
    if (tab === 1 && !form.cabin_class) nextErrors.cabin_class = true;
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  useEffect(() => {
    if (!capabilities || !hotelReady) { if (capabilities) { setPopularDestinations([]); setDestinationsLoading(false); } return undefined; }
    window.sessionStorage.setItem('fairworth_dates', JSON.stringify({
      check_in: form.check_in,
      check_out: form.check_out,
    }));
    window.sessionStorage.setItem('fairworth_trip', JSON.stringify({
      from: canonicalPlace(form.from),
      to: canonicalPlace(form.city),
      check_in: form.check_in,
      check_out: form.check_out,
      guests: form.guests,
      trip_purpose: form.trip_purpose,
      cabin_class: form.cabin_class,
    }));
  }, [form.from, form.city, form.check_in, form.check_out, form.guests, form.cabin_class, form.trip_purpose]);

  useEffect(() => {
    let cancelled = false;
    setDestinationsLoading(true);
    hotelsApi.popularDestinations({ limit: 30 })
      .then(res => {
        if (!cancelled) {
          const destinations = selectFeaturedDestinations(
            (res.data.destinations || [])
              .filter(destination => SUPPORTED_CITY_NAMES.has(String(destination.city || '').toLowerCase())),
          );
          setPopularDestinations(destinations);
        }
      })
      .catch(() => {
        if (!cancelled) setPopularDestinations([]);
      })
      .finally(() => {
        if (!cancelled) setDestinationsLoading(false);
      });
    return () => { cancelled = true; };
  }, [capabilities, hotelReady]);

  const handleSearch = (e) => {
    e.preventDefault();
    if (!validateSearch()) return;
    if (!activeReady) return;

    const origin = canonicalPlace(form.from);
    const destination = canonicalPlace(form.city);
    if (tab === 1) {
      navigate(`/flights?from=${encodeURIComponent(origin)}&to=${encodeURIComponent(destination)}&departure_date=${form.check_in}&check_in=${form.check_in}&check_out=${form.check_out}&passengers=${form.guests}&cabin_class=${form.cabin_class}`);
      return;
    }
    navigate(`/results?from=${encodeURIComponent(origin)}&city=${encodeURIComponent(destination)}&to=${encodeURIComponent(destination)}&check_in=${form.check_in}&check_out=${form.check_out}&guests=${form.guests}&trip_purpose=${form.trip_purpose}`);
  };

  const guestOptions = [1,2,3,4,5,6].map(n => ({
    value: String(n),
    label: `${n} ${l(n === 1 ? 'adult' : 'adults', n === 1 ? 'взрослый' : 'взрослых')}`
  }));

  const destinationForCalendar = canonicalPlace(form.city);
  const showPriceCalendar = Boolean(destinationForCalendar) && activeReady;

  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <div className={styles.heroLeft}>
          <div className={styles.badge}>
            <span className={styles.pulseDot} />
            {t('home_badge')}
          </div>
          <h1 className={styles.headline}>
            {t('home_headline_1')}<br />
            {t('home_headline_2')} <em>{t('home_headline_em')}</em>
          </h1>
          <p className={styles.sub}>{t('home_sub')}</p>
          <div className={styles.trustRow}>
            <div className={styles.trustItem}><strong>0%</strong><span>{t('home_trust_commission')}</span></div>
            <div className={styles.trustItem}><strong>{l('Live', 'Актуальные')}</strong><span>{l('provider data', 'данные провайдеров')}</span></div>
            <div className={styles.trustItem}><strong>{l('No', 'Нет')}</strong><span>{t('home_trust_ads')}</span></div>
          </div>

        </div>

        <div className={styles.searchCard}>
          <div className={styles.tabs}>
            {TABS.map((tab_label, i) => (
              <button key={i} className={`${styles.tabBtn} ${tab === i ? styles.tabActive : ''}`} onClick={() => setTab(i)}>
                {tab_label}{((i === 0 && !hotelReady) || (i === 1 && !flightReady) || i === 2) && !capabilitiesLoading ? ' · Beta' : ''}
              </button>
            ))}
          </div>

          <form onSubmit={handleSearch} className={styles.form}>
            <div className={styles.formBody}>
              {!capabilitiesLoading && !activeReady && <ProviderUnavailable capability={tab === 0 ? 'hotels' : tab === 1 ? 'flights' : 'packages'} compact />}
              {Object.values(errors).some(Boolean) && (
                <div className={styles.formError}>
                  {errors.dates ? t('home_validation_dates') : t('home_validation_required')}
                </div>
              )}
              <div className={styles.row2}>
                <CityDropdown
                  label={t('home_from')}
                  placeholder={t('home_city_placeholder')}
                  value={form.from}
                  error={errors.from}
                  worldwide
                  geolocation
                  onChange={v => {
                    setForm(p => ({ ...p, from: v }));
                    setErrors(prev => ({ ...prev, from: false }));
                  }}
                />
                <CityDropdown
                  label={t('home_to')}
                  placeholder={t('home_dest_placeholder')}
                  value={form.city}
                  error={errors.city}
                  onChange={v => {
                    setForm(p => ({ ...p, city: v }));
                    setErrors(prev => ({ ...prev, city: false }));
                  }}
                />
              </div>
              <div className={styles.row2}>
                <div className={`${styles.field} ${styles.dateField}`}>
                  <label className={styles.label}>{t('home_checkin')}</label>
                  <input
                    type="date"
                    min={formatLocalDate(new Date())}
                    className={`${styles.input} ${errors.check_in ? styles.inputError : ''}`}
                    value={form.check_in}
                    onChange={e => {
                      setForm(p => ({ ...p, check_in: e.target.value }));
                      setErrors(prev => ({ ...prev, check_in: false, dates: false }));
                    }}
                  />
                </div>
                <div className={`${styles.field} ${styles.dateField}`}>
                  <label className={styles.label}>{t('home_checkout')}</label>
                  <input
                    type="date"
                    min={form.check_in}
                    className={`${styles.input} ${errors.check_out ? styles.inputError : ''}`}
                    value={form.check_out}
                    onChange={e => {
                      setForm(p => ({ ...p, check_out: e.target.value }));
                      setErrors(prev => ({ ...prev, check_out: false, dates: false }));
                    }}
                  />
                </div>
              </div>
              {showPriceCalendar && (
                <PriceCalendar
                  city={destinationForCalendar}
                  checkIn={form.check_in}
                  checkOut={form.check_out}
                  onSelectDate={(checkIn, checkOut) => setForm(p => ({ ...p, check_in: checkIn, check_out: checkOut }))}
                />
              )}
              <div className={styles.field}>
                <label className={styles.label}>{t('home_guests')}</label>
                <select
                  className={`${styles.input} ${errors.guests ? styles.inputError : ''}`}
                  value={form.guests}
                  onChange={e => {
                    setForm(p => ({ ...p, guests: e.target.value }));
                    setErrors(prev => ({ ...prev, guests: false }));
                  }}
                >
                  {guestOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              {tab === 0 && (
                <div className={styles.field}>
                  <label className={styles.label}>{l('Trip type', 'Тип поездки')}</label>
                  <select className={styles.input} value={form.trip_purpose} onChange={e => setForm(p => ({ ...p, trip_purpose: e.target.value }))}>
                    <option value="leisure">{l('Leisure', 'Отдых')}</option>
                    <option value="business">{l('Business', 'Командировка')}</option>
                    <option value="family">{l('Family', 'Семейная поездка')}</option>
                    <option value="couple">{l('Couple', 'Поездка вдвоём')}</option>
                  </select>
                </div>
              )}
              {tab === 1 && (
                <div className={styles.field}>
                  <label className={styles.label}>{t('flight_class')}</label>
                  <select className={`${styles.input} ${errors.cabin_class ? styles.inputError : ''}`} value={form.cabin_class} onChange={e => setForm(p => ({ ...p, cabin_class: e.target.value }))}>
                    <option value="economy">{t('flight_class_economy')}</option>
                    <option value="business">{t('flight_class_business')}</option>
                  </select>
                </div>
              )}
            </div>
            <div className={styles.formActions}>
              <button type="submit" className={styles.searchBtn} disabled={capabilitiesLoading || !activeReady}>
                <Search size={16} /> {t('home_search_btn')}
              </button>
              <div className={styles.aiHint}>
                <Sparkles size={13} style={{ color: 'var(--gold)', flexShrink: 0 }} />
                <span>{t('home_ai_hint')}</span>
              </div>
            </div>
          </form>
        </div>
      </div>

      <section className={styles.destinations}>
        <div className={styles.sectionHeader}>
          <div>
            <span className={styles.sectionEyebrow}>{l('Popular now', 'Популярно сейчас')}</span>
            <h2 className={styles.sectionTitle}>{t('home_popular_title')}</h2>
            <p className={styles.sectionSub}>{t('home_popular_sub')}</p>
          </div>
          <button type="button" className={styles.exploreLink} onClick={() => document.querySelector(`.${styles.searchCard}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
            {l('Explore destinations', 'Выбрать направление')} <ArrowRight size={18} />
          </button>
        </div>
        <div className={styles.destinationGrid}>
          {destinationsLoading && [1,2,3].map(i => (
            <div key={i} className={styles.destinationSkeleton}>
              <div className={`skeleton ${styles.destinationSkeletonFill}`} />
            </div>
          ))}
          {!destinationsLoading && popularDestinations.map(destination => {
            const visual = destinationVisual(destination.city, lang);
            return (
              <button
                type="button"
                key={`${destination.city}-${destination.country}`}
                className={styles.destinationCard}
                onClick={() => navigate(`/results?city=${encodeURIComponent(destination.city)}&check_in=${form.check_in}&check_out=${form.check_out}&guests=${form.guests}&trip_purpose=${form.trip_purpose}`)}
                style={{ '--destination-image': `url("${visual.image}")` }}
              >
                <span className={styles.destinationShade} aria-hidden="true" />
                <span className={styles.destinationContent}>
                  <span className={styles.destinationTag}>{visual.tag || destination.country}</span>
                  <span className={styles.destinationName}>{localizedPlace(destination.city, lang)}</span>
                  <span className={styles.destinationPrice}>
                    <span>{t('card_from')}</span>
                    <strong>${formatAmount(destination.min_price, lang)}</strong>
                    <span>{t('card_per_night')}</span>
                  </span>
                </span>
                <span className={styles.destinationArrow} aria-hidden="true"><ArrowRight size={21} /></span>
              </button>
            );
          })}
          {!destinationsLoading && popularDestinations.length === 0 && <div className={styles.destinationsEmpty}>{t('home_popular_empty')}</div>}
        </div>
      </section>

      <div className={styles.features}>
        {[
          { icon: BadgeCheck, title: t('home_feature_score_title'), desc: t('home_feature_score_desc') },
          { icon: ShieldCheck, title: t('home_feature_analysis_title'), desc: t('home_feature_analysis_desc') },
          { icon: Scale, title: t('home_feature_compare_title'), desc: t('home_feature_compare_desc') },
          { icon: BrainCircuit, title: t('home_feature_learn_title'), desc: t('home_feature_learn_desc') },
        ].map(f => (
          <div key={f.title} className={styles.feature}>
            <div className={styles.featureIcon}><f.icon size={21} aria-hidden="true" /></div>
            <div>
              <div className={styles.featureTitle}>{f.title}</div>
              <div className={styles.featureDesc}>{f.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
