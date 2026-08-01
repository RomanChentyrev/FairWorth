const test = require('node:test');
const assert = require('node:assert/strict');
const { canonicalHotelCity } = require('../utils/cities');

test('canonicalHotelCity maps localized catalog names to provider names', () => {
  assert.equal(canonicalHotelCity('Париж'), 'Paris');
  assert.equal(canonicalHotelCity('Москва (MOW)'), 'Moscow');
});

test('canonicalHotelCity preserves worldwide provider names', () => {
  assert.equal(canonicalHotelCity('Jakarta'), 'Jakarta');
  assert.equal(canonicalHotelCity('Paris'), 'Paris');
});
