const jwt = require('jsonwebtoken');
const { db } = require('../db/database');
const { isAdminEmail } = require('../config/admin');
const { isEmailVerificationRequired } = require('../config/auth');

const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'fairworth-dev-secret-change-me');

async function requireAuth(req, res, next) {
  const authorization = req.headers.authorization || '';
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const cookieMatch = String(req.headers.cookie || '').match(/(?:^|;\s*)fw_access=([^;]+)/);
  const token = bearer || (cookieMatch ? decodeURIComponent(cookieMatch[1]) : '');
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload.sessionId) return res.status(401).json({ error: 'Session is no longer valid' });
    const session = await db.prepare(`SELECT * FROM user_sessions WHERE id = ? AND user_id = ? AND revoked_at IS NULL`).get(payload.sessionId, payload.userId);
    if (!session) return res.status(401).json({ error: 'Session is no longer valid' });
    await db.prepare('UPDATE user_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?').run(payload.sessionId);
    req.user = { id: payload.userId, email: payload.email, sessionId: payload.sessionId, authMethod: bearer ? 'bearer' : 'cookie' };
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

async function requireOnboarding(req, res, next) {
  const user = await db.prepare('SELECT onboarding_completed FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(401).json({ error: 'User not found' });
  if (!user.onboarding_completed) {
    return res.status(403).json({ error: 'Complete your preferences first', onboarding_required: true });
  }
  return next();
}

async function requireEmailVerified(req, res, next) {
  if (!isEmailVerificationRequired()) return next();
  const user = await db.prepare('SELECT email_verified FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(401).json({ error: 'User not found' });
  if (!user.email_verified) return res.status(403).json({ error: 'Verify your email before searching offers', email_verification_required: true });
  return next();
}

async function requireAdmin(req, res, next) {
  const user = await db.prepare('SELECT email FROM users WHERE id = ?').get(req.user.id);
  if (!user || !isAdminEmail(user.email)) return res.status(403).json({ error: 'Administrator access required' });
  req.user.email = user.email;
  return next();
}

module.exports = { requireAuth, requireOnboarding, requireEmailVerified, requireAdmin, JWT_SECRET };
