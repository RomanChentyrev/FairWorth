const { Sentry, enabled } = require('../instrument');

const providerEvents = new Map();
const workerEvents = new Map();
const PROVIDER_EVENT_INTERVAL_MS = Math.max(60000, Number(process.env.SENTRY_PROVIDER_EVENT_INTERVAL_MS || 300000));

function requestPath(req) {
  return String(req.originalUrl || req.url || '').split('?')[0];
}

function safeError(error) {
  return {
    name: String(error?.name || 'Error').slice(0, 100),
    code: String(error?.code || '').slice(0, 100) || undefined,
    message: String(error?.message || error || 'Unknown provider error')
      .replace(/(api[_-]?key|token|authorization|secret)=?[^\s&,]*/gi, '$1=[redacted]')
      .slice(0, 500),
  };
}

function captureProviderDegradation(provider, error, context = {}) {
  if (!enabled) return null;
  const status = context.status || (/timed?\s*out|timeout/i.test(String(error?.message || '')) ? 'timeout' : 'error');
  const key = `${provider}:${status}:${context.operation || 'request'}`;
  const previous = providerEvents.get(key) || 0;
  if (Date.now() - previous < PROVIDER_EVENT_INTERVAL_MS) return null;
  providerEvents.set(key, Date.now());
  return Sentry.withScope(scope => {
    scope.setLevel(status === 'timeout' ? 'warning' : 'error');
    scope.setTag('event.kind', 'provider_degraded');
    scope.setTag('provider', String(provider).toLowerCase());
    scope.setTag('provider.status', status);
    if (context.operation) scope.setTag('provider.operation', context.operation);
    scope.setFingerprint(['provider_degraded', String(provider).toLowerCase(), status, context.operation || 'request']);
    scope.setContext('provider_failure', { ...safeError(error), ...context });
    return Sentry.captureMessage(`Provider degraded: ${provider}`);
  });
}

function requestMonitor(req, res, next) {
  res.on('finish', () => {
    if (!enabled || res.statusCode < 500 || res.locals.sentryCaptured) return;
    Sentry.withScope(scope => {
      scope.setLevel('error');
      scope.setTag('event.kind', 'http_5xx');
      scope.setTag('http.status_code', String(res.statusCode));
      scope.setTag('http.method', req.method);
      scope.setFingerprint(['http_5xx', req.method, requestPath(req), String(res.statusCode)]);
      scope.setContext('http_failure', { method: req.method, path: requestPath(req), status_code: res.statusCode });
      Sentry.captureMessage(`HTTP ${res.statusCode}: ${req.method} ${requestPath(req)}`);
    });
  });
  next();
}

function captureWorkerFailure(worker, error, context = {}) {
  if (!enabled) return null;
  const key = `${worker}:${context.operation || 'cycle'}`;
  const previous = workerEvents.get(key) || 0;
  if (Date.now() - previous < PROVIDER_EVENT_INTERVAL_MS) return null;
  workerEvents.set(key, Date.now());
  return Sentry.withScope(scope => {
    scope.setLevel('error');
    scope.setTag('event.kind', 'worker_failure');
    scope.setTag('worker', worker);
    scope.setContext('worker_failure', { ...safeError(error), ...context });
    return Sentry.captureException(error instanceof Error ? error : new Error(String(error)));
  });
}

async function flush(timeout = 2000) {
  if (!enabled) return true;
  return Sentry.flush(timeout);
}

module.exports = {
  enabled,
  requestMonitor,
  captureProviderDegradation,
  captureWorkerFailure,
  flush,
};
