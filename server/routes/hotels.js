const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const { v4: uuidv4 } = require('uuid');
const { analyzeHotel } = require('../services/ai');
const { localizeHotel, localizeHotelFromCache } = require('../services/localization');
const { calculateHotelScore, getUserWeights, recordScoreSnapshot, tripContextKey, SCORE_VERSION } = require('../services/personalization');
const { normalizePrice, roundMoney } = require('../services/pricing');
const { selectComparableRate, rateAvailability, marketBenchmark } = require('../services/comparablePricing');
const { requireAuth, requireOnboarding, requireEmailVerified } = require('../middleware/auth');
const { validateDateRange, defaultTravelDates } = require('../utils/dates');
const { canonicalHotelCity } = require('../utils/cities');
const { hotelDestinationFilter } = require('../utils/hotelDestinations');
const { aiLimiter } = require('../middleware/security');
const { requireCapability, configured } = require('../config/capabilities');
const travelpayouts = require('../services/travelpayouts');
const { ensureCatalogForCity, resolveCatalogDestination } = require('../services/hotelCatalog');
const { refreshLiteApiRates } = require('../services/hotelRates');
const googlePlaces = require('../services/googlePlaces');
const cache = require('../services/cache');
const { warmedDestination } = require('../services/hotelSearchWarmup');
const monitoring = require('../services/monitoring');
const { amenitySearchTerms, amenityMatches } = require('../config/hotelAmenities');
const {
  CACHE_TTL_HOURS,
  HOTEL_CATALOG,
  TRIPADVISOR_URLS,
  extractTripadvisorHotelKey,
  extractTripadvisorLocationId,
  getRates,
} = require('../services/xotelo');

const INSIGHTS_ORIGIN = 'DXB';
const INSIGHTS_CURRENCY = 'USD';
const INSIGHTS_HOT_DAYS = 90;
const INSIGHTS_NIGHTS = 7;
const INSIGHTS_CACHE_KEY = 'global:DXB:USD';
const INSIGHTS_CACHE_TTL_HOURS = Math.max(1, Number(process.env.INSIGHTS_CACHE_TTL_HOURS || 6));
const INSIGHTS_JOB_TIMEOUT_MS = Math.max(5000, Number(process.env.INSIGHTS_JOB_TIMEOUT_MS || 20000));
const INSIGHTS_ITEM_TIMEOUT_MS = Math.max(1000, Number(process.env.INSIGHTS_ITEM_TIMEOUT_MS || 3500));
let insightsRefreshPromise = null;

function parseList(value) {
  if (Array.isArray(value)) return value;
  try { return JSON.parse(value || '[]'); } catch { return []; }
}

function hasRequiredAmenities(hotel, rooms, catalogAmenities, requiredAmenities) {
  if (!requiredAmenities.length) return true;
  const structuredAmenities = catalogAmenities.map(item => item.name).filter(Boolean);
  const hotelAmenities = structuredAmenities.length ? structuredAmenities : parseList(hotel.amenities);
  const roomAmenities = rooms.flatMap(room => parseList(room.amenities));
  const confirmedAmenities = [...hotelAmenities, ...roomAmenities];
  return requiredAmenities.every(required => amenityMatches(confirmedAmenities, required));
}

function comparableRateOptions(preferences, guests, constraints = {}) {
  const preferredAmenities = parseList(preferences?.hotel_amenities);
  const requiredAmenities = parseList(preferences?.required_hotel_amenities);
  return {
    guests,
    preferredRoomTypes: parseList(preferences?.room_type),
    breakfastPreferred: preferredAmenities.includes('breakfast'),
    breakfastRequired: Boolean(constraints.breakfastRequired) || requiredAmenities.includes('breakfast'),
    refundableRequired: Boolean(constraints.refundableRequired),
    ttlHours: CACHE_TTL_HOURS,
  };
}

function comparablePriceContext(hotels, priceRows, preferences, guests, constraints = {}) {
  const options = comparableRateOptions(preferences, guests, constraints);
  const pricesByHotel = priceRows.reduce((map, row) => ((map[row.hotel_id] ||= []).push(row), map), {});
  const hotelsById = new Map(hotels.map(hotel => [hotel.id, hotel]));
  const ratesByHotel = new Map();
  const offers = [];
  for (const [hotelId, prices] of Object.entries(pricesByHotel)) {
    const hotel = hotelsById.get(hotelId) || prices[0];
    const rate = selectComparableRate(prices, options);
    if (!hotel || !rate) continue;
    ratesByHotel.set(hotelId, rate);
    offers.push({
      hotel_id: hotelId,
      city: hotel.city,
      location: hotel.location,
      stars: hotel.stars,
      room_category: rate.room_category,
      comparable_nightly_price: rate.comparable_nightly_price,
      currency: rate.currency,
    });
  }
  const benchmarkByHotel = Object.fromEntries(hotels.map(hotel => {
    const rate = ratesByHotel.get(hotel.id);
    if (!rate) return [hotel.id, null];
    return [hotel.id, marketBenchmark({
      hotel_id: hotel.id, city: hotel.city, location: hotel.location, stars: hotel.stars,
      room_category: rate.room_category, currency: rate.currency,
    }, offers)];
  }));
  return { ratesByHotel, benchmarkByHotel };
}

function withTimeout(promise, timeoutMs, label) {
  let timeout;
  return Promise.race([
    promise,
    new Promise((resolve, reject) => { timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs); }),
  ]).finally(() => clearTimeout(timeout));
}

function formatInsightDate(date) {
  return date.toISOString().slice(0, 10);
}

function addInsightDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getTravelpayoutsToken() {
  return configured(process.env.TRAVELPAYOUTS_TOKEN) ? process.env.TRAVELPAYOUTS_TOKEN : null;
}

function normalizeCityName(value = '') {
  return String(value).trim().toLowerCase().replace(/\s+/g, ' ');
}

async function hotelStatsByCity() {
  const rows = await db.prepare(`
    SELECT
      h.city,
      h.country,
      COUNT(DISTINCT h.id) as hotel_count,
      MIN(hp.price_per_night) as min_price,
      AVG(hp.price_per_night) as avg_price,
      AVG(hr.rating) as avg_rating,
      SUM(COALESCE(hr.count, 0)) as review_count
    FROM hotels h
    LEFT JOIN hotel_prices hp ON hp.hotel_id = h.id AND hp.price_valid = 1
    LEFT JOIN hotel_reviews hr ON hr.hotel_id = h.id
    GROUP BY h.city, h.country
  `).all();

  return new Map(rows.map(row => [normalizeCityName(row.city), row]));
}

async function cityLookupByCode() {
  const cities = await travelpayouts.getCities();
  const cityList = Array.isArray(cities) ? cities : Object.values(cities);
  return new Map(cityList.map(city => [city.code, city]));
}

function destinationName(city, code) {
  return city?.name_translations?.en || city?.name || code;
}

async function getReturnPrice({ destination, origin, returnDate, currency, token }) {
  const tickets = await travelpayouts.cheapestTickets({
    origin: destination,
    destination: origin,
    depart_date: returnDate,
    currency,
    token,
  }).catch(() => []);

  const prices = tickets
    .map(ticket => Number(ticket.price))
    .filter(price => Number.isFinite(price) && price > 0);
  if (prices.length) return Math.min(...prices);

  const dateTickets = await travelpayouts.pricesForDates({
    origin: destination,
    destination: origin,
    depart_date: returnDate,
    currency,
    limit: 1,
    token,
  }).catch(() => []);
  const datePrices = dateTickets
    .map(ticket => Number(ticket.price))
    .filter(price => Number.isFinite(price) && price > 0);
  return datePrices.length ? Math.min(...datePrices) : null;
}

async function buildLiveInsightOffers() {
  const token = getTravelpayoutsToken();
  if (!token) {
    const error = new Error('TRAVELPAYOUTS_TOKEN is not configured on the server');
    error.code = 'PROVIDER_NOT_CONFIGURED';
    error.provider = 'Travelpayouts';
    throw error;
  }

  const [popular, citiesByCode] = await Promise.all([
    travelpayouts.popularDestinations({ origin: INSIGHTS_ORIGIN, currency: INSIGHTS_CURRENCY, token }),
    cityLookupByCode(),
  ]);
  const hotelsByCity = await hotelStatsByCity();
  const today = new Date();
  const maxDeparture = addInsightDays(today, INSIGHTS_HOT_DAYS);

  const candidates = popular
    .filter(item => item.destination && item.destination !== INSIGHTS_ORIGIN)
    .filter(item => {
      if (!item.departure_at) return true;
      const departure = new Date(item.departure_at);
      return !Number.isNaN(departure.getTime()) && departure <= maxDeparture;
    })
    .slice(0, 8);

  const offers = await Promise.all(candidates.map(async item => {
    const city = citiesByCode.get(item.destination);
    const cityName = destinationName(city, item.destination);
    const hotelRow = hotelsByCity.get(normalizeCityName(cityName));
    const departureDate = item.departure_at
      ? String(item.departure_at).slice(0, 10)
      : formatInsightDate(addInsightDays(today, 14));
    const returnDate = item.return_at
      ? String(item.return_at).slice(0, 10)
      : formatInsightDate(addInsightDays(new Date(`${departureDate}T00:00:00.000Z`), INSIGHTS_NIGHTS));
    const outboundPrice = Number(item.price || 0);
    const returnPrice = await withTimeout(getReturnPrice({
      destination: item.destination,
      origin: INSIGHTS_ORIGIN,
      returnDate,
      currency: INSIGHTS_CURRENCY,
      token,
    }), INSIGHTS_ITEM_TIMEOUT_MS, `Return price ${item.destination}`).catch(() => null);
    const flightTotal = outboundPrice + Number(returnPrice || 0);
    const minPrice = hotelRow?.min_price ? Math.round(hotelRow.min_price) : null;
    const avgPrice = hotelRow?.avg_price ? Math.round(hotelRow.avg_price) : minPrice;
    const hotelTotal = minPrice ? minPrice * INSIGHTS_NIGHTS : null;
    const packagePrice = Math.round(flightTotal + Number(hotelTotal || 0));
    const rating = hotelRow?.avg_rating ? Number(hotelRow.avg_rating.toFixed(1)) : 4.3;
    const hotelCount = Number(hotelRow?.hotel_count || 0);
    const reviewCount = Number(hotelRow?.review_count || 0);
    const discountPercent = minPrice && avgPrice
      ? Math.max(5, Math.min(38, Math.round(((avgPrice - minPrice) / Math.max(avgPrice, 1)) * 100) + 10))
      : Math.max(5, Math.min(28, Math.round(32 - outboundPrice / 18)));
    const valueScore = Math.round(
      rating * 16
      + discountPercent
      + Math.max(0, 1100 - packagePrice) * 0.025
      + hotelCount * 0.8
    );
    const popularityScore = Number(item.popularity || 0) + reviewCount + hotelCount * 2500;

    return {
      city: cityName,
      country: hotelRow?.country || city?.country_code || '',
      destination_code: item.destination,
      origin_code: INSIGHTS_ORIGIN,
      currency: INSIGHTS_CURRENCY,
      departure_date: departureDate,
      return_date: returnDate,
      nights: INSIGHTS_NIGHTS,
      outbound_price: outboundPrice || null,
      return_price: returnPrice,
      has_round_trip: Boolean(returnPrice),
      flight_total: flightTotal || null,
      has_hotel_price: Boolean(minPrice),
      hotel_count: hotelCount,
      min_price: minPrice || 0,
      avg_price: avgPrice || minPrice || 0,
      avg_rating: rating,
      review_count: reviewCount,
      discount_percent: discountPercent,
      package_price: packagePrice,
      popularity_score: popularityScore,
      value_score: valueScore,
      source: 'travelpayouts',
      ai_reason: minPrice
        ? `Round trip from Dubai plus ${INSIGHTS_NIGHTS} nights from current hotel prices.`
        : `Popular route from Dubai with live flight price; hotel prices are not in Fairworth yet.`,
    };
  }));

  return offers.filter(offer => offer.outbound_price && offer.package_price);
}

function insightsPayload(liveOffers) {
  const byPriceDrop = [...liveOffers].sort((a, b) => b.discount_percent - a.discount_percent || a.package_price - b.package_price);
  const byPopularity = [...liveOffers].sort((a, b) => b.popularity_score - a.popularity_score);
  const byValue = [...liveOffers].sort((a, b) => b.value_score - a.value_score);
  return {
    origin: INSIGHTS_ORIGIN, currency: INSIGHTS_CURRENCY, days: INSIGHTS_HOT_DAYS, nights: INSIGHTS_NIGHTS,
    source: 'travelpayouts', generated_at: new Date().toISOString(),
    sections: [
      { key: 'hot', offers: byPriceDrop.slice(0, 8) },
      { key: 'popular', offers: byPopularity.slice(0, 8) },
      { key: 'value', offers: byValue.slice(0, 8) },
    ],
    total: liveOffers.length,
  };
}

async function refreshInsightsInBackground({ force = false } = {}) {
  if (insightsRefreshPromise) return insightsRefreshPromise;
  if (!force) {
    const recent = await db.prepare(`SELECT status, refresh_started_at, expires_at > CURRENT_TIMESTAMP AS fresh FROM insights_cache WHERE cache_key = ?`).get(INSIGHTS_CACHE_KEY);
    if (recent?.fresh && recent.status === 'ready') return null;
    if (recent?.status === 'refreshing' && recent.refresh_started_at && Date.now() - new Date(recent.refresh_started_at).getTime() < INSIGHTS_JOB_TIMEOUT_MS * 2) return null;
  }
  insightsRefreshPromise = (async () => {
    await db.prepare(`INSERT INTO insights_cache (cache_key, status, refresh_started_at) VALUES (?, 'refreshing', CURRENT_TIMESTAMP) ON CONFLICT (cache_key) DO UPDATE SET status = 'refreshing', error = NULL, refresh_started_at = CURRENT_TIMESTAMP`).run(INSIGHTS_CACHE_KEY);
    try {
      const offers = await withTimeout(buildLiveInsightOffers(), INSIGHTS_JOB_TIMEOUT_MS, 'Insights refresh');
      const payload = insightsPayload(offers || []);
      await db.prepare(`UPDATE insights_cache SET payload = ?, status = 'ready', error = NULL, updated_at = CURRENT_TIMESTAMP, expires_at = CURRENT_TIMESTAMP + (? * INTERVAL '1 hour'), refresh_started_at = NULL WHERE cache_key = ?`)
        .run(JSON.stringify(payload), INSIGHTS_CACHE_TTL_HOURS, INSIGHTS_CACHE_KEY);
      return payload;
    } catch (error) {
      await db.prepare(`UPDATE insights_cache SET status = 'error', error = ?, refresh_started_at = NULL WHERE cache_key = ?`).run(error.message.slice(0, 1000), INSIGHTS_CACHE_KEY);
      console.warn(`[insights] background refresh failed: ${error.message}`);
      return null;
    }
  })().finally(() => { insightsRefreshPromise = null; });
  return insightsRefreshPromise;
}

async function initializeXoteloSchema() {
  await db.prepare(`
    DELETE FROM hotel_prices
    WHERE operator = 'Fairworth local demo'
       OR provider_code = 'local_fixture'
       OR raw_json LIKE '%"source":"local_fixture"%'
  `).run();
  await db.prepare(`
    DELETE FROM hotel_rooms
    WHERE id LIKE 'room-hotel-%-deluxe'
  `).run();
  await db.prepare(`
    DELETE FROM hotel_reviews
    WHERE id LIKE 'review-hotel-%'
  `).run();

  for (const hotel of HOTEL_CATALOG) {
    const existingByKey = await db.prepare(`
      SELECT id FROM hotels
      WHERE tripadvisor_hotel_key = ? AND id != ?
      LIMIT 1
    `).get(hotel.tripadvisor_hotel_key, hotel.id);
    if (existingByKey) {
      await db.prepare('DELETE FROM hotel_prices WHERE hotel_id = ?').run(hotel.id);
      await db.prepare('DELETE FROM hotel_reviews WHERE hotel_id = ?').run(hotel.id);
      await db.prepare('DELETE FROM hotel_rooms WHERE hotel_id = ?').run(hotel.id);
      await db.prepare('DELETE FROM hotels WHERE id = ?').run(hotel.id);
    }

    const existing = await db.prepare(`
      SELECT id FROM hotels
      WHERE id = ? OR LOWER(name) = LOWER(?) OR tripadvisor_hotel_key = ?
      LIMIT 1
    `).get(hotel.id, hotel.name, hotel.tripadvisor_hotel_key);
    const hotelId = existing?.id || hotel.id;

    if (!existing) {
      await db.prepare(`
        INSERT INTO hotels (
          id, name, location, city, country, stars, description, amenities,
          latitude, longitude, tripadvisor_url, tripadvisor_location_id, tripadvisor_hotel_key
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        hotel.id,
        hotel.name,
        hotel.location,
        hotel.city,
        hotel.country,
        hotel.stars,
        hotel.description,
        hotel.amenities,
        hotel.latitude,
        hotel.longitude,
        hotel.tripadvisor_url,
        hotel.tripadvisor_location_id,
        hotel.tripadvisor_hotel_key
      );
    }

    await db.prepare(`
      UPDATE hotels
      SET tripadvisor_url = ?,
          tripadvisor_location_id = ?,
          tripadvisor_hotel_key = ?,
          latitude = COALESCE(?, latitude),
          longitude = COALESCE(?, longitude)
      WHERE id = ?
    `).run(
      hotel.tripadvisor_url,
      hotel.tripadvisor_location_id,
      hotel.tripadvisor_hotel_key,
      hotel.latitude,
      hotel.longitude,
      hotelId
    );

  }
}

let xoteloSchemaReady = false;
let xoteloSchemaPromise = null;
async function ensureXoteloSchema() {
  if (xoteloSchemaReady) return;
  if (!xoteloSchemaPromise) {
    xoteloSchemaPromise = initializeXoteloSchema()
      .then(() => { xoteloSchemaReady = true; })
      .finally(() => { xoteloSchemaPromise = null; });
  }
  return xoteloSchemaPromise;
}

function defaultCheckOut(checkIn) {
  return formatDate(addDays(parseDate(checkIn), 1));
}

async function cachedXoteloPrices(hotelId, checkIn, checkOut) {
  return await db.prepare(`
    SELECT *
    FROM hotel_prices
    WHERE hotel_id = ?
      AND check_in = ?
      AND check_out = ?
      AND source = 'xotelo'
      AND updated_at + (? * INTERVAL '1 hour') > CURRENT_TIMESTAMP
    ORDER BY price_per_night
  `).all(hotelId, checkIn, checkOut, CACHE_TTL_HOURS);
}

async function writeXoteloPrices(hotelId, result) {
  const previousRows = await db.prepare(`SELECT operator, price_per_night FROM hotel_prices WHERE hotel_id = ? AND source = 'xotelo' ORDER BY updated_at DESC`).all(hotelId);
  const previousByProvider = new Map(previousRows.map(row => [row.operator, Number(row.price_per_night)]));
  const validRates = result.rates.filter(rate => Number(rate.rate) > 0);
  const sortedValues = validRates.map(rate => Number(rate.rate)).sort((a, b) => a - b);
  const median = sortedValues.length ? sortedValues[Math.floor(sortedValues.length / 2)] : null;
  const flagPrice = async ({ priceId = null, provider, type, previous = null, current = null, severity = 'warning', details = {} }) => {
    const recent = await db.prepare(`SELECT id FROM price_anomalies WHERE hotel_id = ? AND provider = ? AND anomaly_type = ? AND status = 'open' AND created_at > CURRENT_TIMESTAMP - INTERVAL '24 hours' LIMIT 1`).get(hotelId, provider, type);
    if (!recent) await db.prepare(`INSERT INTO price_anomalies (id, hotel_id, price_id, provider, anomaly_type, severity, previous_price, current_price, currency, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(uuidv4(), hotelId, priceId, provider, type, severity, previous, current, result.currency || 'USD', JSON.stringify(details));
  };
  for (const rate of result.rates.filter(rate => !(Number(rate.rate) > 0))) await flagPrice({ provider: rate.name || rate.code || 'unknown', type: 'invalid_price', current: Number(rate.rate) || 0, severity: 'critical', details: { rate } });
  await db.prepare(`
    DELETE FROM hotel_prices
    WHERE hotel_id = ? AND check_in = ? AND check_out = ? AND source = 'xotelo'
  `).run(hotelId, result.check_in, result.check_out);

  for (const rate of validRates) {
    const priceId = uuidv4();
    const provider = rate.name || rate.code || 'Xotelo provider';
    const nights = Math.max(1, Math.round((parseDate(result.check_out) - parseDate(result.check_in)) / 86400000));
    const baseNightly = roundMoney(rate.rate, result.currency || 'USD');
    const taxNightly = roundMoney(rate.tax || 0, result.currency || 'USD');
    const current = roundMoney(baseNightly + taxNightly, result.currency || 'USD');
    const previous = previousByProvider.get(provider);
    if (median && (current < median * 0.5 || current > median * 2)) await flagPrice({ priceId, provider, type: 'market_outlier', current, severity: 'warning', details: { market_median: median } });
    if (previous && Math.abs(current - previous) / previous >= 0.4) await flagPrice({ priceId, provider, type: 'sudden_price_change', previous, current, severity: 'warning', details: { change_percent: Math.round(((current - previous) / previous) * 100) } });
    if (Number(rate.tax) > current) await flagPrice({ priceId, provider, type: 'tax_exceeds_base_price', current: Number(rate.tax), previous: current, severity: 'critical' });
    await db.prepare(`
      INSERT INTO hotel_prices (
        id, hotel_id, operator, price_per_night, total_price, check_in, check_out,
        includes_breakfast, cancellation_policy, url, currency, tax, provider_code,
        source, raw_json, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'provider_policy', ?, ?, ?, ?, 'xotelo', ?, CURRENT_TIMESTAMP)
    `).run(
      priceId,
      hotelId,
      provider,
      current,
      roundMoney(current * nights, result.currency || 'USD'),
      result.check_in,
      result.check_out,
      rate.url || rate.link || null,
      result.currency || 'USD',
      roundMoney(taxNightly * nights, result.currency || 'USD'),
      rate.code || null,
      JSON.stringify({ ...rate, base_price_per_night: baseNightly, taxes_per_night: taxNightly, taxes_total: roundMoney(taxNightly * nights, result.currency || 'USD'), stay_total: roundMoney(current * nights, result.currency || 'USD'), nights, currency_unit: 'major', requested_currency: result.currency || 'USD', tax_status: taxNightly > 0 ? 'excluded' : 'unknown', tax_included: taxNightly > 0 ? false : undefined })
    );
  }
}

async function refreshHotelPricesFromXotelo(hotel, checkIn, checkOut, options = {}) {
  if (!hotel?.tripadvisor_hotel_key || !checkIn || !checkOut) return { updated: false, prices: [] };
  if (!options.force) {
    const cached = await cachedXoteloPrices(hotel.id, checkIn, checkOut);
    if (cached.length) return { updated: false, cached: true, prices: cached };
  }

  const result = await getRates({
    hotel_key: hotel.tripadvisor_hotel_key,
    check_in: checkIn,
    check_out: checkOut,
  });

  if (result.rates.length) {
    await writeXoteloPrices(hotel.id, result);
  }

  const prices = await db.prepare(`
    SELECT * FROM hotel_prices
    WHERE hotel_id = ? AND check_in = ? AND check_out = ? AND source = 'xotelo'
    ORDER BY price_per_night
  `).all(hotel.id, result.check_in, result.check_out);

  return { updated: true, cached: false, prices };
}

function parseDate(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

async function scoreHotelForUser(hotel, rooms, reviews, prices, userId, language = 'en', guests = 2, tripPurpose = null) {
  const userPrefs = await db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get(userId);
  const checkIn = prices[0]?.check_in;
  const checkOut = prices[0]?.check_out;
  const requestedGuests = Math.max(1, Number(guests) || 2);
  const weights = await getUserWeights(userId, { destination: hotel.city, check_in: checkIn, check_out: checkOut, guests: requestedGuests, trip_purpose: tripPurpose });
  const marketRows = checkIn && checkOut ? await db.prepare(`
    SELECT hp.*, h.city, h.location, h.stars
    FROM hotels h JOIN hotel_prices hp ON hp.hotel_id = h.id AND hp.price_valid = 1
    WHERE LOWER(h.city) = LOWER(?) AND hp.check_in = ? AND hp.check_out = ?
      AND hp.source IN ('liteapi', 'xotelo') AND (hp.guests = ? OR hp.guests IS NULL)
  `).all(hotel.city, checkIn, checkOut, requestedGuests) : prices.map(price => ({ ...price, city: hotel.city, location: hotel.location, stars: hotel.stars }));
  const marketHotels = [...new Map([
    [hotel.id, hotel],
    ...marketRows.map(row => [row.hotel_id, { id: row.hotel_id, city: row.city, location: row.location, stars: row.stars }]),
  ]).values()];
  const comparableContext = comparablePriceContext(marketHotels, marketRows, userPrefs, requestedGuests);
  const comparable = comparableContext.ratesByHotel.get(hotel.id);
  const result = calculateHotelScore({
    ...hotel,
    min_price: comparable?.payable_nightly_price ?? null,
    comparable_price: comparable?.comparable_nightly_price ?? null,
    rating: reviews?.rating,
    review_count: reviews?.count,
    cleanliness: reviews?.cleanliness,
    service: reviews?.service,
    location_score: reviews?.location_score,
    value_score: reviews?.value,
    latest_review_at: reviews?.latest_review_at,
    recent_review_share: reviews?.recent_review_share,
    previous_rating: reviews?.previous_rating,
    rating_trend: reviews?.rating_trend,
    rating_stddev: reviews?.rating_stddev,
    suspicious_review_share: reviews?.suspicious_review_share,
    verified_review_share: reviews?.verified_review_share,
    review_source_count: reviews?.review_source_count,
    review_source_consistency: reviews?.review_source_consistency,
  }, userPrefs, weights, {
    roomsByHotel: { [hotel.id]: rooms },
    language,
    priceBenchmarkByHotel: comparableContext.benchmarkByHotel,
    priceMetadataByHotel: {
      [hotel.id]: comparable ? { ...comparable, provider: comparable.operator } : null,
    },
  });
  await recordScoreSnapshot(userId, result);
  return result;
}

async function storedHotelImages(hotelId) {
  const rows = await db.prepare(`
    SELECT url, provider, kind, sort_order, width_px, height_px, attribution_json
    FROM hotel_images
    WHERE hotel_id = ?
    ORDER BY sort_order ASC, created_at ASC
  `).all(hotelId);
  return rows
    .filter(row => row.url)
    .map(row => ({
      url: row.url,
      provider: row.provider,
      kind: row.kind || 'gallery',
      sort_order: row.sort_order || 0,
      width_px: row.width_px || null,
      height_px: row.height_px || null,
      attribution: parseJson(row.attribution_json, []),
    }));
}

function parseJson(value, fallback) {
  try { return JSON.parse(value || JSON.stringify(fallback)); } catch { return fallback; }
}

function fallbackImages(hotel, storedImages) {
  const seen = new Set();
  const images = [...storedImages];
  for (const [index, url] of [hotel.image_url, hotel.thumbnail_url].filter(Boolean).entries()) {
    if (seen.has(url) || images.some(image => image.url === url)) continue;
    seen.add(url);
    images.push({
      url,
      provider: hotel.content_source || 'hotel',
      kind: index === 0 ? 'main' : 'thumbnail',
      sort_order: images.length,
      width_px: null,
      height_px: null,
      attribution: [],
    });
  }
  return images;
}

async function hotelImages(hotel) {
  const stored = await storedHotelImages(hotel.id);
  const fallback = fallbackImages(hotel, stored);
  try {
    const googleImages = await googlePlaces.hotelPhotos(hotel);
    if (googleImages.length) return googleImages;
  } catch (error) {
    console.warn(`[google-places] ${hotel.name}: ${error.message}`);
    monitoring.captureProviderDegradation('Google Places', error, { operation: 'hotel_photos', hotel_id: hotel.id });
  }
  return fallback;
}

async function cachedHotelImages(hotel) {
  return fallbackImages(hotel, await storedHotelImages(hotel.id));
}

function detailCacheKey({ hotelId, userId, checkIn, checkOut, guests, language, tripPurpose }) {
  return cache.cacheKey('hotel-detail-v1', {
    hotelId, userId, checkIn, checkOut, guests: Math.max(1, Number(guests) || 2),
    language: language || 'en', tripPurpose: tripPurpose || 'leisure', scoreVersion: SCORE_VERSION,
  });
}

async function loadHotelDetailSnapshot({ hotel, userId, checkIn, checkOut, guests = 2, language = 'en', tripPurpose }) {
  const requestedGuests = Math.max(1, Number(guests) || 2);
  const [rooms, images, prices, reviews] = await Promise.all([
    db.prepare('SELECT * FROM hotel_rooms WHERE hotel_id = ? ORDER BY base_price_per_night').all(hotel.id),
    cachedHotelImages(hotel),
    db.prepare(`
      SELECT * FROM hotel_prices
      WHERE hotel_id = ? AND source IN ('liteapi', 'xotelo') AND price_valid = 1 AND check_in = ? AND check_out = ?
        AND (guests = ? OR guests IS NULL)
      ORDER BY CASE WHEN source = 'liteapi' THEN 0 ELSE 1 END, price_per_night
    `).all(hotel.id, checkIn, checkOut, requestedGuests),
    db.prepare('SELECT * FROM hotel_reviews WHERE hotel_id = ?').get(hotel.id),
  ]);
  const [scoring, localized] = await Promise.all([
    scoreHotelForUser(hotel, rooms, reviews, prices, userId, language, requestedGuests, tripPurpose),
    localizeHotelFromCache(hotel, language, rooms),
  ]);
  return {
    hotel: localized.hotel,
    images,
    rooms: localized.rooms,
    prices: prices.map(price => normalizePrice(price, CACHE_TTL_HOURS)),
    reviews,
    scoring,
    translation_pending: Boolean(localized.translation_pending),
    rates_refreshing: true,
    price_meta: { check_in: checkIn, check_out: checkOut, ttl_hours: CACHE_TTL_HOURS },
  };
}

// GET /api/hotels/search
router.get('/search', requireAuth, requireEmailVerified, requireOnboarding, async (req, res) => {
  try {
    const {
      city: requestedCity, check_in, check_out, guests = 2, trip_purpose, stars, min_price, max_price,
      amenities, districts, rating_min, free_cancel, breakfast,
      sort = 'score', language = 'en', search_event, search_session_id,
      limit = 30, offset = 0
    } = req.query;
    const city = canonicalHotelCity(requestedCity);
    const destinationCode = city ? await resolveCatalogDestination(city, { providerLookup: false }) : null;
    const pageSize = Math.min(Math.max(Number(limit) || 30, 1), 30);
    const pageOffset = Math.max(Number(offset) || 0, 0);
    const userId = req.user.id;
    const userPrefs = await db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get(userId);
    const [feedbackVersion, interactionVersion] = await Promise.all([
      db.prepare(`SELECT COUNT(*) AS count, MAX(created_at) AS latest FROM user_hotel_feedback WHERE user_id = ?`).get(userId),
      db.prepare(`SELECT COUNT(*) AS count, MAX(created_at) AS latest FROM user_interactions WHERE user_id = ?`).get(userId),
    ]);
    const searchCacheKey = cache.cacheKey('hotel-search-v3', {
      userId,
      preferences: userPrefs,
      feedbackVersion,
      interactionVersion,
      query: { ...req.query, city, limit: pageSize, offset: pageOffset, search_event: undefined, search_session_id: undefined },
      scoreVersion: SCORE_VERSION,
    });
    if (search_event !== '1') {
      const cachedSearch = await cache.getJson(searchCacheKey);
      if (cachedSearch) return res.json({ ...cachedSearch, cached: true });
    }
    const requiredPreferenceAmenities = (() => {
      try { return JSON.parse(userPrefs?.required_hotel_amenities || '[]'); } catch { return []; }
    })();
    const strictAmenities = [...new Set([
      ...String(amenities || '').split(',').filter(Boolean),
      ...requiredPreferenceAmenities,
    ])];
    const defaults = defaultTravelDates();
    const liveCheckIn = check_in || defaults.checkIn;
    const liveCheckOut = check_out || defaults.checkOut;
    if (!validateDateRange(liveCheckIn, liveCheckOut)) {
      return res.status(400).json({ error: 'Check-in and check-out must be valid future dates' });
    }
    await ensureXoteloSchema();
    const feedbackContextKey = tripContextKey({ destination: city, check_in: liveCheckIn, check_out: liveCheckOut, guests, trip_purpose }, userPrefs || {});

    if (city) {
      const destination = hotelDestinationFilter('hotels', city, destinationCode);
      const existingCatalog = await db.prepare(`SELECT id FROM hotels WHERE active = 1 AND ${destination.sql} LIMIT 1`)
        .get(...destination.params);
      if (existingCatalog) setImmediate(() => ensureCatalogForCity(city).catch(error => console.warn(`[liteapi] catalog refresh: ${error.message}`)));
      else await ensureCatalogForCity(city);
    }

    // Search is cache-first. Live rates are progressively requested by the client
    // for the visible page through /rates/batch, so an external provider cannot
    // hold the complete results page hostage for tens of seconds.

    let query = `
      SELECT 
        h.id, h.name, h.location, h.city, h.country, h.stars, h.amenities,
        h.latitude, h.longitude, h.tripadvisor_url, h.tripadvisor_location_id,
        h.tripadvisor_hotel_key, h.address, h.postal_code, h.image_url,
        h.thumbnail_url, h.hotel_type, h.chain_name, h.content_source, h.content_raw_json,
        h.source_updated_at, h.active, h.created_at,
        hr.rating, hr.count as review_count, hr.cleanliness, hr.service, hr.location_score, hr.value as value_score,
        hr.latest_review_at, hr.recent_review_share, hr.previous_rating, hr.rating_trend,
        hr.rating_stddev, hr.suspicious_review_share, hr.verified_review_share,
        hr.review_source_count, hr.review_source_consistency,
        MIN(hp.price_per_night) as min_price,
        MAX(hp.price_per_night) as max_price,
        CASE
          WHEN SUM(CASE WHEN hp.source = 'liteapi' THEN 1 ELSE 0 END) > 0 THEN 'liteapi'
          WHEN SUM(CASE WHEN hp.source = 'xotelo' THEN 1 ELSE 0 END) > 0 THEN 'xotelo'
          ELSE NULL
        END as price_source,
        COUNT(*) OVER() as catalog_total
      FROM hotels h
      LEFT JOIN hotel_reviews hr ON hr.hotel_id = h.id
      LEFT JOIN hotel_prices hp ON hp.hotel_id = h.id
        AND hp.source IN ('liteapi', 'xotelo') AND hp.price_valid = 1 AND hp.check_in = ? AND hp.check_out = ?
        AND (hp.guests = ? OR hp.guests IS NULL)
      WHERE h.active = 1
        AND NOT EXISTS (SELECT 1 FROM user_hotel_feedback uhf WHERE uhf.user_id = ? AND uhf.hotel_id = h.id AND uhf.context_key = ?)
    `;
    const params = [liveCheckIn, liveCheckOut, Math.max(1, Number(guests) || 2), userId, feedbackContextKey];

    if (city) {
      const destination = hotelDestinationFilter('h', city, destinationCode);
      query += ` AND ${destination.sql}`;
      params.push(...destination.params);
    }
    if (stars) {
      const starsArr = stars.split(',');
      query += ` AND h.stars IN (${starsArr.map(() => '?').join(',')})`;
      params.push(...starsArr.map(Number));
    }
    if (rating_min) {
      query += ` AND hr.rating >= ?`;
      params.push(Number(rating_min));
    }
    if (districts) {
      const values = String(districts).split(',').filter(Boolean);
      if (values.length) {
        query += ` AND (${values.map(() => 'LOWER(h.location) = LOWER(?)').join(' OR ')})`;
        params.push(...values);
      }
    }
    if (strictAmenities.length) {
      strictAmenities.forEach(amenity => {
        const terms = amenitySearchTerms(amenity);
        const hotelChecks = terms.map(() => 'LOWER(h.amenities) LIKE ?');
        const catalogChecks = terms.map(() => 'LOWER(ha.name) LIKE ? OR LOWER(ha.normalized_name) LIKE ?');
        const roomChecks = terms.map(() => 'LOWER(ra.amenities) LIKE ?');
        query += ` AND (
          (${hotelChecks.join(' OR ')})
          OR EXISTS (SELECT 1 FROM hotel_amenities ha WHERE ha.hotel_id = h.id AND (${catalogChecks.join(' OR ')}))
          OR EXISTS (SELECT 1 FROM hotel_rooms ra WHERE ra.hotel_id = h.id AND (${roomChecks.join(' OR ')}))
        )`;
        params.push(...terms.map(term => `%${term.toLowerCase()}%`));
        terms.forEach(term => params.push(`%${term.toLowerCase()}%`, `%${term.toLowerCase()}%`));
        params.push(...terms.map(term => `%${term.toLowerCase()}%`));
      });
    }
    if (free_cancel === '1') {
      query += ` AND EXISTS (
        SELECT 1 FROM hotel_prices fp WHERE fp.hotel_id = h.id
        AND fp.price_valid = 1
        AND fp.cancellation_policy = 'free_cancellation'
        AND (fp.check_in IS NULL OR (fp.check_in = ? AND fp.check_out = ?))
      )`;
      params.push(liveCheckIn, liveCheckOut);
    }
    if (breakfast === '1') {
      query += ` AND EXISTS (
        SELECT 1 FROM hotel_prices bp WHERE bp.hotel_id = h.id
        AND bp.price_valid = 1
        AND bp.includes_breakfast = 1
        AND (bp.check_in IS NULL OR (bp.check_in = ? AND bp.check_out = ?))
      )`;
      params.push(liveCheckIn, liveCheckOut);
    }
    if (max_price) {
      query += ` AND hp.price_per_night <= ?`;
      params.push(Number(max_price));
    }
    if (min_price) {
      query += ` AND hp.price_per_night >= ?`;
      params.push(Number(min_price));
    }

    query += ` GROUP BY h.id, hr.rating, hr.count, hr.cleanliness, hr.service, hr.location_score, hr.value,
      hr.latest_review_at, hr.recent_review_share, hr.previous_rating, hr.rating_trend,
      hr.rating_stddev, hr.suspicious_review_share, hr.verified_review_share,
      hr.review_source_count, hr.review_source_consistency`;

    if (sort === 'price_asc') query += ` ORDER BY MIN(hp.price_per_night) ASC NULLS LAST, h.id`;
    else if (sort === 'price_desc') query += ` ORDER BY MIN(hp.price_per_night) DESC NULLS LAST, h.id`;
    else if (sort === 'rating') query += ` ORDER BY hr.rating DESC NULLS LAST, hr.count DESC NULLS LAST, h.id`;
    else query += ` ORDER BY hr.rating DESC NULLS LAST, hr.count DESC NULLS LAST, h.stars DESC NULLS LAST, h.id`;
    query += ` LIMIT ? OFFSET ?`;
    params.push(pageSize, pageOffset);

    let hotels = await db.prepare(query).all(...params);
    const catalogTotal = Number(hotels[0]?.catalog_total || 0);
    hotels.forEach(hotel => { delete hotel.catalog_total; });

    const candidateHotelIds = hotels.map(hotel => hotel.id);
    const [userWeights, roomRows, catalogAmenityRows] = await Promise.all([
      getUserWeights(userId, { destination: city, check_in: liveCheckIn, check_out: liveCheckOut, guests, trip_purpose }),
      candidateHotelIds.length
        ? db.prepare(`SELECT hotel_id, name, size_sqm, view_type, amenities FROM hotel_rooms WHERE hotel_id IN (${candidateHotelIds.map(() => '?').join(',')})`).all(...candidateHotelIds)
        : [],
      candidateHotelIds.length
        ? db.prepare(`SELECT hotel_id, name FROM hotel_amenities WHERE hotel_id IN (${candidateHotelIds.map(() => '?').join(',')})`).all(...candidateHotelIds)
        : [],
    ]);
    const roomsByHotel = roomRows.reduce((result, room) => {
      if (!result[room.hotel_id]) result[room.hotel_id] = [];
      result[room.hotel_id].push(room);
      return result;
    }, {});
    const catalogAmenitiesByHotel = catalogAmenityRows.reduce((result, amenity) => {
      if (!result[amenity.hotel_id]) result[amenity.hotel_id] = [];
      result[amenity.hotel_id].push(amenity);
      return result;
    }, {});
    hotels = hotels.filter(hotel => hasRequiredAmenities(
      hotel,
      roomsByHotel[hotel.id] || [],
      catalogAmenitiesByHotel[hotel.id] || [],
      strictAmenities,
    ));
    const scoreCities = [...new Set(hotels.map(hotel => hotel.city).filter(Boolean))];
    const marketRows = scoreCities.length ? await db.prepare(`
      SELECT mp.*, mh.city, mh.location, mh.stars
      FROM hotel_prices mp JOIN hotels mh ON mh.id = mp.hotel_id
      WHERE mh.city IN (${scoreCities.map(() => '?').join(',')})
        AND mp.check_in = ? AND mp.check_out = ? AND mp.price_valid = 1
        AND mp.source IN ('liteapi', 'xotelo') AND (mp.guests = ? OR mp.guests IS NULL)
    `).all(...scoreCities, liveCheckIn, liveCheckOut, Math.max(1, Number(guests) || 2)) : [];
    const marketHotels = [...new Map([
      ...hotels.map(hotel => [hotel.id, hotel]),
      ...marketRows.map(row => [row.hotel_id, { id: row.hotel_id, city: row.city, location: row.location, stars: row.stars }]),
    ]).values()];
    const comparableContext = comparablePriceContext(marketHotels, marketRows, userPrefs, guests);
    const priceMetadataEntries = hotels.map(hotel => {
      const comparable = comparableContext.ratesByHotel.get(hotel.id);
      return [hotel.id, comparable ? { ...comparable, provider: comparable.operator } : null];
    });
    const scoreContext = {
      roomsByHotel,
      language,
      priceMetadataByHotel: Object.fromEntries(priceMetadataEntries),
      priceBenchmarkByHotel: comparableContext.benchmarkByHotel,
    };
    const scored = hotels.map(hotel => {
      const comparable = comparableContext.ratesByHotel.get(hotel.id);
      return calculateHotelScore({
        ...hotel,
        min_price: comparable?.payable_nightly_price ?? null,
        comparable_price: comparable?.comparable_nightly_price ?? null,
        price_source: comparable?.source || null,
      }, userPrefs, userWeights, scoreContext);
    });
    // Score only the current SQL candidate window. Interactive filters no longer
    // trigger a full-city score recalculation for thousands of hotels.
    const sorted = scored.sort((a, b) => {
      if (sort === 'score') return Number(b.top_pick_eligible) - Number(a.top_pick_eligible) || b.adjusted_score - a.adjusted_score || b.fairworth_score - a.fairworth_score;
      if (sort === 'price_asc') return (a.min_price ?? Infinity) - (b.min_price ?? Infinity);
      if (sort === 'price_desc') return (b.min_price ?? -Infinity) - (a.min_price ?? -Infinity);
      if (sort === 'rating') return (b.rating || 0) - (a.rating || 0);
      return 0;
    });
    const totalResults = catalogTotal;
    const pageResults = sorted;
    const hasMore = pageOffset + pageResults.length < totalResults;
    await Promise.all(pageResults.map(result => recordScoreSnapshot(userId, result)));

    // Log search
    if (city && search_event === '1' && search_session_id) {
      const fingerprint = JSON.stringify({ city: city.toLowerCase(), check_in: liveCheckIn, check_out: liveCheckOut, guests: Number(guests) });
      await db.prepare(`
        INSERT INTO searches (id, user_id, destination, check_in, check_out, guests, result_count, search_session_id, search_kind, fingerprint)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'explicit', ?)
        ON CONFLICT (user_id, search_session_id, fingerprint) WHERE search_session_id IS NOT NULL AND fingerprint IS NOT NULL DO NOTHING
      `).run(uuidv4(), userId, city, liveCheckIn, liveCheckOut, guests, totalResults, search_session_id, fingerprint);
    }

    const warmed = city ? await warmedDestination(city) : null;
    const locationFacets = warmed?.locations || (city
      ? (await (() => {
        const destination = hotelDestinationFilter('hotels', city, destinationCode);
        return db.prepare(`SELECT DISTINCT location FROM hotels WHERE active = 1 AND ${destination.sql} ORDER BY location`).all(...destination.params);
      })()).map(row => row.location)
      : []);
    const responseHotels = pageResults.map(hotel => {
      const result = { ...hotel };
      delete result.content_raw_json;
      return result;
    });
    const payload = {
      hotels: responseHotels,
      total: totalResults,
      has_more: hasMore,
      next_offset: pageOffset + pageResults.length,
      page_size: pageSize,
      facets: { locations: locationFacets },
      rates_progressive: true,
      personalization: {
        enabled: Boolean(userPrefs),
        learning_confidence: userWeights.confidence,
        contextual_learning_confidence: userWeights.contextualConfidence,
        active_contexts: userWeights.activeContexts,
        interaction_count: userWeights.interactionCount,
      },
      cached: false,
    };
    await cache.setJson(searchCacheKey, payload, Math.max(30, Number(process.env.HOTEL_SEARCH_CACHE_TTL_SECONDS || 300)));
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

async function enrichRateBatch({ hotelIds, checkIn, checkOut, guests = 2, tripPurpose, language = 'en', breakfast = false, freeCancel = false, userId }) {
    const uniqueIds = [...new Set(hotelIds.map(String))];
    const [cachedPreferences, interactionVersion] = await Promise.all([
      db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get(userId),
      db.prepare(`SELECT COUNT(*) AS count, MAX(created_at) AS latest FROM user_interactions WHERE user_id = ?`).get(userId),
    ]);
    const rateCacheKey = cache.cacheKey('hotel-rate-batch-v2', {
      userId, hotelIds: [...uniqueIds].sort(), checkIn, checkOut, guests: Number(guests), tripPurpose,
      language, breakfast: Boolean(breakfast), freeCancel: Boolean(freeCancel), scoreVersion: SCORE_VERSION,
      preferences: cachedPreferences, interactionVersion,
    });
    const cachedRates = await cache.getJson(rateCacheKey);
    if (cachedRates) return { ...cachedRates, cached: true };
    const hotels = await db.prepare(`SELECT * FROM hotels WHERE active = 1 AND id IN (${uniqueIds.map(() => '?').join(',')})`).all(...uniqueIds);
    if (!hotels.length) return { hotels: [], checked: 0, available: 0, unavailable_hotel_ids: uniqueIds, cached: false };
    try {
      await refreshLiteApiRates(hotels, checkIn, checkOut, { guests });
    } catch (error) {
      monitoring.captureProviderDegradation('LiteAPI', error, { operation: 'hotel_rate_batch' });
      throw error;
    }
    const liteChecks = await db.prepare(`SELECT hotel_id FROM hotel_rate_checks WHERE provider = 'liteapi' AND status = 'available' AND check_in = ? AND check_out = ? AND guests = ? AND hotel_id IN (${uniqueIds.map(() => '?').join(',')})`).all(checkIn, checkOut, Math.max(1, Number(guests) || 2), ...uniqueIds);
    const liteAvailableIds = new Set(liteChecks.map(row => row.hotel_id));
    const xoteloEnabled = String(process.env.HOTEL_RATE_PROVIDERS || 'liteapi,xotelo').split(',').map(value => value.trim()).includes('xotelo');
    const fallbackHotels = xoteloEnabled ? hotels.filter(hotel => !liteAvailableIds.has(hotel.id)) : [];
    await Promise.allSettled(fallbackHotels.map(hotel => refreshHotelPricesFromXotelo(hotel, checkIn, checkOut).catch(error => {
      console.warn(`[xotelo] ${hotel.name}: ${error.message}`);
      monitoring.captureProviderDegradation('Xotelo', error, { operation: 'hotel_rate_batch', hotel_id: hotel.id });
      return null;
    })));
    const ids = hotels.map(hotel => hotel.id);
    const cities = [...new Set(hotels.map(hotel => hotel.city).filter(Boolean))];
    const [roomRows, reviewRows, priceRows, userPrefs, userWeights, marketRows] = await Promise.all([
      db.prepare(`SELECT hotel_id, name, size_sqm, view_type, amenities FROM hotel_rooms WHERE hotel_id IN (${ids.map(() => '?').join(',')})`).all(...ids),
      db.prepare(`SELECT * FROM hotel_reviews WHERE hotel_id IN (${ids.map(() => '?').join(',')})`).all(...ids),
      db.prepare(`SELECT * FROM hotel_prices WHERE hotel_id IN (${ids.map(() => '?').join(',')}) AND source IN ('liteapi', 'xotelo') AND price_valid = 1 AND check_in = ? AND check_out = ? AND (guests = ? OR guests IS NULL) ORDER BY hotel_id, price_per_night`).all(...ids, checkIn, checkOut, Math.max(1, Number(guests) || 2)),
      Promise.resolve(cachedPreferences),
      getUserWeights(userId, { destination: hotels[0]?.city, check_in: checkIn, check_out: checkOut, guests, trip_purpose: tripPurpose }),
      cities.length ? db.prepare(`SELECT hp.*, h.city, h.location, h.stars FROM hotels h JOIN hotel_prices hp ON hp.hotel_id = h.id AND hp.price_valid = 1 WHERE h.city IN (${cities.map(() => '?').join(',')}) AND hp.check_in = ? AND hp.check_out = ? AND hp.source IN ('liteapi', 'xotelo') AND (hp.guests = ? OR hp.guests IS NULL)`).all(...cities, checkIn, checkOut, Math.max(1, Number(guests) || 2)) : [],
    ]);
    const roomsByHotel = roomRows.reduce((map, row) => ((map[row.hotel_id] ||= []).push(row), map), {});
    const reviewsByHotel = new Map(reviewRows.map(row => [row.hotel_id, row]));
    const pricesByHotel = priceRows.reduce((map, row) => ((map[row.hotel_id] ||= []).push(row), map), {});
    const marketHotels = [...new Map([
      ...hotels.map(hotel => [hotel.id, hotel]),
      ...marketRows.map(row => [row.hotel_id, { id: row.hotel_id, city: row.city, location: row.location, stars: row.stars }]),
    ]).values()];
    const comparableContext = comparablePriceContext(marketHotels, marketRows, userPrefs, guests, {
      breakfastRequired: breakfast === true || breakfast === '1',
      refundableRequired: freeCancel === true || freeCancel === '1',
    });
    const priceMetadataByHotel = Object.fromEntries(hotels.map(hotel => {
      const comparable = comparableContext.ratesByHotel.get(hotel.id);
      return [hotel.id, comparable ? { ...comparable, provider: comparable.operator } : null];
    }));
    const enriched = hotels.map(hotel => {
      const review = reviewsByHotel.get(hotel.id);
      const prices = pricesByHotel[hotel.id] || [];
      const comparable = comparableContext.ratesByHotel.get(hotel.id);
      const scoring = calculateHotelScore({
        ...hotel,
        min_price: comparable?.payable_nightly_price ?? null,
        comparable_price: comparable?.comparable_nightly_price ?? null,
        rating: review?.rating,
        review_count: review?.count,
        cleanliness: review?.cleanliness,
        service: review?.service,
        location_score: review?.location_score,
        value_score: review?.value,
        latest_review_at: review?.latest_review_at,
        recent_review_share: review?.recent_review_share,
        previous_rating: review?.previous_rating,
        rating_trend: review?.rating_trend,
        rating_stddev: review?.rating_stddev,
        suspicious_review_share: review?.suspicious_review_share,
        verified_review_share: review?.verified_review_share,
        review_source_count: review?.review_source_count,
        review_source_consistency: review?.review_source_consistency,
      }, userPrefs, userWeights, { roomsByHotel, language, priceMetadataByHotel, priceBenchmarkByHotel: comparableContext.benchmarkByHotel });
      return {
        ...scoring,
        price_source: comparable?.source || prices[0]?.source || null,
        ...rateAvailability(comparable, { checkIn, checkOut, guests }),
      };
    });
    await Promise.all(enriched.filter(result => result.availability_status === 'available').map(result => recordScoreSnapshot(userId, result)));
    const payload = {
      hotels: enriched.map(result => {
        const compact = { ...result };
        delete compact.content_raw_json;
        delete compact.description;
        return compact;
      }),
      checked: hotels.length,
      available: enriched.filter(result => result.availability_status === 'available').length,
      unavailable_hotel_ids: enriched.filter(result => result.availability_status !== 'available').map(result => result.id),
      cached: false,
    };
    await cache.setJson(rateCacheKey, payload, Math.max(60, Number(process.env.HOTEL_RATE_CACHE_TTL_SECONDS || 900)));
    return payload;
}

// POST /api/hotels/rates/batch — progressively enrich catalog results with live rates.
router.post('/rates/batch', requireAuth, requireEmailVerified, requireOnboarding, async (req, res) => {
  try {
    const {
      hotel_ids: hotelIds, check_in: checkIn, check_out: checkOut, guests = 2,
      trip_purpose: tripPurpose, language = 'en', breakfast = false, free_cancel: freeCancel = false,
    } = req.body || {};
    if (!Array.isArray(hotelIds) || !hotelIds.length || hotelIds.length > 50) return res.status(400).json({ error: 'hotel_ids must contain between 1 and 50 items' });
    if (!validateDateRange(checkIn, checkOut)) return res.status(400).json({ error: 'Check-in and check-out must be valid future dates' });
    res.json(await enrichRateBatch({ hotelIds, checkIn, checkOut, guests, tripPurpose, language, breakfast, freeCancel, userId: req.user.id }));
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: 'Could not load the next price batch' });
  }
});

// GET /api/hotels/rates/stream — SSE rate updates in provider-sized batches.
router.get('/rates/stream', requireAuth, requireEmailVerified, requireOnboarding, async (req, res) => {
  const hotelIds = String(req.query.hotel_ids || '').split(',').filter(Boolean);
  const checkIn = req.query.check_in;
  const checkOut = req.query.check_out;
  if (!hotelIds.length || hotelIds.length > 120) return res.status(400).json({ error: 'hotel_ids must contain between 1 and 120 items' });
  if (!validateDateRange(checkIn, checkOut)) return res.status(400).json({ error: 'Check-in and check-out must be valid future dates' });

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  let closed = false;
  req.on('close', () => { closed = true; });
  const send = (event, data) => {
    if (!closed && !res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const batchSize = Math.min(15, Math.max(10, Number(process.env.HOTEL_RATE_STREAM_BATCH_SIZE || 12)));
    let checked = 0;
    let available = 0;
    send('started', { total: hotelIds.length, batch_size: batchSize });
    for (let offset = 0; offset < hotelIds.length && !closed; offset += batchSize) {
      const batch = hotelIds.slice(offset, offset + batchSize);
      const result = await enrichRateBatch({
        hotelIds: batch,
        checkIn,
        checkOut,
        guests: req.query.guests || 2,
        tripPurpose: req.query.trip_purpose,
        language: req.query.language || 'en',
        breakfast: req.query.breakfast === '1',
        freeCancel: req.query.free_cancel === '1',
        userId: req.user.id,
      });
      checked += result.checked;
      available += result.available;
      send('batch', { ...result, progress: { checked, available, total: hotelIds.length } });
    }
    send('complete', { checked, available, total: hotelIds.length });
    if (!closed) res.end();
  } catch (error) {
    console.error(error);
    send('failure', { error: 'Could not load hotel prices' });
    if (!closed) res.end();
  }
});

// GET /api/hotels/popular-destinations
router.get('/popular-destinations', async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 5, 1), 12);
    const defaults = defaultTravelDates();
    await ensureXoteloSchema();
    const destinations = await db.prepare(`
      SELECT
        h.city,
        h.country,
        COUNT(DISTINCT h.id) as hotel_count,
        MIN(hp.price_per_night) as min_price,
        AVG(hr.rating) as avg_rating,
        SUM(COALESCE(hr.count, 0)) as review_count
      FROM hotels h
      LEFT JOIN hotel_prices hp ON hp.hotel_id = h.id AND hp.price_valid = 1
      LEFT JOIN hotel_reviews hr ON hr.hotel_id = h.id
      GROUP BY h.city, h.country
      HAVING MIN(hp.price_per_night) IS NOT NULL
      ORDER BY review_count DESC, hotel_count DESC, min_price ASC
      LIMIT ?
    `).all(limit);

    res.json({
      destinations: destinations.map(destination => ({
        ...destination,
        min_price: Math.round(destination.min_price),
        avg_rating: destination.avg_rating ? Number(destination.avg_rating.toFixed(1)) : null,
        review_count: Number(destination.review_count || 0),
      })),
      total: destinations.length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/hotels/insights
router.get('/insights', async (req, res) => {
  try {
    if (!getTravelpayoutsToken()) {
      return res.status(503).json({
        error: 'Travelpayouts is not configured on the server',
        code: 'PROVIDER_NOT_CONFIGURED',
        provider: 'Travelpayouts',
        retryable: false,
      });
    }
    const cached = await db.prepare(`SELECT *, expires_at > CURRENT_TIMESTAMP AS fresh FROM insights_cache WHERE cache_key = ?`).get(INSIGHTS_CACHE_KEY);
    const payload = cached?.payload ? JSON.parse(cached.payload) : null;
    if (!cached?.fresh) refreshInsightsInBackground().catch(error => console.warn(`[insights] refresh start failed: ${error.message}`));
    if (payload) return res.json({ ...payload, cached: true, stale: !cached.fresh, refreshing: !cached.fresh, refresh_error: cached.error || null });
    if (cached?.status === 'error') return res.status(503).json({ error: 'Insights are temporarily unavailable', code: 'INSIGHTS_UNAVAILABLE', retryable: true });
    return res.status(202).json({ status: 'refreshing', retry_after_seconds: 3, sections: [], total: 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/insights/refresh', requireAuth, async (req, res) => {
  if (!getTravelpayoutsToken()) {
    return res.status(503).json({
      error: 'Travelpayouts is not configured on the server',
      code: 'PROVIDER_NOT_CONFIGURED',
      provider: 'Travelpayouts',
      retryable: false,
    });
  }
  refreshInsightsInBackground({ force: true }).catch(error => console.warn(`[insights] manual refresh failed: ${error.message}`));
  res.status(202).json({ status: 'refreshing', retry_after_seconds: 3 });
});

// GET /api/hotels/price-calendar
router.get('/price-calendar', async (req, res) => {
  try {
    const {
      city: requestedCity = 'Singapore',
      start,
      days = 35,
      nights = 4,
      check_in,
      check_out,
    } = req.query;
    const city = canonicalHotelCity(requestedCity);

    const startDate = start ? parseDate(start) : parseDate(formatDate(new Date()));
    const requestedDays = Math.min(Math.max(Number(days) || 35, 14), 90);
    const tripNights = check_in && check_out
      ? Math.max(1, Math.ceil((parseDate(check_out) - parseDate(check_in)) / (1000 * 60 * 60 * 24)))
      : Math.max(1, Number(nights) || 4);

    const rows = await db.prepare(`
      SELECT hp.check_in AS date, MIN(hp.price_per_night) as price_per_night
      FROM hotel_prices hp
      JOIN hotels h ON h.id = hp.hotel_id
      WHERE hp.source IN ('liteapi', 'xotelo') AND hp.price_valid = 1 AND hp.check_in >= ? AND hp.check_in < ?
        AND (LOWER(h.city) LIKE ? OR LOWER(h.country) LIKE ? OR LOWER(h.location) LIKE ?)
      GROUP BY hp.check_in ORDER BY hp.check_in
    `).all(formatDate(startDate), formatDate(addDays(startDate, requestedDays)), `%${city.toLowerCase()}%`, `%${city.toLowerCase()}%`, `%${city.toLowerCase()}%`);
    const calendar = rows.map(row => ({ date: row.date, price_per_night: Math.round(row.price_per_night), total_price: Math.round(row.price_per_night) * tripNights, is_weekend: [5, 6].includes(parseDate(row.date).getUTCDay()) }));

    const totals = calendar.map(day => day.total_price);
    const minTotal = totals.length ? Math.min(...totals) : 0;
    const maxTotal = totals.length ? Math.max(...totals) : 0;
    const withBand = calendar.map(day => {
      const range = Math.max(1, maxTotal - minTotal);
      const ratio = (day.total_price - minTotal) / range;
      const price_level = ratio < 0.34 ? 'low' : ratio < 0.67 ? 'mid' : 'high';
      return { ...day, price_level };
    });

    let recommendation = null;
    if (check_in) {
      const selected = withBand.find(day => day.date === check_in);
      if (selected) {
        const selectedDate = parseDate(check_in);
        const candidates = withBand
          .map(day => ({
            ...day,
            shift_days: Math.round((parseDate(day.date) - selectedDate) / (1000 * 60 * 60 * 24)),
          }))
          .filter(day => day.shift_days !== 0 && Math.abs(day.shift_days) <= 7 && day.total_price < selected.total_price)
          .sort((a, b) => a.total_price - b.total_price);

        if (candidates.length) {
          const best = candidates[0];
          const savings = selected.total_price - best.total_price;
          recommendation = {
            current_check_in: selected.date,
            recommended_check_in: best.date,
            shift_days: best.shift_days,
            savings_amount: savings,
            savings_percent: Math.round((savings / selected.total_price) * 100),
          };
        }
      }
    }

    res.json({
      city,
      nights: tripNights,
      base_price: calendar.length ? Math.min(...calendar.map(day => day.price_per_night)) : null,
      calendar: withBand,
      recommendation,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/hotels/:id/updates — refresh slow providers after the cached card is visible.
router.get('/:id/updates', requireAuth, requireEmailVerified, requireOnboarding, async (req, res) => {
  const hotel = await db.prepare('SELECT * FROM hotels WHERE id = ?').get(req.params.id);
  if (!hotel) return res.status(404).json({ error: 'Hotel not found' });
  const checkIn = req.query.check_in || formatDate(addDays(new Date(), 30));
  const checkOut = req.query.check_out || defaultCheckOut(checkIn);
  if (!validateDateRange(checkIn, checkOut)) return res.status(400).json({ error: 'Check-in and check-out must be valid future dates' });
  const guests = Math.max(1, Number(req.query.guests) || 2);
  const language = req.query.language || 'en';
  const tripPurpose = req.query.trip_purpose;
  const providerTimeoutMs = Math.min(5000, Math.max(3000, Number(process.env.HOTEL_DETAIL_PROVIDER_TIMEOUT_MS || 4000)));

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  let closed = false;
  req.on('close', () => { closed = true; });
  const send = (event, data) => {
    if (!closed && !res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    send('started', { timeout_ms: providerTimeoutMs });
    const xoteloEnabled = String(process.env.HOTEL_RATE_PROVIDERS || 'liteapi,xotelo')
      .split(',').map(value => value.trim()).includes('xotelo');
    const providerJobs = [
      ['liteapi', refreshLiteApiRates([hotel], checkIn, checkOut, { guests, force: req.query.refresh === '1' })],
      ...(xoteloEnabled ? [['xotelo', refreshHotelPricesFromXotelo(hotel, checkIn, checkOut, { force: req.query.refresh === '1' })]] : []),
    ].map(([provider, job]) => withTimeout(job, providerTimeoutMs, provider)
      .then(result => {
        send('provider', { provider, status: 'updated' });
        return result;
      })
      .catch(error => {
        console.warn(`[hotel-detail:${provider}] ${hotel.name}: ${error.message}`);
        const status = error.message.includes('timed out') ? 'timeout' : 'error';
        monitoring.captureProviderDegradation(provider, error, { operation: 'hotel_detail', status, hotel_id: hotel.id });
        send('provider', { provider, status: status === 'error' ? 'failed' : status });
        return null;
      }));

    const translationJob = withTimeout(localizeHotel(hotel, language,
      await db.prepare('SELECT * FROM hotel_rooms WHERE hotel_id = ? ORDER BY base_price_per_night').all(hotel.id)), providerTimeoutMs, 'translation')
      .then(localized => {
        send('translation', { hotel: localized.hotel, rooms: localized.rooms });
        return localized;
      })
      .catch(error => console.warn(`[hotel-detail:translation] ${hotel.name}: ${error.message}`));
    const imagesJob = withTimeout(hotelImages(hotel), providerTimeoutMs, 'hotel images')
      .then(images => {
        send('images', { images });
        return images;
      })
      .catch(error => console.warn(`[hotel-detail:images] ${hotel.name}: ${error.message}`));

    await Promise.all(providerJobs);
    const snapshot = await loadHotelDetailSnapshot({
      hotel, userId: req.user.id, checkIn, checkOut, guests, language, tripPurpose,
    });
    snapshot.rates_refreshing = false;
    const key = detailCacheKey({ hotelId: hotel.id, userId: req.user.id, checkIn, checkOut, guests, language, tripPurpose });
    const ttl = Math.max(30, Number(process.env.HOTEL_DETAIL_CACHE_TTL_SECONDS || 120));
    await cache.setJson(key, snapshot, ttl);
    send('rates', { prices: snapshot.prices, scoring: snapshot.scoring, price_meta: snapshot.price_meta });
    const [translationResult, imagesResult] = await Promise.allSettled([translationJob, imagesJob]);
    if (translationResult.status === 'fulfilled' && translationResult.value) {
      snapshot.hotel = translationResult.value.hotel;
      snapshot.rooms = translationResult.value.rooms;
      snapshot.translation_pending = false;
    }
    if (imagesResult.status === 'fulfilled' && imagesResult.value?.length) snapshot.images = imagesResult.value;
    await cache.setJson(key, snapshot, ttl);
    send('complete', { rates_refreshed: true });
    if (!closed) res.end();
  } catch (error) {
    console.error(error);
    send('failure', { error: 'Could not refresh hotel details' });
    if (!closed) res.end();
  }
});

// GET /api/hotels/:id — return only cached/local data; providers refresh through SSE.
router.get('/:id', requireAuth, requireEmailVerified, requireOnboarding, async (req, res) => {
  try {
    const hotel = await db.prepare('SELECT * FROM hotels WHERE id = ?').get(req.params.id);
    if (!hotel) return res.status(404).json({ error: 'Hotel not found' });
    const checkIn = req.query.check_in || formatDate(addDays(new Date(), 30));
    const checkOut = req.query.check_out || defaultCheckOut(checkIn);
    if (!validateDateRange(checkIn, checkOut)) return res.status(400).json({ error: 'Check-in and check-out must be valid future dates' });
    const options = {
      hotel, userId: req.user.id, checkIn, checkOut, guests: req.query.guests,
      language: req.query.language || 'en', tripPurpose: req.query.trip_purpose,
    };
    const key = detailCacheKey({ hotelId: hotel.id, ...options });
    const result = await cache.rememberJson(key, Math.max(30, Number(process.env.HOTEL_DETAIL_CACHE_TTL_SECONDS || 120)),
      () => loadHotelDetailSnapshot(options));
    res.json({ ...result.value, cached: result.cached });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

async function hotelAnalysisHandler(req, res) {
  try {
    const userId = req.user.id;
    const defaults = defaultTravelDates();
    const { check_in = defaults.checkIn, check_out = defaults.checkOut, language = 'en', guests = 2, trip_purpose: tripPurpose } = req.body;
    if (!validateDateRange(check_in, check_out)) return res.status(400).json({ error: 'Dates must be in the future' });
    const userPrefs = await db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get(userId);
    if (!userPrefs) return res.status(404).json({ error: 'User preferences not found' });
    const analysisCacheKey = cache.cacheKey('hotel-analysis-v2', {
      hotelId: req.params.id, userId, checkIn: check_in, checkOut: check_out,
      language, guests: Number(guests), tripPurpose: tripPurpose || 'leisure', scoreVersion: SCORE_VERSION, preferences: userPrefs,
    });
    const redisAnalysis = await cache.getJson(analysisCacheKey);
    if (redisAnalysis) return res.json({ analysis: redisAnalysis, cached: true, cache_source: 'redis' });

    // AI output is deterministic for this complete context and can be reused for hours.
    const cached = await db.prepare(`
      SELECT * FROM ai_analyses 
      WHERE hotel_id = ? AND user_id = ? AND check_in = ? AND check_out = ?
      AND created_at + (? * INTERVAL '1 hour') > CURRENT_TIMESTAMP
      ORDER BY created_at DESC LIMIT 1
    `).get(req.params.id, userId, check_in, check_out, Math.max(1, Number(process.env.HOTEL_AI_CACHE_TTL_HOURS || 12)));

    if (cached) {
      const cachedAnalysis = JSON.parse(cached.analysis_json);
      if (cachedAnalysis._language === language && cachedAnalysis._score_version === SCORE_VERSION && Number(cachedAnalysis._guests || 2) === Number(guests || 2) && (cachedAnalysis._trip_purpose || 'leisure') === (tripPurpose || 'leisure')) {
        await cache.setJson(analysisCacheKey, cachedAnalysis, Math.max(3600, Number(process.env.HOTEL_AI_CACHE_TTL_HOURS || 12) * 3600));
        return res.json({ analysis: cachedAnalysis, cached: true });
      }
    }

    const hotel = await db.prepare('SELECT * FROM hotels WHERE id = ?').get(req.params.id);
    if (!hotel) return res.status(404).json({ error: 'Hotel not found' });

    const rooms = await db.prepare('SELECT * FROM hotel_rooms WHERE hotel_id = ?').all(req.params.id);
    const prices = await db.prepare(`SELECT * FROM hotel_prices WHERE hotel_id = ? AND source IN ('liteapi', 'xotelo') AND price_valid = 1 AND check_in = ? AND check_out = ? AND (guests = ? OR guests IS NULL)`).all(req.params.id, check_in, check_out, Math.max(1, Number(guests) || 2));
    const reviews = await db.prepare('SELECT * FROM hotel_reviews WHERE hotel_id = ?').get(req.params.id);
    const analysis = await analyzeHotel(hotel, rooms, reviews, prices, userPrefs, check_in, check_out, language);
    const deterministicScore = await scoreHotelForUser(hotel, rooms, reviews, prices, userId, language, guests, tripPurpose);
    analysis.fairworth_score = deterministicScore.fairworth_score;
    analysis.adjusted_score = deterministicScore.adjusted_score;
    analysis.score_reliability = deterministicScore.score_reliability;
    analysis.score_reliability_level = deterministicScore.score_reliability_level;
    analysis.price_confidence = deterministicScore.price_confidence;
    analysis.price_confidence_level = deterministicScore.price_confidence_level;
    analysis.top_pick_eligible = deterministicScore.top_pick_eligible;
    analysis.reliability_breakdown = deterministicScore.reliability_breakdown;
    analysis.quality_breakdown = deterministicScore.quality_breakdown;
    analysis.quality_weights = deterministicScore.quality_weights;
    analysis.quality_profiles = deterministicScore.quality_profiles;
    analysis.review_freshness_breakdown = deterministicScore.review_freshness_breakdown;
    analysis.review_freshness_reliability = deterministicScore.review_freshness_reliability;
    analysis.rating_trend = deterministicScore.rating_trend;
    analysis.rating_trend_direction = deterministicScore.rating_trend_direction;
    analysis.review_confidence = deterministicScore.review_confidence;
    analysis.review_confidence_reliability = deterministicScore.review_confidence_reliability;
    analysis.review_confidence_breakdown = deterministicScore.review_confidence_breakdown;
    analysis.review_confidence_weights = deterministicScore.review_confidence_weights;
    analysis.review_source_count = deterministicScore.review_source_count;
    analysis.review_structure_breakdown = deterministicScore.review_structure_breakdown;
    analysis.score_breakdown = { ...deterministicScore.score_breakdown, risk: analysis.score_breakdown?.risk || 'medium' };
    analysis.personal_fit = deterministicScore.personal_fit;
    analysis.travel_tier_score = deterministicScore.travel_tier_score;
    analysis.travel_tier_breakdown = deterministicScore.travel_tier_breakdown;
    analysis.travel_tier_weights = deterministicScore.travel_tier_weights;
    analysis.score_version = deterministicScore.score_version;
    analysis.calculated_at = deterministicScore.calculated_at;
    analysis.calculation_parameters = deterministicScore.calculation_parameters;
    analysis.data_completeness = deterministicScore.data_completeness;
    analysis.price_details = deterministicScore.price_details;
    analysis._language = language;
    analysis._score_version = SCORE_VERSION;
    analysis._guests = Math.max(1, Number(guests) || 2);
    analysis._trip_purpose = tripPurpose || 'leisure';

    // Cache it
    await db.prepare(`
      INSERT INTO ai_analyses (id, hotel_id, user_id, check_in, check_out, analysis_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(uuidv4(), req.params.id, userId, check_in, check_out, JSON.stringify(analysis));
    await cache.setJson(analysisCacheKey, analysis, Math.max(3600, Number(process.env.HOTEL_AI_CACHE_TTL_HOURS || 12) * 3600));

    res.json({ analysis, cached: false });
  } catch (err) {
    console.error('AI analysis error:', err);
    res.status(500).json({ error: err.message });
  }
}

// POST /api/hotels/:id/analyze — cached AI analysis.
router.post('/:id/analyze', requireAuth, requireEmailVerified, requireOnboarding, requireCapability('ai'), aiLimiter, hotelAnalysisHandler);

// POST /api/hotels/:id/analyze/stream — newline-delimited progress and result events.
router.post('/:id/analyze/stream', requireAuth, requireEmailVerified, requireOnboarding, requireCapability('ai'), aiLimiter, async (req, res) => {
  res.set({ 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const send = payload => { if (!res.writableEnded) res.write(`${JSON.stringify(payload)}\n`); };
  send({ type: 'status', stage: 'preparing' });
  const responseAdapter = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) {
      if (this.statusCode >= 400) send({ type: 'error', error: payload.error || 'AI analysis failed' });
      else send({ type: 'analysis', ...payload });
      res.end();
      return this;
    },
  };
  send({ type: 'status', stage: 'analysing' });
  await hotelAnalysisHandler(req, responseAdapter);
});

// GET /api/hotels/:id/prices
router.get('/:id/prices', async (req, res) => {
  try {
    const checkIn = req.query.check_in || formatDate(addDays(new Date(), 30));
    const checkOut = req.query.check_out || defaultCheckOut(checkIn);
    const hotel = await db.prepare('SELECT * FROM hotels WHERE id = ?').get(req.params.id);
    if (!hotel) return res.status(404).json({ error: 'Hotel not found' });

    await refreshLiteApiRates([hotel], checkIn, checkOut, { force: req.query.refresh === '1', guests: req.query.guests }).catch(err => console.warn(`[liteapi] ${hotel.name}: ${err.message}`));
    await refreshHotelPricesFromXotelo(hotel, checkIn, checkOut, { force: req.query.refresh === '1' }).catch(err => {
      console.warn(`[xotelo] ${hotel.name}: ${err.message}`);
      return null;
    });

    const prices = await db.prepare(`
      SELECT * FROM hotel_prices
      WHERE hotel_id = ? AND (
        (check_in = ? AND check_out = ?)
        OR check_in IS NULL
      )
      AND price_valid = 1
      ORDER BY
        CASE WHEN source = 'liteapi' THEN 0 ELSE 1 END,
        price_per_night
    `).all(req.params.id, checkIn, checkOut);
    res.json({ prices: prices.map(price => normalizePrice(price, CACHE_TTL_HOURS)), ttl_hours: CACHE_TTL_HOURS });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/prices/refresh', requireAuth, requireEmailVerified, requireOnboarding, async (req, res) => {
  try {
    const checkIn = req.body.check_in || req.query.check_in;
    const checkOut = req.body.check_out || req.query.check_out;
    if (!checkIn || !checkOut) {
      return res.status(400).json({ error: 'check_in and check_out are required' });
    }

    const hotel = await db.prepare('SELECT * FROM hotels WHERE id = ?').get(req.params.id);
    if (!hotel) return res.status(404).json({ error: 'Hotel not found' });
    await refreshLiteApiRates([hotel], checkIn, checkOut, { force: true, guests: req.body.guests });
    if (hotel.tripadvisor_hotel_key) await refreshHotelPricesFromXotelo(hotel, checkIn, checkOut, { force: true });
    const prices = await db.prepare(`SELECT * FROM hotel_prices WHERE hotel_id = ? AND source IN ('liteapi', 'xotelo') AND price_valid = 1 AND check_in = ? AND check_out = ? ORDER BY price_per_night`).all(hotel.id, checkIn, checkOut);
    res.json({ success: true, hotel_id: hotel.id, prices: prices.map(price => normalizePrice(price, CACHE_TTL_HOURS)), ttl_hours: CACHE_TTL_HOURS });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

if (process.env.NODE_ENV !== 'test') {
  const insightsScheduler = setInterval(() => {
    refreshInsightsInBackground().catch(error => console.warn(`[insights] scheduled refresh failed: ${error.message}`));
  }, 15 * 60 * 1000);
  insightsScheduler.unref();
  const initialRefresh = setTimeout(() => {
    refreshInsightsInBackground().catch(error => console.warn(`[insights] initial refresh failed: ${error.message}`));
  }, 1500);
  initialRefresh.unref();
}

module.exports = router;
