import * as Sentry from '@sentry/react';

export const monitoringEnabled = Boolean(import.meta.env.VITE_SENTRY_DSN);

function sentryEnvironment() {
  if (import.meta.env.VITE_SENTRY_ENVIRONMENT) return import.meta.env.VITE_SENTRY_ENVIRONMENT;
  if (window.location.hostname === 'tripalora.com' || window.location.hostname === 'www.tripalora.com') return 'production';
  if (window.location.hostname.includes('staging')) return 'staging';
  return import.meta.env.MODE || 'development';
}

export function initMonitoring() {
  if (!monitoringEnabled) return;
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: sentryEnvironment(),
    release: import.meta.env.VITE_RELEASE || undefined,
    sendDefaultPii: false,
    tracesSampleRate: Math.min(1, Math.max(0, Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE || 0.1))),
    integrations: [Sentry.browserTracingIntegration()],
    tracePropagationTargets: [/^\//],
  });
}

export function captureFrontendException(error, info = {}) {
  if (!monitoringEnabled) return null;
  return Sentry.withScope(scope => {
    scope.setLevel('error');
    scope.setTag('event.kind', 'frontend_crash');
    scope.setContext('react_error_boundary', { component_stack: String(info.componentStack || '').slice(0, 4000) });
    return Sentry.captureException(error);
  });
}
