const { withRetry } = require('../utils/retry');

const BASE_URL = () => (process.env.LITEAPI_BASE_URL || 'https://api.liteapi.travel/v3.0').replace(/\/$/, '');
let facilitiesCache = null;

function configured() {
  return Boolean(process.env.LITEAPI_KEY);
}

async function request(path, options = {}) {
  if (!configured()) throw new Error('LITEAPI_KEY is not configured');
  return withRetry(async () => {
    const response = await fetch(`${BASE_URL()}${path}`, {
      ...options,
      signal: AbortSignal.timeout(Number(process.env.LITEAPI_TIMEOUT_MS || 25000)),
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'X-API-Key': process.env.LITEAPI_KEY,
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text }; }
    if (!response.ok) {
      const error = new Error(`LiteAPI HTTP ${response.status}: ${body.message || body.error || 'request failed'}`);
      error.status = response.status;
      throw error;
    }
    return body;
  }, { attempts: 3, baseDelayMs: 400 });
}

async function getHotels({ iataCode, countryCode, latitude, longitude, offset = 0, limit = 100 }) {
  const params = new URLSearchParams({ offset: String(offset), limit: String(limit) });
  if (iataCode) params.set('iataCode', iataCode);
  if (countryCode) params.set('countryCode', countryCode);
  if (latitude != null) params.set('latitude', String(latitude));
  if (longitude != null) params.set('longitude', String(longitude));
  return request(`/data/hotels?${params}`);
}

async function getFacilities() {
  if (facilitiesCache && facilitiesCache.expiresAt > Date.now()) return facilitiesCache.data;
  const result = await request('/data/facilities');
  const data = Array.isArray(result.data) ? result.data : [];
  facilitiesCache = { data, expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
  return data;
}

async function getRates({ hotelIds, checkIn, checkOut, currency = 'USD', guestNationality = 'US', adults = 2, children = [] }) {
  if (!hotelIds?.length) return [];
  const result = await request('/hotels/rates', {
    method: 'POST',
    body: JSON.stringify({
      hotelIds,
      checkin: checkIn,
      checkout: checkOut,
      currency,
      guestNationality,
      occupancies: [{ adults, children }],
      includeHotelData: true,
    }),
  });
  return Array.isArray(result.data) ? result.data : [];
}

module.exports = { configured, getHotels, getFacilities, getRates };
