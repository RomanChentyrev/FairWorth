const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { parseCookies, ACCESS_COOKIE, REFRESH_COOKIE, CSRF_COOKIE } = require('../services/sessionAuth');

const standard = { standardHeaders: true, legacyHeaders: false };

const authLimiter = rateLimit({
  ...standard, windowMs: 15 * 60 * 1000, limit: Number(process.env.AUTH_RATE_LIMIT || (process.env.NODE_ENV === 'test' ? 200 : 20)),
  message: { error: 'Too many authentication attempts. Try again later.' },
});

const apiLimiter = rateLimit({
  ...standard, windowMs: 60 * 1000, limit: 180,
  message: { error: 'Too many requests. Try again shortly.' },
});

const aiLimiter = rateLimit({
  ...standard, windowMs: 60 * 60 * 1000, limit: 20,
  message: { error: 'AI analysis limit reached. Try again later.' },
});

function csrfProtection(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.headers.authorization?.startsWith('Bearer ')) return next();
  const publicAuthPaths = new Set([
    '/api/auth/register', '/api/auth/login', '/api/auth/verify-email',
    '/api/auth/resend-verification', '/api/auth/forgot-password', '/api/auth/reset-password',
  ]);
  if (publicAuthPaths.has(`${req.baseUrl || ''}${req.path}`) || publicAuthPaths.has(req.path)) return next();
  const cookies = parseCookies(req);
  if (!cookies[ACCESS_COOKIE] && !cookies[REFRESH_COOKIE]) return next();
  const header = String(req.get('x-csrf-token') || '');
  const cookie = String(cookies[CSRF_COOKIE] || '');
  const valid = header.length === cookie.length && header.length > 0 && crypto.timingSafeEqual(Buffer.from(header), Buffer.from(cookie));
  if (!valid) return res.status(403).json({ error: 'Invalid CSRF token', code: 'CSRF_INVALID' });
  return next();
}

module.exports = { authLimiter, apiLimiter, aiLimiter, csrfProtection };
