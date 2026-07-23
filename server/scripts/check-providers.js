require('dotenv').config();
const liteapi = require('../services/liteapi');
const travelpayouts = require('../services/travelpayouts');
const searchApiFlights = require('../services/searchApiFlights');
const { capabilities } = require('../config/capabilities');

function futureDate(days) { const date = new Date(); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }

async function checkHotels() {
  const iataCode = process.env.PROVIDER_SMOKE_IATA || 'DXB';
  const response = await liteapi.getHotels({ iataCode, limit: 3 });
  const hotels = Array.isArray(response?.data) ? response.data : [];
  if (!hotels.length) throw new Error(`LiteAPI returned no catalog hotels for ${iataCode}`);
  const hotelId = hotels[0].id || hotels[0].hotelId;
  const rates = await liteapi.getRates({ hotelIds: [hotelId], checkIn: futureDate(30), checkOut: futureDate(32), currency: 'USD', adults: 2 });
  return `catalog=${hotels.length}, rate_results=${rates.length}`;
}

async function checkFlights() {
  const origin = process.env.PROVIDER_SMOKE_ORIGIN || 'MOW';
  const destination = process.env.PROVIDER_SMOKE_DESTINATION || 'DXB';
  if (process.env.SEARCHAPI_KEY) {
    const offers = await searchApiFlights.flightOffersSearch({
      origin, destination, depart_date: futureDate(30), passengers: 1, currency: 'USD', max: 3,
      apiKey: process.env.SEARCHAPI_KEY,
      market: process.env.SEARCHAPI_MARKET || 'us',
    });
    return `provider=searchapi, route=${origin}-${destination}, offers=${offers.length}`;
  }
  const tickets = await travelpayouts.cheapestTickets({ origin, destination, depart_date: futureDate(30).slice(0, 7), currency: 'USD', token: process.env.TRAVELPAYOUTS_TOKEN });
  return `provider=travelpayouts, route=${origin}-${destination}, offers=${tickets.length}`;
}

async function checkAi() {
  const response = await fetch('https://openrouter.ai/api/v1/models', { headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`OpenRouter HTTP ${response.status}`);
  const body = await response.json();
  return `models=${Array.isArray(body.data) ? body.data.length : 0}`;
}

async function main() {
  const state = capabilities();
  const checks = [
    ['hotels', state.hotels, checkHotels],
    ['flights', state.flights, checkFlights],
    ['ai', state.ai, checkAi],
  ];
  let failed = false;
  for (const [name, capability, check] of checks) {
    if (capability.status !== 'ready') { console.error(`FAIL ${name}: ${capability.reason}`); failed = true; continue; }
    try { console.log(`OK   ${name}: ${await check()}`); } catch (error) { console.error(`FAIL ${name}: ${error.message}`); failed = true; }
  }
  if (failed) process.exitCode = 1;
}

main().catch(error => { console.error(error.message); process.exit(1); });
