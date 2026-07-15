import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ComposableMap, Geographies, Geography, Marker, ZoomableGroup } from 'react-simple-maps';
import { Check, Globe2, MapPin, Plus, Search, Trash2, X, ZoomIn, ZoomOut } from 'lucide-react';
import worldMap from 'world-atlas/countries-110m.json';
import { achievementsApi } from '../api';
import { useLang } from '../i18n/LanguageContext';
import styles from './AchievementsPage.module.css';

const COUNTRY_ALIASES = {
  'United States of America': 'United States',
  'Russian Federation': 'Russia',
  'Czechia': 'Czech Republic',
  'Republic of Serbia': 'Serbia',
  'The Bahamas': 'Bahamas',
  'Dem. Rep. Congo': 'Congo (Kinshasa)',
  'Republic of the Congo': 'Congo (Brazzaville)',
  'Dominican Rep.': 'Dominican Republic',
  'Bosnia and Herz.': 'Bosnia and Herzegovina',
  'Central African Rep.': 'Central African Republic',
  'Eq. Guinea': 'Equatorial Guinea',
  'S. Sudan': 'South Sudan',
};

function normalized(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function flag(code) {
  return String(code || '').toUpperCase().replace(/./g, char => String.fromCodePoint(127397 + char.charCodeAt(0)));
}

function geographyCountryName(geography) {
  const name = geography.properties?.name || '';
  return COUNTRY_ALIASES[name] || name;
}

export default function AchievementsPage() {
  const { lang } = useLang();
  const ru = lang === 'ru';
  const [visits, setVisits] = useState([]);
  const [cities, setCities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [activeVisit, setActiveVisit] = useState(null);
  const [position, setPosition] = useState({ coordinates: [0, 14], zoom: 1 });
  const searchRef = useRef(null);

  useEffect(() => {
    achievementsApi.get()
      .then(response => setVisits(response.data.visits || []))
      .catch(() => setError(ru ? 'Не удалось загрузить вашу карту.' : 'We could not load your map.'))
      .finally(() => setLoading(false));
  }, [ru]);

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
      .catch(() => setError(ru ? 'Справочник городов временно недоступен.' : 'The city directory is temporarily unavailable.'));
  }, [ru]);

  const countries = useMemo(() => Array.from(new Map(cities.map(city => [city.countryCode, {
    type: 'country', key: `country-${city.countryCode}`, country: city.country, countryCode: city.countryCode,
  }])).values()).sort((a, b) => a.country.localeCompare(b.country)), [cities]);

  const results = useMemo(() => {
    const needle = normalized(query);
    if (needle.length < 2) return [];
    const countryMatches = countries.filter(item => normalized(item.country).includes(needle)).slice(0, 3);
    const cityMatches = cities.filter(item => normalized(`${item.city} ${item.admin} ${item.country}`).includes(needle)).slice(0, 7);
    return [...countryMatches, ...cityMatches].slice(0, 8);
  }, [query, cities, countries]);

  const visitedCountries = useMemo(() => new Set(visits.map(visit => normalized(visit.country_name))), [visits]);
  const cityVisits = useMemo(() => visits.filter(visit => visit.city_name), [visits]);
  const stats = useMemo(() => ({ countries: new Set(visits.map(visit => visit.country_code)).size, cities: cityVisits.length }), [visits, cityVisits]);

  const choosePlace = place => {
    setSelected(place);
    setQuery(place.type === 'city' ? `${place.city}, ${place.country}` : place.country);
    setError('');
    if (place.type === 'city') setPosition({ coordinates: [place.longitude, place.latitude], zoom: 3 });
  };

  const addVisit = async () => {
    if (!selected || saving) return;
    setSaving(true);
    setError('');
    try {
      const response = await achievementsApi.addVisit({
        country_code: selected.countryCode,
        country_name: selected.country,
        city_name: selected.type === 'city' ? selected.city : null,
        latitude: selected.type === 'city' ? selected.latitude : null,
        longitude: selected.type === 'city' ? selected.longitude : null,
      });
      setVisits(current => [...current, response.data.visit]);
      setSelected(null);
      setQuery('');
    } catch (requestError) {
      setError(requestError.response?.status === 409
        ? (ru ? 'Это место уже отмечено на вашей карте.' : 'This place is already on your map.')
        : (ru ? 'Не удалось сохранить место.' : 'We could not save this place.'));
    } finally { setSaving(false); }
  };

  const removeVisit = async visit => {
    try {
      await achievementsApi.removeVisit(visit.id);
      setVisits(current => current.filter(item => item.id !== visit.id));
      setActiveVisit(null);
    } catch {
      setError(ru ? 'Не удалось удалить место.' : 'We could not remove this place.');
    }
  };

  const resetMap = () => setPosition({ coordinates: [0, 14], zoom: 1 });

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}><Globe2 size={14} /> {ru ? 'Ваша история путешествий' : 'Your travel story'}</span>
          <h1>{ru ? 'Достижения' : 'Achievements'}</h1>
          <p>{ru ? 'Отмечайте страны и города, в которых вы уже побывали.' : 'Mark the countries and cities you have already explored.'}</p>
        </div>
        <div className={styles.stats} aria-label={ru ? 'Статистика путешествий' : 'Travel statistics'}>
          <div><strong>{stats.countries}</strong><span>{ru ? 'стран' : 'countries'}</span></div>
          <div><strong>{stats.cities}</strong><span>{ru ? 'городов' : 'cities'}</span></div>
        </div>
      </header>

      <section className={styles.workspace}>
        <aside className={styles.sidebar}>
          <div className={styles.searchBlock}>
            <label htmlFor="achievement-place">{ru ? 'Добавить место' : 'Add a place'}</label>
            <div className={styles.searchInput}>
              <Search size={17} />
              <input
                ref={searchRef}
                id="achievement-place"
                value={query}
                onChange={event => { setQuery(event.target.value); setSelected(null); }}
                placeholder={ru ? 'Например, Paris или France' : 'Try Paris or France'}
                autoComplete="off"
              />
              {query && <button type="button" onClick={() => { setQuery(''); setSelected(null); searchRef.current?.focus(); }} aria-label={ru ? 'Очистить' : 'Clear'}><X size={15} /></button>}
            </div>
            {query.length >= 2 && !selected && (
              <div className={styles.results} role="listbox">
                {results.map(place => (
                  <button key={place.key} type="button" role="option" onClick={() => choosePlace(place)}>
                    <span className={styles.flag}>{flag(place.countryCode)}</span>
                    <span><strong>{place.type === 'city' ? place.city : place.country}</strong><small>{place.type === 'city' ? [place.admin, place.country].filter(Boolean).join(', ') : (ru ? 'Страна' : 'Country')}</small></span>
                    <Plus size={15} />
                  </button>
                ))}
                {!results.length && <p>{ru ? 'Ничего не найдено' : 'No places found'}</p>}
              </div>
            )}
            {selected && (
              <button className={styles.addButton} type="button" onClick={addVisit} disabled={saving}>
                {saving ? (ru ? 'Сохраняем...' : 'Saving...') : <><Check size={17} /> {ru ? 'Отметить как посещённое' : 'Mark as visited'}</>}
              </button>
            )}
            {error && <p className={styles.error} role="alert">{error}</p>}
          </div>

          <div className={styles.visitedHeader}>
            <h2>{ru ? 'Посещённые места' : 'Visited places'}</h2>
            <span>{visits.length}</span>
          </div>
          <div className={styles.visitList}>
            {loading && <p className={styles.empty}>{ru ? 'Загружаем карту...' : 'Loading your map...'}</p>}
            {!loading && !visits.length && <p className={styles.empty}>{ru ? 'Начните с первой страны или города.' : 'Start with your first country or city.'}</p>}
            {visits.map(visit => (
              <button key={visit.id} type="button" className={`${styles.visitItem} ${activeVisit?.id === visit.id ? styles.visitActive : ''}`} onClick={() => {
                setActiveVisit(visit);
                if (visit.city_name) setPosition({ coordinates: [visit.longitude, visit.latitude], zoom: 4 });
              }}>
                <span className={styles.flag}>{flag(visit.country_code)}</span>
                <span><strong>{visit.city_name || visit.country_name}</strong><small>{visit.city_name ? visit.country_name : (ru ? 'Вся страна' : 'Country')}</small></span>
                <MapPin size={15} />
              </button>
            ))}
          </div>
        </aside>

        <div className={styles.mapPanel}>
          <div className={styles.mapToolbar}>
            <button type="button" onClick={() => setPosition(current => ({ ...current, zoom: Math.min(6, current.zoom * 1.5) }))} title={ru ? 'Приблизить' : 'Zoom in'}><ZoomIn size={18} /></button>
            <button type="button" onClick={() => setPosition(current => ({ ...current, zoom: Math.max(1, current.zoom / 1.5) }))} title={ru ? 'Отдалить' : 'Zoom out'}><ZoomOut size={18} /></button>
            <button type="button" onClick={resetMap}>{ru ? 'Весь мир' : 'World view'}</button>
          </div>
          <ComposableMap projection="geoMercator" projectionConfig={{ center: [0, 12], scale: 128 }} className={styles.map} aria-label={ru ? 'Карта посещённых мест' : 'Map of visited places'}>
            <ZoomableGroup center={position.coordinates} zoom={position.zoom} onMoveEnd={setPosition} minZoom={1} maxZoom={6}>
              <Geographies geography={worldMap}>
                {({ geographies }) => geographies.filter(geography => geography.properties?.name !== 'Antarctica').map(geography => {
                  const isVisited = visitedCountries.has(normalized(geographyCountryName(geography)));
                  return <Geography key={geography.rsmKey} geography={geography} tabIndex={-1} data-visited={isVisited ? 'true' : 'false'} className={isVisited ? styles.countryVisited : styles.country} />;
                })}
              </Geographies>
              {cityVisits.map(visit => (
                <Marker key={visit.id} coordinates={[visit.longitude, visit.latitude]} onClick={() => setActiveVisit(visit)}>
                  <g className={styles.marker} role="button" tabIndex="0" aria-label={`${visit.city_name}, ${visit.country_name}`}>
                    <circle r={3.5 / position.zoom} />
                    <circle className={styles.markerPulse} r={7 / position.zoom} />
                  </g>
                </Marker>
              ))}
            </ZoomableGroup>
          </ComposableMap>
          <div className={styles.legend}><span />{ru ? 'Посещённая страна' : 'Visited country'}<i />{ru ? 'Посещённый город' : 'Visited city'}</div>
          {activeVisit && (
            <div className={styles.mapPopup}>
              <button type="button" className={styles.popupClose} onClick={() => setActiveVisit(null)} aria-label={ru ? 'Закрыть' : 'Close'}><X size={15} /></button>
              <span className={styles.popupFlag}>{flag(activeVisit.country_code)}</span>
              <div><strong>{activeVisit.city_name || activeVisit.country_name}</strong><small>{activeVisit.city_name ? activeVisit.country_name : (ru ? 'Страна отмечена целиком' : 'Country marked as visited')}</small></div>
              <button type="button" className={styles.deleteButton} onClick={() => removeVisit(activeVisit)} title={ru ? 'Удалить отметку' : 'Remove visit'}><Trash2 size={16} /></button>
            </div>
          )}
          <p className={styles.attribution}>City data: SimpleMaps, CC BY 4.0</p>
        </div>
      </section>
    </main>
  );
}
