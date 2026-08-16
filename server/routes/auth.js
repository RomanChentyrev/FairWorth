const express = require('express');
const { normalizeLocale } = require('../config/locales');
const { t } = require('../i18n');
const router = express.Router();
const { db } = require('../db/database');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const { requireAuth } = require('../middleware/auth');
const { getUserWeights } = require('../services/personalization');
const { createToken, consumeToken } = require('../services/tokens');
const { linkEmail } = require('../services/email');
const { accountEmail } = require('../services/emailTemplates');
const { TERMS_VERSION, PRIVACY_VERSION } = require('../config/legal');
const { effectiveRole } = require('../config/admin');
const { isEmailVerificationRequired } = require('../config/auth');
const logger = require('../services/logger');
const {
  REFRESH_COOKIE, REFRESH_TTL_SECONDS, parseCookies, hashToken, createRefreshToken,
  signAccessToken, setSessionCookies, clearSessionCookies,
} = require('../services/sessionAuth');

const frontendUrl = () => process.env.FRONTEND_URL || 'http://localhost:5173';
const strongPassword = password => typeof password === 'string' && password.length >= 12
  && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password);

function publicUser(user) {
  return {
    id: user.id, name: user.name, email: user.email,
    phone: user.phone, city: user.city, country: user.country, bio: user.bio, website: user.website,
    onboarding_completed: Boolean(user.onboarding_completed), email_verified: !isEmailVerificationRequired() || Boolean(user.email_verified), role: effectiveRole(user.email),
    behavioural_tracking_consent: Boolean(user.behavioural_tracking_consent),
  };
}

function internalAuthError(res, operation, error) {
  logger.error('auth_operation_failed', { operation, error: error?.message || 'Unknown error' });
  if (error?.status === 429) {
    return res.status(429).json({ error: 'Please wait before requesting another email', code: 'AUTH_EMAIL_RATE_LIMITED' });
  }
  return res.status(500).json({ error: 'Authentication service is temporarily unavailable', code: 'AUTH_SERVICE_ERROR' });
}

router.post('/register', async (req, res) => {
  try {
    const locale = normalizeLocale(req.body.language);
    const { name, password, accept_terms: acceptTerms, behavioural_tracking_consent: trackingConsent } = req.body;
    const email = String(req.body.email || '').trim().toLowerCase();
    const cleanName = String(name || '').trim();
    if (!cleanName || !email || !password) return res.status(400).json({ error: t(locale, 'auth.complete_fields') });
    if (!acceptTerms) return res.status(400).json({ error: t(locale, 'auth.accept_legal') });
    if (req.body.terms_version !== TERMS_VERSION || req.body.privacy_version !== PRIVACY_VERSION) return res.status(409).json({ error: t(locale, 'auth.legal_changed'), code: 'LEGAL_VERSION_MISMATCH' });
    if (cleanName.length < 2) return res.status(400).json({ error: t(locale, 'auth.name_min') });
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: t(locale, 'auth.invalid_email') });
    if (!strongPassword(password)) return res.status(400).json({ error: t(locale, 'auth.weak_password') });
    const existing = await db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(email);
    if (existing) return res.status(400).json({ error: t(locale, 'auth.email_exists') });
    const passwordHash = await bcrypt.hash(password, 10);
    const userId = uuidv4();
    const verificationRequired = isEmailVerificationRequired();
    const sessionId = uuidv4();
    const refreshToken = createRefreshToken();
    try {
      await db.transaction(async () => {
      await db.prepare('INSERT INTO users (id, email, name, password_hash, onboarding_completed, email_verified, behavioural_tracking_consent, terms_accepted_at, privacy_accepted_at, terms_version, privacy_version, role, locale) VALUES (?, ?, ?, ?, 0, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?, ?, ?)').run(userId, email, cleanName, passwordHash, verificationRequired ? 0 : 1, trackingConsent ? 1 : 0, TERMS_VERSION, PRIVACY_VERSION, 'user', locale);
      await db.prepare(`
        INSERT INTO user_preferences (
          id, user_id, hotel_stars, room_type, room_view, hotel_amenities,
          preferred_airlines, travel_style, favorite_destinations, avoid_destinations,
          flight_type, seat_class, seat_position, max_stops, budget_level,
          budget_per_night_max, noise_sensitivity
        ) VALUES (?, ?, '[]', '[]', '[]', '[]', '[]', '[]', '[]', '[]',
          NULL, NULL, NULL, NULL, NULL, NULL, 50)
      `).run(uuidv4(), userId);
      await getUserWeights(userId);
      await db.prepare(`INSERT INTO user_sessions (id, user_id, user_agent, ip_address, refresh_token_hash, refresh_expires_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP + (? * INTERVAL '1 second'))`)
        .run(sessionId, userId, req.get('user-agent') || null, req.ip || null, hashToken(refreshToken), REFRESH_TTL_SECONDS);
      });
    } catch (error) {
      throw error;
    }
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    let verificationToken = null;
    if (verificationRequired) {
      verificationToken = await createToken(userId, 'email_verification', 24 * 60);
      await linkEmail({ to: email, name: cleanName, purpose: 'verify', url: `${frontendUrl()}/verify-email?token=${encodeURIComponent(verificationToken)}`, locale }).catch(() => null);
    }
    const token = signAccessToken(user, sessionId);
    setSessionCookies(res, token, refreshToken);
    res.status(201).json({ ...(process.env.NODE_ENV !== 'production' ? { token } : {}), user: publicUser(user), verification_required: verificationRequired, ...(process.env.NODE_ENV !== 'production' && verificationToken ? { development_verification_token: verificationToken } : {}) });
  } catch (err) {
    return internalAuthError(res, 'register', err);
  }
});

router.post('/login', async (req, res) => {
  try {
    const locale = normalizeLocale(req.body.language);
    const email = String(req.body.email || '').trim().toLowerCase();
    const { password } = req.body;
    if (!email || !password) return res.status(400).json({ error: t(locale, 'auth.credentials_required') });
    const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) return res.status(400).json({ error: t(locale, 'auth.invalid_credentials') });
    const valid = await bcrypt.compare(password, user.password_hash || '');
    if (!valid) return res.status(400).json({ error: t(locale, 'auth.invalid_credentials') });
    if (user.locale !== locale) {
      await db.prepare('UPDATE users SET locale = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(locale, user.id);
      user.locale = locale;
    }
    if (!isEmailVerificationRequired() && !user.email_verified) {
      await db.prepare('UPDATE users SET email_verified = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
      user.email_verified = 1;
    }
    const sessionId = uuidv4();
    const refreshToken = createRefreshToken();
    await db.prepare(`INSERT INTO user_sessions (id, user_id, user_agent, ip_address, refresh_token_hash, refresh_expires_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP + (? * INTERVAL '1 second'))`)
      .run(sessionId, user.id, req.get('user-agent') || null, req.ip || null, hashToken(refreshToken), REFRESH_TTL_SECONDS);
    const token = signAccessToken(user, sessionId);
    setSessionCookies(res, token, refreshToken);
    res.json({ ...(process.env.NODE_ENV !== 'production' ? { token } : {}), user: publicUser(user) });
  } catch (err) {
    return internalAuthError(res, 'login', err);
  }
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: publicUser(user) });
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

router.post('/logout', requireAuth, async (req, res) => {
  await db.prepare('UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.user.sessionId);
  clearSessionCookies(res);
  res.status(204).end();
});

router.post('/refresh', async (req, res) => {
  const refreshToken = parseCookies(req)[REFRESH_COOKIE];
  if (!refreshToken) return res.status(401).json({ error: 'Refresh session is missing' });
  const nextRefresh = createRefreshToken();
  const session = await db.prepare(`
    UPDATE user_sessions AS s
    SET refresh_token_hash = ?, refresh_expires_at = CURRENT_TIMESTAMP + (? * INTERVAL '1 second'), last_seen_at = CURRENT_TIMESTAMP
    FROM users AS u
    WHERE u.id = s.user_id AND s.refresh_token_hash = ? AND s.revoked_at IS NULL AND s.refresh_expires_at > CURRENT_TIMESTAMP
    RETURNING s.id, s.user_id, u.email, u.name
  `).get(hashToken(nextRefresh), REFRESH_TTL_SECONDS, hashToken(refreshToken));
  if (!session) { clearSessionCookies(res); return res.status(401).json({ error: 'Refresh session is invalid or expired' }); }
  const token = signAccessToken({ id: session.user_id, email: session.email, name: session.name }, session.id);
  setSessionCookies(res, token, nextRefresh);
  return res.json({ refreshed: true });
});

router.post('/verify-email', async (req, res) => {
  const row = await consumeToken(String(req.body.token || ''), 'email_verification');
  if (!row) return res.status(400).json({ error: 'Verification link is invalid or expired' });
  await db.prepare('UPDATE users SET email_verified = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.user_id);
  return res.json({ verified: true });
});

router.post('/resend-verification', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const user = await db.prepare('SELECT id, email, name, email_verified, locale FROM users WHERE email = ?').get(email);
    if (!user || user.email_verified) return res.json({ sent: true });
    const token = await createToken(user.id, 'email_verification', 24 * 60);
    await linkEmail({ to: user.email, name: user.name, purpose: 'verify', url: `${frontendUrl()}/verify-email?token=${encodeURIComponent(token)}`, locale: user.locale });
    return res.json({ sent: true, ...(process.env.NODE_ENV !== 'production' ? { development_token: token } : {}) });
  } catch (error) { return internalAuthError(res, 'resend_verification', error); }
});

router.post('/forgot-password', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const user = await db.prepare('SELECT id, email, name, locale FROM users WHERE email = ?').get(email);
    if (!user) return res.json({ sent: true });
    const token = await createToken(user.id, 'password_reset', 30);
    await linkEmail({ to: user.email, name: user.name, purpose: 'reset', url: `${frontendUrl()}/reset-password?token=${encodeURIComponent(token)}`, locale: user.locale });
    return res.json({ sent: true, ...(process.env.NODE_ENV !== 'production' ? { development_token: token } : {}) });
  } catch (error) { return internalAuthError(res, 'forgot_password', error); }
});

router.post('/reset-password', async (req, res) => {
  const password = String(req.body.password || '');
  if (!strongPassword(password)) return res.status(400).json({ error: 'Password must be at least 12 characters and include upper/lowercase letters, a number and a symbol' });
  const row = await consumeToken(String(req.body.token || ''), 'password_reset');
  if (!row) return res.status(400).json({ error: 'Reset link is invalid or expired' });
  const user = await db.prepare('SELECT email, name, locale FROM users WHERE id = ?').get(row.user_id);
  await db.transaction(async () => {
    await db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(await bcrypt.hash(password, 10), row.user_id);
    await db.prepare('UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL').run(row.user_id);
  });
  const { sendEmail } = require('../services/email');
  await sendEmail({ to: user.email, ...accountEmail({ name: user.name, event: 'password_changed', locale: user.locale }) }).catch(() => null);
  clearSessionCookies(res);
  return res.json({ reset: true });
});

module.exports = router;
module.exports.internalAuthError = internalAuthError;
