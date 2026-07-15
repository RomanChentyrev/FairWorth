import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authApi } from '../api';
import { useLang } from '../i18n/LanguageContext';

export function VerifyEmailPage() {
  const [params] = useSearchParams(); const navigate = useNavigate(); const { lang } = useLang();
  const token = params.get('token') || sessionStorage.getItem('fairworth_verification_token');
  const [state, setState] = useState(token ? 'loading' : 'waiting'); const [email, setEmail] = useState(''); const [message, setMessage] = useState('');
  useEffect(() => { if (!token) return; authApi.verifyEmail(token).then(() => { sessionStorage.removeItem('fairworth_verification_token'); setState('success'); setTimeout(() => window.location.assign('/preferences?onboarding=1'), 1200); }).catch(error => { setState('error'); setMessage(error.response?.data?.error || error.message); }); }, [token]);
  const resend = async e => { e.preventDefault(); try { const response = await authApi.resendVerification(email); if (response.data.development_token) sessionStorage.setItem('fairworth_verification_token', response.data.development_token); setMessage(lang === 'ru' ? 'Письмо отправлено.' : 'Verification email sent.'); } catch (error) { setMessage(error.response?.data?.error || error.message); } };
  return <main className="system-page"><h1>{lang === 'ru' ? 'Подтвердите email' : 'Verify your email'}</h1>{state === 'loading' && <p>{lang === 'ru' ? 'Проверяем ссылку…' : 'Verifying link…'}</p>}{state === 'success' && <p>{lang === 'ru' ? 'Email подтверждён.' : 'Email verified.'}</p>}{state === 'error' && <p>{message}</p>}{state === 'waiting' && <><p>{lang === 'ru' ? 'Мы отправили ссылку на вашу почту.' : 'We sent a verification link to your email.'}</p><form onSubmit={resend}><input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="Email" /> <button>Resend</button></form>{message && <p>{message}</p>}</>}</main>;
}

export function ForgotPasswordPage() {
  const { lang } = useLang(); const [email, setEmail] = useState(''); const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  const submit = async e => {
    e.preventDefault(); setLoading(true); setMessage(''); setError('');
    try {
      const response = await authApi.forgotPassword(email);
      if (response.data.development_token) sessionStorage.setItem('fairworth_reset_token', response.data.development_token);
      setMessage(lang === 'ru' ? 'Если аккаунт существует, письмо отправлено.' : 'If the account exists, a reset email was sent.');
    } catch (requestError) {
      setError(requestError.response?.data?.error || (lang === 'ru' ? 'Не удалось связаться с сервисом. Проверьте соединение и попробуйте ещё раз.' : 'Could not reach the service. Check your connection and try again.'));
    } finally { setLoading(false); }
  };
  return <main className="system-page"><h1>{lang === 'ru' ? 'Восстановление пароля' : 'Forgot password'}</h1><form onSubmit={submit}><label htmlFor="forgot-email">Email</label> <input id="forgot-email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required /> <button disabled={loading}>{loading ? (lang === 'ru' ? 'Отправляем…' : 'Sending…') : (lang === 'ru' ? 'Отправить' : 'Send reset link')}</button></form><div aria-live="polite">{error && <p role="alert">{error}</p>}{message && <><p>{message}</p><Link to="/reset-password">{lang === 'ru' ? 'Открыть форму сброса' : 'Open reset form'}</Link></>}</div></main>;
}

export function ResetPasswordPage() {
  const [params] = useSearchParams(); const { lang } = useLang(); const navigate = useNavigate(); const [password, setPassword] = useState(''); const [message, setMessage] = useState('');
  const token = params.get('token') || sessionStorage.getItem('fairworth_reset_token');
  const submit = async e => { e.preventDefault(); try { await authApi.resetPassword(token, password); sessionStorage.removeItem('fairworth_reset_token'); setMessage(lang === 'ru' ? 'Пароль изменён.' : 'Password changed.'); setTimeout(() => navigate('/login'), 1000); } catch (error) { setMessage(error.response?.data?.error || error.message); } };
  return <main className="system-page"><h1>{lang === 'ru' ? 'Новый пароль' : 'Set a new password'}</h1><form onSubmit={submit}><input type="password" minLength="12" value={password} onChange={e => setPassword(e.target.value)} required placeholder={lang === 'ru' ? '12+ символов: A-z, 0-9, !' : '12+ characters: A-z, 0-9, !'} /> <button>{lang === 'ru' ? 'Сохранить' : 'Save password'}</button></form>{message && <p>{message}</p>}</main>;
}
