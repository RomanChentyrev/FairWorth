import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { hotelsApi } from '../api';
import { useLang } from '../i18n/LanguageContext';
import styles from './PriceCalendar.module.css';
import { formatAmount } from '../utils/money';

function parseDate(value) {
  return new Date(`${value}T00:00:00`);
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date, months) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function monthLabel(date, lang) {
  return new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : 'en-US', {
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function getNights(checkIn, checkOut) {
  const nights = Math.ceil((parseDate(checkOut) - parseDate(checkIn)) / (1000 * 60 * 60 * 24));
  return Number.isFinite(nights) && nights > 0 ? nights : 4;
}

export default function PriceCalendar({ city, checkIn, checkOut, onSelectDate }) {
  const { t, lang } = useLang();
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(parseDate(checkIn)));
  const [calendar, setCalendar] = useState([]);
  const [recommendation, setRecommendation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [selectingEnd, setSelectingEnd] = useState(false);

  const nights = getNights(checkIn, checkOut);
  const calendarByDate = useMemo(() => {
    const map = new Map();
    calendar.forEach(day => map.set(day.date, day));
    return map;
  }, [calendar]);

  useEffect(() => {
    setVisibleMonth(startOfMonth(parseDate(checkIn)));
  }, [checkIn]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    hotelsApi.priceCalendar({
      city: city || 'Singapore',
      start: formatDate(visibleMonth),
      days: 42,
      nights,
      check_in: checkIn,
      check_out: checkOut,
    }, { signal: controller.signal })
      .then(res => {
        setCalendar(res.data.calendar || []);
        setRecommendation(res.data.recommendation || null);
      })
      .catch(err => {
        if (err.name !== 'CanceledError' && err.code !== 'ERR_CANCELED') setError(true);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [city, visibleMonth, checkIn, checkOut, nights]);

  const cells = useMemo(() => {
    const first = startOfMonth(visibleMonth);
    const mondayOffset = (first.getDay() + 6) % 7;
    const gridStart = addDays(first, -mondayOffset);
    return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  }, [visibleMonth]);

  const handleSelect = (date) => {
    const selectedDate = formatDate(date);
    const selectedTime = parseDate(selectedDate).getTime();
    const checkInTime = parseDate(checkIn).getTime();
    const checkOutTime = parseDate(checkOut).getTime();

    if (!selectingEnd || selectedTime <= checkInTime) {
      onSelectDate(selectedDate, formatDate(addDays(date, Math.max(1, nights))));
      setSelectingEnd(true);
      return;
    }

    onSelectDate(checkIn, selectedDate);
    setSelectingEnd(false);
  };

  const recText = recommendation
    ? t('calendar_ai_tip')
        .replace('{days}', Math.abs(recommendation.shift_days))
        .replace('{percent}', recommendation.savings_percent)
        .replace('{amount}', formatAmount(recommendation.savings_amount, lang))
    : t('calendar_ai_default');

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <button type="button" className={styles.navBtn} onClick={() => setVisibleMonth(m => addMonths(m, -1))} aria-label={t('calendar_prev')}>
          <ChevronLeft size={15} />
        </button>
        <div>
          <div className={styles.title}>{t('calendar_title')}</div>
          <div className={styles.month}>{monthLabel(visibleMonth, lang)}</div>
        </div>
        <button type="button" className={styles.navBtn} onClick={() => setVisibleMonth(m => addMonths(m, 1))} aria-label={t('calendar_next')}>
          <ChevronRight size={15} />
        </button>
      </div>

      <div className={styles.weekdays}>
        {(lang === 'ru' ? ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'] : ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']).map(day => (
          <span key={day}>{day}</span>
        ))}
      </div>

      <div className={styles.grid}>
        {cells.map(date => {
          const dateKey = formatDate(date);
          const day = calendarByDate.get(dateKey);
          const inMonth = date.getMonth() === visibleMonth.getMonth();
          const time = parseDate(dateKey).getTime();
          const checkInTime = parseDate(checkIn).getTime();
          const checkOutTime = parseDate(checkOut).getTime();
          const isStart = dateKey === checkIn;
          const isEnd = dateKey === checkOut;
          const inRange = time > checkInTime && time < checkOutTime;
          return (
            <button
              type="button"
              key={dateKey}
              className={`${styles.day} ${!inMonth ? styles.dayMuted : ''} ${day ? styles[day.price_level] : ''} ${inRange ? styles.inRange : ''} ${isStart ? styles.rangeStart : ''} ${isEnd ? styles.rangeEnd : ''}`}
              onClick={() => handleSelect(date)}
            >
              <span className={styles.dayNum}>{date.getDate()}</span>
              {(isStart || isEnd) && <span className={styles.marker}>{isStart ? t('calendar_start') : t('calendar_end')}</span>}
            </button>
          );
        })}
      </div>

      <div className={styles.legend}>
        <span><i className={styles.lowDot} /> {t('calendar_low')}</span>
        <span><i className={styles.midDot} /> {t('calendar_mid')}</span>
        <span><i className={styles.highDot} /> {t('calendar_high')}</span>
      </div>

      <div className={styles.aiBox}>
        <Sparkles size={13} />
        <span>{selectingEnd ? t('calendar_select_end') : loading ? t('calendar_loading') : error ? t('calendar_error') : recText}</span>
      </div>
    </div>
  );
}
