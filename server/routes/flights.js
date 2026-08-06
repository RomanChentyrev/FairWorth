const express = require('express');
const router = express.Router();
const travelpayouts = require('../services/travelpayouts');
const searchApiFlights = require('../services/searchApiFlights');
const duffelFlights = require('../services/duffelFlights');
const { configured } = require('../config/capabilities');
const { db } = require('../db/database');
const { scoreFlights, FLIGHT_SCORE_VERSION } = require('../services/flightScoring');
const { buildRouteGraph, routeFallbackTickets } = require('../services/flightRouteGraph');
const { resolveAirportGroup } = require('../services/flightAirportResolver');

function getTravelpayoutsToken() {
  return process.env.TRAVELPAYOUTS_TOKEN;
}

function getSearchApiCredentials() {
  const apiKey = process.env.SEARCHAPI_KEY;
  return configured(apiKey)
    ? { apiKey, market: process.env.SEARCHAPI_MARKET || 'us' }
    : null;
}

function getDuffelCredentials() {
  const accessToken = process.env.DUFFEL_ACCESS_TOKEN;
  return configured(accessToken) ? { accessToken } : null;
}

function requireTopSearchProvider(res) {
  const token = configured(getTravelpayoutsToken()) ? getTravelpayoutsToken() : null;
  const searchApi = getSearchApiCredentials();
  const duffel = getDuffelCredentials();
  if (!token && !searchApi && !duffel) {
    res.status(503).json({
      success: false,
      error: 'No flight search provider is configured on the server',
      code: 'PROVIDER_NOT_CONFIGURED', capability: 'flights', provider: null, retryable: false,
    });
    return null;
  }
  return { token, searchApi, duffel };
}

function requireTravelpayoutsToken(res) {
  const token = getTravelpayoutsToken();
  if (!configured(token)) {
    res.status(503).json({
      success: false,
      error: 'TRAVELPAYOUTS_TOKEN is not configured on the server',
      code: 'PROVIDER_NOT_CONFIGURED', capability: 'flights', provider: 'Travelpayouts', retryable: false,
    });
    return null;
  }
  return token;
}

function parseRouteQuery(query) {
  return {
    origin: String(query.origin || '').trim().toUpperCase(),
    destination: String(query.destination || '-').trim().toUpperCase(),
    depart_date: query.depart_date ? String(query.depart_date).trim() : undefined,
    return_date: query.return_date ? String(query.return_date).trim() : undefined,
    currency: String(query.currency || 'USD').trim().toUpperCase(),
  };
}

async function flightPreferences(userId) {
  return (await db.prepare(`SELECT flight_type, seat_class, seat_position, preferred_airlines,
    max_stops, travel_style, budget_level FROM user_preferences WHERE user_id = ?`).get(userId)) || {};
}

function scoringContext(query) {
  const departure = query.depart_date ? new Date(`${String(query.depart_date).slice(0, 10)}T00:00:00Z`) : null;
  const returning = query.return_date ? new Date(`${String(query.return_date).slice(0, 10)}T00:00:00Z`) : null;
  const calculatedTripDays = departure && returning && !Number.isNaN(departure.getTime()) && !Number.isNaN(returning.getTime())
    ? Math.max(0, Math.round((returning - departure) / 86400000))
    : null;
  return {
    passengers: Math.min(Math.max(Number(query.passengers) || 1, 1), 9),
    cabinClass: query.cabin_class ? String(query.cabin_class).toLowerCase() : null,
    maxStops: query.max_stops,
    tripDays: Number.isFinite(Number(query.trip_days)) ? Math.max(0, Number(query.trip_days)) : calculatedTripDays,
  };
}

function rankedFlights(tickets, preferences, context) {
  return scoreFlights(tickets, preferences, context)
    .filter(ticket => ticket.strict_filter_failures.length === 0)
    .sort((a, b) => Number(b.top_pick_eligible) - Number(a.top_pick_eligible)
      || b.adjusted_score - a.adjusted_score
      || b.fairworth_score - a.fairworth_score
      || Number(a.price || Infinity) - Number(b.price || Infinity));
}

function indicativeFarePositioning(items = []) {
  const observed = items.map(item => item.fare_observed_at).filter(Boolean).sort();
  const currentOffers = items.filter(item => item.fare_type === 'current_metasearch_fare' || item.source === 'searchapi');
  const indicativeOffers = items.length - currentOffers.length;
  return {
    fare_type: currentOffers.length && indicativeOffers
      ? 'mixed'
      : currentOffers.length ? 'current_metasearch_fare' : 'indicative',
    latest_observed_at: observed.at(-1) || null,
    availability_confirmed: items.some(item => item.availability_confirmed === true),
    seat_availability_confirmed: items.some(item => item.seat_availability_confirmed === true),
    requires_provider_verification: true,
    disclaimer: 'Search offers can change. Revalidate final price and availability before checkout.',
  };
}

function routeGraphForQuery(params, query) {
  return buildRouteGraph({
    origin: params.origin,
    destination: params.destination,
    maxStops: String(query.max_stops || '') === '0' ? 0 : 2,
    limit: 5,
  });
}

function validateOriginDestination(res, { origin, destination }, options = {}) {
  if (!origin) {
    res.status(400).json({ success: false, error: 'origin is required' });
    return false;
  }
  if (options.destinationRequired && (!destination || destination === '-')) {
    res.status(400).json({ success: false, error: 'destination is required' });
    return false;
  }
  return true;
}

function calendarStats(days) {
  const prices = days
    .map(day => Number(day.price))
    .filter(price => Number.isFinite(price) && price > 0);

  if (!prices.length) {
    return { min: null, max: null, avg: null, cheap: [] };
  }

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const avg = Math.round(prices.reduce((sum, price) => sum + price, 0) / prices.length);
  const cheapThreshold = min * 1.1;
  const cheap = days
    .filter(day => Number(day.price) <= cheapThreshold)
    .map(day => day.date);

  return { min, max, avg, cheap };
}

function isProviderTimeout(error) {
  return error?.name === 'TimeoutError' || ['ETIMEDOUT', 'ESOCKETTIMEDOUT'].includes(error?.code) || /timed?\s*out|timeout/i.test(String(error?.message || ''));
}

function sendTravelpayoutsError(res, err) {
  console.error('[travelpayouts]', err);
  const timeout = isProviderTimeout(err);
  res.status(timeout ? 504 : 502).json({
    success: false,
    error: timeout ? 'Travelpayouts did not respond in time' : 'Travelpayouts request failed',
    code: timeout ? 'PROVIDER_TIMEOUT' : 'PROVIDER_ERROR',
    provider: 'Travelpayouts',
    retryable: true,
  });
}

function sendFlightProviderError(res, err) {
  if (!err?.provider || err.provider === 'Travelpayouts') return sendTravelpayoutsError(res, err);
  console.error(`[${err.provider}]`, err);
  const timeout = isProviderTimeout(err);
  res.status(timeout ? 504 : 502).json({
    success: false,
    error: timeout ? `${err.provider} did not respond in time` : `${err.provider} request failed`,
    code: timeout ? 'PROVIDER_TIMEOUT' : 'PROVIDER_ERROR',
    provider: err.provider,
    retryable: true,
  });
}

function preferredProviderError(errors) {
  return errors.find(isProviderTimeout) || errors[0] || new Error('Travelpayouts request failed');
}

function uniqueTickets(tickets) {
  const seen = new Set();
  return tickets.filter(ticket => {
    const key = [
      ticket.destination,
      ticket.airline,
      ticket.flight_number,
      ticket.departure_at,
      ticket.return_at,
      ticket.price,
    ].join(':');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dayDistance(dateA, dateB) {
  const a = new Date(`${dateA}T00:00:00.000Z`);
  const b = new Date(`${dateB}T00:00:00.000Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return Infinity;
  return Math.round((a - b) / (1000 * 60 * 60 * 24));
}

function addDays(dateValue, days) {
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function ticketDepartureDate(ticket) {
  return (ticket.departure_at || ticket.date || '').slice(0, 10);
}

function filterTicketsByRequestedDate(tickets, requestedDate) {
  if (!requestedDate || requestedDate.length !== 10) return tickets;
  return tickets.filter(ticket => ticketDepartureDate(ticket) === requestedDate);
}

function formatDateTimeInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

async function enrichArrivalTimes(tickets) {
  try {
    const airports = await travelpayouts.getAirports();
    const airportList = Array.isArray(airports) ? airports : Object.values(airports);
    const airportByCode = new Map(airportList.map(airport => [airport.code, airport]));

    return tickets.map(ticket => {
      if (ticket.arrival_local_at) return ticket;
      const destinationCode = ticket.destination_airport || ticket.destination;
      const destinationAirport = airportByCode.get(destinationCode);
      const duration = Number(ticket.duration_to || ticket.duration || 0);
      if (!ticket.departure_at || !duration || !destinationAirport?.time_zone) return ticket;

      const departure = new Date(ticket.departure_at);
      if (Number.isNaN(departure.getTime())) return ticket;

      const arrival = new Date(departure.getTime() + duration * 60 * 1000);
      return {
        ...ticket,
        arrival_local_at: formatDateTimeInZone(arrival, destinationAirport.time_zone),
        arrival_time_zone: destinationAirport.time_zone,
      };
    });
  } catch (err) {
    console.warn(`[travelpayouts] arrival enrichment skipped: ${err.message}`);
    return tickets;
  }
}

async function cheapestTicketsHandler(req, res) {
  const token = requireTravelpayoutsToken(res);
  if (!token) return;

  const params = parseRouteQuery(req.query);
  if (!validateOriginDestination(res, params)) return;

  try {
    const tickets = await travelpayouts.cheapestTickets({ ...params, token });
    res.json({
      success: true,
      count: tickets.length,
      origin: params.origin,
      destination: params.destination,
      currency: params.currency,
      fare_positioning: indicativeFarePositioning(tickets),
      data: tickets,
    });
  } catch (err) {
    sendTravelpayoutsError(res, err);
  }
}

router.get('/cheapest', cheapestTicketsHandler);
router.get('/cheapest-tickets', cheapestTicketsHandler);

router.get('/top', async (req, res) => {
  const providers = requireTopSearchProvider(res);
  if (!providers) return;
  const { token, searchApi, duffel } = providers;
  const params = parseRouteQuery(req.query);
  const limit = Math.min(Math.max(Number(req.query.limit) || 5, 1), 40);
  const providerLimit = Math.min(Math.max(limit * 4, 40), 100);
  const includeAlternatives = String(req.query.include_alternatives || '').toLowerCase() === 'true';
  if (!validateOriginDestination(res, params, { destinationRequired: true })) return;
  if (!params.depart_date) {
    res.status(400).json({ success: false, error: 'depart_date is required' });
    return;
  }

  const requestedDate = params.depart_date;
  const isExactDateSearch = requestedDate.length === 10;
  const context = scoringContext(req.query);
  const originGroup = resolveAirportGroup(params.origin);
  const destinationGroup = resolveAirportGroup(params.destination);
  const originCodes = originGroup.airports.map(airport => airport.code);
  const destinationCodes = destinationGroup.airports.map(airport => airport.code);
  const providerStatuses = {
    searchapi: { status: searchApi ? 'pending' : 'not_configured', attempts: 0, exact_offers: 0, alternative_offers: 0 },
    duffel: { status: duffel ? 'pending' : 'not_configured', attempts: 0, exact_offers: 0, alternative_offers: 0 },
    travelpayouts: { status: token ? 'pending' : 'not_configured', attempts: 0, exact_offers: 0, alternative_offers: 0 },
  };
  const providerNames = new Set();
  let tickets = [];

  const recordResult = (key, provider, result, stage) => {
    const status = providerStatuses[key];
    status.attempts += 1;
    if (result.status === 'rejected') {
      status.status = isProviderTimeout(result.reason) ? 'timeout' : 'error';
      status.retryable = true;
      status.error_code = isProviderTimeout(result.reason) ? 'PROVIDER_TIMEOUT' : 'PROVIDER_ERROR';
      return [];
    }
    const data = result.value || [];
    status.status = data.length ? 'offers_found' : (status.status === 'offers_found' ? status.status : 'empty');
    status[stage === 'exact' ? 'exact_offers' : 'alternative_offers'] += data.length;
    providerNames.add(provider);
    return data;
  };

  const searchCurrentProviders = async (date, stage = 'exact', offset = 0) => {
    const calls = [];
    const descriptors = [];
    if (searchApi && isExactDateSearch) {
      descriptors.push(['searchapi', 'SearchAPI']);
      calls.push(searchApiFlights.flightOffersSearch({
        origin: originCodes,
        destination: destinationCodes,
        depart_date: date,
        passengers: context.passengers,
        cabin_class: req.query.cabin_class,
        currency: params.currency,
        max: providerLimit,
        max_stops: req.query.max_stops,
        ...searchApi,
      }));
    }
    if (duffel && isExactDateSearch) {
      descriptors.push(['duffel', 'Duffel']);
      calls.push(duffelFlights.flightOffersSearch({
        origin: params.origin,
        destination: params.destination,
        depart_date: date,
        passengers: context.passengers,
        cabin_class: req.query.cabin_class,
        max_stops: req.query.max_stops,
        max: providerLimit,
        ...duffel,
      }));
    }
    const settled = await Promise.allSettled(calls);
    return settled.flatMap((result, index) => {
      const [key, provider] = descriptors[index];
      const found = recordResult(key, provider, result, stage);
      if (stage === 'exact') return found;
      return found.map(ticket => ({
        ...ticket,
        requested_depart_date: requestedDate,
        is_alternative_date: true,
        date_distance_days: Math.abs(offset),
        alternative_depart_date: date,
      }));
    });
  };

  tickets.push(...await searchCurrentProviders(requestedDate));

  if (token) {
    const travelResult = await Promise.allSettled([
      travelpayouts.pricesForDates({ ...params, limit: providerLimit, token }),
    ]);
    let travelTickets = recordResult('travelpayouts', 'Travelpayouts', travelResult[0], 'exact');
    travelTickets = filterTicketsByRequestedDate(travelTickets, requestedDate);
    providerStatuses.travelpayouts.exact_offers = travelTickets.length;
    if (!travelTickets.length) {
      const fallbackResults = await Promise.allSettled([
        travelpayouts.cheapestTickets({ ...params, token }),
        travelpayouts.priceCalendar({ ...params, token }),
      ]);
      const cheapTickets = recordResult('travelpayouts', 'Travelpayouts', fallbackResults[0], 'exact');
      const calendarDays = recordResult('travelpayouts', 'Travelpayouts', fallbackResults[1], 'exact')
        .filter(day => day.price && (day.date === requestedDate || ticketDepartureDate(day) === requestedDate))
        .map(day => ({ ...day, destination: day.destination || params.destination, source: 'price_calendar' }));
      travelTickets = [...filterTicketsByRequestedDate(cheapTickets, requestedDate), ...calendarDays];
      providerStatuses.travelpayouts.exact_offers = travelTickets.length;
    }
    tickets.push(...travelTickets);
  }

  const exactOfferCount = tickets.length;
  if (includeAlternatives && isExactDateSearch && exactOfferCount === 0) {
    for (const distance of [1, 2, 3]) {
      const offsets = [-distance, distance];
      const alternatives = await Promise.all(offsets.map(offset => (
        searchCurrentProviders(addDays(requestedDate, offset), 'alternative', offset)
      )));
      tickets.push(...alternatives.flat());
      if (tickets.length) break;
    }
  }

  if (token && includeAlternatives && exactOfferCount === 0 && isExactDateSearch) {
    const monthResult = await Promise.allSettled([travelpayouts.pricesForDates({
      ...params,
      depart_date: requestedDate.slice(0, 7),
      limit: 100,
      token,
    })]);
    const monthTickets = recordResult('travelpayouts', 'Travelpayouts', monthResult[0], 'alternative')
      .map(ticket => ({
        ...ticket,
        date_distance_days: Math.abs(dayDistance(ticketDepartureDate(ticket), requestedDate)),
        is_alternative_date: ticketDepartureDate(ticket) !== requestedDate,
        requested_depart_date: requestedDate,
        alternative_depart_date: ticketDepartureDate(ticket),
      }))
      .filter(ticket => ticket.date_distance_days > 0 && ticket.date_distance_days <= 3);
    providerStatuses.travelpayouts.alternative_offers = monthTickets.length;
    tickets.push(...monthTickets);
  }

  tickets = uniqueTickets(tickets).sort((a, b) => {
    const aDistance = a.date_distance_days ?? 0;
    const bDistance = b.date_distance_days ?? 0;
    if (aDistance !== bDistance) return aDistance - bDistance;
    return Number(a.price || Infinity) - Number(b.price || Infinity);
  });
  tickets = await enrichArrivalTimes(tickets);
  const preferences = await flightPreferences(req.user.id);
  tickets = rankedFlights(tickets, preferences, context).slice(0, limit);

  const exactTickets = tickets.filter(ticket => !ticket.is_alternative_date);
  const alternativeTickets = tickets.filter(ticket => ticket.is_alternative_date);
  const routeGraph = routeGraphForQuery(params, req.query);
  const routeOptions = exactTickets.length || alternativeTickets.length
    ? []
    : routeFallbackTickets(routeGraph, { departDate: requestedDate, currency: params.currency });
  const configuredStatuses = Object.values(providerStatuses).filter(status => status.status !== 'not_configured');
  const allProvidersFailed = configuredStatuses.length > 0
    && configuredStatuses.every(status => ['timeout', 'error'].includes(status.status));
  const someProvidersFailed = configuredStatuses.some(status => ['timeout', 'error'].includes(status.status));
  const searchStatus = exactTickets.length
    ? (someProvidersFailed ? 'partial' : 'complete_with_offers')
    : alternativeTickets.length
      ? 'alternative_dates_found'
      : allProvidersFailed
        ? 'provider_unavailable'
        : routeOptions.length
          ? 'route_only'
          : 'complete_no_offers';

  res.json({
    success: true,
    search_status: searchStatus,
    count: tickets.length,
    exact_offer_count: exactTickets.length,
    alternative_offer_count: alternativeTickets.length,
    route_option_count: routeOptions.length,
    origin: params.origin,
    destination: params.destination,
    airport_expansion: { origin: originGroup, destination: destinationGroup },
    currency: params.currency,
    limit,
    score_version: FLIGHT_SCORE_VERSION,
    scoring_context: context,
    route_graph: routeGraph,
    route_options: routeOptions,
    fare_positioning: {
      ...indicativeFarePositioning(tickets),
      route_options_available: routeOptions.length > 0,
    },
    providers: [...providerNames],
    provider_statuses: providerStatuses,
    data: tickets,
  });
});

router.get('/direct', async (req, res) => {
  const token = requireTravelpayoutsToken(res);
  if (!token) return;

  const params = parseRouteQuery(req.query);
  if (!validateOriginDestination(res, params, { destinationRequired: true })) return;

  try {
    const tickets = await travelpayouts.directTickets({ ...params, token });
    res.json({
      success: true,
      count: tickets.length,
      origin: params.origin,
      destination: params.destination,
      currency: params.currency,
      fare_positioning: indicativeFarePositioning(tickets),
      data: tickets,
    });
  } catch (err) {
    sendTravelpayoutsError(res, err);
  }
});

router.get('/most-suitable', async (req, res) => {
  const token = requireTravelpayoutsToken(res);
  if (!token) return;

  const params = parseRouteQuery(req.query);
  if (!validateOriginDestination(res, params, { destinationRequired: true })) return;

  try {
    const tickets = await travelpayouts.pricesForDates({ ...params, limit: 40, token });
    const enrichedTickets = await enrichArrivalTimes(filterTicketsByRequestedDate(tickets, params.depart_date));
    const preferences = await flightPreferences(req.user.id);
    const context = scoringContext(req.query);
    const suitableTickets = rankedFlights(enrichedTickets
      .map(ticket => ({
        ...ticket,
        suitability_basis: 'fairworth_flight_score',
      })), preferences, context);

    res.json({
      success: true,
      count: suitableTickets.length,
      origin: params.origin,
      destination: params.destination,
      currency: params.currency,
      suitability_basis: 'fairworth_flight_score',
      score_version: FLIGHT_SCORE_VERSION,
      scoring_context: context,
      fare_positioning: indicativeFarePositioning(suitableTickets),
      data: suitableTickets,
    });
  } catch (err) {
    sendTravelpayoutsError(res, err);
  }
});

router.get('/calendar', async (req, res) => {
  const token = requireTravelpayoutsToken(res);
  if (!token) return;

  const params = parseRouteQuery(req.query);
  if (!validateOriginDestination(res, params, { destinationRequired: true })) return;
  if (!params.depart_date) {
    res.status(400).json({ success: false, error: 'depart_date is required' });
    return;
  }

  try {
    const days = await travelpayouts.priceCalendar({ ...params, token });
    res.json({
      success: true,
      count: days.length,
      origin: params.origin,
      destination: params.destination,
      currency: params.currency,
      stats: calendarStats(days),
      fare_positioning: indicativeFarePositioning(days),
      data: days,
    });
  } catch (err) {
    sendTravelpayoutsError(res, err);
  }
});

router.get('/popular', async (req, res) => {
  const token = requireTravelpayoutsToken(res);
  if (!token) return;

  const origin = String(req.query.origin || '').trim().toUpperCase();
  const currency = String(req.query.currency || 'USD').trim().toUpperCase();
  if (!origin) {
    res.status(400).json({ success: false, error: 'origin is required' });
    return;
  }

  try {
    const destinations = await travelpayouts.popularDestinations({ origin, currency, token });
    res.json({
      success: true,
      count: destinations.length,
      origin,
      currency,
      fare_positioning: indicativeFarePositioning(destinations),
      data: destinations,
    });
  } catch (err) {
    sendTravelpayoutsError(res, err);
  }
});

router.get('/airports.json', async (req, res) => {
  try {
    const airports = await travelpayouts.getAirports();
    res.json(airports);
  } catch (err) {
    sendTravelpayoutsError(res, err);
  }
});

router.get('/airports', async (req, res) => {
  try {
    const airports = await travelpayouts.getAirports();
    res.json({ success: true, count: Array.isArray(airports) ? airports.length : Object.keys(airports).length, data: airports });
  } catch (err) {
    sendTravelpayoutsError(res, err);
  }
});

router.get('/airports/search', async (req, res) => {
  const query = String(req.query.q || '').trim();
  if (query.length < 2) {
    res.json({ success: true, count: 0, data: [] });
    return;
  }

  try {
    const results = await travelpayouts.searchAirports(query);
    res.json({ success: true, count: results.length, data: results });
  } catch (err) {
    sendTravelpayoutsError(res, err);
  }
});

router.get('/airlines', async (req, res) => {
  try {
    const airlines = await travelpayouts.getAirlines();
    res.json({ success: true, count: Array.isArray(airlines) ? airlines.length : Object.keys(airlines).length, data: airlines });
  } catch (err) {
    sendTravelpayoutsError(res, err);
  }
});

router.get('/cities', async (req, res) => {
  try {
    const cities = await travelpayouts.getCities();
    res.json({ success: true, count: Array.isArray(cities) ? cities.length : Object.keys(cities).length, data: cities });
  } catch (err) {
    sendTravelpayoutsError(res, err);
  }
});

router.get('/countries', async (req, res) => {
  try {
    const countries = await travelpayouts.getCountries();
    res.json({ success: true, count: Array.isArray(countries) ? countries.length : Object.keys(countries).length, data: countries });
  } catch (err) {
    sendTravelpayoutsError(res, err);
  }
});

router.get('/search', async (req, res) => {
  res.status(410).json({ error: 'Demo flight search was removed. Use the indicative Travelpayouts /top endpoint.' });
});

module.exports = router;
