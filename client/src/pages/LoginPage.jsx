import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Eye, EyeOff } from 'lucide-react';
import styles from './RegisterPage.module.css';
import { useLang } from '../i18n/LanguageContext';

export default function LoginPage({ onLogin }) {
  const navigate = useNavigate();
  const { lang, toggleLang, t } = useLang();
  const isRu = lang === 'ru';
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await axios.post('/api/auth/login', { ...form, language: lang }, { withCredentials: true });
      const { user } = res.data;
      localStorage.setItem('fw_user', JSON.stringify(user));
      if (onLogin) onLogin(user);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || (isRu ? 'Ошибка входа' : 'Sign-in failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`${styles.page} ${styles.registerPage}`}>
      <header className={styles.registerHeader}>
        <Link to="/" className={styles.registerLogo}>Tripalora</Link>
        <button type="button" className={styles.langBtn} onClick={toggleLang}>{isRu ? 'EN' : 'RU'}</button>
      </header>
      <main className={`${styles.registerMain} ${styles.loginMain}`}>
        <div className={styles.formWrap}>
          <div className={styles.formHeader}>
            <h2 className={styles.formTitle}>{t('login_title')}</h2>
            <p className={styles.formSub}>{t('login_no_account')} <Link to="/register" className={styles.switchLink}>{t('login_reg_link')}</Link></p>
          </div>
          <form onSubmit={handleSubmit} className={styles.form}>
            <div className={styles.field}>
              <label className={styles.label}>Email</label>
              <input className={styles.input} type="email" placeholder="alex@example.com" value={form.email} onChange={e => set('email', e.target.value)} required autoFocus />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>{t('reg_password')}</label>
              <div className={styles.passwordWrap}>
                <input className={styles.input} type={showPassword ? 'text' : 'password'} placeholder={isRu ? 'Ваш пароль' : 'Your password'} value={form.password} onChange={e => set('password', e.target.value)} required />
                <button type="button" className={styles.eyeBtn} onClick={() => setShowPassword(p => !p)} aria-label={showPassword ? (isRu ? 'Скрыть пароль' : 'Hide password') : (isRu ? 'Показать пароль' : 'Show password')}>
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>
            {error && <div className={styles.error}>{error}</div>}
            <button className={styles.submitBtn} type="submit" disabled={loading}>
              {loading ? <><span className={styles.spinner} /> {t('login_loading')}</> : t('login_submit')}
            </button>
          </form>
          <p className={styles.terms} style={{ marginTop: 32 }}><Link to="/forgot-password">{isRu ? 'Забыли пароль?' : 'Forgot your password?'}</Link></p>
        </div>
      </main>
    </div>
  );
}
