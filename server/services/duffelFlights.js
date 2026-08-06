const https = require('https');
const crypto = require('crypto');
const { withRetry } = require('../utils/retry');

const HOSTNAME = 'api.duffel.com';
const API_VERSION = 'v2';

function requestJson({ path, accessToken, body }) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const request = https.request({
      hostname: HOSTNAME,
      path,
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'identity',
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Duffel-Version': API_VERSION,
        'User-Agent': 'Tripalora/1.0',
      },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data;
        try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
        if (response.statusCode < 200 || response.statusCode >= 300 || data.errors?.length) {
          const detail = data.errors?.[0]?.message || data.message || `HTTP ${response.statusCode}`;
          const error = new Error(`Duffel request failed: ${detail}`);
          error.status = response.statusCode;
          error.provider = 'Duffel';
          reject(error);
          return;
        }
        resolve(data);
      });
    });
    request.on('error', error => {
      error.provider = 'Duffel';
      reject(error);
    });
    request.setTimeout(Number(process.env.DUFFEL_TIMEOUT_MS || 25000), () => {
      const error = new Error('Duffel request timed out');
      error.name = 'TimeoutError';
      error.code = 'ETIMEDOUT';
      error.provider = 'Duffel';
      request.destroy(error);
    });
    request.write(payload);
    request.end();
  });
}

function minutesBetween(start, end) {
  const left = new Date(start);
  const right = new Date(end);
  if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) return null;
  return Math.max(0, Math.round((right - left) / 60000));
}

function segmentCarrier(segment) {
  return segment.marketing_carrier || segment.operating_carrier || {};
}

function normalizeOffer(offer, passengers = 1, sliceIndex = 0) {
  const slice = offer?.slices?.[sliceIndex];
  const rawSegments = Array.isArray(slice?.segments) ? slice.segments : [];
  if (!rawSegments.length) return null;
  const first = rawSegments[0];
  const last = rawSegments.at(-1);
  const partySize = Math.max(1, Number(passengers) || 1);
  const totalPrice = Number(offer.total_amount || 0);
  if (!Number.isFinite(totalPrice) || totalPrice <= 0) return null;

  const segments = rawSegments.map(segment => {
    const carrier = segmentCarrier(segment);
    return {
      origin: segment.origin?.iata_code || segment.origin?.iata_city_code,
      destination: segment.destination?.iata_code || segment.destination?.iata_city_code,
      departure_at: segment.departing_at || null,
      arrival_at: segment.arriving_at || null,
      carrier_code: carrier.iata_code || null,
      airline_name: carrier.name || null,
      flight_number: `${carrier.iata_code || ''}${segment.marketing_carrier_flight_number || ''}` || null,
      aircraft: segment.aircraft?.name || null,
      duration_minutes: minutesBetween(segment.departing_at, segment.arriving_at),
      travel_class: segment.passengers?.[0]?.cabin_class || null,
    };
  });
  const layovers = rawSegments.slice(0, -1).map((segment, index) => {
    const next = rawSegments[index + 1];
    const duration = minutesBetween(segment.arriving_at, next.departing_at);
    return {
      airport_code: segment.destination?.iata_code || null,
      airport_name: segment.destination?.name || null,
      duration_minutes: duration,
      overnight: segment.arriving_at?.slice(0, 10) !== next.departing_at?.slice(0, 10),
      airport_change: segment.destination?.iata_code !== next.origin?.iata_code,
    };
  });
  const carrier = segmentCarrier(first);
  const idHash = crypto.createHash('sha256').update(`${offer.id}:${sliceIndex}`).digest('hex').slice(0, 20);
  const cabin = segments.find(segment => segment.travel_class)?.travel_class || null;

  return {
    id: `duffel-${idHash}`,
    provider_offer_id: idHash,
    source: 'duffel',
    fare_type: 'live_offer',
    origin: first.origin?.iata_code || first.origin?.iata_city_code,
    origin_airport: first.origin?.iata_code || null,
    destination: last.destination?.iata_code || last.destination?.iata_city_code,
    destination_airport: last.destination?.iata_code || null,
    airline: carrier.iata_code || carrier.name || 'Multiple airlines',
    airline_name: carrier.name || carrier.iata_code || 'Multiple airlines',
    flight_number: segments.map(segment => segment.flight_number).filter(Boolean).join(' / '),
    departure_at: first.departing_at || null,
    arrival_local_at: last.arriving_at || null,
    duration_to: minutesBetween(first.departing_at, last.arriving_at),
    transfers: Math.max(0, rawSegments.length - 1),
    segments,
    layovers,
    connection_airports: layovers.map(layover => layover.airport_code).filter(Boolean),
    overnight_layover: layovers.some(layover => layover.overnight),
    price: totalPrice / partySize,
    total_price: totalPrice,
    currency: offer.total_currency || 'USD',
    price_for_passengers: true,
    cabin_class: cabin,
    aircraft: segments.map(segment => segment.aircraft).filter(Boolean).join(' / ') || null,
    taxes_included: true,
    baggage_included: undefined,
    refundable: offer.conditions?.refund_before_departure?.allowed,
    fare_observed_at: new Date().toISOString(),
    fare_received_at: new Date().toISOString(),
    fare_cache_status: 'live_offer',
    availability_confirmed: true,
    seat_availability_confirmed: false,
    requires_provider_verification: true,
    booking_token_available: true,
    expires_at: offer.expires_at || null,
    self_transfer: false,
    protected_itinerary: true,
    provider_verification_reason: 'The Duffel offer must be refreshed before checkout.',
  };
}

async function flightOffersSearch({
  origin, destination, depart_date, passengers = 1, cabin_class = 'economy', max_stops,
  accessToken, max = 50,
}) {
  const requestedCabin = cabin_class === 'first_class' ? 'first' : cabin_class;
  const maxConnections = ['0', '1', '2'].includes(String(max_stops)) ? Number(max_stops) : 2;
  const body = {
    data: {
      slices: [{ origin, destination, departure_date: depart_date }],
      passengers: Array.from({ length: Math.min(Math.max(Number(passengers) || 1, 1), 9) }, () => ({ type: 'adult' })),
      cabin_class: ['economy', 'premium_economy', 'business', 'first'].includes(requestedCabin) ? requestedCabin : 'economy',
      max_connections: maxConnections,
    },
  };
  const supplierTimeout = Math.min(Math.max(Number(process.env.DUFFEL_SUPPLIER_TIMEOUT_MS || 15000), 1000), 20000);
  const payload = await withRetry(() => requestJson({
    path: `/air/offer_requests?return_offers=true&supplier_timeout=${supplierTimeout}`,
    accessToken,
    body,
  }), {
    attempts: 2,
    baseDelayMs: 350,
    shouldRetry: error => !error.status || error.status >= 500 || error.status === 429,
  });
  return (payload.data?.offers || [])
    .map(offer => normalizeOffer(offer, passengers))
    .filter(Boolean)
    .slice(0, Math.min(Math.max(Number(max) || 50, 1), 100));
}

module.exports = { flightOffersSearch, normalizeOffer, minutesBetween };
