import React, { useState, useEffect } from 'react';
import { usersApi } from '../api';
import { Save, Check, Sparkles, User, Settings, Bell, Shield, Camera, MapPin, Globe, Edit2 } from 'lucide-react';
import { useLang } from '../i18n/LanguageContext';
import { useNavigate, useSearchParams } from 'react-router-dom';
import styles from './PreferencesPage.module.css';
 
function ToggleSwitch({ on, onChange }) {
  return (
    <div className={`${styles.toggle} ${on ? styles.toggleOn : ''}`} onClick={() => onChange(!on)}>
      <div className={styles.toggleKnob} />
    </div>
  );
}
 
function MultiSelect({ options, value = [], onChange }) {
  const toggle = (opt) => onChange(value.includes(opt) ? value.filter(v => v !== opt) : [...value, opt]);
  return (
    <div className={styles.chips}>
      {options.map(opt => (
        <button key={opt.value} className={`${styles.chip} ${value.includes(opt.value) ? styles.chipOn : ''}`} onClick={() => toggle(opt.value)}>
          {opt.icon && <span>{opt.icon}</span>}{opt.label}
        </button>
      ))}
    </div>
  );
}
 
function SingleSelect({ options, value, onChange }) {
  return (
    <div className={styles.chips}>
      {options.map(opt => (
        <button key={opt.value} className={`${styles.chip} ${value === opt.value ? styles.chipOn : ''}`} onClick={() => onChange(opt.value)}>
          {opt.label}
        </button>
      ))}
    </div>
  );
}
 
const DEFAULT_PREFS = {
  hotel_stars: ['5'], room_type: ['deluxe'], room_view: ['sea', 'city'],
  hotel_amenities: ['pool', 'breakfast', 'spa'], flight_type: 'direct',
  seat_class: 'business', seat_position: 'window',
  preferred_airlines: ['Singapore Airlines', 'Emirates'], max_stops: 0,
  travel_style: ['beach', 'gastronomy', 'spa'], budget_level: 'luxury',
  budget_per_night_max: 1500, noise_sensitivity: 80,
  favorite_destinations: ['Asia', 'Maldives', 'UAE'], avoid_destinations: [],
  alert_price_drop: true, alert_price_rise: true,
  alert_booking_reminder: true, alert_weekly_insights: true, alert_destination_deals: false,
};
 
function parsePrefs(raw) {
  if (!raw) return DEFAULT_PREFS;
  const parseArr = (v) => { if (!v) return []; if (Array.isArray(v)) return v; try { return JSON.parse(v); } catch { return []; } };
  return {
    hotel_stars: parseArr(raw.hotel_stars), room_type: parseArr(raw.room_type),
    room_view: parseArr(raw.room_view), hotel_amenities: parseArr(raw.hotel_amenities),
    flight_type: raw.flight_type || 'direct', seat_class: raw.seat_class || 'business',
    seat_position: raw.seat_position || 'window', preferred_airlines: parseArr(raw.preferred_airlines),
    max_stops: raw.max_stops ?? 0, travel_style: parseArr(raw.travel_style),
    budget_level: raw.budget_level || 'luxury', budget_per_night_max: raw.budget_per_night_max || 1500,
    noise_sensitivity: raw.noise_sensitivity || 80, favorite_destinations: parseArr(raw.favorite_destinations),
    avoid_destinations: parseArr(raw.avoid_destinations),
    alert_price_drop: !!raw.alert_price_drop, alert_price_rise: !!raw.alert_price_rise,
    alert_booking_reminder: !!raw.alert_booking_reminder, alert_weekly_insights: !!raw.alert_weekly_insights,
    alert_destination_deals: !!raw.alert_destination_deals,
  };
}
 
export default function PreferencesPage({ user: propUser, onUserUpdate }) {
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const onboarding = searchParams.get('onboarding') === '1';
  const [activeTab, setActiveTab] = useState(onboarding ? 'preferences' : 'personal');
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [user, setUser] = useState(propUser || null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [personalForm, setPersonalForm] = useState({ name: '', phone: '', city: '', country: '', website: '', bio: '' });
  const [trackingConsent, setTrackingConsent] = useState(false);
  const [editingPersonal, setEditingPersonal] = useState(false);
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [pwError, setPwError] = useState('');
  const [pwSaved, setPwSaved] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [profileError, setProfileError] = useState('');
  const [stats, setStats] = useState({ searches: 0, saved: 0, comparisons: 0, booking_intents: 0, member_since: null });
 
  useEffect(() => {
    const fetch = async () => {
      try {
        const res = await usersApi.getMe();
        setUser(res.data.user);
        setPersonalForm({
          name: res.data.user.name || '', phone: res.data.user.phone || '', city: res.data.user.city || '',
          country: res.data.user.country || '', website: res.data.user.website || '', bio: res.data.user.bio || '',
        });
        setTrackingConsent(Boolean(res.data.user.behavioural_tracking_consent));
        if (res.data.preferences) setPrefs(parsePrefs(res.data.preferences));
        const sessionRes = await usersApi.getSessions();
        setSessions(sessionRes.data.sessions || []);
        const statsRes = await usersApi.getStats();
        setStats(statsRes.data);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    };
    fetch();
  }, []);
 
  const set = (k, v) => setPrefs(p => ({ ...p, [k]: v }));
  const setP = (k, v) => setPersonalForm(p => ({ ...p, [k]: v }));
 
  const handleSavePrefs = async () => {
    setSaving(true); setSaved(false);
    try {
      await usersApi.updatePreferences(prefs);
      if (onboarding) {
        const result = await usersApi.completeOnboarding();
        onUserUpdate?.(result.data.user);
        navigate('/');
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }
    catch (e) { alert('Error: ' + e.message); }
    finally { setSaving(false); }
  };

  const handleSaveProfile = async () => {
    setProfileError('');
    try {
      const res = await usersApi.updateProfile({
        name: personalForm.name, phone: personalForm.phone,
        city: personalForm.city, country: personalForm.country, bio: personalForm.bio, website: personalForm.website,
      });
      setUser(res.data.user);
      onUserUpdate?.(res.data.user);
      setEditingPersonal(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) { setProfileError(e.response?.data?.error || e.message); }
  };

  const handleChangePassword = async () => {
    if (pwForm.next !== pwForm.confirm) { setPwError(t('prefs_pw_mismatch')); return; }
    if (pwForm.next.length < 12) { setPwError(t('prefs_pw_min')); return; }
    try {
      await usersApi.changePassword({ current_password: pwForm.current, new_password: pwForm.next });
      setPwError(''); setPwSaved(true); setPwForm({ current: '', next: '', confirm: '' });
      setTimeout(() => setPwSaved(false), 3000);
    } catch (e) { setPwError(e.response?.data?.error || e.message); }
  };

  const revokeSession = async (id) => {
    await usersApi.revokeSession(id);
    setSessions(current => current.filter(session => session.id !== id));
  };

  const updateTrackingConsent = async (value) => {
    setTrackingConsent(value);
    await usersApi.updateConsent(value);
  };

  const exportData = async () => {
    const response = await usersApi.exportData();
    const url = URL.createObjectURL(response.data);
    const link = document.createElement('a'); link.href = url; link.download = 'fairworth-data.json'; link.click();
    URL.revokeObjectURL(url);
  };

  const deleteAccount = async () => {
    const password = window.prompt(lang === 'ru' ? 'Введите пароль для удаления аккаунта' : 'Enter your password to delete the account');
    if (!password) return;
    try {
      await usersApi.deleteAccount(password);
      localStorage.removeItem('fw_user');
      window.location.assign('/register');
    } catch (e) { setProfileError(e.response?.data?.error || e.message); }
  };
 
  const TABS = [
    { id: 'personal', label: t('prefs_personal'), icon: User },
    { id: 'preferences', label: t('prefs_preferences'), icon: Settings },
    { id: 'notifications', label: t('prefs_notifications'), icon: Bell },
    { id: 'security', label: t('prefs_security'), icon: Shield },
  ];
 
  const initials = (user?.name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
 
  // Localised options
  const HOTEL_STARS = [
    { value: '3', label: lang === 'ru' ? '⭐ 3 звезды' : '⭐ 3 stars' },
    { value: '4', label: lang === 'ru' ? '⭐⭐ 4 звезды' : '⭐⭐ 4 stars' },
    { value: '5', label: lang === 'ru' ? '⭐⭐⭐ 5 звёзд' : '⭐⭐⭐ 5 stars' },
  ];
  const ROOM_TYPES = [
    { value: 'standard', label: lang === 'ru' ? 'Стандарт' : 'Standard' },
    { value: 'deluxe', label: 'Deluxe' },
    { value: 'suite', label: 'Suite' },
    { value: 'villa', label: 'Villa' },
  ];
  const VIEWS = [
    { value: 'sea', label: lang === 'ru' ? '🌊 Море' : '🌊 Sea' },
    { value: 'city', label: lang === 'ru' ? '🏙 Город' : '🏙 City' },
    { value: 'garden', label: lang === 'ru' ? '🌿 Сад' : '🌿 Garden' },
    { value: 'pool', label: lang === 'ru' ? '🏊 Бассейн' : '🏊 Pool' },
    { value: 'mountain', label: lang === 'ru' ? '⛰ Горы' : '⛰ Mountain' },
  ];
  const AMENITIES = [
    { value: 'pool', label: lang === 'ru' ? '🏊 Бассейн' : '🏊 Pool' },
    { value: 'breakfast', label: lang === 'ru' ? '🍳 Завтрак' : '🍳 Breakfast' },
    { value: 'spa', label: '💆 Spa' },
    { value: 'gym', label: lang === 'ru' ? '🏋️ Фитнес' : '🏋️ Gym' },
    { value: 'bar', label: lang === 'ru' ? '🍸 Бар' : '🍸 Bar' },
    { value: 'restaurant', label: lang === 'ru' ? '🍽 Ресторан' : '🍽 Restaurant' },
    { value: 'butler', label: lang === 'ru' ? '🛎 Батлер' : '🛎 Butler' },
    { value: 'wifi', label: 'Wi-Fi' },
  ];
  const FLIGHT_TYPES = [
    { value: 'direct', label: lang === 'ru' ? 'Только прямые' : 'Direct only' },
    { value: '1stop', label: lang === 'ru' ? 'До 1 пересадки' : 'Up to 1 stop' },
    { value: 'any', label: lang === 'ru' ? 'Любые' : 'Any' },
  ];
  const SEAT_CLASSES = [
    { value: 'economy', label: lang === 'ru' ? 'Эконом' : 'Economy' },
    { value: 'premium_economy', label: lang === 'ru' ? 'Премиум эконом' : 'Premium economy' },
    { value: 'business', label: lang === 'ru' ? 'Бизнес' : 'Business' },
    { value: 'first', label: lang === 'ru' ? 'Первый' : 'First' },
  ];
  const SEATS = [
    { value: 'window', label: lang === 'ru' ? '🪟 У окна' : '🪟 Window' },
    { value: 'aisle', label: lang === 'ru' ? '🚶 У прохода' : '🚶 Aisle' },
    { value: 'middle', label: lang === 'ru' ? '🪑 Средний' : '🪑 Middle' },
  ];
  const AIRLINES = [
    { value: 'Singapore Airlines', label: 'Singapore Airlines' },
    { value: 'Emirates', label: 'Emirates' },
    { value: 'Lufthansa', label: 'Lufthansa' },
    { value: 'Qatar Airways', label: 'Qatar Airways' },
    { value: 'Turkish Airlines', label: 'Turkish Airlines' },
    { value: 'Aeroflot', label: 'Aeroflot' },
  ];
  const TRAVEL_STYLES = [
    { value: 'beach', label: lang === 'ru' ? '🏖 Пляж' : '🏖 Beach' },
    { value: 'gastronomy', label: lang === 'ru' ? '🍷 Гастрономия' : '🍷 Gastronomy' },
    { value: 'culture', label: lang === 'ru' ? '🏛 Культура' : '🏛 Culture' },
    { value: 'active', label: lang === 'ru' ? '🏃 Активный' : '🏃 Active' },
    { value: 'spa', label: '💆 Spa' },
    { value: 'shopping', label: lang === 'ru' ? '🛍 Шопинг' : '🛍 Shopping' },
    { value: 'nature', label: lang === 'ru' ? '🌿 Природа' : '🌿 Nature' },
    { value: 'nightlife', label: lang === 'ru' ? '🌙 Ночная жизнь' : '🌙 Nightlife' },
  ];
  const BUDGETS = [
    { value: 'budget', label: lang === 'ru' ? '💰 Бюджетный' : '💰 Budget' },
    { value: 'mid', label: lang === 'ru' ? '💳 Средний' : '💳 Mid-range' },
    { value: 'upscale', label: lang === 'ru' ? '✨ Выше среднего' : '✨ Upscale' },
    { value: 'luxury', label: lang === 'ru' ? '👑 Люкс' : '👑 Luxury' },
  ];
  const DESTINATIONS = [
    { value: 'Asia', label: '🌏 Asia' },
    { value: 'Europe', label: '🇪🇺 Europe' },
    { value: 'Maldives', label: '🏝 Maldives' },
    { value: 'UAE', label: '🌆 UAE' },
    { value: 'Americas', label: '🌎 Americas' },
    { value: 'Africa', label: '🌍 Africa' },
    { value: 'Oceania', label: '🌊 Oceania' },
  ];
 
  const TRAVEL_STATS = [
    { icon: '🔎', value: stats.searches, label: t('prefs_searches') },
    { icon: '🔖', value: stats.saved, label: t('prefs_saved_count') },
    { icon: '⚖️', value: stats.comparisons, label: t('prefs_comparisons') },
    { icon: '↗', value: stats.booking_intents, label: lang === 'ru' ? 'Переходов к бронированию' : 'Booking visits' },
    { icon: '📅', value: stats.member_since ? new Date(stats.member_since).toLocaleDateString(lang) : '—', label: lang === 'ru' ? 'Участник с' : 'Member since' },
  ];
 
  const NOTIFS = [
    { key: 'alert_price_drop', label: t('prefs_notif_price_drop'), desc: t('prefs_notif_price_drop_desc'), icon: '📉' },
    { key: 'alert_price_rise', label: t('prefs_notif_price_rise'), desc: t('prefs_notif_price_rise_desc'), icon: '📈' },
    { key: 'alert_booking_reminder', label: t('prefs_notif_reminder'), desc: t('prefs_notif_reminder_desc'), icon: '⏰' },
    { key: 'alert_weekly_insights', label: t('prefs_notif_insights'), desc: t('prefs_notif_insights_desc'), icon: '📊' },
    { key: 'alert_destination_deals', label: t('prefs_notif_deals'), desc: t('prefs_notif_deals_desc'), icon: '🔥' },
  ];
 
  if (loading) return (
    <div className={styles.page}>
      <div className={styles.loadingWrap}>
        {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 120, borderRadius: 14 }} />)}
      </div>
    </div>
  );
 
  return (
    <div className={styles.page}>
      <div className={styles.layout}>
 
        {/* SIDEBAR */}
        <aside className={styles.sidebar}>
          <div className={styles.avatarCard}>
            <div className={styles.avatarWrap}>
              <div className={styles.avatar}>{initials}</div>
            </div>
            <div className={styles.userName}>{user?.name || (lang === 'ru' ? 'Пользователь' : 'User')}</div>
            <div className={styles.userEmail}>{user?.email}</div>
            <div className={styles.userBadge}>{t('prefs_member')}</div>
          </div>
 
          <div className={styles.statsCard}>
            {[
              { label: t('prefs_searches'), value: stats.searches },
              { label: t('prefs_saved_count'), value: stats.saved },
              { label: t('prefs_comparisons'), value: stats.comparisons },
              { label: lang === 'ru' ? 'Бронирования' : 'Booking visits', value: stats.booking_intents },
            ].map(s => (
              <div key={s.label} className={styles.statItem}>
                <div className={styles.statValue}>{s.value}</div>
                <div className={styles.statLabel}>{s.label}</div>
              </div>
            ))}
          </div>
 
          <nav className={styles.tabNav}>
            {TABS.map(tab => {
              const Icon = tab.icon;
              return (
                <button key={tab.id} className={`${styles.tabNavItem} ${activeTab === tab.id ? styles.tabNavActive : ''}`} onClick={() => setActiveTab(tab.id)}>
                  <Icon size={16} />{tab.label}
                </button>
              );
            })}
          </nav>
 
          <div className={styles.aiBadge}>
            <Sparkles size={14} style={{ color: '#C9A84C', flexShrink: 0 }} />
            <span>{t('prefs_ai_text')}</span>
          </div>
        </aside>
 
        {/* MAIN */}
        <main className={styles.main}>
 
          {/* PERSONAL */}
          {activeTab === 'personal' && (
            <div className={styles.tabContent}>
              <div className={styles.tabHeader}>
                <div>
                  <h2 className={styles.tabTitle}>{t('prefs_personal_title')}</h2>
                  <p className={styles.tabSub}>{t('prefs_personal_sub')}</p>
                </div>
                {!editingPersonal
                  ? <button className={styles.editBtn} onClick={() => setEditingPersonal(true)}><Edit2 size={14} /> {t('prefs_edit')}</button>
                  : <div className={styles.editActions}>
                      <button className={styles.cancelBtn} onClick={() => setEditingPersonal(false)}>{t('prefs_cancel')}</button>
                      <button className={styles.saveSmBtn} onClick={handleSaveProfile}><Check size={14} /> {t('prefs_save')}</button>
                    </div>
                }
              </div>
              {profileError && <div className={styles.pwError}>{profileError}</div>}
 
              <div className={styles.personalGrid}>
                {[
                  { key: 'name', label: t('prefs_name'), placeholder: lang === 'ru' ? 'Ваше имя' : 'Your name' },
                  { key: 'email', label: t('prefs_email'), readOnly: true, value: user?.email, badge: t('prefs_verified') },
                  { key: 'phone', label: t('prefs_phone'), placeholder: '+7 (999) 000-00-00' },
                  { key: 'city', label: t('prefs_city'), placeholder: lang === 'ru' ? 'Москва' : 'Moscow' },
                  { key: 'country', label: t('prefs_country'), placeholder: lang === 'ru' ? 'Россия' : 'Russia' },
                ].map(field => (
                  <div key={field.key} className={styles.personalField}>
                    <label className={styles.fieldLabel}>{field.label}</label>
                    {field.readOnly ? (
                      <div className={styles.fieldValue}>
                        {field.value}
                        {field.badge && <span className={styles.verifiedBadge}>{field.badge}</span>}
                      </div>
                    ) : editingPersonal ? (
                      <input className={styles.fieldInput} type={field.type || 'text'} value={personalForm[field.key]} onChange={e => setP(field.key, e.target.value)} placeholder={field.placeholder} />
                    ) : (
                      <div className={styles.fieldValue}>{personalForm[field.key] || '—'}</div>
                    )}
                  </div>
                ))}
                <div className={`${styles.personalField} ${styles.personalFieldFull}`}>
                  <label className={styles.fieldLabel}>{t('prefs_bio')}</label>
                  {editingPersonal
                    ? <textarea className={styles.fieldTextarea} value={personalForm.bio} onChange={e => setP('bio', e.target.value)} placeholder={lang === 'ru' ? 'Расскажите о себе...' : 'Tell us about yourself...'} rows={3} />
                    : <div className={styles.fieldValue}>{personalForm.bio || '—'}</div>
                  }
                </div>
                <div className={styles.personalField}>
                  <label className={styles.fieldLabel}>{t('prefs_website')}</label>
                  {editingPersonal
                    ? <input className={styles.fieldInput} value={personalForm.website} onChange={e => setP('website', e.target.value)} placeholder="https://example.com" />
                    : <div className={styles.fieldValue}>{personalForm.website ? <><Globe size={13} style={{marginRight:4}}/>{personalForm.website}</> : '—'}</div>
                  }
                </div>
              </div>
 
              <div className={styles.travelStatsCard}>
                <div className={styles.travelStatsTitle}>{t('prefs_travel_stats')}</div>
                <div className={styles.travelStatsGrid}>
                  {TRAVEL_STATS.map(s => (
                    <div key={s.label} className={styles.travelStatItem}>
                      <div className={styles.travelStatIcon}>{s.icon}</div>
                      <div>
                        <div className={styles.travelStatValue}>{s.value}</div>
                        <div className={styles.travelStatLabel}>{s.label}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
 
          {/* PREFERENCES */}
          {activeTab === 'preferences' && (
            <div className={styles.tabContent}>
              <div className={styles.tabHeader}>
                <div>
                  <h2 className={styles.tabTitle}>{t('prefs_pref_title')}</h2>
                  <p className={styles.tabSub}>{t('prefs_pref_sub')}</p>
                </div>
                <button className={styles.saveSmBtn} onClick={handleSavePrefs} disabled={saving}>
                  {saved ? <><Check size={14} />{t('prefs_saved')}</> : saving ? t('prefs_saving') : <><Save size={14} />{onboarding ? (lang === 'ru' ? 'Сохранить и начать' : 'Save and start') : t('prefs_save')}</>}
                </button>
              </div>
 
              <div className={styles.prefsGrid}>
                <div className={styles.prefCard}>
                  <div className={styles.prefCardTitle}>{t('prefs_hotels_label')}</div>
                  <div className={styles.prefSection}><div className={styles.prefLabel}>{t('prefs_category')}</div><MultiSelect options={HOTEL_STARS} value={prefs.hotel_stars} onChange={v => set('hotel_stars', v)} /></div>
                  <div className={styles.prefSection}><div className={styles.prefLabel}>{t('prefs_room_type')}</div><MultiSelect options={ROOM_TYPES} value={prefs.room_type} onChange={v => set('room_type', v)} /></div>
                  <div className={styles.prefSection}><div className={styles.prefLabel}>{t('prefs_view')}</div><MultiSelect options={VIEWS} value={prefs.room_view} onChange={v => set('room_view', v)} /></div>
                  <div className={styles.prefSection}><div className={styles.prefLabel}>{t('prefs_amenities_label')}</div><MultiSelect options={AMENITIES} value={prefs.hotel_amenities} onChange={v => set('hotel_amenities', v)} /></div>
                </div>
 
                <div className={styles.prefCard}>
                  <div className={styles.prefCardTitle}>{t('prefs_flights_label')}</div>
                  <div className={styles.prefSection}><div className={styles.prefLabel}>{t('prefs_flight_type')}</div><SingleSelect options={FLIGHT_TYPES} value={prefs.flight_type} onChange={v => set('flight_type', v)} /></div>
                  <div className={styles.prefSection}><div className={styles.prefLabel}>{t('prefs_class')}</div><SingleSelect options={SEAT_CLASSES} value={prefs.seat_class} onChange={v => set('seat_class', v)} /></div>
                  <div className={styles.prefSection}><div className={styles.prefLabel}>{t('prefs_seat')}</div><SingleSelect options={SEATS} value={prefs.seat_position} onChange={v => set('seat_position', v)} /></div>
                  <div className={styles.prefSection}><div className={styles.prefLabel}>{t('prefs_airlines')}</div><MultiSelect options={AIRLINES} value={prefs.preferred_airlines} onChange={v => set('preferred_airlines', v)} /></div>
                </div>
 
                <div className={styles.prefCard}>
                  <div className={styles.prefCardTitle}>{t('prefs_style_label')}</div>
                  <div className={styles.prefSection}><div className={styles.prefLabel}>{t('prefs_interests')}</div><MultiSelect options={TRAVEL_STYLES} value={prefs.travel_style} onChange={v => set('travel_style', v)} /></div>
                  <div className={styles.prefSection}><div className={styles.prefLabel}>{t('prefs_budget')}</div><SingleSelect options={BUDGETS} value={prefs.budget_level} onChange={v => set('budget_level', v)} /></div>
                  <div className={styles.prefSection}>
                    <div className={styles.prefLabel}>{t('prefs_max_price')}: <strong>${prefs.budget_per_night_max}</strong></div>
                    <input type="range" className={styles.slider} min={100} max={5000} step={50} value={prefs.budget_per_night_max} onChange={e => set('budget_per_night_max', Number(e.target.value))} />
                    <div className={styles.sliderLabels}><span>$100</span><span>$5 000</span></div>
                  </div>
                  <div className={styles.prefSection}>
                    <div className={styles.prefLabel}>{t('prefs_noise')}: <strong>{prefs.noise_sensitivity}%</strong></div>
                    <input type="range" className={styles.slider} min={0} max={100} step={10} value={prefs.noise_sensitivity} onChange={e => set('noise_sensitivity', Number(e.target.value))} />
                    <div className={styles.sliderLabels}><span>{lang === 'ru' ? 'Не важно' : 'Not important'}</span><span>{lang === 'ru' ? 'Критично' : 'Critical'}</span></div>
                  </div>
                  <div className={styles.prefSection}><div className={styles.prefLabel}>{t('prefs_destinations')}</div><MultiSelect options={DESTINATIONS} value={prefs.favorite_destinations} onChange={v => set('favorite_destinations', v)} /></div>
                </div>
              </div>
            </div>
          )}
 
          {/* NOTIFICATIONS */}
          {activeTab === 'notifications' && (
            <div className={styles.tabContent}>
              <div className={styles.tabHeader}>
                <div>
                  <h2 className={styles.tabTitle}>{t('prefs_notif_title')}</h2>
                  <p className={styles.tabSub}>{t('prefs_notif_sub')}</p>
                </div>
                <button className={styles.saveSmBtn} onClick={handleSavePrefs} disabled={saving}>
                  {saved ? <><Check size={14} />{t('prefs_saved')}</> : <><Save size={14} />{t('prefs_save')}</>}
                </button>
              </div>
 
              <div className={styles.notifCard}>
                <div className={styles.notifGroup}>
                  <div className={styles.notifGroupTitle}>{t('prefs_notif_prices')}</div>
                  {NOTIFS.slice(0, 3).map(n => (
                    <div key={n.key} className={styles.notifRow}>
                      <div className={styles.notifIcon}>{n.icon}</div>
                      <div className={styles.notifText}>
                        <div className={styles.notifLabel}>{n.label}</div>
                        <div className={styles.notifDesc}>{n.desc}</div>
                      </div>
                      <ToggleSwitch on={prefs[n.key]} onChange={v => set(n.key, v)} />
                    </div>
                  ))}
                </div>
                <div className={styles.notifGroup}>
                  <div className={styles.notifGroupTitle}>{t('prefs_notif_info')}</div>
                  {NOTIFS.slice(3).map(n => (
                    <div key={n.key} className={styles.notifRow}>
                      <div className={styles.notifIcon}>{n.icon}</div>
                      <div className={styles.notifText}>
                        <div className={styles.notifLabel}>{n.label}</div>
                        <div className={styles.notifDesc}>{n.desc}</div>
                      </div>
                      <ToggleSwitch on={prefs[n.key]} onChange={v => set(n.key, v)} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
 
          {/* SECURITY */}
          {activeTab === 'security' && (
            <div className={styles.tabContent}>
              <div className={styles.tabHeader}>
                <div>
                  <h2 className={styles.tabTitle}>{t('prefs_sec_title')}</h2>
                  <p className={styles.tabSub}>{t('prefs_sec_sub')}</p>
                </div>
              </div>
 
              <div className={styles.securityCard}>
                <div className={styles.securitySection}>
                  <div className={styles.securitySectionTitle}>{t('prefs_change_password')}</div>
                  <div className={styles.securityFields}>
                    <div className={styles.personalField}>
                      <label className={styles.fieldLabel}>{t('prefs_current_pw')}</label>
                      <input className={styles.fieldInput} type="password" value={pwForm.current} onChange={e => setPwForm(p => ({...p, current: e.target.value}))} placeholder="••••••••" />
                    </div>
                    <div className={styles.personalField}>
                      <label className={styles.fieldLabel}>{t('prefs_new_pw')}</label>
                      <input className={styles.fieldInput} type="password" value={pwForm.next} onChange={e => setPwForm(p => ({...p, next: e.target.value}))} placeholder={t('prefs_pw_min')} />
                    </div>
                    <div className={styles.personalField}>
                      <label className={styles.fieldLabel}>{t('prefs_confirm_pw')}</label>
                      <input className={styles.fieldInput} type="password" value={pwForm.confirm} onChange={e => setPwForm(p => ({...p, confirm: e.target.value}))} placeholder="••••••••" />
                    </div>
                  </div>
                  {pwError && <div className={styles.pwError}>{pwError}</div>}
                  {pwSaved && <div className={styles.pwSuccess}>{t('prefs_pw_changed')}</div>}
                  <button className={styles.saveSmBtn} style={{marginTop:16}} onClick={handleChangePassword}>
                    <Shield size={14} /> {t('prefs_change_pw_btn')}
                  </button>
                </div>
 
                <div className={styles.securityDivider} />

                <div className={styles.securitySection}>
                  <div className={styles.securitySectionTitle}>{lang === 'ru' ? 'Данные и конфиденциальность' : 'Data and privacy'}</div>
                  <div className={styles.sessionRow}>
                    <div><div className={styles.sessionDevice}>{lang === 'ru' ? 'Поведенческая персонализация' : 'Behavioural personalisation'}</div><div className={styles.sessionMeta}>{lang === 'ru' ? 'Разрешает использовать клики и просмотры для настройки Score.' : 'Allows clicks and views to improve your Score.'}</div></div>
                    <ToggleSwitch on={trackingConsent} onChange={updateTrackingConsent} />
                  </div>
                  <button className={styles.saveSmBtn} onClick={exportData}>{lang === 'ru' ? 'Экспортировать мои данные' : 'Export my data'}</button>
                </div>

                <div className={styles.securityDivider} />

                <div className={styles.securitySection}>
                  <div className={styles.securitySectionTitle}>{t('prefs_sessions')}</div>
                  {sessions.map(s => (
                    <div key={s.id} className={styles.sessionRow}>
                      <div>
                        <div className={styles.sessionDevice}>
                          {s.user_agent || (lang === 'ru' ? 'Неизвестное устройство' : 'Unknown device')}
                          {s.current && <span className={styles.currentBadge}>{t('prefs_current_session')}</span>}
                        </div>
                        <div className={styles.sessionMeta}>{s.ip_address || '—'} · {s.current ? (lang === 'ru' ? 'Сейчас' : 'Now') : new Date(s.last_seen_at).toLocaleString()}</div>
                      </div>
                      {!s.current && <button className={styles.revokeBtn} onClick={() => revokeSession(s.id)}>{t('prefs_revoke')}</button>}
                    </div>
                  ))}
                </div>
 
                <div className={styles.securityDivider} />
 
                <div className={styles.securitySection}>
                  <div className={styles.securitySectionTitle} style={{color:'var(--red)'}}>{t('prefs_danger')}</div>
                  <p className={styles.dangerDesc}>{t('prefs_danger_desc')}</p>
                  <button className={styles.dangerBtn} onClick={deleteAccount}>{t('prefs_delete')}</button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
