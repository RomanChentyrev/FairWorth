const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreFlights, priceValueScore, durationScore, seatingScore } = require('../services/flightScoring');

const ticket = (overrides = {}) => ({
  price: 500,
  transfers: 0,
  duration_to: 300,
  departure_at: '2030-05-10T10:00:00+00:00',
  airline: 'EK',
  link: 'https://example.test/fare',
  expires_at: '2030-05-01T00:00:00Z',
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
