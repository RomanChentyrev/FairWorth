import React from 'react';
import { useLang } from '../i18n/LanguageContext';

export default function ProviderUnavailable({ capability, compact = false }) {
  const { lang } = useLang(); const ru = lang === 'ru';
  const names = { hotels: ru ? 'Поиск отелей' : 'Hotel search', flights: ru ? 'Поиск авиабилетов' : 'Flight search', ai: ru ? 'ИИ-анализ' : 'AI analysis', transfers: ru ? 'Трансферы' : 'Transfers', packages: ru ? 'Пакетные поездки' : 'Trip packages' };
  return <div className={`provider-state ${compact ? 'provider-state-compact' : ''}`} role="status">
    <div className="provider-state-badge">Beta</div>
    <h2>{names[capability] || capability}</h2>
    <p>{ru ? 'Раздел временно недоступен: реальный поставщик данных ещё не подключён локально. Демонстрационные цены и предложения не показываются.' : 'This section is temporarily unavailable because its live data provider is not configured locally. Demonstration prices and offers are not shown.'}</p>
    <small>{ru ? 'Подключите соответствующий API-ключ в server/.env и перезапустите сервис.' : 'Configure the corresponding API key in server/.env and restart the service.'}</small>
  </div>;
}
