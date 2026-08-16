require('dotenv').config();
const { validateEnv } = require('./config/env');
const env = validateEnv();
const { Sentry, enabled: sentryEnabled } = require('./instrument');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { init } = require('./db/database');
const { ensurePersonalizationSchema } = require('./services/personalization');
const { ensureDatabaseSchema } = require('./db/schema');
const { requireAuth, requireOnboarding, requireEmailVerified } = require('./middleware/auth');
const { authLimiter, apiLimiter, csrfProtection } = require('./middleware/security');
const logger = require('./services/logger');
const monitoring = require('./services/monitoring');
const { capabilities, requireCapability } = require('./config/capabilities');

const app = express();
const PORT = env.PORT;
const allowedOrigins = env.CORS_ORIGINS.split(',').map(value => value.trim());

app.set('trust proxy', env.TRUST_PROXY ? 1 : false);
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
  crossOriginResourcePolicy: { policy: 'same-origin' },
}));
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
}));
app.use(express.json({ limit: '100kb' }));
app.use(logger.requestLogger);
app.use(monitoring.requestMonitor);
app.use('/api', apiLimiter);
app.use('/api', csrfProtection);

app.get('/api/live', (req, res) => res.json({ status: 'ok' }));
app.get('/api/capabilities', (req, res) => res.json({ capabilities: capabilities() }));
app.get('/api/ready', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ready' });
  } catch (error) {
    res.status(503).json({ status: 'unavailable' });
  }
});

app.get('/api/health', async (req, res) => {
  const providerCapabilities = capabilities();
  const checks = {
    database: { status: 'unknown' },
    redis: { status: 'unknown' },
    xotelo: { status: 'unknown' },
    openrouter: { status: providerCapabilities.ai.status === 'ready' ? 'configured' : 'not_configured' },
    travelpayouts: { status: process.env.TRAVELPAYOUTS_TOKEN ? 'configured' : 'not_configured' },
    searchapi: { status: process.env.SEARCHAPI_KEY ? 'configured' : 'not_configured' },
    liteapi: { status: providerCapabilities.hotels.status === 'ready' ? 'configured' : 'not_configured' },
    capabilities: providerCapabilities,
    sentry: { status: sentryEnabled ? 'configured' : 'not_configured', environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development', release: process.env.SENTRY_RELEASE || null },
  };
  try {
    await db.query('SELECT 1');
    checks.database.status = 'ok';
  } catch (error) {
    checks.database = { status: 'error' };
  }
  checks.redis = await require('./services/cache').health();
  const probe = async (name, url, headers = {}) => {
    try {
      const response = await fetch(url, { method: 'HEAD', headers, signal: AbortSignal.timeout(2500) });
      checks[name] = { status: response.status < 500 ? 'reachable' : 'error', http_status: response.status };
    } catch (error) { checks[name] = { status: 'error' }; }
  };
  await Promise.all([
    probe('xotelo', 'https://data.xotelo.com/api/rates'),
    providerCapabilities.ai.status === 'ready' ? probe('openrouter', 'https://openrouter.ai/api/v1/models', { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }) : null,
    process.env.TRAVELPAYOUTS_TOKEN ? probe('travelpayouts', 'https://api.travelpayouts.com/data/en/airlines.json') : null,
    providerCapabilities.hotels.status === 'ready' ? probe('liteapi', `${(process.env.LITEAPI_BASE_URL || 'https://api.liteapi.travel/v3.0').replace(/\/$/, '')}/data/facilities`, { 'X-API-Key': process.env.LITEAPI_KEY }) : null,
  ].filter(Boolean));
  for (const [name, check] of Object.entries(checks)) {
    if (!['database', 'redis', 'capabilities', 'sentry'].includes(name) && check.status === 'error') {
      monitoring.captureProviderDegradation(name, new Error('Provider health probe failed'), { operation: 'health_probe', status: 'error', http_status: check.http_status });
    }
  }
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
  // Routes loaded AFTER db is ready so they can require db safely
  app.use('/api/auth', authLimiter, require('./routes/auth'));
  app.use('/api/legal', require('./routes/legal'));
  app.use('/api/partners', require('./routes/partners'));
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api/hotels', requireCapability('hotels'), require('./routes/hotels'));
  app.use('/api/flights', requireAuth, requireEmailVerified, requireOnboarding, requireCapability('flights'), require('./routes/flights'));
  app.use('/api/transfers', requireAuth, requireEmailVerified, requireOnboarding, require('./routes/transfers'));
  app.use('/api/users', requireAuth, require('./routes/users'));
  app.use('/api/achievements', requireAuth, require('./routes/achievements'));
  app.use('/api/ai-mode', requireAuth, requireEmailVerified, requireOnboarding, requireCapability('ai'), require('./routes/aiMode'));
  app.use('/api/bookings', requireAuth, requireEmailVerified, requireOnboarding, require('./routes/bookings'));
  app.post('/api/notifications/unsubscribe', async (req, res) => {
    const ok = await require('./services/notificationQueue').unsubscribe(String(req.body.token || req.query.token || ''));
    return ok ? res.json({ unsubscribed: true }) : res.status(400).json({ error: 'Unsubscribe link is invalid or already used' });
  });
  app.use('/api/notifications', requireAuth, requireEmailVerified, require('./routes/notifications'));
  app.use('/api/compare', requireAuth, requireEmailVerified, requireOnboarding, requireCapability('hotels'), require('./routes/compare'));
  app.use('/api/interactions', requireAuth, requireEmailVerified, requireOnboarding, require('./routes/interactions'));
  app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found', code: 'NOT_FOUND' }));
  if (sentryEnabled) Sentry.setupExpressErrorHandler(app);
  app.use((error, req, res, next) => {
    res.locals.sentryCaptured = sentryEnabled;
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
  })).catch(async err => {
    console.error('Failed to initialise database:', err);
    monitoring.captureWorkerFailure('api', err, { operation: 'startup' });
    await monitoring.flush();
    process.exit(1);
  });
}

module.exports = { app, ready };
