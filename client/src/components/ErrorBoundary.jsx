import React from 'react';
import { LanguageContext } from '../i18n/LanguageContext';
import { captureFrontendException, monitoringEnabled } from '../monitoring';

export default class ErrorBoundary extends React.Component {
  static contextType = LanguageContext;
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { captureFrontendException(error, info); }
  reload = () => {
    try { window.sessionStorage.removeItem('fairworth_hotel_results_cache'); } catch { /* Storage may be unavailable. */ }
    window.location.reload();
  };
  render() {
    if (!this.state.error) return this.props.children;
    const l = this.context?.l || (english => english);
    const message = monitoringEnabled
      ? l('The error was recorded. Reload the page to continue.', 'Ошибка записана. Перезагрузите страницу, чтобы продолжить.')
      : l('Reload the page to continue.', 'Перезагрузите страницу, чтобы продолжить.');
    return <main className="system-page"><h1>{l('Something went wrong', 'Что-то пошло не так')}</h1><p>{message}</p><button onClick={this.reload}>{l('Reload', 'Перезагрузить')}</button></main>;
  }
}
