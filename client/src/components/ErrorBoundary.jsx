import React from 'react';
import * as Sentry from '@sentry/react';

export default class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { Sentry.captureException(error, { extra: info }); }
  reload = () => {
    try { window.sessionStorage.removeItem('fairworth_hotel_results_cache'); } catch { /* Storage may be unavailable. */ }
    window.location.reload();
  };
  render() {
    if (!this.state.error) return this.props.children;
    return <main className="system-page"><h1>Something went wrong</h1><p>The error was recorded. Reload the page to continue.</p><button onClick={this.reload}>Reload</button></main>;
  }
}
