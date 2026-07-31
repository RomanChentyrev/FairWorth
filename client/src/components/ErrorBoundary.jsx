import React from 'react';
import * as Sentry from '@sentry/react';
import { LanguageContext } from '../i18n/LanguageContext';

export default class ErrorBoundary extends React.Component {
  static contextType = LanguageContext;
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { Sentry.captureException(error, { extra: info }); }
  reload = () => {
    try { window.sessionStorage.removeItem('fairworth_hotel_results_cache'); } catch { /* Storage may be unavailable. */ }
    window.location.reload();
  };
  render() {
    if (!this.state.error) return this.props.children;
    const l = this.context?.l || (english => english);
    return <main className="system-page"><h1>{l('Something went wrong', 'Что-то пошло не так')}</h1><p>{l('The error was recorded. Reload the page to continue.', 'Ошибка записана. Перезагрузите страницу, чтобы продолжить.')}</p><button onClick={this.reload}>{l('Reload', 'Перезагрузить')}</button></main>;
  }
}
