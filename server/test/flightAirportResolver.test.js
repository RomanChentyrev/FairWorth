const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveAirportGroup } = require('../services/flightAirportResolver');

test('airport resolver expands Jakarta and Paris metro codes into flightable airports', () => {
  const jakarta = resolveAirportGroup('JKT');
  const paris = resolveAirportGroup('PAR');
  assert.deepEqual(new Set(jakarta.airports.map(airport => airport.code)), new Set(['CGK', 'HLP']));
  assert.ok(paris.airports.some(airport => airport.code === 'CDG'));
  assert.ok(paris.airports.some(airport => airport.code === 'ORY'));
  assert.equal(paris.airports.some(airport => airport.code === 'LBG'), false);
});

test('airport resolver preserves an exact airport code', () => {
  const airport = resolveAirportGroup('CGK');
  assert.deepEqual(airport.airports.map(item => item.code), ['CGK']);
  assert.equal(airport.expanded, false);
});
