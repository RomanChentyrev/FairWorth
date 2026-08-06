const Sentry = require('@sentry/node');

const dsn = String(process.env.SENTRY_DSN || '').trim();
const enabled = Boolean(dsn);

if (enabled) {
  Sentry.init({
    dsn,
    enabled,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE || process.env.RELEASE_SHA || undefined,
    sendDefaultPii: false,
    tracesSampleRate: Math.min(1, Math.max(0, Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1))),
    beforeSend(event) {
      if (event.request?.headers) {
        delete event.request.headers.authorization;
        delete event.request.headers.Authorization;
        delete event.request.headers.cookie;
        delete event.request.headers.Cookie;
      }
      return event;
    },
  });
}

module.exports = { Sentry, enabled };
