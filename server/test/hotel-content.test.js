const test = require('node:test');
const assert = require('node:assert/strict');
const { flattenRates, nightsBetween } = require('../services/hotelRates');
const { normalizedAmenity, hotelIdentityKey, similarity, matchConfidence } = require('../services/hotelCatalog');
const { amenityMatches } = require('../config/hotelAmenities');

test('LiteAPI stay total is normalized to a nightly price with explicit tax status', () => {
  const rates = flattenRates({ roomTypes: [{ roomTypeId: 'room', offerId: 'offer', supplier: 'Provider', rates: [{ rateId: 'rate', boardName: 'Breakfast included', retailRate: { total: [{ amount: 800, currency: 'USD' }], taxesAndFees: [{ amount: 80, currency: 'USD', included: true }] }, cancellationPolicies: { refundableTag: 'RFN' } }] }] }, 4);
  assert.equal(rates[0].perNight, 200);
  assert.equal(rates[0].stayTotal, 800);
  assert.equal(rates[0].taxPerNight, 20);
  assert.equal(rates[0].basePerNight, 180);
  assert.equal(rates[0].taxStatus, 'included');
  assert.equal(rates[0].includesBreakfast, true);
  assert.equal(rates[0].refundable, true);
});

test('LiteAPI excluded taxes are added to the payable stay and nightly totals', () => {
  const rates = flattenRates({ roomTypes: [{ roomTypeId: 'room', rates: [{ rateId: 'rate', retailRate: { total: [{ amount: 800, currency: 'USD' }], taxesAndFees: [{ amount: 80, currency: 'USD', included: false }] } }] }] }, 4, 'USD');
  assert.equal(rates[0].stayTotal, 880);
  assert.equal(rates[0].perNight, 220);
  assert.equal(rates[0].taxTotal, 80);
  assert.equal(rates[0].taxStatus, 'excluded');
});

test('catalog matching favors equal names and nearby coordinates', () => {
  const source = { name: 'The Grand Hotel Singapore', city: 'Singapore', address: '1 Bay Street', latitude: 1.29, longitude: 103.85 };
  const same = { name: 'Grand Hotel Singapore', city: 'Singapore', address: '1 Bay Street', latitude: 1.2901, longitude: 103.8501 };
  const other = { name: 'Airport Lodge', city: 'Singapore', address: 'Airport Road', latitude: 1.36, longitude: 103.99 };
  assert.ok(matchConfidence(source, same) >= 0.92);
  assert.ok(matchConfidence(source, same) > matchConfidence(source, other));
  assert.ok(similarity(source.name, same.name) > 0.7);
});

test('catalog identity is stable across accents, punctuation, and small coordinate formatting differences', () => {
  const first = hotelIdentityKey({ name: 'Hôtel de Paris!', city: 'París', country: 'FR', latitude: 48.85661, longitude: 2.35221 });
  const second = hotelIdentityKey({ name: 'Hotel de Paris', city: 'Paris', country: 'fr', latitude: 48.856609, longitude: 2.352209 });
  assert.equal(first, second);
  assert.equal(hotelIdentityKey({ name: '', city: 'Paris' }), null);
});

test('amenities and date ranges are normalized', () => {
  assert.equal(normalizedAmenity('High speed WiFi Internet'), 'wifi');
  assert.equal(normalizedAmenity('Swimming Pool'), 'pool');
  assert.equal(normalizedAmenity('Outdoor tennis court'), 'tennis');
  assert.equal(normalizedAmenity('Private bathroom with bath tub'), 'bathtub');
  assert.equal(normalizedAmenity('Facilities for disabled guests'), 'accessible');
  assert.equal(normalizedAmenity('Spacious room'), 'spacious_room');
  assert.equal(normalizedAmenity('Beach towels'), 'beach_towels');
  assert.equal(amenityMatches(['Beach towels', 'Beach umbrellas'], 'beach'), false);
  assert.equal(amenityMatches(['Private beach'], 'beach'), true);
  assert.equal(nightsBetween('2026-07-30', '2026-08-03'), 4);
});
