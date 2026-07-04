const { v4: uuidv4 } = require('uuid');
const { db } = require('../db/database');
const liteapi = require('./liteapi');
const { roundMoney, majorUnits } = require('./pricing');

function nightsBetween(checkIn, checkOut) {
  return Math.max(1, Math.round((new Date(`${checkOut}T00:00:00Z`) - new Date(`${checkIn}T00:00:00Z`)) / 86400000));
}

function firstMoney(values = [], currency) {
  return values.find(item => !currency || item.currency === currency) || values[0] || null;
}

function flattenRates(hotelResult, nights, requestedCurrency = 'USD') {
  const rows = [];
  for (const room of hotelResult.roomTypes || []) for (const rate of room.rates || []) {
    const money = firstMoney(rate.retailRate?.total || []);
    const currency = money?.currency || requestedCurrency;
    const amount = majorUnits(money?.amount, currency, 'major');
    if (!(amount > 0)) continue;
    const taxes = Array.isArray(rate.retailRate?.taxesAndFees) ? rate.retailRate.taxesAndFees : [];
    const includedTaxTotal = taxes.filter(item => item.included === true).reduce((sum, item) => sum + (majorUnits(item.amount, item.currency || currency, 'major') || 0), 0);
    const excludedTaxTotal = taxes.filter(item => item.included === false).reduce((sum, item) => sum + (majorUnits(item.amount, item.currency || currency, 'major') || 0), 0);
    const taxTotal = roundMoney(includedTaxTotal + excludedTaxTotal, currency);
    const includedValues = taxes.map(item => item.included).filter(value => typeof value === 'boolean');
    const taxStatus = !includedValues.length ? 'unknown' : includedValues.every(Boolean) ? 'included' : includedValues.every(value => !value) ? 'excluded' : 'mixed';
    const stayTotal = roundMoney(amount + excludedTaxTotal, currency);
    const nightlyTotal = roundMoney(stayTotal / nights, currency);
    const taxPerNight = roundMoney(taxTotal / nights, currency);
    const basePerNight = roundMoney((amount - includedTaxTotal) / nights, currency);
    const currencyMismatch = String(currency).toUpperCase() !== String(requestedCurrency).toUpperCase();
    const maxNightly = Number(process.env.MAX_HOTEL_NIGHTLY_PRICE_USD || 10000);
    const valid = nightlyTotal > 0 && nightlyTotal <= maxNightly && !currencyMismatch;
    rows.push({
      roomTypeId: room.roomTypeId, offerId: room.offerId, rateId: rate.rateId,
      operator: room.supplier || String(room.supplierId || 'LiteAPI'), providerCode: String(room.supplierId || ''),
      boardName: rate.boardName || rate.boardType || null,
      includesBreakfast: /breakfast/i.test(`${rate.boardName || ''} ${rate.boardType || ''}`),
      refundable: rate.cancellationPolicies?.refundableTag === 'RFN',
      amount, perNight: nightlyTotal, stayTotal, taxPerNight, taxTotal, basePerNight,
      currency, requestedCurrency, valid, anomalyReason: currencyMismatch ? 'currency_conversion_unavailable' : valid ? null : 'invalid_or_extreme_nightly_price',
      taxStatus, raw: { ...rate, roomTypeId: room.roomTypeId, offerId: room.offerId, provider_stay_amount: amount, stay_total: stayTotal, base_price_per_night: basePerNight, taxes_per_night: taxPerNight, taxes_total: taxTotal, nights, currency_unit: 'major', requested_currency: requestedCurrency, fx_applied: false, tax_status: taxStatus, tax_included: taxStatus === 'included' },
    });
  }
  return rows.sort((a, b) => a.perNight - b.perNight).slice(0, 5);
}

async function refreshLiteApiRates(hotels, checkIn, checkOut, { currency = 'USD', guests = 2, force = false } = {}) {
  if (!liteapi.configured() || !hotels.length) return;
  const ids = hotels.map(item => item.id);
  const mappings = await db.prepare(`SELECT hotel_id, provider_hotel_id FROM hotel_provider_mappings WHERE provider = 'liteapi' AND hotel_id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  if (!mappings.length) return;
  const staleMappings = [];
  for (const mapping of mappings) {
    const cached = !force && await db.prepare(`SELECT id FROM hotel_rate_checks WHERE hotel_id = ? AND provider = 'liteapi' AND check_in = ? AND check_out = ? AND guests = ? AND currency = ? AND checked_at > CURRENT_TIMESTAMP - INTERVAL '1 hour' LIMIT 1`).get(mapping.hotel_id, checkIn, checkOut, Math.max(1, Number(guests || 2)), currency);
    if (!cached) staleMappings.push(mapping);
  }
  const max = Number(process.env.LITEAPI_RATE_CANDIDATE_LIMIT || 50);
  const selected = staleMappings.slice(0, max);
  if (!selected.length) return;
  const byProviderId = new Map(selected.map(item => [item.provider_hotel_id, item.hotel_id]));
  const nights = nightsBetween(checkIn, checkOut);
  const results = await liteapi.getRates({ hotelIds: [...byProviderId.keys()], checkIn, checkOut, currency, adults: Math.max(1, Number(guests || 2)) });
  const availableIds = new Set(results.filter(result => flattenRates(result, nights, currency).some(rate => rate.valid)).map(result => result.hotelId));
  for (const mapping of selected) {
    await db.prepare(`INSERT INTO hotel_rate_checks (id, hotel_id, provider, check_in, check_out, guests, currency, status, checked_at) VALUES (?, ?, 'liteapi', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT (hotel_id, provider, check_in, check_out, guests, currency) DO UPDATE SET status = EXCLUDED.status, checked_at = CURRENT_TIMESTAMP`)
      .run(uuidv4(), mapping.hotel_id, checkIn, checkOut, Math.max(1, Number(guests || 2)), currency, availableIds.has(mapping.provider_hotel_id) ? 'available' : 'unavailable');
  }
  for (const result of results) {
    const hotelId = byProviderId.get(result.hotelId); if (!hotelId) continue;
    await db.prepare(`DELETE FROM hotel_prices WHERE hotel_id = ? AND source = 'liteapi' AND check_in = ? AND check_out = ?`).run(hotelId, checkIn, checkOut);
    const rates = flattenRates(result, nights, currency);
    const validPrices = rates.filter(rate => rate.valid).map(rate => rate.perNight).sort((a, b) => a - b);
    const median = validPrices.length ? validPrices[Math.floor(validPrices.length / 2)] : null;
    for (const rate of rates) {
      const marketOutlier = median && (rate.perNight < median / 8 || rate.perNight > median * 8);
      const valid = rate.valid && !marketOutlier;
      const anomalyReason = marketOutlier ? 'provider_market_outlier' : rate.anomalyReason;
      await db.prepare(`INSERT INTO hotel_prices (id, hotel_id, operator, price_per_night, total_price, check_in, check_out, includes_breakfast, cancellation_policy, currency, tax, provider_code, source, raw_json, updated_at, offer_id, room_type_id, rate_id, board_name, refundable, currency_unit, requested_currency, price_valid, anomaly_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'liteapi', ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, 'major', ?, ?, ?)`)
        .run(uuidv4(), hotelId, rate.operator, rate.perNight, rate.stayTotal, checkIn, checkOut, rate.includesBreakfast ? 1 : 0, rate.refundable ? 'free_cancellation' : 'non_refundable', rate.currency, rate.taxTotal, rate.providerCode, JSON.stringify(rate.raw), rate.offerId, rate.roomTypeId, rate.rateId, rate.boardName, rate.refundable ? 1 : 0, rate.requestedCurrency, valid ? 1 : 0, anomalyReason);
    }
  }
}

module.exports = { refreshLiteApiRates, flattenRates, nightsBetween };
