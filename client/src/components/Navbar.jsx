import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  BarChart3,
  BedDouble,
  GitCompare,
  LogOut,
  Map,
  Menu,
  Plane,
  Route,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
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

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!mobileMenuOpen) return undefined;
    const closeOnEscape = event => {
      if (event.key === 'Escape') setMobileMenuOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [mobileMenuOpen]);

  const mobileNav = [
    { to: hotelsLink, path: '/results', label: t('nav_hotels'), icon: BedDouble },
    { to: flightsLink, path: '/flights', label: t('nav_flights'), icon: Plane },
    { to: '/ai', path: '/ai', label: t('nav_ai_mode'), icon: Sparkles, auth: true },
    { to: '/insights', path: '/insights', label: t('nav_insights'), icon: BarChart3 },
    { to: '/achievements', path: '/achievements', label: t('nav_achievements'), icon: Map, auth: true },
  ];

  return (
    <header className={styles.nav}>
      <div className={styles.inner}>
        <Link to="/" className={styles.logo} aria-label={l('Tripalora home', 'Tripalora — главная')}>
          <span className={styles.logoMark}><Route size={16} aria-hidden="true" /></span>
          <span>Tripalora</span>
        </Link>

        <nav className={styles.links} aria-label={l('Primary navigation', 'Основная навигация')}>
          <Link to="/" className={`${styles.link} ${location.pathname === '/' ? styles.active : ''}`}>
            {l('Plan a trip', 'Спланировать')}
          </Link>
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
        </nav>

        <div className={styles.actions}>
          {user && <Link to="/ai" className={`${styles.aiModeBtn} ${location.pathname === '/ai' ? styles.aiModeActive : ''}`}>
            <Sparkles size={15} />
            {t('nav_ai_mode')}
          </Link>}
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
          <button
            type="button"
            className={styles.mobileMenuButton}
            aria-label={mobileMenuOpen ? l('Close menu', 'Закрыть меню') : l('Open menu', 'Открыть меню')}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-account-menu"
            onClick={() => setMobileMenuOpen(open => !open)}
          >
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {mobileMenuOpen && (
        <>
          <button
            type="button"
            className={styles.mobileBackdrop}
            aria-label={l('Close menu', 'Закрыть меню')}
            onClick={() => setMobileMenuOpen(false)}
          />
          <div id="mobile-account-menu" className={styles.mobileMenu}>
            {user && (
              <div className={styles.mobileUser}>
                <div className={styles.userAvatar}>{user.name?.[0]?.toUpperCase() || '?'}</div>
                <div>
                  <strong>{user.name}</strong>
                  <span>{user.email}</span>
                </div>
              </div>
            )}
            <Link to="/preferences" className={styles.mobileMenuItem}>
              <SlidersHorizontal size={18} /> {t('nav_preferences')}
            </Link>
            {compareCount > 0 && (
              <Link to="/compare" className={styles.mobileMenuItem}>
                <GitCompare size={18} /> {t('nav_compare')}
                <span className={styles.mobileCount}>{compareCount}</span>
              </Link>
            )}
            {user ? (
              <button type="button" className={`${styles.mobileMenuItem} ${styles.mobileLogout}`} onClick={onLogout}>
                <LogOut size={18} /> {t('nav_logout')}
              </button>
            ) : (
              <Link to="/register" className={styles.mobileMenuItem}>{t('nav_login')}</Link>
            )}
          </div>
        </>
      )}

      <nav className={styles.mobileBottomNav} aria-label={l('Primary navigation', 'Основная навигация')}>
        {mobileNav.filter(item => !item.auth || user).map(item => {
          const Icon = item.icon;
          const active = location.pathname === item.path;
          return (
            <Link key={item.path} to={item.to} className={`${styles.mobileNavItem} ${active ? styles.mobileNavActive : ''}`}>
              <Icon size={19} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
