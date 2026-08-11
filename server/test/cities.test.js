const test = require('node:test');
const assert = require('node:assert/strict');
const { canonicalHotelCity } = require('../utils/cities');
const { hotelDestinationCode, hotelDestinationFilter, validHotelDestinationCode } = require('../utils/hotelDestinations');

test('canonicalHotelCity maps localized catalog names to provider names', () => {
  assert.equal(canonicalHotelCity('Париж'), 'Paris');
  assert.equal(canonicalHotelCity('Москва (MOW)'), 'Moscow');
  assert.equal(canonicalHotelCity('Parigi (PAR)'), 'Paris');
  assert.equal(canonicalHotelCity('Mosca'), 'Moscow');
  assert.equal(canonicalHotelCity('巴黎 (PAR)'), 'Paris');
  assert.equal(canonicalHotelCity('吉隆坡'), 'Kuala Lumpur');
  assert.equal(canonicalHotelCity('باريس (PAR)'), 'Paris');
  assert.equal(canonicalHotelCity('كوالالمبور'), 'Kuala Lumpur');
});

test('canonicalHotelCity preserves worldwide provider names', () => {
  assert.equal(canonicalHotelCity('Jakarta'), 'Jakarta');
  assert.equal(canonicalHotelCity('Paris'), 'Paris');
});

test('hotel destinations resolve localized names and reject invalid catalog codes', () => {
  assert.equal(hotelDestinationCode('Parigi (PAR)'), 'PAR');
  assert.equal(hotelDestinationCode('Куала-Лумпур'), 'KUL');
  assert.equal(hotelDestinationCode('吉隆坡'), 'KUL');
  assert.equal(hotelDestinationCode('كوالالمبور'), 'KUL');
  assert.equal(hotelDestinationCode('New York'), 'NYC');
  assert.equal(validHotelDestinationCode('PHT'), null);
  assert.equal(hotelDestinationCode('PHT'), null);
});

test('hotel destination filter combines text fields with provider IATA mappings', () => {
  const filter = hotelDestinationFilter('h', 'Kuala Lumpur', 'KUL');
  assert.match(filter.sql, /hotel_provider_mappings/);
  assert.deepEqual(filter.params, ['%kuala lumpur%', '%kuala lumpur%', '%kuala lumpur%', 'KUL']);
});
