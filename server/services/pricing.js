const DEMO_SOURCES = new Set(['demo', 'synthetic', 'mock', 'local']);
const ZERO_DECIMAL_CURRENCIES = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);

function currencyDecimals(currency) { return ZERO_DECIMAL_CURRENCIES.has(String(currency || '').toUpperCase()) ? 0 : 2; }
function roundMoney(value, currency = 'USD') {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const factor = 10 ** Math.min(2, currencyDecimals(currency));
  return Math.round((number + Number.EPSILON) * factor) / factor;
}
function majorUnits(value, currency = 'USD', unit = 'major') {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const major = unit === 'minor' ? number / (10 ** currencyDecimals(currency)) : number;
  return roundMoney(major, currency);
}

function parseRaw(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

function normalizePrice(price, ttlHours = 12) {
  if (!price) return null;
  const raw = parseRaw(price.raw_json);
  const currency = price.currency || 'USD';
  const nightlyTotal = roundMoney(price.price_per_night, currency) || 0;
  const stayTotal = roundMoney(price.total_price, currency) || nightlyTotal;
  const dateNights = price.check_in && price.check_out ? Math.round((new Date(`${price.check_out}T00:00:00Z`) - new Date(`${price.check_in}T00:00:00Z`)) / 86400000) : 1;
  const rawNights = Math.max(1, Number(raw.nights || dateNights || 1));
  const stayTax = price.tax == null || price.tax === '' ? null : roundMoney(price.tax, currency);
  const nightlyTax = roundMoney(raw.taxes_per_night ?? (stayTax == null ? null : stayTax / rawNights), currency);
  const declaredIncluded = raw.tax_included ?? raw.taxes_included ?? raw.includes_taxes;
  let taxStatus = 'unknown';
  if (declaredIncluded === true) taxStatus = 'included';
  else if (declaredIncluded === false || raw.tax_status === 'excluded') taxStatus = 'not_included';
  const basePrice = roundMoney(raw.base_price_per_night ?? (taxStatus === 'included' ? nightlyTotal - Number(nightlyTax || 0) : nightlyTotal - Number(nightlyTax || 0)), currency);
  const updatedAt = price.updated_at ? new Date(price.updated_at) : null;
  const ageHours = updatedAt && !Number.isNaN(updatedAt.getTime()) ? (Date.now() - updatedAt.getTime()) / 3_600_000 : null;
  const stale = ageHours == null || ageHours > ttlHours;
  const demo = DEMO_SOURCES.has(String(price.source || '').toLowerCase());
  const warnings = [];
  if (demo) warnings.push('demonstration_price');
  if (stale) warnings.push('stale_price');
  if (taxStatus === 'unknown') warnings.push('tax_status_unknown');
  const configuredMax = Number(process.env.MAX_HOTEL_NIGHTLY_PRICE_USD || 10000);
  const currencyMismatch = price.requested_currency && String(price.requested_currency).toUpperCase() !== String(currency).toUpperCase() && !price.fx_rate;
  const valid = price.price_valid !== 0 && nightlyTotal > 0 && nightlyTotal <= configuredMax && !currencyMismatch;
  if (!valid) warnings.push(currencyMismatch ? 'currency_conversion_unavailable' : (price.anomaly_reason || 'invalid_or_extreme_price'));
  return {
    ...price,
    currency,
    currency_unit: 'major',
    base_price: basePrice,
    price_per_night: nightlyTotal,
    nightly_total_price: nightlyTotal,
    taxes_and_fees: nightlyTax,
    taxes_and_fees_per_night: nightlyTax,
    taxes_and_fees_total: stayTax,
    normalized_total_price: nightlyTotal,
    stay_total_price: stayTotal,
    tax_status: taxStatus,
    taxes_included: taxStatus === 'included' ? true : taxStatus === 'not_included' ? false : null,
    is_stale: stale,
    is_demonstration: demo,
    price_age_hours: ageHours == null ? null : Math.max(0, Math.round(ageHours * 10) / 10),
    price_warnings: warnings,
    is_displayable: valid,
  };
}

module.exports = { normalizePrice, roundMoney, majorUnits, currencyDecimals };
