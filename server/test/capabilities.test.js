const test = require('node:test');
const assert = require('node:assert/strict');
const { capabilities } = require('../config/capabilities');

test('provider capabilities are unavailable without live keys', () => {
  const previous = {
    fixture: process.env.PROVIDER_FIXTURES_ENABLED,
    liteapi: process.env.LITEAPI_KEY,
    travelpayouts: process.env.TRAVELPAYOUTS_TOKEN,
    searchapi: process.env.SEARCHAPI_KEY,
    duffel: process.env.DUFFEL_ACCESS_TOKEN,
    openrouter: process.env.OPENROUTER_API_KEY,
    hotelRateProviders: process.env.HOTEL_RATE_PROVIDERS,
    partnerBooking: process.env.PARTNER_BOOKING_ENABLED,
  };
  process.env.PROVIDER_FIXTURES_ENABLED = 'false';
  process.env.HOTEL_RATE_PROVIDERS = 'none';
  process.env.PARTNER_BOOKING_ENABLED = 'false';
  delete process.env.LITEAPI_KEY; delete process.env.TRAVELPAYOUTS_TOKEN; delete process.env.OPENROUTER_API_KEY;
  delete process.env.SEARCHAPI_KEY; delete process.env.DUFFEL_ACCESS_TOKEN;
  const result = capabilities();
  assert.equal(result.hotels.status, 'unavailable');
  assert.equal(result.flights.status, 'unavailable');
  assert.equal(result.ai.status, 'unavailable');
  assert.equal(result.partner_booking.stage, 'post_company_registration');
  for (const [key, value] of Object.entries(previous)) {
    const envKey = { fixture: 'PROVIDER_FIXTURES_ENABLED', liteapi: 'LITEAPI_KEY', travelpayouts: 'TRAVELPAYOUTS_TOKEN', searchapi: 'SEARCHAPI_KEY', duffel: 'DUFFEL_ACCESS_TOKEN', openrouter: 'OPENROUTER_API_KEY', hotelRateProviders: 'HOTEL_RATE_PROVIDERS', partnerBooking: 'PARTNER_BOOKING_ENABLED' }[key];
    if (value === undefined) delete process.env[envKey]; else process.env[envKey] = value;
  }
});

test('partner booking requires both the feature flag and complete redirect configuration', () => {
  const keys = ['PARTNER_BOOKING_ENABLED', 'PARTNER_ALLOWED_HOSTS', 'PARTNER_DEEP_LINK_TEMPLATE', 'PARTNER_POSTBACK_SECRET'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.PARTNER_BOOKING_ENABLED = 'false';
    delete process.env.PARTNER_ALLOWED_HOSTS;
    delete process.env.PARTNER_DEEP_LINK_TEMPLATE;
    delete process.env.PARTNER_POSTBACK_SECRET;
    assert.equal(capabilities().partner_booking.status, 'pending');

    process.env.PARTNER_BOOKING_ENABLED = 'true';
    assert.equal(capabilities().partner_booking.status, 'unavailable');
    assert.equal(capabilities().partner_booking.stage, 'configuration_required');

    process.env.PARTNER_ALLOWED_HOSTS = 'partner.example.com';
    process.env.PARTNER_DEEP_LINK_TEMPLATE = 'https://partner.example.com/redirect?url={url}';
    process.env.PARTNER_POSTBACK_SECRET = 'test-partner-secret';
    const enabled = capabilities().partner_booking;
    assert.equal(enabled.status, 'ready');
    assert.deepEqual(enabled.features, { redirect: true, postback: true });
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
  }
});

test('fixtures do not replace real provider credentials', () => {
  const previous = {
    fixture: process.env.PROVIDER_FIXTURES_ENABLED,
    liteapi: process.env.LITEAPI_KEY,
    token: process.env.TRAVELPAYOUTS_TOKEN,
    searchapi: process.env.SEARCHAPI_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
    hotelRateProviders: process.env.HOTEL_RATE_PROVIDERS,
  };
  process.env.PROVIDER_FIXTURES_ENABLED = 'true';
  process.env.HOTEL_RATE_PROVIDERS = 'none';
  delete process.env.TRAVELPAYOUTS_TOKEN;
  delete process.env.SEARCHAPI_KEY;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.LITEAPI_KEY;
  assert.equal(capabilities().hotels.status, 'unavailable');
  assert.equal(capabilities().flights.status, 'unavailable');
  assert.equal(capabilities().ai.status, 'unavailable');
  process.env.TRAVELPAYOUTS_TOKEN = 'test-travelpayouts-token';
  const flightCapability = capabilities().flights;
  assert.equal(flightCapability.status, 'ready');
  assert.equal(flightCapability.features.indicative_fares, true);
  assert.equal(flightCapability.features.live_fares, undefined);
  if (previous.fixture === undefined) delete process.env.PROVIDER_FIXTURES_ENABLED; else process.env.PROVIDER_FIXTURES_ENABLED = previous.fixture;
  if (previous.liteapi === undefined) delete process.env.LITEAPI_KEY; else process.env.LITEAPI_KEY = previous.liteapi;
  if (previous.token === undefined) delete process.env.TRAVELPAYOUTS_TOKEN; else process.env.TRAVELPAYOUTS_TOKEN = previous.token;
  if (previous.searchapi === undefined) delete process.env.SEARCHAPI_KEY; else process.env.SEARCHAPI_KEY = previous.searchapi;
  if (previous.openrouter === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = previous.openrouter;
  if (previous.hotelRateProviders === undefined) delete process.env.HOTEL_RATE_PROVIDERS; else process.env.HOTEL_RATE_PROVIDERS = previous.hotelRateProviders;
});

test('SearchAPI enables current connecting flight fares without Travelpayouts', () => {
  const keys = ['SEARCHAPI_KEY', 'TRAVELPAYOUTS_TOKEN', 'DUFFEL_ACCESS_TOKEN'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.SEARCHAPI_KEY = 'test-searchapi-key';
    delete process.env.TRAVELPAYOUTS_TOKEN;
    delete process.env.DUFFEL_ACCESS_TOKEN;
    const flights = capabilities().flights;
    assert.equal(flights.status, 'ready');
    assert.equal(flights.provider, 'SearchAPI');
    assert.equal(flights.features.live_offers, false);
    assert.equal(flights.features.current_metasearch_fares, true);
    assert.equal(flights.features.connecting_itineraries, true);
    assert.equal(flights.features.indicative_fares, false);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
  }
});

test('Duffel enables live offers and connecting itineraries', () => {
  const keys = ['SEARCHAPI_KEY', 'TRAVELPAYOUTS_TOKEN', 'DUFFEL_ACCESS_TOKEN'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    delete process.env.SEARCHAPI_KEY;
    delete process.env.TRAVELPAYOUTS_TOKEN;
    process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_example';
    const flights = capabilities().flights;
    assert.equal(flights.status, 'ready');
    assert.equal(flights.provider, 'Duffel');
    assert.equal(flights.features.live_offers, true);
    assert.equal(flights.features.connecting_itineraries, true);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
  }
});
