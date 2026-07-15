import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, MapPin, Search, Sparkles } from 'lucide-react';
import { useLang } from '../i18n/LanguageContext';
import { hotelsApi } from '../api';
import PriceCalendar from '../components/PriceCalendar';
import styles from './HomePage.module.css';
import { defaultTravelDates, formatLocalDate } from '../utils/dates';
import { formatAmount } from '../utils/money';
import useCapabilities from '../hooks/useCapabilities';
import ProviderUnavailable from '../components/ProviderUnavailable';

const CITIES = [
  { name: 'Сингапур', nameEn: 'Singapore', code: 'SIN', country: 'Сингапур', countryEn: 'Singapore', flag: '🇸🇬' },
  { name: 'Дубай', nameEn: 'Dubai', code: 'DXB', country: 'ОАЭ', countryEn: 'UAE', flag: '🇦🇪' },
  { name: 'Абу-Даби', nameEn: 'Abu Dhabi', code: 'AUH', country: 'ОАЭ', countryEn: 'UAE', flag: '🇦🇪' },
  { name: 'Париж', nameEn: 'Paris', code: 'PAR', country: 'Франция', countryEn: 'France', flag: '🇫🇷' },
  { name: 'Нью-Йорк', nameEn: 'New York', code: 'NYC', country: 'США', countryEn: 'USA', flag: '🇺🇸' },
  { name: 'Москва', nameEn: 'Moscow', code: 'MOW', country: 'Россия', countryEn: 'Russia', flag: '🇷🇺' },
  { name: 'Пекин', nameEn: 'Beijing', code: 'BJS', country: 'Китай', countryEn: 'China', flag: '🇨🇳' },
  { name: 'Шанхай', nameEn: 'Shanghai', code: 'SHA', country: 'Китай', countryEn: 'China', flag: '🇨🇳' },
  { name: 'Нячанг', nameEn: 'Nha Trang', code: 'NHA', country: 'Вьетнам', countryEn: 'Vietnam', flag: '🇻🇳' },
  { name: 'Дананг', nameEn: 'Da Nang', code: 'DAD', country: 'Вьетнам', countryEn: 'Vietnam', flag: '🇻🇳' },
  { name: 'Куала-Лумпур', nameEn: 'Kuala Lumpur', code: 'SZB', country: 'Малайзия', countryEn: 'Malaysia', flag: '🇲🇾' },
];

const SUPPORTED_CITY_NAMES = new Set(CITIES.flatMap(city => [city.name, city.nameEn]).map(name => name.toLowerCase()));

function CityDropdown({ value, onChange, placeholder, label, error }) {
  const { lang } = useLang();
  const [query, setQuery] = useState(value || '');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  const suggestions = query.length >= 1
    ? CITIES.filter(c => {
        const q = query.toLowerCase();
        return c.name.toLowerCase().includes(q)
          || c.nameEn.toLowerCase().includes(q)
          || c.code.toLowerCase().includes(q)
          || c.country.toLowerCase().includes(q)
          || c.countryEn.toLowerCase().includes(q);
      }).slice(0, 7)
    : CITIES.slice(0, 6);

  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelect = (city) => {
    const displayName = lang === 'en' ? city.nameEn : city.name;
    const val = `${displayName} (${city.code})`;
    setQuery(val);
    onChange(val);
    setOpen(false);
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
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          autoComplete="off"
        />
        {open && suggestions.length > 0 && (
          <div className={styles.dropdown}>
            {query.length < 1 && <div className={styles.dropdownHint}>{lang === 'ru' ? 'Популярные направления' : 'Popular destinations'}</div>}
            {suggestions.map(city => (
              <button key={city.code} className={styles.dropdownItem} onMouseDown={() => handleSelect(city)} type="button">
                <span className={styles.cityFlag}>{city.flag}</span>
                <div className={styles.cityInfo}>
                  <span className={styles.cityName}>{lang === 'en' ? city.nameEn : city.name}</span>
                  <span className={styles.cityMeta}>{lang === 'en' ? city.countryEn : city.country} · {city.code}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function HomePage() {
  const navigate = useNavigate();
  const { t, lang } = useLang();
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
    from: lang === 'ru' ? 'Москва (SVO)' : 'Moscow (SVO)',
    city: '',
    check_in: initialDates.check_in,
    check_out: initialDates.check_out,
    guests: '2',
    trip_purpose: 'leisure',
    cabin_class: 'business',
  });

  const TABS = [t('home_tab_hotel'), t('home_tab_flights'), t('home_tab_package')];

  const cleanPlace = (value) => value.replace(/\s*\([^)]*\)/, '').trim();
  const isSupportedCity = (value) => SUPPORTED_CITY_NAMES.has(cleanPlace(value).toLowerCase());

  const validateSearch = () => {
    const nextErrors = {};
    const origin = cleanPlace(form.from);
    const destination = cleanPlace(form.city);
    const checkInTime = form.check_in ? new Date(`${form.check_in}T00:00:00`).getTime() : NaN;
    const checkOutTime = form.check_out ? new Date(`${form.check_out}T00:00:00`).getTime() : NaN;

    if (!origin) nextErrors.from = true;
    if (!destination) nextErrors.city = true;
    if (origin && !isSupportedCity(form.from)) nextErrors.from = true;
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
      from: cleanPlace(form.from),
      to: cleanPlace(form.city),
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
          const destinations = (res.data.destinations || [])
            .filter(destination => SUPPORTED_CITY_NAMES.has(String(destination.city || '').toLowerCase()))
            .slice(0, 5);
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

    const origin = cleanPlace(form.from);
    const destination = cleanPlace(form.city);
    if (tab === 1) {
      navigate(`/flights?from=${encodeURIComponent(origin)}&to=${encodeURIComponent(destination)}&departure_date=${form.check_in}&check_in=${form.check_in}&check_out=${form.check_out}&passengers=${form.guests}&cabin_class=${form.cabin_class}`);
      return;
    }
    navigate(`/results?from=${encodeURIComponent(origin)}&city=${encodeURIComponent(destination)}&to=${encodeURIComponent(destination)}&check_in=${form.check_in}&check_out=${form.check_out}&guests=${form.guests}&trip_purpose=${form.trip_purpose}`);
  };

  const guestOptions = [1,2,3,4,5,6].map(n => ({
    value: String(n),
    label: `${n} ${lang === 'ru' ? (n === 1 ? 'взрослый' : 'взрослых') : (n === 1 ? 'adult' : 'adults')}`
  }));

  const destinationForCalendar = cleanPlace(form.city);
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
            <div className={styles.trustItem}><strong>Live</strong><span>{lang === 'ru' ? 'данные провайдеров' : 'provider data'}</span></div>
            <div className={styles.trustItem}><strong>No</strong><span>{t('home_trust_ads')}</span></div>
          </div>

          <section className={styles.destinations}>
            <div className={styles.sectionHeader}>
              <div>
                <h2 className={styles.sectionTitle}>{t('home_popular_title')}</h2>
                <p className={styles.sectionSub}>{t('home_popular_sub')}</p>
              </div>
            </div>

            <div className={styles.destinationGrid}>
              {destinationsLoading && [1,2,3,4,5].map(i => (
                <div key={i} className={styles.destinationSkeleton}>
                  <div className={`skeleton ${styles.skeletonTitle}`} />
                  <div className={`skeleton ${styles.skeletonLine}`} />
                  <div className={`skeleton ${styles.skeletonPrice}`} />
                </div>
              ))}
              {!destinationsLoading && popularDestinations.map(destination => (
                <button
                  type="button"
                  key={`${destination.city}-${destination.country}`}
                  className={styles.destinationCard}
                  onClick={() => navigate(`/results?city=${encodeURIComponent(destination.city)}&check_in=${form.check_in}&check_out=${form.check_out}&guests=${form.guests}&trip_purpose=${form.trip_purpose}`)}
                >
                  <div className={styles.destinationTop}>
                    <div>
                      <h3 className={styles.destinationName}>{destination.city}</h3>
                      <div className={styles.destinationCountry}>
                        <MapPin size={12} />
                        {destination.country}
                      </div>
                    </div>
                    <ArrowRight size={15} className={styles.destinationArrow} />
                  </div>
                  <div className={styles.destinationPrice}>
                    <span>{t('card_from')}</span>
                    <strong>${formatAmount(destination.min_price, lang)}</strong>
                    <span>{t('card_per_night')}</span>
                  </div>
                </button>
              ))}
              {!destinationsLoading && popularDestinations.length === 0 && (
                <div className={styles.destinationsEmpty}>{t('home_popular_empty')}</div>
              )}
            </div>
          </section>
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
              <div className={styles.field}>
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
              <div className={styles.field}>
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
                <label className={styles.label}>{lang === 'ru' ? 'Тип поездки' : 'Trip type'}</label>
                <select className={styles.input} value={form.trip_purpose} onChange={e => setForm(p => ({ ...p, trip_purpose: e.target.value }))}>
                  <option value="leisure">{lang === 'ru' ? 'Отдых' : 'Leisure'}</option>
                  <option value="business">{lang === 'ru' ? 'Командировка' : 'Business'}</option>
                  <option value="family">{lang === 'ru' ? 'Семейная поездка' : 'Family'}</option>
                  <option value="couple">{lang === 'ru' ? 'Поездка вдвоём' : 'Couple'}</option>
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
            <button type="submit" className={styles.searchBtn} disabled={capabilitiesLoading || !activeReady}>
              <Search size={16} /> {t('home_search_btn')}
            </button>
            <div className={styles.aiHint}>
              <Sparkles size={13} style={{ color: 'var(--gold)', flexShrink: 0 }} />
              <span>{t('home_ai_hint')}</span>
            </div>
          </form>
        </div>
      </div>

      <div className={styles.features}>
        {[
          { icon: '🎯', title: t('home_feature_score_title'), desc: t('home_feature_score_desc') },
          { icon: '🔍', title: t('home_feature_analysis_title'), desc: t('home_feature_analysis_desc') },
          { icon: '⚖️', title: t('home_feature_compare_title'), desc: t('home_feature_compare_desc') },
          { icon: '🧠', title: t('home_feature_learn_title'), desc: t('home_feature_learn_desc') },
        ].map(f => (
          <div key={f.title} className={styles.feature}>
            <div className={styles.featureIcon}>{f.icon}</div>
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
