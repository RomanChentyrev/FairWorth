import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Hotel, Plane, ShieldCheck, UserRound } from 'lucide-react';
import { bookingsApi, usersApi } from '../api';
import { useTripBasket } from '../context/TripBasketContext';
import { useLang } from '../i18n/LanguageContext';
import { formatAmount } from '../utils/money';
import styles from './DemoBookingPage.module.css';

const blankTraveler = () => ({ first_name: '', last_name: '', birth_date: '', gender: 'unspecified', nationality: '', document_type: 'passport', document_number: '', document_expiry: '' });

export default function DemoBookingPage() {
  const { lang } = useLang();
  const ru = lang === 'ru';
  const { basket, clearBasket } = useTripBasket();
  const passengerCount = Math.max(1, Number(basket.outboundFlight?.passengers || basket.returnFlight?.passengers || 1));
  const [travelers, setTravelers] = useState(() => Array.from({ length: passengerCount }, blankTraveler));
  const [contact, setContact] = useState({ email: '', phone: '', special_requests: '' });
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState(null);
  const flights = useMemo(() => [basket.outboundFlight, basket.returnFlight].filter(Boolean), [basket]);
  const hotelTotal = Number(basket.hotel?.totalPrice || 0);
  const flightsTotal = flights.reduce((sum, flight) => sum + Number(flight.totalPrice || 0), 0);
  const grandTotal = hotelTotal + flightsTotal;

  useEffect(() => {
    usersApi.getMe().then(response => setContact(current => ({ ...current, email: response.data.user.email || '', phone: response.data.user.phone || '' }))).catch(() => {});
  }, []);

  const updateTraveler = (index, key, value) => setTravelers(current => current.map((traveler, itemIndex) => itemIndex === index ? { ...traveler, [key]: value } : traveler));

  const submit = async event => {
    event.preventDefault();
    if (!basket.hotel || !basket.outboundFlight) return;
    setSubmitting(true); setError('');
    try {
      const response = await bookingsApi.createDemo({
        currency: 'USD',
        hotel: {
          id: basket.hotel.id, name: basket.hotel.name, city: basket.hotel.city || '',
          checkIn: basket.hotel.checkIn, checkOut: basket.hotel.checkOut,
          nights: Number(basket.hotel.nights), totalPrice: Number(basket.hotel.totalPrice),
        },
        flights: flights.map(flight => ({
          flightId: flight.flightId, title: flight.title, originCode: flight.originCode,
          destinationCode: flight.destinationCode, date: flight.date,
          departureTime: flight.departureTime || '', arrivalTime: flight.arrivalTime || '',
          provider: flight.provider || '', cabinClass: flight.cabinClass || '',
          passengers: Number(flight.passengers), totalPrice: Number(flight.totalPrice),
        })), contact_email: contact.email, contact_phone: contact.phone,
        travelers, special_requests: contact.special_requests || undefined, accept_demo_terms: accepted,
      });
      setConfirmation(response.data.booking);
      clearBasket();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (requestError) {
      setError(requestError.response?.data?.details?.[0]?.message || requestError.response?.data?.error || (ru ? 'Не удалось создать демо-бронь.' : 'Could not create the demo booking.'));
    } finally { setSubmitting(false); }
  };

  if (confirmation) return (
    <main className={styles.confirmation}>
      <CheckCircle2 size={48} />
      <span>{ru ? 'Демо-бронирование подтверждено' : 'Demo booking confirmed'}</span>
      <h1>{confirmation.reference}</h1>
      <p>{ru ? 'Оплата не списывалась. Мы сохранили это подтверждение в вашем аккаунте.' : 'No payment was charged. This confirmation has been saved to your account.'}</p>
      <div className={styles.confirmTotal}>${formatAmount(confirmation.grand_total, lang)}</div>
      <Link to="/">{ru ? 'Вернуться на главную' : 'Back to home'}</Link>
    </main>
  );

  if (!basket.hotel || !basket.outboundFlight) return (
    <main className="system-page"><h1>{ru ? 'Поездка ещё не собрана' : 'Your trip is not ready'}</h1><p>{ru ? 'Для демо-бронирования добавьте в корзину отель и авиабилет туда.' : 'Add a hotel and an outbound flight before starting the demo booking.'}</p><Link to="/">{ru ? 'Собрать поездку' : 'Build a trip'}</Link></main>
  );

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <span>{ru ? 'Без списания средств' : 'No payment will be charged'}</span>
        <h1>{ru ? 'Демо-бронирование поездки' : 'Demo trip booking'}</h1>
        <p>{ru ? 'Проверьте поездку и заполните данные путешественников.' : 'Review your trip and enter the traveler details.'}</p>
      </header>
      <form className={styles.layout} onSubmit={submit}>
        <div className={styles.formColumn}>
          <section className={styles.section}>
            <div className={styles.sectionTitle}><UserRound size={18} /><div><h2>{ru ? 'Контактные данные' : 'Contact details'}</h2><p>{ru ? 'Для подтверждения и связи по поездке' : 'For confirmations and trip updates'}</p></div></div>
            <div className={styles.fields}>
              <label><span>Email</span><input type="email" required value={contact.email} onChange={event => setContact({ ...contact, email: event.target.value })} /></label>
              <label><span>{ru ? 'Телефон' : 'Phone'}</span><input type="tel" required value={contact.phone} onChange={event => setContact({ ...contact, phone: event.target.value })} /></label>
            </div>
          </section>
          {travelers.map((traveler, index) => (
            <section className={styles.section} key={index}>
              <div className={styles.sectionTitle}><UserRound size={18} /><div><h2>{ru ? `Путешественник ${index + 1}` : `Traveler ${index + 1}`}</h2><p>{index === 0 ? (ru ? 'Основной гость отеля' : 'Lead hotel guest') : (ru ? 'Данные пассажира' : 'Passenger details')}</p></div></div>
              <div className={styles.fields}>
                <label><span>{ru ? 'Имя латиницей' : 'First name'}</span><input required value={traveler.first_name} onChange={event => updateTraveler(index, 'first_name', event.target.value)} /></label>
                <label><span>{ru ? 'Фамилия латиницей' : 'Last name'}</span><input required value={traveler.last_name} onChange={event => updateTraveler(index, 'last_name', event.target.value)} /></label>
                <label><span>{ru ? 'Дата рождения' : 'Date of birth'}</span><input type="date" required max={new Date().toISOString().slice(0, 10)} value={traveler.birth_date} onChange={event => updateTraveler(index, 'birth_date', event.target.value)} /></label>
                <label><span>{ru ? 'Пол' : 'Gender'}</span><select value={traveler.gender} onChange={event => updateTraveler(index, 'gender', event.target.value)}><option value="unspecified">{ru ? 'Не указывать' : 'Prefer not to say'}</option><option value="female">{ru ? 'Женский' : 'Female'}</option><option value="male">{ru ? 'Мужской' : 'Male'}</option></select></label>
                <label><span>{ru ? 'Гражданство' : 'Nationality'}</span><input required value={traveler.nationality} onChange={event => updateTraveler(index, 'nationality', event.target.value)} /></label>
                <label><span>{ru ? 'Документ' : 'Document type'}</span><select value={traveler.document_type} onChange={event => updateTraveler(index, 'document_type', event.target.value)}><option value="passport">{ru ? 'Загранпаспорт' : 'Passport'}</option><option value="national_id">ID</option></select></label>
                <label><span>{ru ? 'Номер документа' : 'Document number'}</span><input required minLength="4" value={traveler.document_number} onChange={event => updateTraveler(index, 'document_number', event.target.value)} /></label>
                <label><span>{ru ? 'Срок действия' : 'Document expiry'}</span><input type="date" required min={new Date().toISOString().slice(0, 10)} value={traveler.document_expiry} onChange={event => updateTraveler(index, 'document_expiry', event.target.value)} /></label>
              </div>
            </section>
          ))}
          <section className={styles.section}>
            <label className={styles.fullField}><span>{ru ? 'Пожелания к отелю' : 'Hotel requests'}</span><textarea rows="3" maxLength="1000" value={contact.special_requests} onChange={event => setContact({ ...contact, special_requests: event.target.value })} placeholder={ru ? 'Например, тихий номер или поздний заезд' : 'For example, a quiet room or late arrival'} /></label>
          </section>
        </div>
        <aside className={styles.summary}>
          <h2>{ru ? 'Ваша поездка' : 'Your trip'}</h2>
          <div className={styles.summaryItem}><Hotel size={18} /><div><strong>{basket.hotel.name}</strong><span>{basket.hotel.city} · {basket.hotel.checkIn} — {basket.hotel.checkOut}</span></div><b>${formatAmount(hotelTotal, lang)}</b></div>
          {flights.map((flight, index) => <div className={styles.summaryItem} key={`${flight.flightId}-${index}`}><Plane size={18} /><div><strong>{flight.title}</strong><span>{flight.originCode} → {flight.destinationCode} · {flight.date}</span></div><b>${formatAmount(flight.totalPrice, lang)}</b></div>)}
          <div className={styles.breakdown}><div><span>{ru ? 'Отель' : 'Hotel'}</span><strong>${formatAmount(hotelTotal, lang)}</strong></div><div><span>{ru ? 'Перелёты' : 'Flights'}</span><strong>${formatAmount(flightsTotal, lang)}</strong></div><div className={styles.grandTotal}><span>{ru ? 'Итого' : 'Total'}</span><strong>${formatAmount(grandTotal, lang)}</strong></div></div>
          <label className={styles.accept}><input type="checkbox" required checked={accepted} onChange={event => setAccepted(event.target.checked)} /><span>{ru ? 'Я понимаю, что это демонстрация и реальное бронирование или списание средств не производится.' : 'I understand this is a demonstration and no real reservation or payment will be made.'}</span></label>
          {error && <p className={styles.error}>{error}</p>}
          <button className={styles.submit} type="submit" disabled={submitting || !accepted}>{submitting ? (ru ? 'Подтверждаем...' : 'Confirming...') : (ru ? `Подтвердить демо-бронь · $${formatAmount(grandTotal, lang)}` : `Confirm demo booking · $${formatAmount(grandTotal, lang)}`)}</button>
          <div className={styles.secure}><ShieldCheck size={14} />{ru ? 'Полный номер документа не сохраняется' : 'Full document numbers are not stored'}</div>
        </aside>
      </form>
    </main>
  );
}
