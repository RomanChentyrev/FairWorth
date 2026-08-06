const flightIndex = require('../resources/flight-airport-index.json');

const airports = flightIndex.airports.map(item => ({
  code: item.c,
  city_code: item.cc,
  name: item.n,
  country_code: item.k,
  coordinates: item.p,
  iata_type: 'airport',
  flightable: true,
}));
const cities = flightIndex.cities.map(item => ({
  code: item.c,
  name: item.n,
  coordinates: item.p,
}));

const airportByCode = new Map(airports.filter(item => item?.code).map(item => [item.code.toUpperCase(), item]));
const cityByCode = new Map(cities.filter(item => item?.code).map(item => [item.code.toUpperCase(), item]));
const airportsByCity = new Map();

for (const airport of airports) {
  const cityCode = String(airport?.city_code || '').toUpperCase();
  if (!cityCode || airport?.iata_type !== 'airport' || airport?.flightable !== true) continue;
  if (!airportsByCity.has(cityCode)) airportsByCity.set(cityCode, []);
  airportsByCity.get(cityCode).push(airport);
}

function radians(value) {
  return Number(value) * Math.PI / 180;
}

function distanceKm(left, right) {
  if (![left?.lat, left?.lon, right?.lat, right?.lon].every(value => Number.isFinite(Number(value)))) return Number.POSITIVE_INFINITY;
  const earthRadius = 6371;
  const latitude = radians(right.lat - left.lat);
  const longitude = radians(right.lon - left.lon);
  const a = Math.sin(latitude / 2) ** 2
    + Math.cos(radians(left.lat)) * Math.cos(radians(right.lat)) * Math.sin(longitude / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function publicAirport(airport, cityCoordinates) {
  return {
    code: airport.code,
    name: airport.name || airport.code,
    city_code: airport.city_code || null,
    country_code: airport.country_code || null,
    distance_from_city_km: Number.isFinite(distanceKm(cityCoordinates, airport.coordinates))
      ? Math.round(distanceKm(cityCoordinates, airport.coordinates))
      : null,
  };
}

function resolveAirportGroup(value, { limit = 8 } = {}) {
  const input = String(value || '').trim().toUpperCase();
  if (!input) return { input, city_code: null, airports: [], expanded: false };

  const city = cityByCode.get(input);
  if (city) {
    const candidates = [...(airportsByCity.get(input) || [])]
      .sort((left, right) => distanceKm(city.coordinates, left.coordinates) - distanceKm(city.coordinates, right.coordinates))
      .slice(0, Math.max(1, limit));
    if (candidates.length) {
      return {
        input,
        city_code: input,
        city_name: city.name || input,
        airports: candidates.map(airport => publicAirport(airport, city.coordinates)),
        expanded: candidates.length > 1 || candidates[0].code !== input,
      };
    }
  }

  const airport = airportByCode.get(input);
  if (airport?.iata_type === 'airport' && airport?.flightable === true) {
    return {
      input,
      city_code: airport.city_code || null,
      city_name: airport.city_name || null,
      airports: [publicAirport(airport, cityByCode.get(String(airport.city_code || '').toUpperCase())?.coordinates)],
      expanded: false,
    };
  }

  return {
    input,
    city_code: null,
    city_name: null,
    airports: [{ code: input, name: input, city_code: null, country_code: null, distance_from_city_km: null }],
    expanded: false,
  };
}

function airportCodes(value, options) {
  return resolveAirportGroup(value, options).airports.map(airport => airport.code);
}

module.exports = { resolveAirportGroup, airportCodes, distanceKm };
