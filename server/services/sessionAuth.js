const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../middleware/auth');

const ACCESS_COOKIE = 'fw_access';
const REFRESH_COOKIE = 'fw_refresh';
const CSRF_COOKIE = 'fw_csrf';
const ACCESS_TTL_SECONDS = Number(process.env.ACCESS_TOKEN_TTL_SECONDS || 15 * 60);
const REFRESH_TTL_SECONDS = Number(process.env.REFRESH_TOKEN_TTL_SECONDS || 30 * 24 * 60 * 60);

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map(item => item.trim()).filter(Boolean).map(item => {
    const separator = item.indexOf('=');
    return [decodeURIComponent(item.slice(0, separator)), decodeURIComponent(item.slice(separator + 1))];
  }));
}
function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function createRefreshToken() { return crypto.randomBytes(48).toString('base64url'); }
function signAccessToken(user, sessionId) {
  return jwt.sign({ userId: user.id, email: user.email, name: user.name, sessionId }, JWT_SECRET, { expiresIn: ACCESS_TTL_SECONDS });
}
function cookieOptions(httpOnly, maxAge, path = '/') {
  return { httpOnly, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: maxAge * 1000, path };
}
function setSessionCookies(res, accessToken, refreshToken, csrfToken = crypto.randomBytes(24).toString('base64url')) {
  res.cookie(ACCESS_COOKIE, accessToken, cookieOptions(true, ACCESS_TTL_SECONDS));
  res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions(true, REFRESH_TTL_SECONDS, '/api/auth'));
  res.cookie(CSRF_COOKIE, csrfToken, cookieOptions(false, REFRESH_TTL_SECONDS));
  return csrfToken;
}
function clearSessionCookies(res) {
  for (const [name, path] of [[ACCESS_COOKIE, '/'], [REFRESH_COOKIE, '/api/auth'], [CSRF_COOKIE, '/']]) {
    res.clearCookie(name, { httpOnly: name !== CSRF_COOKIE, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path });
  }
}

module.exports = { ACCESS_COOKIE, REFRESH_COOKIE, CSRF_COOKIE, REFRESH_TTL_SECONDS, parseCookies, hashToken, createRefreshToken, signAccessToken, setSessionCookies, clearSessionCookies };
