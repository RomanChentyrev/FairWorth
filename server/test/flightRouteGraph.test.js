const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRouteGraph, routeFallbackTickets, hasDirectEdge, possibleAirports } = require('../services/flightRouteGraph');

test('city codes expand to airports for direct edge checks', () => {
  assert.deepEqual(new Set(possibleAirports('MOW')), new Set(['SVO', 'DME', 'VKO', 'ZIA']));
  assert.deepEqual(new Set(possibleAirports('JKT')), new Set(['CGK', 'HLP']));
  assert.equal(hasDirectEdge('MOW', 'DXB'), true);
});

test('route graph returns estimated connections without claiming schedule confirmation', () => {
  const graph = buildRouteGraph({ origin: 'SVO', destination: 'KUL', limit: 4 });
  assert.equal(graph.status, 'estimated');
  assert.ok(graph.options.length > 0);
  assert.ok(graph.options.some(option => option.airports.includes('DXB') || option.airports.includes('DOH') || option.airports.includes('IST')));
  assert.equal(graph.options[0].schedule_confirmed, false);
  assert.equal(graph.options[0].provider_verification_required, true);
});

test('route graph can return informational two-stop options', () => {
  const graph = buildRouteGraph({ origin: 'JKT', destination: 'PAR', maxStops: 2, limit: 5 });
  assert.ok(graph.options.some(option => option.stops === 2));
  assert.ok(graph.options.every(option => option.schedule_confirmed === false));
});

test('route-only fallback tickets are not fare offers', () => {
  const graph = buildRouteGraph({ origin: 'SVO', destination: 'KUL', limit: 2 });
  const tickets = routeFallbackTickets(graph, { departDate: '2030-05-10' });
  assert.equal(tickets.length, 2);
  assert.equal(tickets[0].fare_type, 'route_only');
  assert.equal(tickets[0].price, null);
  assert.equal(tickets[0].availability_confirmed, false);
  assert.equal(tickets[0].route_graph_option.provider_verification_required, true);
});
