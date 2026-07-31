import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authApi } from '../api';
import { useLang } from '../i18n/LanguageContext';

export function VerifyEmailPage() {
  const [params] = useSearchParams(); const navigate = useNavigate(); const { lang , l} = useLang();
  const token = params.get('token') || sessionStorage.getItem('fairworth_verification_token');
  const [state, setState] = useState(token ? 'loading' : 'waiting'); const [email, setEmail] = useState(''); const [message, setMessage] = useState('');
  useEffect(() => { if (!token) return; authApi.verifyEmail(token).then(() => { sessionStorage.removeItem('fairworth_verification_token'); setState('success'); setTimeout(() => window.location.assign('/preferences?onboarding=1'), 1200); }).catch(error => { setState('error'); setMessage(error.response?.data?.error || error.message); }); }, [token]);
  const resend = async e => { e.preventDefault(); try { const response = await authApi.resendVerification(email); if (response.data.development_token) sessionStorage.setItem('fairworth_verification_token', response.data.development_token); setMessage(l('Verification email sent.', 'Письмо отправлено.')); } catch (error) { setMessage(error.response?.data?.error || error.message); } };
  return <main className="system-page"><h1>{l('Verify your email', 'Подтвердите email')}</h1>{state === 'loading' && <p>{l('Verifying link…', 'Проверяем ссылку…')}</p>}{state === 'success' && <p>{l('Email verified.', 'Email подтверждён.')}</p>}{state === 'error' && <p>{message}</p>}{state === 'waiting' && <><p>{l('We sent a verification link to your email.', 'Мы отправили ссылку на вашу почту.')}</p><form onSubmit={resend}><input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="Email" /> <button>{l('Resend', 'Отправить повторно')}</button></form>{message && <p>{message}</p>}</>}</main>;
}

export function ForgotPasswordPage() {
  const { lang, l } = useLang(); const [email, setEmail] = useState(''); const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  const submit = async e => {
    e.preventDefault(); setLoading(true); setMessage(''); setError('');
    try {
      const response = await authApi.forgotPassword(email);
      if (response.data.development_token) sessionStorage.setItem('fairworth_reset_token', response.data.development_token);
      setMessage(l('If the account exists, a reset email was sent.', 'Если аккаунт существует, письмо отправлено.'));
    } catch (requestError) {
      setError(requestError.response?.data?.error || (l('Could not reach the service. Check your connection and try again.', 'Не удалось связаться с сервисом. Проверьте соединение и попробуйте ещё раз.')));
    } finally { setLoading(false); }
  };
  return <main className="system-page"><h1>{l('Forgot password', 'Восстановление пароля')}</h1><form onSubmit={submit}><label htmlFor="forgot-email">Email</label> <input id="forgot-email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required /> <button disabled={loading}>{loading ? (l('Sending…', 'Отправляем…')) : (l('Send reset link', 'Отправить'))}</button></form><div aria-live="polite">{error && <p role="alert">{error}</p>}{message && <><p>{message}</p><Link to="/reset-password">{l('Open reset form', 'Открыть форму сброса')}</Link></>}</div></main>;
}

export function ResetPasswordPage() {
  const [params] = useSearchParams(); const { lang, l } = useLang(); const navigate = useNavigate(); const [password, setPassword] = useState(''); const [message, setMessage] = useState('');
  const token = params.get('token') || sessionStorage.getItem('fairworth_reset_token');
  const submit = async e => { e.preventDefault(); try { await authApi.resetPassword(token, password); sessionStorage.removeItem('fairworth_reset_token'); setMessage(l('Password changed.', 'Пароль изменён.')); setTimeout(() => navigate('/login'), 1000); } catch (error) { setMessage(error.response?.data?.error || error.message); } };
  return <main className="system-page"><h1>{l('Set a new password', 'Новый пароль')}</h1><form onSubmit={submit}><input type="password" minLength="12" value={password} onChange={e => setPassword(e.target.value)} required placeholder={l('12+ characters: A-z, 0-9, !', '12+ символов: A-z, 0-9, !')} /> <button>{l('Save password', 'Сохранить')}</button></form>{message && <p>{message}</p>}</main>;
}
