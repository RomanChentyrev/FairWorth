const test = require('node:test');
const assert = require('node:assert/strict');
const { fuzzyPlaceScore } = require('../services/travelpayouts');

test('airport autocomplete tolerates a small city spelling mistake', () => {
  assert.ok(fuzzyPlaceScore('Nha Thang', ['Nha Trang']) >= 0.78);
  assert.ok(fuzzyPlaceScore('Nha Thang', ['New York']) < 0.78);
});
