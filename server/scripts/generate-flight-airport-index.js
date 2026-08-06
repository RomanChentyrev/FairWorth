const fs = require('fs');
const path = require('path');

const dataDirectory = path.join(__dirname, '..', 'data');
const outputDirectory = path.join(__dirname, '..', 'resources');
const outputPath = path.join(outputDirectory, 'flight-airport-index.json');
const sourceAirports = require(path.join(dataDirectory, 'airports.json'));
const sourceCities = require(path.join(dataDirectory, 'cities.json'));

const flightableAirports = sourceAirports.filter(item => (
  item?.code && item.iata_type === 'airport' && item.flightable === true
));
const cityCodes = new Set(flightableAirports.map(item => item.city_code).filter(Boolean));

const payload = {
  airports: flightableAirports.map(item => ({
    c: item.code,
    cc: item.city_code || null,
    n: item.name || item.code,
    k: item.country_code || null,
    p: item.coordinates || null,
  })),
  cities: sourceCities.filter(item => item?.code && cityCodes.has(item.code)).map(item => ({
    c: item.code,
    n: item.name || item.code,
    p: item.coordinates || null,
  })),
};

fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(payload));
console.log(`Generated ${payload.airports.length} airports and ${payload.cities.length} city groups in ${outputPath}`);
