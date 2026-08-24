/**
 * Travelpayouts Flight Data API Service
 * Docs: https://travelpayouts.github.io/slate/
 *
 * Все данные — из кэша Aviasales, обновляются каждые несколько часов.
 * Токен берётся из .env: TRAVELPAYOUTS_TOKEN
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');
const zlib  = require('zlib');
const { withRetry } = require('../utils/retry');

const BASE_V1  = 'api.travelpayouts.com';
const BASE_V2  = 'api.travelpayouts.com';
const DATA_DIR = process.env.TRAVELPAYOUTS_DATA_DIR
  || (process.env.NODE_ENV === 'production' ? '/tmp/tripalora-travelpayouts' : path.join(__dirname, '../data'));

// ─── In-memory кэш ────────────────────────────────────────────────────────────
// Структура: { [key]: { data, expiresAt } }
const memCache = {};

function cacheGet(key) {
  const entry = memCache[key];
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { delete memCache[key]; return null; }
  return entry.data;
}

function cacheSet(key, data, ttlMs) {
  memCache[key] = { data, expiresAt: Date.now() + ttlMs };
}

function validTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function markIndicativeFares(items, cacheStatus = 'provider_cached', receivedAt = new Date().toISOString()) {
  return (items || []).map(item => ({
    ...item,
    fare_type: 'indicative',
    fare_observed_at: validTimestamp(item.fare_observed_at || item.found_at || item.updated_at) || receivedAt,
    fare_received_at: validTimestamp(item.fare_received_at) || receivedAt,
    fare_cache_status: cacheStatus,
    availability_confirmed: false,
    seat_availability_confirmed: false,
    requires_provider_verification: true,
  }));
}

function cachedIndicativeFares(key) {
  const cached = cacheGet(key);
  return cached ? markIndicativeFares(cached, 'local_cache') : null;
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────
function getOnce(hostname, path, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      path,
      method: 'GET',
      headers: {
        'x-access-token': token,
        'Accept-Encoding': 'gzip, deflate',
        'User-Agent': 'Fairworth/1.0',
      },
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      const encoding = res.headers['content-encoding'];

      let stream = res;
      if (encoding === 'gzip')    stream = res.pipe(zlib.createGunzip());
      if (encoding === 'deflate') stream = res.pipe(zlib.createInflate());

      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf-8');
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const error = new Error(`Travelpayouts HTTP ${res.statusCode}: ${body.slice(0, 200)}`);
            error.status = res.statusCode;
            error.provider = 'Travelpayouts';
            reject(error);
            return;
          }
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`JSON parse error: ${e.message}`));
        }
      });
      stream.on('error', reject);
    });

    req.on('error', reject);
    req.setTimeout(Number(process.env.TRAVELPAYOUTS_TIMEOUT_MS || 25000), () => {
      const error = new Error('Travelpayouts request timed out');
      error.name = 'TimeoutError';
      error.code = 'ETIMEDOUT';
      error.provider = 'Travelpayouts';
      req.destroy(error);
    });
    req.end();
  });
}

function get(hostname, path, token) {
  return withRetry(() => getOnce(hostname, path, token), {
    attempts: 3,
    baseDelayMs: 300,
    shouldRetry: error => !error.status || error.status >= 500 || error.status === 429,
  });
}

// ─── Статичные JSON-файлы (скачиваются один раз, кэшируются на диске) ─────────
const STATIC_FILES = {
  airports:  'https://api.travelpayouts.com/data/en/airports.json',
  cities:    'https://api.travelpayouts.com/data/en/cities.json',
  countries: 'https://api.travelpayouts.com/data/en/countries.json',
  airlines:  'https://api.travelpayouts.com/data/en/airlines.json',
  planes:    'https://api.travelpayouts.com/data/en/planes.json',
};

async function fetchStaticFile(name) {
  const filePath = path.join(DATA_DIR, `${name}.json`);

  // Есть файл на диске и ему меньше 24 часов — отдаём его
  if (fs.existsSync(filePath)) {
    const stat = fs.statSync(filePath);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs < 24 * 60 * 60 * 1000) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  }

  // Скачиваем
  const url = new URL(STATIC_FILES[name]);
  const data = await get(url.hostname, url.pathname, '');
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data));
    console.log(`[travelpayouts] cached static file: ${name}.json`);
  } catch (error) {
    // Static metadata remains usable in memory when an immutable container
    // cannot persist its optional provider cache.
    console.warn(`[travelpayouts] static cache skipped for ${name}: ${error.message}`);
  }
  return data;
}

// ─── Публичные методы ─────────────────────────────────────────────────────────

/**
 * Дешёвые билеты по маршруту
 * GET /v1/prices/cheap
 */
async function cheapestTickets({ origin, destination = '-', depart_date, return_date, currency = 'USD', token }) {
  const cacheKey = `cheap:${origin}:${destination}:${depart_date}:${return_date}:${currency}`;
  const cached   = cachedIndicativeFares(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({ origin, destination, currency, token });
  if (depart_date)  params.set('depart_date', depart_date);
  if (return_date)  params.set('return_date', return_date);

  const result = await get(BASE_V1, `/v1/prices/cheap?${params}`, token);

  if (!result.success) throw new Error(result.error || 'Travelpayouts error');

  // Нормализуем ответ в массив
  const tickets = [];
  for (const [dest, byIdx] of Object.entries(result.data || {})) {
    for (const ticket of Object.values(byIdx)) {
      tickets.push({ destination: dest, ...ticket });
    }
  }

  const indicativeTickets = markIndicativeFares(tickets);
  cacheSet(cacheKey, indicativeTickets, 3 * 60 * 60 * 1000); // 3 часа
  return indicativeTickets;
}

/**
 * Только прямые (non-stop) билеты
 * GET /v1/prices/direct
 */
async function directTickets({ origin, destination, depart_date, return_date, currency = 'USD', token }) {
  const cacheKey = `direct:${origin}:${destination}:${depart_date}:${return_date}:${currency}`;
  const cached   = cachedIndicativeFares(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({ origin, destination, currency, token });
  if (depart_date) params.set('depart_date', depart_date);
  if (return_date) params.set('return_date', return_date);

  const result = await get(BASE_V1, `/v1/prices/direct?${params}`, token);
  if (!result.success) throw new Error(result.error || 'Travelpayouts error');

  const tickets = [];
  for (const [dest, byIdx] of Object.entries(result.data || {})) {
    for (const ticket of Object.values(byIdx)) {
      tickets.push({ destination: dest, ...ticket, direct: true });
    }
  }

  const indicativeTickets = markIndicativeFares(tickets);
  cacheSet(cacheKey, indicativeTickets, 3 * 60 * 60 * 1000);
  return indicativeTickets;
}

/**
 * Цены за каждый день месяца (для ценового календаря)
 * GET /v1/prices/calendar
 */
async function priceCalendar({ origin, destination, depart_date, return_date, currency = 'USD', token }) {
  const cacheKey = `calendar:${origin}:${destination}:${depart_date}:${return_date}:${currency}`;
  const cached   = cachedIndicativeFares(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({
    origin, destination, currency, token,
    depart_date,
    calendar_type: 'departure_date',
  });
  if (return_date) params.set('return_date', return_date);

  const result = await get(BASE_V1, `/v1/prices/calendar?${params}`, token);
  if (!result.success) throw new Error(result.error || 'Travelpayouts error');

  // Превращаем объект { "2025-06-01": {...}, ... } в отсортированный массив
  const days = Object.entries(result.data || {})
    .map(([date, info]) => ({ date, ...info }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const indicativeDays = markIndicativeFares(days);
  cacheSet(cacheKey, indicativeDays, 3 * 60 * 60 * 1000);
  return indicativeDays;
}

/**
 * Популярные направления из города
 * GET /v1/city-directions
 */
async function popularDestinations({ origin, currency = 'USD', token }) {
  const cacheKey = `popular:${origin}:${currency}`;
  const cached   = cachedIndicativeFares(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({ origin, currency, token });
  const result = await get(BASE_V1, `/v1/city-directions?${params}`, token);
  if (!result.success) throw new Error(result.error || 'Travelpayouts error');

  const destinations = Object.entries(result.data || {})
    .map(([dest, info]) => ({ destination: dest, ...info }))
    .sort((a, b) => a.price - b.price)
    .slice(0, 20);

  const indicativeDestinations = markIndicativeFares(destinations);
  cacheSet(cacheKey, indicativeDestinations, 6 * 60 * 60 * 1000); // 6 часов
  return indicativeDestinations;
}

/**
 * Несколько вариантов по датам через Aviasales v3.
 * Хорошо подходит для top-N: возвращает duration_to, аэропорты и gate.
 */
async function pricesForDates({ origin, destination, depart_date, return_date, currency = 'USD', limit = 5, direct = false, token }) {
  const cacheKey = `prices-for-dates:${origin}:${destination}:${depart_date}:${return_date}:${currency}:${limit}:${direct}`;
  const cached = cachedIndicativeFares(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({
    origin,
    destination,
    currency,
    sorting: 'price',
    direct: direct ? 'true' : 'false',
    limit: String(limit),
    token,
  });
  if (depart_date) params.set('departure_at', depart_date);
  if (return_date) params.set('return_at', return_date);

  const result = await get(BASE_V2, `/aviasales/v3/prices_for_dates?${params}`, token);
  if (!result.success) throw new Error(result.error || 'Travelpayouts error');

  const tickets = markIndicativeFares(Array.isArray(result.data) ? result.data : []);
  cacheSet(cacheKey, tickets, 60 * 60 * 1000);
  return tickets;
}

/**
 * Статичные данные — аэропорты, города, авиакомпании, страны
 */
async function getAirports()  { return fetchStaticFile('airports'); }
async function getCities()    { return fetchStaticFile('cities'); }
async function getCountries() { return fetchStaticFile('countries'); }
async function getAirlines()  { return fetchStaticFile('airlines'); }
async function getPlanes()    { return fetchStaticFile('planes'); }

function normalizeSearchTerm(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\p{L}]+/gu, ' ')
    .trim();
}

function editDistance(left, right) {
  const a = normalizeSearchTerm(left);
  const b = normalizeSearchTerm(right);
  if (!a) return b.length;
  if (!b) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const diagonal = previous;
      previous = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return row[b.length];
}

function fuzzyPlaceScore(query, values) {
  const normalizedQuery = normalizeSearchTerm(query);
  if (normalizedQuery.length < 4) return 0;
  return values.reduce((best, value) => {
    const normalizedValue = normalizeSearchTerm(value);
    if (!normalizedValue) return best;
    const distance = editDistance(normalizedQuery, normalizedValue);
    const similarity = 1 - distance / Math.max(normalizedQuery.length, normalizedValue.length);
    return Math.max(best, similarity);
  }, 0);
}

/**
 * Поиск аэропорта/города по строке (для автокомплита)
 */
async function searchAirports(query) {
  const airports = await getAirports();
  const cities   = await getCities();
  const q        = query.toLowerCase();

  const results = [];

  // Ищем среди аэропортов
  for (const ap of Object.values(airports)) {
    if (!ap.iata_type) continue; // пропускаем без IATA
    const name    = (ap.name || '').toLowerCase();
    const nameRu  = (ap.name_translations?.ru || '').toLowerCase();
    const cityName = (ap.city_name || '').toLowerCase();
    const code    = (ap.code || '').toLowerCase();

    if (name.includes(q) || nameRu.includes(q) || cityName.includes(q) || code.includes(q)) {
      results.push({
        type:     'airport',
        code:     ap.code,
        name:     ap.name,
        name_ru:  ap.name_translations?.ru,
        city:     ap.city_name,
        country:  ap.country_code,
      });
    }
    if (results.length >= 10) break;
  }

  // Если мало — добавляем города
  if (results.length < 10) {
    for (const city of Object.values(cities)) {
      const name   = (city.name || '').toLowerCase();
      const nameRu = (city.name_translations?.ru || '').toLowerCase();
      const code   = (city.code || '').toLowerCase();

      if (name.includes(q) || nameRu.includes(q) || code.includes(q)) {
        if (!results.find(r => r.code === city.code)) {
          results.push({
            type:    'city',
            code:    city.code,
            name:    city.name,
            name_ru: city.name_translations?.ru,
            country: city.country_code,
          });
        }
      }
      if (results.length >= 10) break;
    }
  }

  if (results.length) return results.slice(0, 10);

  // Autocomplete must remain useful when a conversational query contains a
  // small typo (for example "Nha Thang" instead of "Nha Trang").
  const fuzzy = [];
  for (const city of Object.values(cities)) {
    const score = fuzzyPlaceScore(query, [city.name, city.name_translations?.ru, city.code]);
    if (score >= 0.78) fuzzy.push({
      type: 'city', code: city.code, name: city.name,
      name_ru: city.name_translations?.ru, country: city.country_code, match_score: score,
    });
  }
  for (const ap of Object.values(airports)) {
    if (!ap.iata_type) continue;
    const score = fuzzyPlaceScore(query, [ap.name, ap.name_translations?.ru, ap.city_name, ap.code]);
    if (score >= 0.78) fuzzy.push({
      type: 'airport', code: ap.code, name: ap.name,
      name_ru: ap.name_translations?.ru, city: ap.city_name,
      country: ap.country_code, match_score: score,
    });
  }
  return fuzzy
    .sort((left, right) => right.match_score - left.match_score || Number(left.type !== 'city') - Number(right.type !== 'city'))
    .filter((item, index, list) => list.findIndex(candidate => candidate.code === item.code && candidate.type === item.type) === index)
    .slice(0, 10);
}

module.exports = {
  cheapestTickets,
  directTickets,
  priceCalendar,
  pricesForDates,
  popularDestinations,
  getAirports,
  getCities,
  getCountries,
  getAirlines,
  getPlanes,
  searchAirports,
  fuzzyPlaceScore,
  markIndicativeFares,
};
