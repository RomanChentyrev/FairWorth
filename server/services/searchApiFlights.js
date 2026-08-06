const https = require('https');
const crypto = require('crypto');
const { withRetry } = require('../utils/retry');
const { possibleAirports } = require('./flightRouteGraph');

const HOSTNAME = 'www.searchapi.io';
const SEARCH_PATH = '/api/v1/search';
const searchCache = new Map();

function requestJson({ path, apiKey }) {
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: HOSTNAME,
      path,
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': 'Tripalora/1.0',
      },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let payload;
        try { payload = text ? JSON.parse(text) : {}; } catch { payload = {}; }
        if (response.statusCode < 200 || response.statusCode >= 300 || payload.error) {
          const detail = payload?.error || payload?.message || `HTTP ${response.statusCode}`;
          const error = new Error(`SearchAPI request failed: ${detail}`);
          error.status = response.statusCode;
          error.provider = 'SearchAPI';
          reject(error);
          return;
        }
        resolve(payload);
      });
    });
    request.on('error', error => {
      error.provider = 'SearchAPI';
      reject(error);
    });
    request.setTimeout(Number(process.env.SEARCHAPI_TIMEOUT_MS || 30000), () => {
      const error = new Error('SearchAPI request timed out');
      error.name = 'TimeoutError';
      error.code = 'ETIMEDOUT';
      error.provider = 'SearchAPI';
      request.destroy(error);
    });
    request.end();
  });
}

function dateTime(airport) {
  if (!airport?.date || !airport?.time) return null;
  return `${airport.date}T${airport.time}:00`;
}

function airlineCode(segment) {
  const match = String(segment?.flight_number || '').trim().match(/^([A-Z0-9]{2,3})\s*\d/i);
  return match?.[1]?.toUpperCase() || '';
}

function checkedBaggage(offer) {
  const text = [
    ...(offer.extensions || []),
    ...(offer.flights || []).flatMap(segment => segment.extensions || []),
  ].join(' ').toLowerCase();
  if (/\bno checked bag|\bchecked bag not included/.test(text)) return false;
  if (/\bchecked bag included|\bincludes? (?:one|1) checked bag|\b(?:one|1) free checked bag/.test(text)) return true;
  return undefined;
}

function normalizeOffer(offer, passengers = 1, receivedAt = new Date().toISOString(), index = 0, currency = 'USD') {
  const flights = Array.isArray(offer.flights) ? offer.flights : [];
  if (!flights.length) return null;
  const first = flights[0];
  const last = flights.at(-1);
  const partySize = Math.max(1, Number(passengers) || 1);
  const totalPrice = Number(offer.price || 0);
  if (!Number.isFinite(totalPrice) || totalPrice <= 0) return null;
  const segments = flights.map(segment => ({
    origin: segment.departure_airport?.id,
    destination: segment.arrival_airport?.id,
    departure_at: dateTime(segment.departure_airport),
    arrival_at: dateTime(segment.arrival_airport),
    carrier_code: airlineCode(segment),
    airline_name: segment.airline || null,
    flight_number: segment.flight_number || null,
    aircraft: segment.airplane || null,
    duration_minutes: Number(segment.duration || 0) || null,
    travel_class: segment.travel_class || null,
    extensions: segment.extensions || [],
  }));
  const layovers = (offer.layovers || []).map(layover => ({
    airport_code: layover.id || null,
    airport_name: layover.name || null,
    duration_minutes: Number(layover.duration || 0) || null,
    overnight: layover.is_overnight === true,
  }));
  const offerText = (offer.extensions || []).join(' ').toLowerCase();
  const selfTransfer = /\bself[- ]transfer\b|\bseparate tickets?\b/.test(offerText);
  const carrierCode = airlineCode(first);
  const tokenHash = crypto.createHash('sha256')
    .update(String(offer.booking_token || offer.departure_token || `${first.flight_number}-${dateTime(first.departure_airport)}-${index}`))
    .digest('hex')
    .slice(0, 20);

  return {
    id: `searchapi-${tokenHash}`,
    provider_offer_id: tokenHash,
    source: 'searchapi',
    fare_type: 'current_metasearch_fare',
    origin: first.departure_airport?.id,
    origin_airport: first.departure_airport?.id,
    destination: last.arrival_airport?.id,
    destination_airport: last.arrival_airport?.id,
    airline: carrierCode,
    airline_name: first.airline || carrierCode,
    flight_number: segments.map(segment => segment.flight_number).filter(Boolean).join(' / '),
    departure_at: dateTime(first.departure_airport),
    arrival_local_at: dateTime(last.arrival_airport),
    duration_to: Number(offer.total_duration || 0) || segments.reduce((sum, segment) => sum + Number(segment.duration_minutes || 0), 0) || null,
    transfers: Math.max(0, flights.length - 1),
    segments,
    layovers,
    connection_airports: layovers.map(layover => layover.airport_code).filter(Boolean),
    overnight_layover: layovers.some(layover => layover.overnight),
    price: totalPrice / partySize,
    total_price: totalPrice,
    currency: offer.currency || currency,
    price_for_passengers: true,
    cabin_class: first.travel_class ? String(first.travel_class).toLowerCase().replace(/\s+/g, '_') : null,
    aircraft: segments.map(segment => segment.aircraft).filter(Boolean).join(' / ') || null,
    taxes_included: true,
    baggage_included: checkedBaggage(offer),
    refundable: undefined,
    fare_observed_at: receivedAt,
    fare_received_at: receivedAt,
    fare_cache_status: 'current_metasearch',
    availability_confirmed: false,
    seat_availability_confirmed: false,
    requires_provider_verification: true,
    booking_token_available: Boolean(offer.booking_token),
    self_transfer: selfTransfer,
    protected_itinerary: !selfTransfer,
    provider_verification_reason: 'Google Flights results must be revalidated with the seller before checkout.',
  };
}

function stopsFilter(maxStops) {
  if (Number(maxStops) === 0) return 'nonstop';
  if (Number(maxStops) === 1) return 'one_stop_or_fewer';
  if (Number(maxStops) === 2) return 'two_stops_or_fewer';
  return 'any';
}

function travelClass(value) {
  const normalized = String(value || 'economy').toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'first') return 'first_class';
  return ['economy', 'premium_economy', 'business', 'first_class'].includes(normalized) ? normalized : 'economy';
}

function searchAirportIds(value) {
  if (Array.isArray(value)) return value.map(item => String(item).trim().toUpperCase()).filter(Boolean).join(',');
  if (String(value || '').includes(',')) {
    return String(value).split(',').map(item => item.trim().toUpperCase()).filter(Boolean).join(',');
  }
  return possibleAirports(value).filter(Boolean).join(',');
}

async function flightOffersSearch({
  origin, destination, depart_date, passengers = 1, cabin_class, currency = 'USD',
  max = 40, max_stops, apiKey, market = process.env.SEARCHAPI_MARKET || 'us',
}) {
  const cacheKey = [origin, destination, depart_date, passengers, cabin_class, currency, max, max_stops, market].join(':');
  const cached = searchCache.get(cacheKey);
  if (cached?.expiresAt > Date.now()) {
    return cached.data.map(item => ({ ...item, fare_cache_status: 'local_cache' }));
  }
  const params = new URLSearchParams({
    engine: 'google_flights',
    flight_type: 'one_way',
    departure_id: searchAirportIds(origin),
    arrival_id: searchAirportIds(destination),
    outbound_date: depart_date,
    travel_class: travelClass(cabin_class),
    stops: stopsFilter(max_stops),
    adults: String(Math.min(Math.max(Number(passengers) || 1, 1), 9)),
    currency,
    gl: market,
    hl: 'en',
    sort_by: 'top_flights',
    show_cheapest_flights: 'true',
    show_hidden_flights: 'true',
  });
  const payload = await withRetry(() => requestJson({
    path: `${SEARCH_PATH}?${params}`,
    apiKey,
  }), {
    attempts: 2,
    baseDelayMs: 350,
    shouldRetry: error => !error.status || error.status >= 500 || error.status === 429,
  });
  const receivedAt = new Date().toISOString();
  const offers = [...(payload.best_flights || []), ...(payload.other_flights || [])]
    .map((offer, index) => normalizeOffer(offer, passengers, receivedAt, index, currency))
    .filter(Boolean)
    .slice(0, Math.min(Math.max(Number(max) || 40, 1), 100));
  searchCache.set(cacheKey, { data: offers, expiresAt: Date.now() + 15 * 60 * 1000 });
  return offers;
}

module.exports = {
  flightOffersSearch,
  normalizeOffer,
  checkedBaggage,
  stopsFilter,
  travelClass,
  searchAirportIds,
  dateTime,
};
