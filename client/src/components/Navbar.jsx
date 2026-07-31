import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { SlidersHorizontal, GitCompare, LogOut, Map } from 'lucide-react';
import { useLang } from '../i18n/LanguageContext';
import styles from './Navbar.module.css';
import { validFutureDates } from '../utils/dates';
import LanguageSelect from './LanguageSelect';

function readStoredTrip() {
  try {
    return JSON.parse(window.sessionStorage.getItem('fairworth_trip') || '{}');
  } catch {
    return {};
  }
}

function readStoredDates() {
  try {
    return JSON.parse(window.sessionStorage.getItem('fairworth_dates') || '{}');
  } catch {
    return {};
  }
}

export default function Navbar({ compareCount, user, onLogout }) {
  const location = useLocation();
  const { lang, t, l } = useLang();
  const storedTrip = readStoredTrip();
  const storedDates = readStoredDates();
  const dates = validFutureDates({ check_in: storedTrip.check_in || storedDates.check_in, check_out: storedTrip.check_out || storedDates.check_out });
  const from = storedTrip.from || 'Moscow';
  const to = storedTrip.to || 'Singapore';
  const checkIn = dates.check_in;
  const checkOut = dates.check_out;
  const guests = storedTrip.guests || '2';
  const cabinClass = storedTrip.cabin_class || 'business';
  const hotelsLink = `/results?from=${encodeURIComponent(from)}&city=${encodeURIComponent(to)}&to=${encodeURIComponent(to)}&check_in=${checkIn}&check_out=${checkOut}&guests=${guests}`;
  const flightsLink = `/flights?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&departure_date=${checkIn}&check_in=${checkIn}&check_out=${checkOut}&passengers=${guests}&cabin_class=${cabinClass}`;

  return (
    <nav className={styles.nav}>
      <div className={styles.inner}>
        <Link to="/" className={styles.logo}>Tripalora</Link>

        <div className={styles.links}>
          <Link to={hotelsLink} className={`${styles.link} ${location.pathname === '/results' ? styles.active : ''}`}>
            {t('nav_hotels')}
          </Link>
          <Link to={flightsLink} className={`${styles.link} ${location.pathname === '/flights' ? styles.active : ''}`}>
            {t('nav_flights')}
          </Link>
          <Link to="/insights" className={`${styles.link} ${location.pathname === '/insights' ? styles.active : ''}`}>
            {t('nav_insights')}
          </Link>
          {user && <Link to="/achievements" className={`${styles.link} ${location.pathname === '/achievements' ? styles.active : ''}`}>
            <Map size={14} />
            {t('nav_achievements')}
          </Link>}
        </div>

        <div className={styles.actions}>
          {compareCount > 0 && (
            <Link to="/compare" className={styles.compareBtn}>
              <GitCompare size={15} />
              {t('nav_compare')}
              <span className={styles.badge}>{compareCount}</span>
            </Link>
          )}

          <Link to="/preferences" className={styles.prefsBtn}>
            <SlidersHorizontal size={15} />
            {t('nav_preferences')}
          </Link>
          {user?.role === 'admin' && <Link to="/admin" className={styles.prefsBtn}>{l('Admin', 'Администрирование')}</Link>}

          <LanguageSelect compact />

          {user ? (
            <div className={styles.userBlock}>
              <div className={styles.userAvatar}>
                {user.name?.[0]?.toUpperCase() || '?'}
              </div>
              <span className={styles.userName}>{user.name}</span>
              <button className={styles.logoutBtn} onClick={onLogout} title={t('nav_logout')}>
                <LogOut size={14} />
              </button>
            </div>
          ) : (
            <Link to="/register" className={styles.loginBtn}>{t('nav_login')}</Link>
          )}
        </div>
      </div>
    </nav>
  );
}
