const DEFAULT_HUBS = [
  { code: 'IST', name: 'Istanbul', airline: 'Turkish Airlines', region: 'europe_middle_east', score: 96 },
  { code: 'DXB', name: 'Dubai', airline: 'Emirates', region: 'middle_east', score: 94 },
  { code: 'DOH', name: 'Doha', airline: 'Qatar Airways', region: 'middle_east', score: 93 },
  { code: 'AUH', name: 'Abu Dhabi', airline: 'Etihad Airways', region: 'middle_east', score: 88 },
  { code: 'PEK', name: 'Beijing', airline: 'Air China', region: 'east_asia', score: 84 },
  { code: 'PVG', name: 'Shanghai', airline: 'China Eastern', region: 'east_asia', score: 83 },
  { code: 'SIN', name: 'Singapore', airline: 'Singapore Airlines', region: 'southeast_asia', score: 82 },
  { code: 'BKK', name: 'Bangkok', airline: 'Thai Airways', region: 'southeast_asia', score: 79 },
  { code: 'KUL', name: 'Kuala Lumpur', airline: 'Malaysia Airlines', region: 'southeast_asia', score: 77 },
  { code: 'CDG', name: 'Paris', airline: 'Air France', region: 'europe', score: 76 },
  { code: 'FRA', name: 'Frankfurt', airline: 'Lufthansa', region: 'europe', score: 75 },
  { code: 'LHR', name: 'London', airline: 'British Airways', region: 'europe', score: 74 },
  { code: 'JFK', name: 'New York', airline: 'Multiple airlines', region: 'north_america', score: 72 },
];

const { airportCodes } = require('./flightAirportResolver');

const DIRECT_PAIRS = new Set([
  'SVO:IST', 'SVO:DXB', 'SVO:DOH', 'SVO:AUH', 'SVO:PEK', 'SVO:PVG', 'SVO:CDG',
  'DME:IST', 'VKO:IST', 'DXB:SIN', 'DXB:KUL', 'DXB:DAD', 'DXB:CDG', 'DXB:JFK',
  'DOH:SIN', 'DOH:KUL', 'DOH:DAD', 'DOH:CDG', 'DOH:JFK', 'IST:CDG', 'IST:JFK',
  'IST:SIN', 'IST:KUL', 'PEK:SHA', 'PEK:SIN', 'PVG:SIN', 'SIN:KUL', 'SIN:DAD',
  'SIN:CXR', 'KUL:DAD', 'KUL:CXR', 'CDG:JFK', 'LHR:JFK', 'FRA:JFK',
]);

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

function possibleAirports(code) {
  return airportCodes(normalizeCode(code));
}

function routeKey(left, right) {
  return `${normalizeCode(left)}:${normalizeCode(right)}`;
}

function hasDirectEdge(left, right) {
  const origins = possibleAirports(left);
  const destinations = possibleAirports(right);
  return origins.some(origin => destinations.some(destination => (
    origin === destination
      || DIRECT_PAIRS.has(routeKey(origin, destination))
      || DIRECT_PAIRS.has(routeKey(destination, origin))
  )));
}

function airportLabel(code) {
  const hub = DEFAULT_HUBS.find(item => item.code === code);
  return hub?.name || code;
}

function optionConfidence(stops, hubScore = 70, directEdgeCount = 0) {
  const base = stops === 0 ? 76 : stops === 1 ? 62 : 48;
  return Math.max(35, Math.min(82, Math.round(base + (hubScore - 75) * 0.25 + directEdgeCount * 4)));
}

function directOption(origin, destination) {
  const direct = hasDirectEdge(origin, destination);
  if (!direct) return null;
  return {
    type: 'direct',
    stops: 0,
    airports: [normalizeCode(origin), normalizeCode(destination)],
    label: `${normalizeCode(origin)} → ${normalizeCode(destination)}`,
    suggested_airlines: [],
    route_confidence: optionConfidence(0, 80, 2),
    schedule_confirmed: false,
    fare_available: false,
    provider_verification_required: true,
  };
}

function connectionOption(origin, destination, hub) {
  const firstLeg = hasDirectEdge(origin, hub.code);
  const secondLeg = hasDirectEdge(hub.code, destination);
  const directEdgeCount = Number(firstLeg) + Number(secondLeg);
  return {
    type: 'connection',
    stops: 1,
    airports: [normalizeCode(origin), hub.code, normalizeCode(destination)],
    connection_airports: [{ code: hub.code, name: hub.name }],
    label: `${normalizeCode(origin)} → ${hub.code} → ${normalizeCode(destination)}`,
    suggested_airlines: [hub.airline],
    route_confidence: optionConfidence(1, hub.score, directEdgeCount),
    schedule_confirmed: false,
    fare_available: false,
    provider_verification_required: true,
    missing_live_fare_reason: 'No confirmed fare was returned for the selected date.',
  };
}

function twoConnectionOption(origin, destination, firstHub, secondHub) {
  const directEdgeCount = Number(hasDirectEdge(origin, firstHub.code))
    + Number(hasDirectEdge(firstHub.code, secondHub.code))
    + Number(hasDirectEdge(secondHub.code, destination));
  return {
    type: 'connection',
    stops: 2,
    airports: [normalizeCode(origin), firstHub.code, secondHub.code, normalizeCode(destination)],
    connection_airports: [
      { code: firstHub.code, name: firstHub.name },
      { code: secondHub.code, name: secondHub.name },
    ],
    label: `${normalizeCode(origin)} → ${firstHub.code} → ${secondHub.code} → ${normalizeCode(destination)}`,
    suggested_airlines: [...new Set([firstHub.airline, secondHub.airline])],
    route_confidence: optionConfidence(2, (firstHub.score + secondHub.score) / 2, directEdgeCount),
    schedule_confirmed: false,
    fare_available: false,
    provider_verification_required: true,
    missing_live_fare_reason: 'No confirmed fare was returned for the selected date.',
  };
}

function routeRank(origin, destination, hub) {
  if ([origin, destination].includes(hub.code)) return -Infinity;
  const firstLeg = hasDirectEdge(origin, hub.code);
  const secondLeg = hasDirectEdge(hub.code, destination);
  return hub.score + Number(firstLeg) * 18 + Number(secondLeg) * 18;
}

function buildRouteGraph({ origin, destination, maxStops = 2, limit = 5 } = {}) {
  const normalizedOrigin = normalizeCode(origin);
  const normalizedDestination = normalizeCode(destination);
  if (!normalizedOrigin || !normalizedDestination || normalizedOrigin === normalizedDestination) {
    return {
      status: 'unavailable',
      source: 'fairworth_route_graph',
      options: [],
      caveat: 'Origin and destination must be different IATA/city codes.',
    };
  }

  const direct = directOption(normalizedOrigin, normalizedDestination);
  const connectionLimit = Math.max(0, Number(limit || 5) - (direct ? 1 : 0));
  const singleLimit = maxStops >= 2 ? Math.ceil(connectionLimit * 0.6) : connectionLimit;
  const connections = maxStops === 0 ? [] : DEFAULT_HUBS
    .map(hub => ({ hub, rank: routeRank(normalizedOrigin, normalizedDestination, hub) }))
    .filter(item => item.rank > 0)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, singleLimit)
    .map(item => connectionOption(normalizedOrigin, normalizedDestination, item.hub));

  const twoStopConnections = maxStops < 2 ? [] : DEFAULT_HUBS
    .flatMap(firstHub => DEFAULT_HUBS
      .filter(secondHub => secondHub.code !== firstHub.code)
      .map(secondHub => ({
        firstHub,
        secondHub,
        rank: routeRank(normalizedOrigin, normalizedDestination, firstHub)
          + routeRank(firstHub.code, normalizedDestination, secondHub),
      })))
    .filter(item => item.rank > 0 && ![normalizedOrigin, normalizedDestination].includes(item.firstHub.code)
      && ![normalizedOrigin, normalizedDestination].includes(item.secondHub.code))
    .sort((left, right) => right.rank - left.rank)
    .slice(0, Math.max(0, connectionLimit - connections.length))
    .map(item => twoConnectionOption(normalizedOrigin, normalizedDestination, item.firstHub, item.secondHub));

  const options = [direct, ...connections, ...twoStopConnections].filter(Boolean);
  return {
    status: options.length ? 'estimated' : 'unavailable',
    source: 'fairworth_route_graph',
    source_stage: 'mvp_estimated_routes',
    origin: normalizedOrigin,
    destination: normalizedDestination,
    options,
    caveat: 'These are route possibilities, not confirmed schedules or bookable fares. Final price and seat availability require provider verification.',
    future_providers: ['AeroDataBox', 'OAG'],
  };
}

function routeFallbackTickets(routeGraph, { departDate, currency = 'USD' } = {}) {
  const receivedAt = new Date().toISOString();
  return (routeGraph.options || []).map((option, index) => ({
    id: `route-${option.airports.join('-')}-${departDate || 'date'}`,
    airline: option.suggested_airlines[0] || 'Multiple airlines',
    flight_number: option.stops === 0 ? 'Route possibility' : 'Connection possibility',
    origin: routeGraph.origin,
    destination: routeGraph.destination,
    departure_at: departDate ? `${departDate}T00:00:00Z` : null,
    duration_to: null,
    transfers: option.stops,
    price: null,
    currency,
    route_graph_option: option,
    fare_type: 'route_only',
    fare_observed_at: receivedAt,
    fare_received_at: receivedAt,
    fare_cache_status: 'route_graph_estimate',
    availability_confirmed: false,
    seat_availability_confirmed: false,
    requires_provider_verification: true,
    top_pick_eligible: false,
    fairworth_score: Math.max(35, option.route_confidence - 8 - index * 2),
    adjusted_score: Math.max(30, option.route_confidence - 14 - index * 2),
    score_reliability: option.route_confidence,
    fare_confidence: 0,
    unknown_score_data: ['live_fare', 'schedule', 'seat_availability'],
  }));
}

module.exports = {
  buildRouteGraph,
  routeFallbackTickets,
  hasDirectEdge,
  possibleAirports,
  DEFAULT_HUBS,
};
