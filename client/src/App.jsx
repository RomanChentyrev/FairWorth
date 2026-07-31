import React, { Suspense, useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import HomePage from './pages/HomePage';
import ResultsPage from './pages/ResultsPage';
import FlightsPage from './pages/FlightsPage';
import InsightsPage from './pages/InsightsPage';
import HotelDetailPage from './pages/HotelDetailPage';
import ComparePage from './pages/ComparePage';
import PreferencesPage from './pages/PreferencesPage';
import RegisterPage from './pages/RegisterPage';
import LoginPage from './pages/LoginPage';
import TripBasket from './components/TripBasket';
import ApiStatusBanner from './components/ApiStatusBanner';
import NotFoundPage from './pages/NotFoundPage';
import LegalPage from './pages/LegalPage';
import BookingReturnPage from './pages/BookingReturnPage';
import DemoBookingPage from './pages/DemoBookingPage';
import { VerifyEmailPage, ForgotPasswordPage, ResetPasswordPage } from './pages/AuthActionPage';
import AdminPage from './pages/AdminPage';
import UnsubscribePage from './pages/UnsubscribePage';
import { authApi, interactionsApi } from './api';
import { useLang } from './i18n/LanguageContext';

const AchievementsPage = React.lazy(() => import('./pages/AchievementsPage'));

function RequireAuth({ user, children }) {
  if (!user) return <Navigate to="/register" replace />;
  return children;
}

function RequireOnboarding({ user, children }) {
  if (!user?.onboarding_completed) return <Navigate to="/preferences?onboarding=1" replace />;
  return children;
}
function RequireVerified({ user, children }) {
  if (!user?.email_verified) return <Navigate to="/verify-email" replace />;
  return children;
}
function RequireAdmin({ user, children }) {
  if (user?.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const { lang , l} = useLang();
  const [compareList, setCompareList] = useState([]);
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('fw_user')); } catch { return null; }
  });

  useEffect(() => {
    authApi.me().then(res => {
      localStorage.setItem('fw_user', JSON.stringify(res.data.user));
      setUser(res.data.user);
    }).catch(() => {
      localStorage.removeItem('fw_user');
      setUser(null);
    });
  }, []);

  useEffect(() => {
    const expire = () => {
      localStorage.removeItem('fw_user');
      setUser(null);
    };
    window.addEventListener('fairworth-auth-expired', expire);
    return () => window.removeEventListener('fairworth-auth-expired', expire);
  }, []);

  const handleLogin = (u) => {
    setCompareList([]);
    window.sessionStorage.removeItem('fairworth_interaction_session');
    window.dispatchEvent(new Event('fairworth-user-changed'));
    setUser(u);
  };
  const handleUserUpdate = (updatedUser) => {
    localStorage.setItem('fw_user', JSON.stringify(updatedUser));
    setUser(updatedUser);
  };
  const handleLogout = async () => {
    try { await authApi.logout(); } catch {}
    localStorage.removeItem('fw_user');
    window.sessionStorage.removeItem('fairworth_interaction_session');
    window.sessionStorage.removeItem('fairworth_dates');
    window.sessionStorage.removeItem('fairworth_trip');
    window.dispatchEvent(new Event('fairworth-user-changed'));
    setCompareList([]);
    setUser(null);
  };

  const toggleCompare = (hotel) => {
    const exists = compareList.some(item => item.id === hotel.id);
    if (!exists && compareList.length >= 3) return;
    interactionsApi.track(exists ? 'compare_remove' : 'compare_add', {
      hotel_id: hotel.id,
    }).catch(() => {});
    setCompareList(prev => exists
      ? prev.filter(item => item.id !== hotel.id)
      : [...prev, hotel]);
  };
  const isInCompare = (id) => compareList.some(h => h.id === id);

  return (
    <><a className="skip-link" href="#app-content">{l('Skip to content', 'К содержанию')}</a><div id="app-content" tabIndex="-1"><Routes>
      <Route path="/register" element={<RegisterPage onLogin={handleLogin} />} />
      <Route path="/login" element={<LoginPage onLogin={handleLogin} />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/unsubscribe" element={<UnsubscribePage />} />
      <Route path="/legal/:type" element={<><ApiStatusBanner /><LegalPage /></>} />
      <Route path="*" element={
        <>
          <Navbar compareCount={compareList.length} user={user} onLogout={handleLogout} />
          <ApiStatusBanner />
          {user && <TripBasket />}
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/results" element={
              <RequireAuth user={user}>
                <RequireVerified user={user}><RequireOnboarding user={user}><ResultsPage compareList={compareList} toggleCompare={toggleCompare} isInCompare={isInCompare} /></RequireOnboarding></RequireVerified>
              </RequireAuth>
            } />
            <Route path="/flights" element={
              <RequireAuth user={user}>
                <RequireVerified user={user}><RequireOnboarding user={user}><FlightsPage /></RequireOnboarding></RequireVerified>
              </RequireAuth>
            } />
            <Route path="/transfers" element={<Navigate to="/" replace />} />
            <Route path="/insights" element={
              <RequireAuth user={user}>
                <InsightsPage />
              </RequireAuth>
            } />
            <Route path="/achievements" element={
              <RequireAuth user={user}>
                <Suspense fallback={<main className="system-page"><p>{l('Loading your map...', 'Загружаем карту...')}</p></main>}>
                  <AchievementsPage />
                </Suspense>
              </RequireAuth>
            } />
            <Route path="/hotel/:id" element={
              <RequireAuth user={user}>
                <RequireVerified user={user}><RequireOnboarding user={user}><HotelDetailPage compareList={compareList} toggleCompare={toggleCompare} isInCompare={isInCompare} /></RequireOnboarding></RequireVerified>
              </RequireAuth>
            } />
            <Route path="/compare" element={
              <RequireAuth user={user}>
                <RequireVerified user={user}><RequireOnboarding user={user}><ComparePage compareList={compareList} setCompareList={setCompareList} /></RequireOnboarding></RequireVerified>
              </RequireAuth>
            } />
            <Route path="/preferences" element={
              <RequireAuth user={user}>
                <PreferencesPage user={user} onUserUpdate={handleUserUpdate} />
              </RequireAuth>
            } />
            <Route path="/booking/return" element={<RequireAuth user={user}><BookingReturnPage /></RequireAuth>} />
            <Route path="/booking/demo" element={<RequireAuth user={user}><RequireVerified user={user}><RequireOnboarding user={user}><DemoBookingPage /></RequireOnboarding></RequireVerified></RequireAuth>} />
            <Route path="/admin" element={<RequireAuth user={user}><RequireAdmin user={user}><AdminPage /></RequireAdmin></RequireAuth>} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </>
      } />
    </Routes></div></>
  );
}
