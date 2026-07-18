const test = require('node:test');
const assert = require('node:assert/strict');
const { markIndicativeFares } = require('../services/travelpayouts');

test('Travelpayouts prices are marked as indicative and never confirm seats', () => {
  const receivedAt = '2026-07-16T05:00:00.000Z';
  const [fare] = markIndicativeFares([{ price: 420, found_at: '2026-07-16T04:30:00Z' }], 'provider_cached', receivedAt);

  assert.equal(fare.fare_type, 'indicative');
  assert.equal(fare.fare_observed_at, '2026-07-16T04:30:00.000Z');
  assert.equal(fare.fare_received_at, receivedAt);
  assert.equal(fare.fare_cache_status, 'provider_cached');
  assert.equal(fare.availability_confirmed, false);
  assert.equal(fare.seat_availability_confirmed, false);
  assert.equal(fare.requires_provider_verification, true);
});

test('local cache keeps the original observation time', () => {
  const [fare] = markIndicativeFares([{
    price: 420,
    fare_observed_at: '2026-07-16T04:30:00.000Z',
    fare_received_at: '2026-07-16T05:00:00.000Z',
  }], 'local_cache', '2026-07-16T06:00:00.000Z');

  assert.equal(fare.fare_observed_at, '2026-07-16T04:30:00.000Z');
  assert.equal(fare.fare_received_at, '2026-07-16T05:00:00.000Z');
  assert.equal(fare.fare_cache_status, 'local_cache');
});
