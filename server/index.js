require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { init } = require('./db/database');
const { ensurePersonalizationSchema } = require('./services/personalization');
const { ensureDatabaseSchema } = require('./db/schema');
const { requireAuth, requireOnboarding, requireEmailVerified } = require('./middleware/auth');
const { authLimiter, apiLimiter, aiLimiter, csrfProtection } = require('./middleware/security');
const Sentry = require('@sentry/node');
const logger = require('./services/logger');

const app = express();
const PORT = process.env.PORT || 3001;
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000').split(',').map(value => value.trim());

if (process.env.SENTRY_DSN) Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV || 'development' });

if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET with at least 32 characters is required in production');
}
if (process.env.NODE_ENV === 'production') {
  for (const key of ['SMTP_HOST', 'EMAIL_FROM', 'PARTNER_POSTBACK_SECRET', 'PARTNER_ALLOWED_HOSTS', 'FRONTEND_URL']) {
    if (!process.env[key]) throw new Error(`${key} is required in production`);
  }
}

app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://unpkg.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://unpkg.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'https://*.sentry.io'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
    },
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
}));
app.use(express.json({ limit: '100kb' }));
app.use(logger.requestLogger);
app.use('/api', apiLimiter);
app.use('/api', csrfProtection);

app.get('/api/live', (req, res) => res.json({ status: 'ok' }));
app.get('/api/ready', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ready' });
  } catch (error) {
    res.status(503).json({ status: 'unavailable' });
  }
});

app.get('/api/health', async (req, res) => {
  const checks = {
    database: { status: 'unknown' },
    xotelo: { status: 'unknown' },
    openrouter: { status: process.env.OPENROUTER_API_KEY ? 'configured' : 'not_configured' },
    travelpayouts: { status: process.env.TRAVELPAYOUTS_TOKEN ? 'configured' : 'not_configured' },
    liteapi: { status: process.env.LITEAPI_KEY ? 'configured' : 'not_configured' },
  };
  try {
    await db.query('SELECT 1');
    checks.database.status = 'ok';
  } catch (error) {
    checks.database = { status: 'error' };
  }
  const probe = async (name, url, headers = {}) => {
    try {
      const response = await fetch(url, { method: 'HEAD', headers, signal: AbortSignal.timeout(2500) });
      checks[name] = { status: response.status < 500 ? 'reachable' : 'error', http_status: response.status };
    } catch (error) { checks[name] = { status: 'error' }; }
  };
  await Promise.all([
    probe('xotelo', 'https://data.xotelo.com/api/rates'),
    process.env.OPENROUTER_API_KEY ? probe('openrouter', 'https://openrouter.ai/api/v1/models', { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }) : null,
    process.env.TRAVELPAYOUTS_TOKEN ? probe('travelpayouts', 'https://api.travelpayouts.com/data/en/airlines.json') : null,
    process.env.LITEAPI_KEY ? probe('liteapi', `${(process.env.LITEAPI_BASE_URL || 'https://api.liteapi.travel/v3.0').replace(/\/$/, '')}/data/facilities`, { 'X-API-Key': process.env.LITEAPI_KEY }) : null,
  ].filter(Boolean));
  const ready = checks.database.status === 'ok';
  const externalError = Object.entries(checks).some(([name, check]) => name !== 'database' && check.status === 'error');
  res.status(ready ? 200 : 503).json({ status: ready ? (externalError ? 'degraded' : 'ready') : 'unavailable', checks, timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.json({
    service: 'Fairworth API',
    status: 'ok',
    health: '/api/health',
    flights: {
      cheapest: '/api/flights/cheapest?origin=MOW&destination=SIN&depart_date=2026-08&currency=USD',
      mostSuitable: '/api/flights/most-suitable?origin=MOW&destination=SIN&depart_date=2026-08&currency=USD',
      calendar: '/api/flights/calendar?origin=MOW&destination=SIN&depart_date=2026-08&currency=USD',
      airports: '/api/flights/airports.json',
      airlines: '/api/flights/airlines',
    },
  });
});

// Bootstrap DB then mount routes
const { db } = require('./db/database');
const ready = init().then(async () => {
  if (process.env.RUN_MIGRATIONS_ON_START !== 'false') await ensureDatabaseSchema();
  await ensurePersonalizationSchema();
  require('./services/hotelCatalog').startCatalogScheduler();
  // Routes loaded AFTER db is ready so they can require db safely
  app.use('/api/auth', authLimiter, require('./routes/auth'));
  app.use('/api/partners', require('./routes/partners'));
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api/hotels', require('./routes/hotels'));
  app.use('/api/flights', requireAuth, requireEmailVerified, requireOnboarding, require('./routes/flights'));
  app.use('/api/transfers', requireAuth, requireEmailVerified, requireOnboarding, require('./routes/transfers'));
  app.use('/api/users', requireAuth, require('./routes/users'));
  app.use('/api/compare', requireAuth, requireEmailVerified, requireOnboarding, require('./routes/compare'));
  app.use('/api/interactions', requireAuth, requireEmailVerified, requireOnboarding, require('./routes/interactions'));
  app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found', code: 'NOT_FOUND' }));
  app.use((error, req, res, next) => {
    if (process.env.SENTRY_DSN) Sentry.captureException(error);
    logger.error('unhandled_error', { error: error.message, path: req.originalUrl });
    if (res.headersSent) return next(error);
    return res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  });
  return app;
});

if (require.main === module) {
  ready.then(() => app.listen(PORT, () => {
    console.log(`\n🚀 Fairworth API running at http://localhost:${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/api/health`);
  })).catch(err => {
  console.error('Failed to initialise database:', err);
  process.exit(1);
  });
}

module.exports = { app, ready };
