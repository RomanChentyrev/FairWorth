const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateHotelScore, DEFAULT_SCORE_WEIGHTS, DEFAULT_PREFERENCE_WEIGHTS, tripContextSegments, roomTypeSimilarity, roomViewSimilarity } = require('../services/personalization');

const weights = { score: DEFAULT_SCORE_WEIGHTS, declared: DEFAULT_PREFERENCE_WEIGHTS, learned: DEFAULT_PREFERENCE_WEIGHTS, confidence: 0, interactionCount: 0 };
const context = { language: 'en', prices: [200, 400, 800], roomsByHotel: { good: [{ name: 'Deluxe', view_type: 'sea', amenities: '["Private bath tub"]' }], bad: [{ name: 'Standard', view_type: 'city', amenities: '[]' }] }, priceMetadataByHotel: {} };
const preferences = { hotel_stars: '[5]', hotel_amenities: '["pool","spa"]', room_type: '["deluxe"]', room_view: '["sea"]', budget_per_night_max: 500 };

test('trip context is segmented by purpose, duration, destination, season and party size', () => {
  assert.deepEqual(tripContextSegments({
    trip_purpose: 'business', check_in: '2030-07-10', check_out: '2030-07-12', destination: 'New York', guests: 1,
  }, {}), [
    { type: 'purpose', value: 'business' },
    { type: 'duration', value: 'short' },
    { type: 'destination', value: 'new_york' },
    { type: 'season', value: 'summer' },
    { type: 'guests', value: 'solo' },
  ]);
  assert.equal(tripContextSegments({}, { travel_style: '["family"]' })[0].value, 'family');
});

test('room type and view matching use hierarchy and partial similarity', () => {
  assert.equal(roomTypeSimilarity('suite', 'Junior Suite with balcony'), 80);
  assert.equal(roomTypeSimilarity('deluxe', 'Deluxe King Room'), 100);
  assert.equal(roomTypeSimilarity('king', 'Deluxe King Room'), 100);
  assert.equal(roomViewSimilarity('sea', 'Partial sea view'), 75);
  assert.equal(roomViewSimilarity('sea', 'Oceanfront panorama'), 100);

  const result = calculateHotelScore(
    { id: 'partial-room', rating: 4.5, review_count: 200 },
    { hotel_stars: '[]', hotel_amenities: '[]', room_type: '["suite"]', room_view: '["sea"]' },
    weights,
    { ...context, roomsByHotel: { 'partial-room': [{ name: 'Junior Suite', view_type: 'Partial sea view', amenities: '[]' }] } },
  );
  assert.equal(result.preference_parts?.room_type, undefined);
  assert.equal(result.room_preference_match.type.score, 80);
  assert.equal(result.room_preference_match.view.score, 75);
  assert.ok(!result.unknown_preference_data.includes('room_type'));
  assert.ok(!result.unknown_preference_data.includes('room_view'));
});

test('Score rewards preference and budget matches', () => {
  const good = calculateHotelScore({ id: 'good', stars: 5, amenities: '["pool","spa"]', min_price: 300, rating: 4.8, review_count: 2000, cleanliness: 4.8, service: 4.8, location_score: 4.7, value_score: 4.6 }, preferences, weights, context);
  const bad = calculateHotelScore({ id: 'bad', stars: 3, amenities: '["wifi"]', min_price: 800, rating: 4, review_count: 100, cleanliness: 4, service: 4, location_score: 4, value_score: 3.5 }, preferences, weights, context);
  assert.ok(good.fairworth_score > bad.fairworth_score);
  assert.equal(good.personal_fit, 100);
  assert.match(good.score_explanation, /Score \d+\/100/);
  assert.equal(good.score_version, '4.5.0');
  assert.match(good.calculated_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(good.data_completeness.score > 0 && good.data_completeness.score <= 100);
  assert.equal(good.calculation_parameters.market_price_sample_size, 0);
});

test('Score matches aliases and room-level amenities', () => {
  const roomPreferences = { hotel_stars: '[]', hotel_amenities: '["tennis","bathtub"]', room_type: '[]', room_view: '[]', budget_per_night_max: null };
  const matching = calculateHotelScore({ id: 'good', stars: 5, amenities: '["Outdoor tennis court"]', min_price: 300, rating: 4.8, review_count: 2000 }, roomPreferences, weights, context);
  const missing = calculateHotelScore({ id: 'bad', stars: 5, amenities: '["wifi"]', min_price: 300, rating: 4.8, review_count: 2000 }, roomPreferences, weights, context);
  assert.equal(matching.score_breakdown.preferences, 100);
  assert.ok(matching.fairworth_score > missing.fairworth_score);
});

test('unknown provider data is excluded instead of lowering Score', () => {
  const unknownPreferences = { hotel_stars: '[]', hotel_amenities: '["tennis","bathtub"]', room_type: '["suite"]', room_view: '["sea"]', budget_per_night_max: null, noise_sensitivity: 80 };
  const hotel = { id: 'unknown', stars: 5, amenities: '[]' };
  const unknownContext = { ...context, prices: [], roomsByHotel: {} };
  const personalised = calculateHotelScore(hotel, unknownPreferences, weights, unknownContext);
  const baseline = calculateHotelScore(hotel, null, weights, unknownContext);
  assert.equal(personalised.fairworth_score, baseline.fairworth_score);
  assert.equal(personalised.score_breakdown.preferences, null);
  assert.equal(personalised.score_breakdown.trust, null);
  assert.deepEqual(personalised.preference_mismatches, []);
  assert.ok(personalised.unknown_preference_data.includes('amenity:tennis'));
  assert.ok(personalised.unknown_preference_data.includes('amenity:bathtub'));
  assert.ok(personalised.unknown_preference_data.includes('room_type'));
  assert.ok(personalised.unknown_preference_data.includes('room_view'));
  assert.match(personalised.score_explanation, /did not reduce the score/i);
});

test('optional amenities use a weighted partial match when provider data is available', () => {
  const mixedPreferences = { hotel_stars: '[]', hotel_amenities: '["wifi","tennis"]', room_type: '[]', room_view: '[]', budget_per_night_max: null };
  const result = calculateHotelScore({ id: 'mixed', amenities: '["High speed WiFi"]', rating: 4.5, review_count: 100 }, mixedPreferences, weights, { ...context, roomsByHotel: {} });
  assert.ok(result.score_breakdown.preferences > 0 && result.score_breakdown.preferences < 100);
  assert.ok(!result.unknown_preference_data.includes('amenity:tennis'));
  assert.ok(result.preference_mismatches.some(item => item.includes('tennis')));
});

test('luxury preference ranks verified premium quality above a cheap lower-class hotel', () => {
  const luxuryPreferences = { hotel_stars: '[]', hotel_amenities: '[]', room_type: '[]', room_view: '[]', budget_level: 'luxury', budget_per_night_max: 1200 };
  const luxuryContext = { language: 'en', prices: [120, 480], roomsByHotel: {}, priceMetadataByHotel: {} };
  const cheap = calculateHotelScore({ id: 'cheap', stars: 3, amenities: '["wifi"]', min_price: 120, rating: 4.2, review_count: 800, value_score: 4.4 }, luxuryPreferences, weights, luxuryContext);
  const premium = calculateHotelScore({ id: 'premium', stars: 5, amenities: '["spa","pool","restaurant"]', min_price: 480, rating: 4.8, review_count: 1800, value_score: 4.6 }, luxuryPreferences, weights, luxuryContext);
  assert.ok(premium.fairworth_score > cheap.fairworth_score, `${premium.fairworth_score} should exceed ${cheap.fairworth_score}`);
  assert.ok(premium.score_breakdown.preferences > cheap.score_breakdown.preferences);
  assert.ok(cheap.preference_mismatches.some(item => /below.*travel tier/i.test(item)));
  assert.equal(premium.score_version, '4.5.0');
});

test('explicit star preference sharply reduces duplicate star influence inside travel tier', () => {
  const explicitLuxury = { hotel_stars: '[5]', hotel_amenities: '[]', room_type: '[]', room_view: '[]', budget_level: 'luxury' };
  const tierContext = {
    language: 'en', prices: [], priceMetadataByHotel: {},
    roomsByHotel: {
      sparseFive: [{ name: 'Standard room', size_sqm: 20, amenities: '[]' }],
      broadFour: [{ name: 'Executive suite with club access', size_sqm: 52, amenities: '["Club lounge access","Bathtub"]' }],
    },
  };
  const sparseFive = calculateHotelScore({ id: 'sparseFive', stars: 5, chain_name: 'Generic Hotels', amenities: '["wifi"]', rating: 4, cleanliness: 4, service: 4, location_score: 4 }, explicitLuxury, weights, tierContext);
  const broadFour = calculateHotelScore({ id: 'broadFour', stars: 4, chain_name: 'Ritz-Carlton', amenities: '["spa","pool","concierge"]', rating: 4.9, cleanliness: 4.9, service: 4.9, location_score: 4.9 }, explicitLuxury, weights, tierContext);
  assert.equal(broadFour.travel_tier_weights.star_fit, 0.05);
  assert.ok(broadFour.travel_tier_score > sparseFive.travel_tier_score, `${broadFour.travel_tier_score} should exceed ${sparseFive.travel_tier_score}`);
  assert.equal(broadFour.travel_tier_breakdown.brand, 100);
  assert.equal(broadFour.travel_tier_breakdown.room_category, 100);
});

test('luxury experience outranks old nominal stars using reviews, breakfast and renovation evidence', () => {
  const year = new Date().getUTCFullYear();
  const luxuryPreferences = { hotel_stars: '[]', hotel_amenities: '[]', room_type: '[]', room_view: '[]', budget_level: 'luxury' };
  const experienceContext = {
    language: 'en', prices: [], priceMetadataByHotel: {},
    roomsByHotel: {
      oldFive: [{ name: 'Standard room', size_sqm: 24, amenities: '[]' }],
      boutiqueFour: [{ name: 'Executive suite', size_sqm: 48, amenities: '["Club lounge access","Bathtub"]' }],
    },
  };
  const oldFive = calculateHotelScore({
    id: 'oldFive', stars: 5, chain_name: 'Generic Hotels', amenities: '["spa"]', rating: 3.8, cleanliness: 3.6, service: 3.4,
    content_raw_json: JSON.stringify({ renovationYear: year - 18, breakfastScore: 2.5, reviews: ['Dated room, worn furniture, poor service and disappointing breakfast. Needs renovation.'] }),
  }, luxuryPreferences, weights, experienceContext);
  const boutiqueFour = calculateHotelScore({
    id: 'boutiqueFour', stars: 4, amenities: '["spa","concierge","valet","club_lounge","pool"]', rating: 4.9, cleanliness: 4.9, service: 4.9,
    content_raw_json: JSON.stringify({ renovationYear: year - 1, breakfastQuality: 4.8, roomConditionScore: 4.9, reviews: ['Newly renovated with impeccable service, pristine rooms and an excellent breakfast. A luxurious premium experience.'] }),
  }, luxuryPreferences, weights, experienceContext);
  assert.ok(boutiqueFour.travel_tier_score > oldFive.travel_tier_score, `${boutiqueFour.travel_tier_score} should exceed ${oldFive.travel_tier_score}`);
  assert.equal(boutiqueFour.travel_tier_breakdown.renovation_freshness, 100);
  assert.ok(boutiqueFour.travel_tier_breakdown.luxury_review_sentiment > oldFive.travel_tier_breakdown.luxury_review_sentiment);
  assert.ok(boutiqueFour.travel_tier_breakdown.breakfast_quality > oldFive.travel_tier_breakdown.breakfast_quality);
});

test('required amenities are excluded from the optional amenity score', () => {
  const splitPreferences = { hotel_stars: '[]', hotel_amenities: '["pool"]', required_hotel_amenities: '["spa"]', room_type: '[]', room_view: '[]' };
  const result = calculateHotelScore({ id: 'required', amenities: '["spa"]', rating: 4.5, review_count: 100 }, splitPreferences, weights, { ...context, roomsByHotel: {} });
  assert.equal(result.score_breakdown.preferences, 0);
  assert.ok(result.preference_mismatches.some(item => item.includes('pool')));
});

test('reliability lowers ranking score without changing the base FairWorth Score', () => {
  const unknownPreferences = { hotel_stars: '[5]', hotel_amenities: '["spa"]', room_type: '["suite"]', room_view: '["sea"]', budget_level: 'luxury', budget_per_night_max: 900, noise_sensitivity: 80 };
  const sparse = calculateHotelScore({ id: 'sparse', stars: 5, amenities: '[]', rating: 5 }, unknownPreferences, weights, { ...context, prices: [], roomsByHotel: {} });
  assert.ok(sparse.score_reliability < 60);
  assert.equal(sparse.score_reliability_level, 'low');
  assert.ok(sparse.adjusted_score < sparse.fairworth_score);
  assert.equal(sparse.calculation_parameters.ranking_formula, 'fairworth_score * 0.80 + score_reliability * 0.10 + price_confidence * 0.10');
  assert.ok(sparse.unknown_preference_data.includes('amenity:spa'));
});

test('Score remains bounded when features are missing', () => {
  const result = calculateHotelScore({ id: 'missing', stars: 5, amenities: '[]' }, null, weights, { ...context, roomsByHotel: {} });
  assert.ok(result.fairworth_score >= 0 && result.fairworth_score <= 100);
  assert.ok(result.feature_availability.unavailable.includes('noise_level'));
});

test('price score is independent from the current result list', () => {
  const benchmark = { segment: 'city_stars', sample_size: 20, p25: 200, median: 300, p75: 400, currency: 'USD' };
  const hotel = { id: 'stable-price', stars: 5, amenities: '[]', min_price: 300, comparable_price: 300, rating: 4.5, review_count: 500, value_score: 4 };
  const stablePreferences = { hotel_stars: '[]', hotel_amenities: '[]', room_type: '[]', room_view: '[]', budget_level: 'mid' };
  const first = calculateHotelScore(hotel, stablePreferences, weights, { ...context, prices: [100, 300, 900], priceBenchmarkByHotel: { 'stable-price': benchmark } });
  const filtered = calculateHotelScore(hotel, stablePreferences, weights, { ...context, prices: [300], priceBenchmarkByHotel: { 'stable-price': benchmark } });
  assert.equal(first.score_breakdown.value, filtered.score_breakdown.value);
  assert.equal(first.fairworth_score, filtered.fairworth_score);
});

test('fresh complete live prices outrank stale or demonstration prices without changing FairWorth Score', () => {
  const hotel = { id: 'price-trust', stars: 4, amenities: '[]', min_price: 250, comparable_price: 250, rating: 4.6, review_count: 800, value_score: 4.2 };
  const benchmark = { segment: 'city_stars', sample_size: 10, p25: 200, median: 250, p75: 320, currency: 'USD' };
  const basePrice = { source: 'liteapi', currency: 'USD', tax_status: 'included', is_displayable: true, is_stale: false, is_demonstration: false, price_age_hours: 0.5, comparison_adjustments: [] };
  const scoreContext = metadata => ({ ...context, priceBenchmarkByHotel: { 'price-trust': benchmark }, priceMetadataByHotel: { 'price-trust': metadata } });
  const fresh = calculateHotelScore(hotel, null, weights, scoreContext(basePrice));
  const stale = calculateHotelScore(hotel, null, weights, scoreContext({ ...basePrice, is_stale: true, price_age_hours: 20 }));
  const demonstration = calculateHotelScore(hotel, null, weights, scoreContext({ ...basePrice, source: 'demo', is_demonstration: true }));
  assert.equal(fresh.fairworth_score, stale.fairworth_score);
  assert.equal(fresh.fairworth_score, demonstration.fairworth_score);
  assert.equal(fresh.price_confidence, 100);
  assert.equal(stale.price_confidence, 35);
  assert.equal(demonstration.price_confidence, 0);
  assert.equal(fresh.top_pick_eligible, true);
  assert.equal(stale.top_pick_eligible, false);
  assert.equal(demonstration.top_pick_eligible, false);
  assert.ok(fresh.adjusted_score > stale.adjusted_score);
});

test('quality weights change hotel ordering for luxury and business travel styles', () => {
  const qualityContext = { ...context, roomsByHotel: {}, prices: [] };
  const serviceHotel = { id: 'service-first', stars: 5, amenities: '["concierge","valet","club_lounge","spa"]', rating: 4.5, cleanliness: 4.5, service: 5, location_score: 3, review_count: 500 };
  const locationHotel = { id: 'location-first', stars: 4, amenities: '["wifi","soundproofing"]', rating: 4.5, cleanliness: 4.5, service: 3, location_score: 5, review_count: 500 };
  const luxuryPrefs = { hotel_stars: '[]', hotel_amenities: '[]', room_type: '[]', room_view: '[]', travel_style: '[]', budget_level: 'luxury' };
  const businessPrefs = { hotel_stars: '[]', hotel_amenities: '[]', room_type: '[]', room_view: '[]', travel_style: '["business"]', budget_level: 'mid' };
  const luxuryService = calculateHotelScore(serviceHotel, luxuryPrefs, weights, qualityContext);
  const luxuryLocation = calculateHotelScore(locationHotel, luxuryPrefs, weights, qualityContext);
  const businessService = calculateHotelScore(serviceHotel, businessPrefs, weights, qualityContext);
  const businessLocation = calculateHotelScore(locationHotel, businessPrefs, weights, qualityContext);
  assert.ok(luxuryService.score_breakdown.quality > luxuryLocation.score_breakdown.quality);
  assert.ok(businessLocation.score_breakdown.quality > businessService.score_breakdown.quality);
  assert.equal(luxuryService.quality_weights.service, 0.36);
  assert.equal(businessLocation.quality_weights.location, 0.315);
  assert.deepEqual(luxuryService.quality_profiles, ['luxury']);
  assert.deepEqual(businessLocation.quality_profiles, ['business']);
});

test('recent reviews and improving ratings increase quality without penalizing unknown freshness', () => {
  const day = 24 * 60 * 60 * 1000;
  const base = { stars: 5, amenities: '[]', rating: 4.6, cleanliness: 4.6, service: 4.6, location_score: 4.6, review_count: 500 };
  const qualityContext = { ...context, roomsByHotel: {}, prices: [] };
  const fresh = calculateHotelScore({
    ...base, id: 'fresh', latest_review_at: new Date(Date.now() - 30 * day).toISOString(),
    recent_review_share: 0.8, rating_trend: 0.3, renovation_year: new Date().getUTCFullYear() - 1,
  }, null, weights, qualityContext);
  const stale = calculateHotelScore({
    ...base, id: 'stale', latest_review_at: new Date(Date.now() - 5 * 365 * day).toISOString(),
    recent_review_share: 0.05, rating_trend: -0.4, renovation_year: new Date().getUTCFullYear() - 18,
  }, null, weights, qualityContext);
  const unknown = calculateHotelScore({ ...base, id: 'unknown-freshness' }, null, weights, qualityContext);

  assert.ok(fresh.score_breakdown.quality > stale.score_breakdown.quality);
  assert.equal(fresh.rating_trend_direction, 'sharp_improvement');
  assert.equal(stale.rating_trend_direction, 'sharp_decline');
  assert.equal(unknown.quality_breakdown.review_freshness, null);
  assert.ok(unknown.unknown_preference_data.includes('review_freshness:latest_review'));
  assert.equal(unknown.score_breakdown.quality, 92);
});

test('review confidence combines volume, freshness, verified stays and source consistency', () => {
  const day = 24 * 60 * 60 * 1000;
  const trusted = calculateHotelScore({
    id: 'trusted-reviews', rating: 4.6, review_count: 1200,
    latest_review_at: new Date(Date.now() - 20 * day).toISOString(), recent_review_share: 0.85,
    rating_trend: 0.1, review_source_count: 3, review_source_consistency: 0.95,
    verified_review_share: 0.9, suspicious_review_share: 0.01, rating_stddev: 0.7,
  }, null, weights, { ...context, roomsByHotel: {}, prices: [] });
  const weak = calculateHotelScore({
    id: 'weak-reviews', rating: 4.6, review_count: 1200,
    latest_review_at: new Date(Date.now() - 4 * 365 * day).toISOString(), recent_review_share: 0.05,
    rating_trend: -0.4, review_source_count: 2, review_source_consistency: 0.35,
    verified_review_share: 0.2, suspicious_review_share: 0.35, rating_stddev: 1.8,
  }, null, weights, { ...context, roomsByHotel: {}, prices: [] });

  assert.ok(trusted.review_confidence > weak.review_confidence);
  assert.ok(trusted.adjusted_score > weak.adjusted_score);
  assert.equal(trusted.review_confidence_reliability, 100);
  assert.equal(trusted.review_confidence_breakdown.source_consistency, 95);
  assert.equal(trusted.review_source_count, 3);
});

test('missing review structure affects reliability but is not treated as negative evidence', () => {
  const result = calculateHotelScore({ id: 'volume-only', rating: 4.5, review_count: 500 }, null, weights, { ...context, roomsByHotel: {}, prices: [] });
  assert.ok(result.review_confidence > 0);
  assert.equal(result.review_confidence, result.review_confidence_breakdown.review_volume);
  assert.equal(result.review_confidence_breakdown.source_consistency, null);
  assert.equal(result.review_confidence_reliability, 40);
});
