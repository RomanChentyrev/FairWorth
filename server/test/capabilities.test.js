const test = require('node:test');
const assert = require('node:assert/strict');
const { capabilities } = require('../config/capabilities');

test('provider capabilities are unavailable without live keys', () => {
  const previous = {
    fixture: process.env.PROVIDER_FIXTURES_ENABLED,
    liteapi: process.env.LITEAPI_KEY,
    travelpayouts: process.env.TRAVELPAYOUTS_TOKEN,
    openrouter: process.env.OPENROUTER_API_KEY,
    hotelRateProviders: process.env.HOTEL_RATE_PROVIDERS,
  };
  process.env.PROVIDER_FIXTURES_ENABLED = 'false';
  process.env.HOTEL_RATE_PROVIDERS = 'none';
  delete process.env.LITEAPI_KEY; delete process.env.TRAVELPAYOUTS_TOKEN; delete process.env.OPENROUTER_API_KEY;
  const result = capabilities();
  assert.equal(result.hotels.status, 'unavailable');
  assert.equal(result.flights.status, 'unavailable');
  assert.equal(result.ai.status, 'unavailable');
  assert.equal(result.partner_booking.stage, 'post_company_registration');
  for (const [key, value] of Object.entries(previous)) {
    const envKey = { fixture: 'PROVIDER_FIXTURES_ENABLED', liteapi: 'LITEAPI_KEY', travelpayouts: 'TRAVELPAYOUTS_TOKEN', openrouter: 'OPENROUTER_API_KEY', hotelRateProviders: 'HOTEL_RATE_PROVIDERS' }[key];
    if (value === undefined) delete process.env[envKey]; else process.env[envKey] = value;
  }
});

test('fixtures do not replace real provider credentials', () => {
  const previous = {
    fixture: process.env.PROVIDER_FIXTURES_ENABLED,
    liteapi: process.env.LITEAPI_KEY,
    token: process.env.TRAVELPAYOUTS_TOKEN,
    openrouter: process.env.OPENROUTER_API_KEY,
    hotelRateProviders: process.env.HOTEL_RATE_PROVIDERS,
  };
  process.env.PROVIDER_FIXTURES_ENABLED = 'true';
  process.env.HOTEL_RATE_PROVIDERS = 'none';
  delete process.env.TRAVELPAYOUTS_TOKEN;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.LITEAPI_KEY;
  assert.equal(capabilities().hotels.status, 'unavailable');
  assert.equal(capabilities().flights.status, 'unavailable');
  assert.equal(capabilities().ai.status, 'unavailable');
  process.env.TRAVELPAYOUTS_TOKEN = 'test-travelpayouts-token';
  assert.equal(capabilities().flights.status, 'ready');
  if (previous.fixture === undefined) delete process.env.PROVIDER_FIXTURES_ENABLED; else process.env.PROVIDER_FIXTURES_ENABLED = previous.fixture;
  if (previous.liteapi === undefined) delete process.env.LITEAPI_KEY; else process.env.LITEAPI_KEY = previous.liteapi;
  if (previous.token === undefined) delete process.env.TRAVELPAYOUTS_TOKEN; else process.env.TRAVELPAYOUTS_TOKEN = previous.token;
  if (previous.openrouter === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = previous.openrouter;
  if (previous.hotelRateProviders === undefined) delete process.env.HOTEL_RATE_PROVIDERS; else process.env.HOTEL_RATE_PROVIDERS = previous.hotelRateProviders;
});
