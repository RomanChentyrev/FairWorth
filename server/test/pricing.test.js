const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePrice, roundMoney, majorUnits } = require('../services/pricing');

test('normalises excluded taxes and separates nightly from stay totals', () => {
  const result = normalizePrice({ price_per_night: 120, total_price: 480, tax: 80, check_in: '2026-08-01', check_out: '2026-08-05', raw_json: JSON.stringify({ base_price_per_night: 100, taxes_per_night: 20, nights: 4, tax_included: false }), source: 'xotelo', currency: 'USD', updated_at: new Date().toISOString() });
  assert.equal(result.tax_status, 'not_included');
  assert.equal(result.normalized_total_price, 120);
  assert.equal(result.base_price, 100);
  assert.equal(result.taxes_and_fees_per_night, 20);
  assert.equal(result.stay_total_price, 480);
  assert.equal(result.is_stale, false);
});

test('marks unknown tax and stale demonstration prices', () => {
  const result = normalizePrice({ price_per_night: 100, source: 'demo', updated_at: '2020-01-01T00:00:00Z' });
  assert.equal(result.tax_status, 'unknown');
  assert.equal(result.is_demonstration, true);
  assert.ok(result.price_warnings.includes('stale_price'));
  assert.ok(result.price_warnings.includes('demonstration_price'));
});

test('money uses major units and never exceeds two decimals', () => {
  assert.equal(majorUnits(12345, 'USD', 'minor'), 123.45);
  assert.equal(majorUnits(12345, 'JPY', 'minor'), 12345);
  assert.equal(roundMoney(210.267142857, 'USD'), 210.27);
});

test('rejects unconverted currencies and extreme nightly outliers', () => {
  const mismatch = normalizePrice({ price_per_night: 100, total_price: 400, currency: 'EUR', requested_currency: 'USD', price_valid: 1, updated_at: new Date().toISOString() });
  assert.equal(mismatch.is_displayable, false);
  assert.ok(mismatch.price_warnings.includes('currency_conversion_unavailable'));
  const outlier = normalizePrice({ price_per_night: 15000, total_price: 15000, currency: 'USD', price_valid: 1, updated_at: new Date().toISOString() });
  assert.equal(outlier.is_displayable, false);
});
