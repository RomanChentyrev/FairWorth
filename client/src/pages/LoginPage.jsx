import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
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
    <div className={styles.page}>
      <button type="button" onClick={toggleLang} style={{ position: 'fixed', top: 20, right: 24, zIndex: 10, border: '1px solid #d8dde6', borderRadius: 8, padding: '7px 12px', background: '#fff', cursor: 'pointer', fontWeight: 700 }}>{isRu ? 'EN' : 'RU'}</button>
      <div className={styles.left}>
        <div className={styles.leftContent}>
          <div className={styles.logo}>Fairworth</div>
          <h1 className={styles.headline}>{isRu ? <>С возвращением.<br />Ваши предпочтения <em>ждут вас</em></> : <>Welcome back.<br />Your preferences <em>are waiting</em></>}</h1>
          <div className={styles.features}>
            {[
              { icon: '✦', text: isRu ? 'ИИ помнит ваши предпочтения по отелям и перелётам' : 'AI remembers your hotel and flight preferences' },
              { icon: '📌', text: isRu ? 'Ваши закладки и история поиска сохранены' : 'Your saved hotels and search history are here' },
              { icon: '🔔', text: isRu ? 'Алерты о ценах продолжают работать' : 'Your price alerts keep working' },
              { icon: '⚖️', text: isRu ? 'Незавершённые сравнения ждут вас' : 'Your unfinished comparisons are waiting' },
            ].map(f => (
              <div key={f.text} className={styles.feature}>
                <span className={styles.featureIcon}>{f.icon}</span>
                <span>{f.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className={styles.right}>
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
                <button type="button" className={styles.eyeBtn} onClick={() => setShowPassword(p => !p)} tabIndex={-1}>{showPassword ? '🙈' : '👁'}</button>
              </div>
            </div>
            {error && <div className={styles.error}>{error}</div>}
            <button className={styles.submitBtn} type="submit" disabled={loading}>
              {loading ? <><span className={styles.spinner} /> {t('login_loading')}</> : t('login_submit')}
            </button>
          </form>
          <p className={styles.terms} style={{ marginTop: 32 }}><Link to="/forgot-password">{isRu ? 'Забыли пароль?' : 'Forgot your password?'}</Link></p>
        </div>
      </div>
    </div>
  );
}
