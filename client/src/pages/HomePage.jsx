import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, MapPin, Search, Sparkles } from 'lucide-react';
import { useLang } from '../i18n/LanguageContext';
import { hotelsApi } from '../api';
import PriceCalendar from '../components/PriceCalendar';
import styles from './HomePage.module.css';
import { defaultTravelDates, formatLocalDate } from '../utils/dates';
import { formatAmount } from '../utils/money';

const CITIES = [
  { name: 'Москва', nameEn: 'Moscow', code: 'SVO', country: 'Россия', countryEn: 'Russia', flag: '🇷🇺' },
  { name: 'Санкт-Петербург', nameEn: 'Saint Petersburg', code: 'LED', country: 'Россия', countryEn: 'Russia', flag: '🇷🇺' },
  { name: 'Новосибирск', nameEn: 'Novosibirsk', code: 'OVB', country: 'Россия', countryEn: 'Russia', flag: '🇷🇺' },
  { name: 'Екатеринбург', nameEn: 'Yekaterinburg', code: 'SVX', country: 'Россия', countryEn: 'Russia', flag: '🇷🇺' },
  { name: 'Казань', nameEn: 'Kazan', code: 'KZN', country: 'Россия', countryEn: 'Russia', flag: '🇷🇺' },
  { name: 'Сочи', nameEn: 'Sochi', code: 'AER', country: 'Россия', countryEn: 'Russia', flag: '🇷🇺' },
  { name: 'Сингапур', nameEn: 'Singapore', code: 'SIN', country: 'Сингапур', countryEn: 'Singapore', flag: '🇸🇬' },
  { name: 'Дубай', nameEn: 'Dubai', code: 'DXB', country: 'ОАЭ', countryEn: 'UAE', flag: '🇦🇪' },
  { name: 'Абу-Даби', nameEn: 'Abu Dhabi', code: 'AUH', country: 'ОАЭ', countryEn: 'UAE', flag: '🇦🇪' },
  { name: 'Бангкок', nameEn: 'Bangkok', code: 'BKK', country: 'Таиланд', countryEn: 'Thailand', flag: '🇹🇭' },
  { name: 'Пхукет', nameEn: 'Phuket', code: 'HKT', country: 'Таиланд', countryEn: 'Thailand', flag: '🇹🇭' },
  { name: 'Бали', nameEn: 'Bali', code: 'DPS', country: 'Индонезия', countryEn: 'Indonesia', flag: '🇮🇩' },
  { name: 'Токио', nameEn: 'Tokyo', code: 'NRT', country: 'Япония', countryEn: 'Japan', flag: '🇯🇵' },
  { name: 'Сеул', nameEn: 'Seoul', code: 'ICN', country: 'Южная Корея', countryEn: 'South Korea', flag: '🇰🇷' },
  { name: 'Гонконг', nameEn: 'Hong Kong', code: 'HKG', country: 'Гонконг', countryEn: 'Hong Kong', flag: '🇭🇰' },
  { name: 'Мальдивы', nameEn: 'Maldives', code: 'MLE', country: 'Мальдивы', countryEn: 'Maldives', flag: '🇲🇻' },
  { name: 'Стамбул', nameEn: 'Istanbul', code: 'IST', country: 'Турция', countryEn: 'Turkey', flag: '🇹🇷' },
  { name: 'Анталья', nameEn: 'Antalya', code: 'AYT', country: 'Турция', countryEn: 'Turkey', flag: '🇹🇷' },
  { name: 'Париж', nameEn: 'Paris', code: 'CDG', country: 'Франция', countryEn: 'France', flag: '🇫🇷' },
  { name: 'Лондон', nameEn: 'London', code: 'LHR', country: 'Великобритания', countryEn: 'UK', flag: '🇬🇧' },
  { name: 'Рим', nameEn: 'Rome', code: 'FCO', country: 'Италия', countryEn: 'Italy', flag: '🇮🇹' },
  { name: 'Барселона', nameEn: 'Barcelona', code: 'BCN', country: 'Испания', countryEn: 'Spain', flag: '🇪🇸' },
  { name: 'Амстердам', nameEn: 'Amsterdam', code: 'AMS', country: 'Нидерланды', countryEn: 'Netherlands', flag: '🇳🇱' },
  { name: 'Берлин', nameEn: 'Berlin', code: 'BER', country: 'Германия', countryEn: 'Germany', flag: '🇩🇪' },
  { name: 'Вена', nameEn: 'Vienna', code: 'VIE', country: 'Австрия', countryEn: 'Austria', flag: '🇦🇹' },
  { name: 'Прага', nameEn: 'Prague', code: 'PRG', country: 'Чехия', countryEn: 'Czech Republic', flag: '🇨🇿' },
  { name: 'Нью-Йорк', nameEn: 'New York', code: 'JFK', country: 'США', countryEn: 'USA', flag: '🇺🇸' },
  { name: 'Лос-Анджелес', nameEn: 'Los Angeles', code: 'LAX', country: 'США', countryEn: 'USA', flag: '🇺🇸' },
  { name: 'Майами', nameEn: 'Miami', code: 'MIA', country: 'США', countryEn: 'USA', flag: '🇺🇸' },
  { name: 'Доха', nameEn: 'Doha', code: 'DOH', country: 'Катар', countryEn: 'Qatar', flag: '🇶🇦' },
  { name: 'Сидней', nameEn: 'Sydney', code: 'SYD', country: 'Австралия', countryEn: 'Australia', flag: '🇦🇺' },
];

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
  const initialDates = defaultTravelDates();
  const [form, setForm] = useState({
    from: lang === 'ru' ? 'Москва (SVO)' : 'Moscow (SVO)',
    city: '',
    check_in: initialDates.check_in,
    check_out: initialDates.check_out,
    guests: '2',
    cabin_class: 'business',
  });

  const TABS = [t('home_tab_hotel'), t('home_tab_flights'), t('home_tab_package')];

  const cleanPlace = (value) => value.replace(/\s*\([^)]*\)/, '').trim();

  const validateSearch = () => {
    const nextErrors = {};
    const origin = cleanPlace(form.from);
    const destination = cleanPlace(form.city);
    const checkInTime = form.check_in ? new Date(`${form.check_in}T00:00:00`).getTime() : NaN;
    const checkOutTime = form.check_out ? new Date(`${form.check_out}T00:00:00`).getTime() : NaN;

    if (!origin) nextErrors.from = true;
    if (!destination) nextErrors.city = true;
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
      cabin_class: form.cabin_class,
    }));
  }, [form.from, form.city, form.check_in, form.check_out, form.guests, form.cabin_class]);

  useEffect(() => {
    let cancelled = false;
    setDestinationsLoading(true);
    hotelsApi.popularDestinations({ limit: 5 })
      .then(res => {
        if (!cancelled) setPopularDestinations(res.data.destinations || []);
      })
      .catch(() => {
        if (!cancelled) setPopularDestinations([]);
      })
      .finally(() => {
        if (!cancelled) setDestinationsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    if (!validateSearch()) return;

    const origin = cleanPlace(form.from);
    const destination = cleanPlace(form.city);
    if (tab === 1) {
      navigate(`/flights?from=${encodeURIComponent(origin)}&to=${encodeURIComponent(destination)}&departure_date=${form.check_in}&check_in=${form.check_in}&check_out=${form.check_out}&passengers=${form.guests}&cabin_class=${form.cabin_class}`);
      return;
    }
    navigate(`/results?from=${encodeURIComponent(origin)}&city=${encodeURIComponent(destination)}&to=${encodeURIComponent(destination)}&check_in=${form.check_in}&check_out=${form.check_out}&guests=${form.guests}`);
  };

  const guestOptions = [1,2,3,4,5,6].map(n => ({
    value: String(n),
    label: `${n} ${lang === 'ru' ? (n === 1 ? 'взрослый' : 'взрослых') : (n === 1 ? 'adult' : 'adults')}`
  }));

  const destinationForCalendar = cleanPlace(form.city);
  const showPriceCalendar = Boolean(destinationForCalendar) && (tab === 0 || tab === 1 || tab === 2);

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
            <div className={styles.trustItem}><strong>94%</strong><span>{t('home_trust_accuracy')}</span></div>
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
                  onClick={() => navigate(`/results?city=${encodeURIComponent(destination.city)}&check_in=${form.check_in}&check_out=${form.check_out}&guests=${form.guests}`)}
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
                {tab_label}
              </button>
            ))}
          </div>

          <form onSubmit={handleSearch} className={styles.form}>
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
            {tab === 1 && (
              <div className={styles.field}>
                <label className={styles.label}>{t('flight_class')}</label>
                <select className={`${styles.input} ${errors.cabin_class ? styles.inputError : ''}`} value={form.cabin_class} onChange={e => setForm(p => ({ ...p, cabin_class: e.target.value }))}>
                  <option value="economy">{t('flight_class_economy')}</option>
                  <option value="business">{t('flight_class_business')}</option>
                </select>
              </div>
            )}
            <button type="submit" className={styles.searchBtn}>
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
