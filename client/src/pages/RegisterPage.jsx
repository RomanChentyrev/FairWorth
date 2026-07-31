import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Eye, EyeOff } from 'lucide-react';
import styles from './RegisterPage.module.css';
import { useLang } from '../i18n/LanguageContext';
import { legalApi } from '../api';
import LanguageSelect from '../components/LanguageSelect';

export default function RegisterPage({ onLogin }) {
  const navigate = useNavigate();
  const { lang, t , l} = useLang();
  const [form, setForm] = useState({ name: '', email: '', password: '', accept_terms: false, behavioural_tracking_consent: true });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [legal, setLegal] = useState(null);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  useEffect(() => {
    legalApi.current().then(response => setLegal(response.data)).catch(() => setError(l('Could not load the current legal documents.', 'Не удалось загрузить актуальные юридические документы.')));
  }, [lang]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (!legal) throw new Error(l('Wait for the legal documents to load.', 'Дождитесь загрузки юридических документов.'));
      const res = await axios.post('/api/auth/register', { ...form, language: lang, terms_version: legal.terms_version, privacy_version: legal.privacy_version }, { withCredentials: true });
      const { user } = res.data;
      localStorage.setItem('fw_user', JSON.stringify(user));
      if (res.data.development_verification_token) sessionStorage.setItem('fairworth_verification_token', res.data.development_verification_token);
      if (onLogin) onLogin(user);
      navigate(res.data.verification_required ? '/verify-email' : '/preferences?onboarding=1');
    } catch (err) {
      setError(err.response?.data?.error || (l('Registration failed', 'Ошибка регистрации')));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`${styles.page} ${styles.registerPage}`}>
      <header className={styles.registerHeader}>
        <Link to="/" className={styles.registerLogo}>Tripalora</Link>
        <LanguageSelect />
      </header>
      <main className={styles.registerMain}>
        <div className={styles.formWrap}>
          <div className={styles.formHeader}>
            <h2 className={styles.formTitle}>{t('reg_title')}</h2>
            <p className={styles.formSub}>{t('reg_have_account')} <Link to="/login" className={styles.switchLink}>{t('reg_login_link')}</Link></p>
          </div>
          <form onSubmit={handleSubmit} className={styles.form}>
            <div className={styles.field}>
              <label className={styles.label}>{t('reg_name')}</label>
              <input className={styles.input} type="text" placeholder={t('reg_name_placeholder')} value={form.name} onChange={e => set('name', e.target.value)} required autoFocus />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Email</label>
              <input className={styles.input} type="email" placeholder="alex@example.com" value={form.email} onChange={e => set('email', e.target.value)} required />
            </div>
            <label className={styles.consent}><input type="checkbox" checked={form.accept_terms} onChange={e => set('accept_terms', e.target.checked)} required disabled={!legal} /><span>{t('reg_accept_prefix')} <Link to="/legal/terms">{l('Terms', 'Условия использования')}{legal ? ` v${legal.terms_version}` : ''}</Link> {t('reg_accept_connector')} <Link to="/legal/privacy">{l('Privacy Policy', 'Политику конфиденциальности')}{legal ? ` v${legal.privacy_version}` : ''}</Link>.</span></label>
            <label className={styles.consent}><input type="checkbox" checked={form.behavioural_tracking_consent} onChange={e => set('behavioural_tracking_consent', e.target.checked)} /><span>{l('Allow behavioural tracking to personalise my Score (optional)', 'Разрешить анализ действий для персонализации Score (необязательно)')}</span></label>
            <div className={styles.field}>
              <label className={styles.label}>{t('reg_password')}</label>
              <div className={styles.passwordWrap}>
                <input className={styles.input} type={showPassword ? 'text' : 'password'} placeholder={l('12+ characters: A-z, 0-9, !', '12+ символов: A-z, 0-9, !')} value={form.password} onChange={e => set('password', e.target.value)} required minLength={12} />
                <button type="button" className={styles.eyeBtn} onClick={() => setShowPassword(p => !p)} aria-label={showPassword ? (l('Hide password', 'Скрыть пароль')) : (l('Show password', 'Показать пароль'))}>
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>
            {error && <div className={styles.error}>{error}</div>}
            <button className={styles.submitBtn} type="submit" disabled={loading || !legal}>
              {loading ? <><span className={styles.spinner} /> {t('reg_loading')}</> : t('reg_submit')}
            </button>
          </form>
          <div className={styles.divider}><span>{t('reg_after')}</span></div>
          <div className={styles.nextSteps}>
            {[
              { n: 1, text: t('reg_step1') },
              { n: 2, text: t('reg_step2') },
              { n: 3, text: t('reg_step3') },
            ].map(s => (
              <div key={s.n} className={styles.nextStep}>
                <div className={styles.stepNum}>{s.n}</div>
                <div>{s.text}</div>
              </div>
            ))}
          </div>
          <p className={styles.terms}>{t('reg_terms')}</p>
        </div>
      </main>
    </div>
  );
}
