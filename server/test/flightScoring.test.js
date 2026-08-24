const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreFlights, priceValueScore, durationScore, seatingScore, connectionScore } = require('../services/flightScoring');

const ticket = (overrides = {}) => ({
  price: 500,
  transfers: 0,
  duration_to: 300,
  departure_at: '2030-05-10T10:00:00+00:00',
  airline: 'EK',
  link: 'https://example.test/fare',
  expires_at: '2030-05-01T00:00:00Z',
  fare_type: 'indicative',
  fare_observed_at: new Date().toISOString(),
  fare_cache_status: 'provider_cached',
  ...overrides,
});

test('price value uses a market median instead of the maximum result', () => {
  assert.ok(priceValueScore(400, 500) > priceValueScore(700, 500));
  assert.equal(priceValueScore(500, 500), 82);
});

test('duration is relative to the route baseline', () => {
  assert.equal(durationScore(300, 300), 100);
  assert.ok(durationScore(600, 300) < 60);
});

test('unknown fields do not lower the base score but lower reliability', () => {
  const complete = scoreFlights([ticket({ cabin_class: 'economy', taxes_included: true, baggage_included: true, refundable: true, price_for_passengers: true })], {}, { passengers: 1, cabinClass: 'economy' })[0];
  const incomplete = scoreFlights([ticket({ duration_to: null, transfers: null })], {}, { passengers: 1, cabinClass: 'economy' })[0];
  assert.ok(incomplete.score_reliability < complete.score_reliability);
  assert.ok(incomplete.unknown_score_data.includes('duration'));
  assert.ok(incomplete.unknown_score_data.includes('stops'));
});

test('strict stop and confirmed cabin preferences reject mismatches', () => {
  const result = scoreFlights([ticket({ transfers: 2, cabin_class: 'economy' })], { max_stops: 1 }, { cabinClass: 'business' })[0];
  assert.deepEqual(result.strict_filter_failures.sort(), ['cabin_class', 'max_stops']);
});

test('an explicit any-stops search overrides a saved direct-flight preference', () => {
  const [result] = scoreFlights([ticket({
    transfers: 1,
    cabin_class: 'business',
  })], {
    flight_type: 'direct',
    max_stops: 0,
    seat_class: 'business',
  }, {
    passengers: 2,
    cabinClass: 'business',
    maxStops: 'any',
  });

  assert.deepEqual(result.strict_filter_failures, []);
  assert.equal(result.score_context.max_stops, null);
});

test('profile constraints can be relaxed without relaxing explicit search constraints', () => {
  const preferences = { flight_type: 'direct', max_stops: 0, seat_class: 'premium_economy' };
  const economyConnection = ticket({ transfers: 1, cabin_class: 'economy' });
  const strictProfile = scoreFlights([economyConnection], preferences, {})[0];
  assert.deepEqual(strictProfile.strict_filter_failures.sort(), ['cabin_class', 'max_stops']);

  const relaxedProfile = scoreFlights([economyConnection], preferences, { relaxProfileConstraints: true })[0];
  assert.deepEqual(relaxedProfile.strict_filter_failures, []);
  assert.equal(relaxedProfile.score_context.profile_constraints_relaxed, true);

  const explicitDirect = scoreFlights([economyConnection], preferences, {
    maxStops: 0,
    relaxProfileConstraints: true,
  })[0];
  assert.deepEqual(explicitDirect.strict_filter_failures, ['max_stops']);
});

test('pair seating prefers a two-seat block and does not invent missing layouts', () => {
  assert.equal(seatingScore({ seat_layout: '2-4-2' }, 2), 100);
  assert.equal(seatingScore({ seat_layout: '3-3' }, 2), 72);
  assert.equal(seatingScore({}, 2), null);
});

test('party size changes the score when a confirmed seat layout is available', () => {
  const pairFriendly = scoreFlights([ticket({ seat_layout: '2-4-2' })], {}, { passengers: 2 })[0];
  const tripleBlocks = scoreFlights([ticket({ seat_layout: '3-3' })], {}, { passengers: 2 })[0];
  assert.ok(pairFriendly.fairworth_score > tripleBlocks.fairworth_score);
  assert.equal(pairFriendly.price_details.total_for_party, 1000);
});

test('connection quality penalizes overnight and excessively long layovers', () => {
  const comfortable = connectionScore({ transfers: 1, layovers: [{ duration_minutes: 105 }] });
  const difficult = connectionScore({ transfers: 1, layovers: [{ duration_minutes: 480, overnight: true }] });
  assert.ok(comfortable > difficult);
});

test('indicative fares expose conservative confidence and never claim availability', () => {
  const result = scoreFlights([ticket({ cabin_class: 'economy', taxes_included: true, baggage_included: true, refundable: true })], {}, { passengers: 1 })[0];
  assert.ok(result.fare_confidence < 80);
  assert.equal(result.price_details.fare_type, 'indicative');
  assert.equal(result.price_details.availability_confirmed, false);
  assert.equal(result.price_details.seat_availability_confirmed, false);
  assert.equal(result.price_details.requires_provider_verification, true);
  assert.ok(result.unknown_score_data.includes('confirmed_availability'));
});

test('current metasearch fares preserve party total without claiming availability', () => {
  const result = scoreFlights([ticket({
    source: 'searchapi', fare_type: 'current_metasearch_fare', fare_cache_status: 'current_metasearch', total_price: 900,
    price: 450, price_for_passengers: true, availability_confirmed: false, seat_availability_confirmed: false,
    booking_token_available: true,
    cabin_class: 'economy', taxes_included: true, baggage_included: true,
  })], {}, { passengers: 2, cabinClass: 'economy' })[0];
  assert.ok(result.fare_confidence >= 55);
  assert.equal(result.price_details.total_for_party, 900);
  assert.equal(result.price_details.availability_confirmed, false);
  assert.equal(result.price_details.seat_availability_confirmed, false);
  assert.equal(result.unknown_score_data.includes('confirmed_availability'), true);
});

test('live offer with too few bookable seats fails party availability', () => {
  const result = scoreFlights([ticket({
    source: 'confirmed-provider', fare_type: 'live_offer', seats_left: 1, availability_confirmed: true,
    seat_availability_confirmed: false, cabin_class: 'economy', taxes_included: true,
  })], {}, { passengers: 2, cabinClass: 'economy' })[0];
  assert.ok(result.strict_filter_failures.includes('party_availability'));
  assert.equal(result.top_pick_eligible, false);
});
