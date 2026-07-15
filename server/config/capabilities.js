function fixtureEnabled() {
  return process.env.NODE_ENV !== 'production' && process.env.PROVIDER_FIXTURES_ENABLED === 'true';
}

function configured(value) {
  const normalized = String(value || '').trim();
  return Boolean(normalized) && !/^(your_|replace_|generate_|\[)/i.test(normalized);
}

function xoteloHotelFallbackEnabled() {
  const providers = String(process.env.HOTEL_RATE_PROVIDERS || 'liteapi,xotelo')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
  return process.env.NODE_ENV !== 'production' && providers.includes('xotelo');
}

function capabilities() {
  const liteApiReady = configured(process.env.LITEAPI_KEY);
  const xoteloReady = xoteloHotelFallbackEnabled();
  const hotelsReady = liteApiReady || xoteloReady;
  const flightsReady = configured(process.env.TRAVELPAYOUTS_TOKEN);
  const aiReady = configured(process.env.OPENROUTER_API_KEY);
  const hotelPhotosReady = configured(process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY)
    && process.env.GOOGLE_PLACES_PHOTOS_ENABLED !== 'false';
  return {
    hotels: {
      status: hotelsReady ? 'ready' : 'unavailable', stage: 'beta', provider: liteApiReady ? 'LiteAPI' : xoteloReady ? 'Xotelo' : 'LiteAPI',
      reason: hotelsReady ? null : 'LITEAPI_KEY is not configured',
      features: { catalog: hotelsReady, live_rates: hotelsReady, price_watches: hotelsReady },
    },
    flights: {
      status: flightsReady ? 'ready' : 'unavailable', stage: 'beta', provider: 'Travelpayouts',
      reason: flightsReady ? null : 'TRAVELPAYOUTS_TOKEN is not configured',
      features: { search: flightsReady, live_fares: flightsReady },
    },
    ai: {
      status: aiReady ? 'ready' : 'unavailable', stage: 'beta', provider: 'OpenRouter', optional: true,
      reason: aiReady ? null : 'OPENROUTER_API_KEY is not configured',
      features: { hotel_analysis: aiReady },
    },
    hotel_photos: {
      status: hotelPhotosReady ? 'ready' : 'unavailable', stage: 'optional_mvp_enrichment', provider: 'Google Places Photos', optional: true,
      reason: hotelPhotosReady ? null : 'GOOGLE_PLACES_API_KEY is not configured',
      features: { galleries: hotelPhotosReady, fallback_images: true },
    },
    transfers: { status: 'unavailable', stage: 'planned', provider: null, reason: 'A live transfer provider is not connected', features: {} },
    partner_booking: { status: 'pending', stage: 'post_company_registration', reason: 'Partner deep links will be enabled after company registration' },
  };
}

function requireCapability(name) {
  return (req, res, next) => {
    const capability = capabilities()[name];
    if (capability?.status === 'ready') return next();
    return res.status(503).json({
      error: `${name} is temporarily unavailable because its live provider is not configured`,
      code: 'PROVIDER_NOT_CONFIGURED',
      capability: name,
      provider: capability?.provider || null,
      stage: capability?.stage || 'unavailable',
      retryable: false,
    });
  };
}

module.exports = { capabilities, requireCapability, configured, fixtureEnabled, xoteloHotelFallbackEnabled };
