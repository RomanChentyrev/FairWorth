import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ComposableMap, Geographies, Geography, Marker, Sphere, ZoomableGroup } from 'react-simple-maps';
import { ArrowRight, Check, Compass, Globe2, MapPin, Plus, Search, Trash2, Trophy, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import worldMap from 'world-atlas/countries-110m.json';
import { achievementsApi } from '../api';
import { useLang } from '../i18n/LanguageContext';
import styles from './AchievementsPage.module.css';
import { defaultTravelDates } from '../utils/dates';

function normalized(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function flag(code) {
  return String(code || '').toUpperCase().replace(/./g, char => String.fromCodePoint(127397 + char.charCodeAt(0)));
}

export default function AchievementsPage() {
  const { lang , l} = useLang();
  const navigate = useNavigate();
  const [visits, setVisits] = useState([]);
  const [cities, setCities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [activeVisit, setActiveVisit] = useState(null);
  const [position, setPosition] = useState({ coordinates: [0, 14], zoom: 1 });
  const [compactMap, setCompactMap] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const searchRef = useRef(null);

  useEffect(() => {
    achievementsApi.get()
      .then(response => setVisits(response.data.visits || []))
      .catch(() => setError(l('We could not load your map.', 'Не удалось загрузить вашу карту.')))
      .finally(() => setLoading(false));
  }, [lang]);

  useEffect(() => {
    fetch('/data/world-cities.json')
      .then(response => {
        if (!response.ok) throw new Error('City index unavailable');
        return response.json();
      })
      .then(items => setCities(items.map(city => ({
        type: 'city', key: `city-${city.i}`, city: city.n, admin: city.a, country: city.c,
        countryCode: city.cc, longitude: city.x, latitude: city.y, population: city.p,
      }))))
      .catch(() => setError(l('The city directory is temporarily unavailable.', 'Справочник городов временно недоступен.')));
  }, [lang]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const update = event => setCompactMap(event.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const results = useMemo(() => {
    const needle = normalized(query);
    if (needle.length < 2) return [];
    return cities
      .filter(item => normalized(`${item.city} ${item.admin} ${item.country}`).includes(needle))
      .slice(0, 8);
  }, [query, cities]);

  const cityVisits = useMemo(
    () => visits.filter(visit => visit.city_name && visit.latitude != null && visit.longitude != null),
    [visits],
  );
  const stats = useMemo(() => ({
    countries: new Set(cityVisits.map(visit => visit.country_code)).size,
    cities: cityVisits.length,
  }), [cityVisits]);
  const nextMilestone = stats.cities < 5 ? 5 : Math.ceil((stats.cities + 1) / 5) * 5;
  const milestoneProgress = Math.min(100, Math.round((stats.cities / nextMilestone) * 100));
  const badges = [
    { key: 'first', icon: MapPin, unlocked: stats.cities >= 1, label: l('First pin', 'Первая отметка') },
    { key: 'countries', icon: Compass, unlocked: stats.countries >= 3, label: l('Border crosser', 'Через границы') },
    { key: 'cities', icon: Trophy, unlocked: stats.cities >= 10, label: l('City collector', 'Коллекционер городов') },
  ];

  const choosePlace = place => {
    setSelected(place);
    setQuery(`${place.city}, ${place.country}`);
    setError('');
    setPosition({ coordinates: [place.longitude, place.latitude], zoom: 3 });
  };

  const addVisit = async () => {
    if (!selected || saving) return;
    setSaving(true);
    setError('');
    try {
      const response = await achievementsApi.addVisit({
        country_code: selected.countryCode,
        country_name: selected.country,
        city_name: selected.city,
        latitude: selected.latitude,
        longitude: selected.longitude,
      });
      setVisits(current => [...current, response.data.visit]);
      setSelected(null);
      setQuery('');
    } catch (requestError) {
      setError(requestError.response?.status === 409
        ? (l('This place is already on your map.', 'Это место уже отмечено на вашей карте.'))
        : (l('We could not save this place.', 'Не удалось сохранить место.')));
    } finally { setSaving(false); }
  };

  const removeVisit = async visit => {
    try {
      await achievementsApi.removeVisit(visit.id);
      setVisits(current => current.filter(item => item.id !== visit.id));
      setActiveVisit(null);
    } catch {
      setError(l('We could not remove this place.', 'Не удалось удалить место.'));
    }
  };

  const resetMap = () => setPosition({ coordinates: [0, 14], zoom: 1 });
  const markerScale = compactMap ? 1.8 : 1;
  const exploreHotels = visit => {
    const dates = defaultTravelDates();
    navigate(`/results?city=${encodeURIComponent(visit.city_name)}&check_in=${dates.check_in}&check_out=${dates.check_out}&guests=2&trip_purpose=leisure`);
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}><Globe2 size={14} /> {l('Your travel story', 'Ваша история путешествий')}</span>
          <h1>{l('Achievements', 'Достижения')}</h1>
          <p>{l('Pin the cities you have already explored.', 'Отмечайте города, в которых вы уже побывали.')}</p>
        </div>
        <div className={styles.stats} aria-label={l('Travel statistics', 'Статистика путешествий')}>
          <div><strong>{stats.countries}</strong><span>{l('countries', 'стран')}</span></div>
          <div><strong>{stats.cities}</strong><span>{l('cities', 'городов')}</span></div>
          <div className={styles.milestoneStat}>
            <strong>{nextMilestone}</strong><span>{l('next milestone', 'следующая цель')}</span>
          </div>
        </div>
      </header>

      <section className={styles.progressBand} aria-label={l('Travel progress', 'Прогресс путешествий')}>
        <div className={styles.progressCopy}>
          <span><Trophy size={16} /> {l('Your next travel milestone', 'Следующая цель путешествий')}</span>
          <strong>{stats.cities} / {nextMilestone} {l('cities pinned', 'городов отмечено')}</strong>
        </div>
        <div className={styles.progressTrack} aria-valuemin="0" aria-valuemax={nextMilestone} aria-valuenow={stats.cities} role="progressbar">
          <span style={{ width: `${milestoneProgress}%` }} />
        </div>
        <div className={styles.badges}>
          {badges.map(({ key, icon: Icon, unlocked, label }) => (
            <span key={key} className={`${styles.achievementBadge} ${unlocked ? styles.badgeUnlocked : ''}`} title={label}>
              <Icon size={15} /> <span>{label}</span>
            </span>
          ))}
        </div>
      </section>

      <section className={styles.workspace}>
        <aside className={styles.sidebar}>
          <div className={styles.searchBlock}>
            <label htmlFor="achievement-place">{l('Add a city', 'Добавить город')}</label>
            <div className={styles.searchInput}>
              <Search size={17} />
              <input
                ref={searchRef}
                id="achievement-place"
                value={query}
                onChange={event => { setQuery(event.target.value); setSelected(null); }}
                placeholder={l('Try Paris', 'Например, Paris')}
                autoComplete="off"
              />
              {query && <button type="button" onClick={() => { setQuery(''); setSelected(null); searchRef.current?.focus(); }} aria-label={l('Clear', 'Очистить')}><X size={15} /></button>}
            </div>
            {query.length >= 2 && !selected && (
              <div className={styles.results} role="listbox">
                {results.map(place => (
                  <button key={place.key} type="button" role="option" onClick={() => choosePlace(place)}>
                    <span className={styles.flag}>{flag(place.countryCode)}</span>
                    <span><strong>{place.city}</strong><small>{[place.admin, place.country].filter(Boolean).join(', ')}</small></span>
                    <Plus size={15} />
                  </button>
                ))}
                {!results.length && <p>{l('No places found', 'Ничего не найдено')}</p>}
              </div>
            )}
            {selected && (
              <button className={styles.addButton} type="button" onClick={addVisit} disabled={saving}>
                {saving ? (l('Saving...', 'Сохраняем...')) : <><Check size={17} /> {l('Mark as visited', 'Отметить как посещённое')}</>}
              </button>
            )}
            {error && <p className={styles.error} role="alert">{error}</p>}
          </div>

          <div className={styles.visitedHeader}>
            <h2>{l('Visited cities', 'Посещённые города')}</h2>
            <span>{cityVisits.length}</span>
          </div>
          <div className={styles.visitList}>
            {loading && <p className={styles.empty}>{l('Loading your map...', 'Загружаем карту...')}</p>}
            {!loading && !cityVisits.length && <p className={styles.empty}>{l('Start with your first city.', 'Добавьте свой первый город.')}</p>}
            {cityVisits.map(visit => (
              <button key={visit.id} type="button" className={`${styles.visitItem} ${activeVisit?.id === visit.id ? styles.visitActive : ''}`} onClick={() => {
                setActiveVisit(visit);
                setPosition({ coordinates: [visit.longitude, visit.latitude], zoom: 4 });
              }}>
                <span className={styles.flag}>{flag(visit.country_code)}</span>
                <span><strong>{visit.city_name}</strong><small>{visit.country_name}</small></span>
                <MapPin size={15} />
              </button>
            ))}
          </div>
        </aside>

        <div className={styles.mapPanel}>
          <div className={styles.mapToolbar}>
            <button type="button" onClick={() => setPosition(current => ({ ...current, zoom: Math.min(6, current.zoom * 1.5) }))} title={l('Zoom in', 'Приблизить')}><ZoomIn size={18} /></button>
            <button type="button" onClick={() => setPosition(current => ({ ...current, zoom: Math.max(1, current.zoom / 1.5) }))} title={l('Zoom out', 'Отдалить')}><ZoomOut size={18} /></button>
            <button type="button" onClick={resetMap}>{l('World view', 'Весь мир')}</button>
          </div>
          <ComposableMap projection="geoMercator" projectionConfig={{ center: [0, 12], scale: 128 }} className={styles.map} aria-label={l('Map of visited places', 'Карта посещённых мест')}>
            <ZoomableGroup center={position.coordinates} zoom={position.zoom} onMoveEnd={setPosition} minZoom={1} maxZoom={6}>
              <Sphere id="tripalora-world-sphere" className={styles.sphere} />
              <Geographies geography={worldMap}>
                {({ geographies }) => geographies
                  .filter(geography => geography.properties?.name !== 'Antarctica')
                  .map((geography, index) => (
                    <Geography
                      key={geography.rsmKey}
                      geography={geography}
                      tabIndex={-1}
                      className={`${styles.country} ${styles[`countryTone${index % 5}`]}`}
                    />
                  ))}
              </Geographies>
              {cityVisits.map(visit => (
                <Marker key={visit.id} coordinates={[visit.longitude, visit.latitude]} onClick={() => setActiveVisit(visit)}>
                  <g
                    className={`${styles.marker} ${activeVisit?.id === visit.id ? styles.markerActive : ''}`}
                    role="button"
                    tabIndex="0"
                    aria-label={`${visit.city_name}, ${visit.country_name}`}
                    onKeyDown={event => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setActiveVisit(visit);
                      }
                    }}
                  >
                    <circle className={styles.markerHitArea} r={(10 * markerScale) / position.zoom} />
                    <circle className={styles.markerShadow} cx={(1.3 * markerScale) / position.zoom} cy={(1.8 * markerScale) / position.zoom} r={(6.2 * markerScale) / position.zoom} />
                    <circle className={styles.markerRim} r={(6.2 * markerScale) / position.zoom} />
                    <circle className={styles.markerHead} r={(4.7 * markerScale) / position.zoom} />
                    <circle className={styles.markerHighlight} cx={(-1.5 * markerScale) / position.zoom} cy={(-1.5 * markerScale) / position.zoom} r={(1.25 * markerScale) / position.zoom} />
                  </g>
                </Marker>
              ))}
            </ZoomableGroup>
          </ComposableMap>
          <div className={styles.legend}><i />{l('Visited city', 'Посещённый город')}</div>
          {activeVisit && (
            <div className={styles.mapPopup}>
              <button type="button" className={styles.popupClose} onClick={() => setActiveVisit(null)} aria-label={l('Close', 'Закрыть')}><X size={15} /></button>
              <span className={styles.popupFlag}>{flag(activeVisit.country_code)}</span>
              <div><strong>{activeVisit.city_name}</strong><small>{activeVisit.country_name}</small></div>
              <button type="button" className={styles.exploreButton} onClick={() => exploreHotels(activeVisit)}>
                {l('Hotels', 'Отели')} <ArrowRight size={15} />
              </button>
              <button type="button" className={styles.deleteButton} onClick={() => removeVisit(activeVisit)} title={l('Remove visit', 'Удалить отметку')}><Trash2 size={16} /></button>
            </div>
          )}
          <p className={styles.attribution}>City data: SimpleMaps, CC BY 4.0</p>
        </div>
      </section>
    </main>
  );
}
