import React from 'react';
import { useParams } from 'react-router-dom';
import { useLang } from '../i18n/LanguageContext';
export default function LegalPage() {
  const { type } = useParams(); const { lang } = useLang(); const privacy = type === 'privacy';
  return <main className="legal-page"><h1>{privacy ? (lang === 'ru' ? 'Политика конфиденциальности' : 'Privacy Policy') : (lang === 'ru' ? 'Условия использования' : 'Terms of Service')}</h1>
    {privacy ? <><p>{lang === 'ru' ? 'Fairworth хранит данные аккаунта, предпочтения и, только с вашего согласия, поведенческие события для персонализации Score.' : 'Fairworth stores account data, preferences and, only with your consent, behavioural events to personalise the Score.'}</p><p>{lang === 'ru' ? 'Мы не собираем дату рождения. Вы можете экспортировать или удалить свои данные в настройках аккаунта.' : 'We do not collect your date of birth. You can export or delete your data in account settings.'}</p></> : <><p>{lang === 'ru' ? 'Fairworth предоставляет сравнительную информацию, а бронирование выполняется внешним поставщиком.' : 'Fairworth provides comparison information; bookings are completed by external providers.'}</p><p>{lang === 'ru' ? 'Цены и доступность могут меняться. Проверьте итоговые условия у поставщика перед оплатой.' : 'Prices and availability may change. Confirm final terms with the provider before payment.'}</p></>}</main>;
}
