const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateHotelScore, DEFAULT_SCORE_WEIGHTS, DEFAULT_PREFERENCE_WEIGHTS } = require('../services/personalization');

const weights = { score: DEFAULT_SCORE_WEIGHTS, declared: DEFAULT_PREFERENCE_WEIGHTS, learned: DEFAULT_PREFERENCE_WEIGHTS, confidence: 0, interactionCount: 0 };
const context = { language: 'en', prices: [200, 400, 800], roomsByHotel: { good: [{ name: 'Deluxe', view_type: 'sea' }], bad: [{ name: 'Standard', view_type: 'city' }] }, priceMetadataByHotel: {} };
const preferences = { hotel_stars: '[5]', hotel_amenities: '["pool","spa"]', room_type: '["deluxe"]', room_view: '["sea"]', budget_per_night_max: 500 };

test('Score rewards preference and budget matches', () => {
  const good = calculateHotelScore({ id: 'good', stars: 5, amenities: '["pool","spa"]', min_price: 300, rating: 4.8, review_count: 2000, cleanliness: 4.8, service: 4.8, location_score: 4.7, value_score: 4.6 }, preferences, weights, context);
  const bad = calculateHotelScore({ id: 'bad', stars: 3, amenities: '["wifi"]', min_price: 800, rating: 4, review_count: 100, cleanliness: 4, service: 4, location_score: 4, value_score: 3.5 }, preferences, weights, context);
  assert.ok(good.fairworth_score > bad.fairworth_score);
  assert.equal(good.personal_fit, 100);
  assert.match(good.score_explanation, /Score \d+\/100/);
  assert.equal(good.score_version, '3.0.0');
  assert.match(good.calculated_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(good.data_completeness.score > 0 && good.data_completeness.score <= 100);
  assert.equal(good.calculation_parameters.market_price_sample_size, 3);
});

test('Score remains bounded when features are missing', () => {
  const result = calculateHotelScore({ id: 'missing', stars: 5, amenities: '[]' }, null, weights, { ...context, roomsByHotel: {} });
  assert.ok(result.fairworth_score >= 0 && result.fairworth_score <= 100);
  assert.ok(result.feature_availability.unavailable.includes('noise_level'));
});
