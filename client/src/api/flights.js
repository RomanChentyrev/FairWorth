/**
 * Fairworth — API client для авиабилетов
 * Использование: import { flightsApi } from '../api/flights';
 */

const BASE = '/api/flights';

async function request(path) {
  const res = await fetch(BASE + path);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Дешёвые билеты по маршруту
 * @param {string} origin     - IATA города вылета, напр. "MOW"
 * @param {string} destination - IATA города прилёта или "-" (все)
 * @param {string} departDate  - "2026-08" или "2026-08-15"
 * @param {string} returnDate  - опционально
 * @param {string} currency    - "USD" | "RUB" | "EUR"
 */
export async function getCheapestTickets({ origin, destination = '-', departDate, returnDate, currency = 'USD' }) {
  const params = new URLSearchParams({ origin, destination, currency });
  if (departDate) params.set('depart_date', departDate);
  if (returnDate) params.set('return_date', returnDate);
  return request(`/cheapest?${params}`);
}

/**
 * Только прямые рейсы
 */
export async function getDirectTickets({ origin, destination, departDate, returnDate, currency = 'USD' }) {
  const params = new URLSearchParams({ origin, destination, currency });
  if (departDate) params.set('depart_date', departDate);
  if (returnDate) params.set('return_date', returnDate);
  return request(`/direct?${params}`);
}

/**
 * Most suitable tickets.
 * Сейчас это прямые рейсы без пересадок; позже сюда можно добавить Fairworth Index.
 */
export async function getMostSuitableTickets({ origin, destination, departDate, returnDate, currency = 'USD' }) {
  const params = new URLSearchParams({ origin, destination, currency });
  if (departDate) params.set('depart_date', departDate);
  if (returnDate) params.set('return_date', returnDate);
  return request(`/most-suitable?${params}`);
}

/**
 * Ценовой календарь на месяц
 * Возвращает массив { date, price, airline, ... } + stats { min, max, avg, cheap[] }
 */
export async function getPriceCalendar({ origin, destination, departDate, returnDate, currency = 'USD' }) {
  const params = new URLSearchParams({ origin, destination, depart_date: departDate, currency });
  if (returnDate) params.set('return_date', returnDate);
  return request(`/calendar?${params}`);
}

/**
 * Популярные направления из города
 * Возвращает массив { destination, price, airline, city_info, ... }
 */
export async function getPopularDestinations({ origin, currency = 'USD' }) {
  return request(`/popular?origin=${origin}&currency=${currency}`);
}

/**
 * Поиск аэропорта / города (для автокомплита)
 * @param {string} query - минимум 2 символа
 */
export async function searchAirports(query) {
  if (!query || query.length < 2) return { data: [] };
  return request(`/airports/search?q=${encodeURIComponent(query)}`);
}

/**
 * Полный справочник аэропортов Travelpayouts en/airports.json
 */
export async function getAirports() {
  return request('/airports');
}

/**
 * Все авиакомпании
 */
export async function getAirlines() {
  return request('/airlines');
}

export const flightsApi = {
  getCheapestTickets,
  getDirectTickets,
  getMostSuitableTickets,
  getPriceCalendar,
  getPopularDestinations,
  searchAirports,
  getAirports,
  getAirlines,
};
