/**
 * PopularDestinations — блок "Куда полететь" для главной страницы
 *
 * Использование:
 *   <PopularDestinations origin="MOW" currency="USD" onSelect={({destination}) => ...} />
 */

import React, { useState, useEffect } from 'react';
import { getPopularDestinations } from '../api/flights';
import { useLang } from '../i18n/LanguageContext';
import { formatAmount } from '../utils/money';

const CITY_IMAGES = {
  SIN: '🇸🇬', BKK: '🇹🇭', DXB: '🇦🇪', HKT: '🇹🇭', BAL: '🇮🇩',
  NRT: '🇯🇵', ICN: '🇰🇷', HKG: '🇭🇰', MLE: '🇲🇻', IST: '🇹🇷',
  CDG: '🇫🇷', LHR: '🇬🇧', FCO: '🇮🇹', BCN: '🇪🇸', AMS: '🇳🇱',
  JFK: '🇺🇸', LAX: '🇺🇸', MIA: '🇺🇸', DOH: '🇶🇦', SYD: '🇦🇺',
};

const styles = {
  wrap:     { marginBottom: '32px' },
  title:    { fontSize: '18px', fontWeight: 700, color: 'var(--navy)', marginBottom: '16px' },
  grid:     { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '10px' },
  card:     { background: '#fff', border: '1.5px solid var(--border)', borderRadius: '12px', padding: '14px', cursor: 'pointer', transition: 'all 0.15s', textAlign: 'left' },
  flag:     { fontSize: '28px', marginBottom: '8px', display: 'block' },
  cityName: { fontSize: '14px', fontWeight: 600, color: 'var(--navy)', marginBottom: '4px' },
  price:    { fontSize: '13px', color: 'var(--text-secondary)' },
  airline:  { fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' },
  skeleton: { background: 'linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)', height: '90px', borderRadius: '12px', backgroundSize: '200% 100%', animation: 'shimmer 1.2s infinite' },
  error:    { color: 'var(--red)', fontSize: '13px', padding: '12px', background: 'var(--red-bg)', borderRadius: '8px' },
};

export default function PopularDestinations({ origin = 'MOW', currency = 'USD', onSelect }) {
  const { lang , l} = useLang();
  const [destinations, setDestinations] = useState([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getPopularDestinations({ origin, currency })
      .then(r => { if (!cancelled) setDestinations(r.data || []); })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [origin, currency]);

  const sym = { USD: '$', EUR: '€', RUB: '₽' }[currency] || currency;

  return (
    <div style={styles.wrap}>
      <h3 style={styles.title}>{l('Where to fly from', 'Куда полететь из')} {origin}</h3>

      {error && <div style={styles.error}>⚠️ {error}</div>}

      <div style={styles.grid}>
        {loading
          ? Array.from({ length: 8 }).map((_, i) => (
              <div key={i} style={styles.skeleton} />
            ))
          : destinations.slice(0, 12).map((d) => {
              const cityName = d.city_info?.name || d.destination;
              const flag     = CITY_IMAGES[d.destination] || '✈️';
              return (
                <button
                  key={d.destination}
                  style={styles.card}
                  onClick={() => onSelect?.(d)}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--navy)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = ''; }}
                >
                  <span style={styles.flag}>{flag}</span>
                  <div style={styles.cityName}>{cityName}</div>
                  <div style={styles.price}>{l('from', 'от')} {sym}{formatAmount(d.price, lang)}</div>
                  <div style={styles.airline}>{d.airline} · {d.destination}</div>
                </button>
              );
            })
        }
      </div>
    </div>
  );
}
