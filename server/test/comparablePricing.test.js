const test = require('node:test');
const assert = require('node:assert/strict');
const { selectComparableRate, marketBenchmark, benchmarkPriceScore } = require('../services/comparablePricing');

function rate(overrides = {}) {
  return {
    id: Math.random().toString(16),
    hotel_id: 'target',
    price_per_night: 100,
    total_price: 400,
    check_in: '2026-08-01',
    check_out: '2026-08-05',
    currency: 'USD',
    source: 'liteapi',
    price_valid: 1,
    guests: 2,
    updated_at: new Date().toISOString(),
    raw_json: JSON.stringify({ nights: 4, tax_included: true, room_name: 'Deluxe room' }),
    ...overrides,
  };
}

test('comparable rate accounts for guests, refundability, breakfast and tax certainty', () => {
  const cheapestRestricted = rate({ price_per_night: 100, total_price: 400, refundable: 0, includes_breakfast: 0, raw_json: JSON.stringify({ nights: 4, room_name: 'Deluxe room' }) });
  const completeRate = rate({ id: 'complete', price_per_night: 110, total_price: 440, refundable: 1, cancellation_policy: 'free_cancellation', includes_breakfast: 1 });
  const insufficientOccupancy = rate({ id: 'small', price_per_night: 60, total_price: 240, guests: 1 });
  const selected = selectComparableRate([cheapestRestricted, completeRate, insufficientOccupancy], { guests: 2, preferredRoomTypes: ['deluxe'], breakfastPreferred: true });
  assert.equal(selected.id, 'complete');
  assert.equal(selected.payable_nightly_price, 110);
  assert.deepEqual(selected.comparison_adjustments, []);
});

test('market benchmark uses a comparable segment and percentile price score', () => {
  const target = { hotel_id: 'target', city: 'Paris', location: 'Center', stars: 5, room_category: 'deluxe', currency: 'USD' };
  const offers = [100, 200, 300, 400].map((price, index) => ({
    hotel_id: `peer-${index}`, city: 'Paris', location: 'Center', stars: 5,
    room_category: 'deluxe', comparable_nightly_price: price, currency: 'USD',
  }));
  const benchmark = marketBenchmark(target, offers);
  assert.equal(benchmark.segment, 'city_stars_district_room');
  assert.equal(benchmark.sample_size, 4);
  assert.equal(benchmarkPriceScore(benchmark.median, benchmark), 75);
  assert.equal(benchmarkPriceScore(benchmark.p25, benchmark), 100);
});
