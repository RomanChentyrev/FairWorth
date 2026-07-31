import React from 'react';
import { useLang } from '../i18n/LanguageContext';

export default function ProviderUnavailable({ capability, compact = false }) {
  const { l } = useLang();
  const names = { hotels: l('Hotel search', 'Поиск отелей'), flights: l('Flight search', 'Поиск авиабилетов'), ai: l('AI analysis', 'ИИ-анализ'), transfers: l('Transfers', 'Трансферы'), packages: l('Trip packages', 'Пакетные поездки') };
  return <div className={`provider-state ${compact ? 'provider-state-compact' : ''}`} role="status">
    <div className="provider-state-badge">Beta</div>
    <h2>{names[capability] || capability}</h2>
    <p>{l('This section is temporarily unavailable because its live data provider is not configured locally. Demonstration prices and offers are not shown.', 'Раздел временно недоступен: реальный поставщик данных ещё не подключён локально. Демонстрационные цены и предложения не показываются.')}</p>
    <small>{l('Configure the corresponding API key in server/.env and restart the service.', 'Подключите соответствующий API-ключ в server/.env и перезапустите сервис.')}</small>
  </div>;
}
