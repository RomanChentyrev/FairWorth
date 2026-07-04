const express = require('express');
const router = express.Router();
const travelpayouts = require('../services/travelpayouts');

function getTravelpayoutsToken() {
  return process.env.TRAVELPAYOUTS_TOKEN;
}

function requireTravelpayoutsToken(res) {
  const token = getTravelpayoutsToken();
  if (!token) {
    res.status(500).json({
      success: false,
      error: 'TRAVELPAYOUTS_TOKEN is not configured on the server',
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

function sendTravelpayoutsError(res, err) {
  console.error('[travelpayouts]', err);
  res.status(502).json({
    success: false,
    error: err.message || 'Travelpayouts API error',
  });
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
      data: tickets,
    });
  } catch (err) {
    sendTravelpayoutsError(res, err);
  }
}

router.get('/cheapest', cheapestTicketsHandler);
router.get('/cheapest-tickets', cheapestTicketsHandler);

router.get('/top', async (req, res) => {
  const token = requireTravelpayoutsToken(res);
  if (!token) return;

  const params = parseRouteQuery(req.query);
  const limit = Math.min(Math.max(Number(req.query.limit) || 5, 1), 40);
  const includeAlternatives = String(req.query.include_alternatives || '').toLowerCase() === 'true';
  if (!validateOriginDestination(res, params, { destinationRequired: true })) return;
  if (!params.depart_date) {
    res.status(400).json({ success: false, error: 'depart_date is required' });
    return;
  }

  try {
    const requestedDate = params.depart_date;
    const isExactDateSearch = requestedDate.length === 10;
    const requestedMonth = requestedDate.slice(0, 7);
    let tickets = await travelpayouts.pricesForDates({ ...params, limit, token }).catch(() => []);

    tickets = filterTicketsByRequestedDate(tickets, requestedDate);

    if (!tickets.length) {
      const [cheapTickets, calendarDays] = await Promise.all([
        travelpayouts.cheapestTickets({ ...params, token }).catch(() => []),
        travelpayouts.priceCalendar({ ...params, token }).catch(() => []),
      ]);

      const calendarTickets = calendarDays
        .filter(day => {
          if (!day.price || !day.departure_at) return false;
          if (isExactDateSearch) return day.date === requestedDate;
          return day.date.startsWith(requestedMonth);
        })
        .map(day => ({
          ...day,
          destination: day.destination || params.destination,
          source: 'price_calendar',
        }));
      tickets = [
        ...filterTicketsByRequestedDate(cheapTickets, requestedDate),
        ...calendarTickets,
      ];
    }

    if (includeAlternatives && tickets.length < limit && isExactDateSearch) {
      const monthTickets = await travelpayouts.pricesForDates({
        ...params,
        depart_date: requestedDate.slice(0, 7),
        limit: 30,
        token,
      }).catch(() => []);

      const nearbyTickets = monthTickets
        .map(ticket => ({
          ...ticket,
          date_distance_days: Math.abs(dayDistance(ticketDepartureDate(ticket), requestedDate)),
          is_alternative_date: ticketDepartureDate(ticket) !== requestedDate,
        }))
        .filter(ticket => ticket.date_distance_days > 0 && ticket.date_distance_days <= 14);

      tickets = [...tickets, ...nearbyTickets];
    }

    tickets = uniqueTickets(tickets)
      .sort((a, b) => {
        const aDistance = a.date_distance_days ?? 0;
        const bDistance = b.date_distance_days ?? 0;
        if (aDistance !== bDistance) return aDistance - bDistance;
        return Number(a.price || Infinity) - Number(b.price || Infinity);
      })
      .slice(0, limit);
    tickets = await enrichArrivalTimes(tickets);

    res.json({
      success: true,
      count: tickets.length,
      origin: params.origin,
      destination: params.destination,
      currency: params.currency,
      limit,
      data: tickets,
    });
  } catch (err) {
    sendTravelpayoutsError(res, err);
  }
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
    const tickets = await travelpayouts.directTickets({ ...params, token });
    const suitableTickets = tickets
      .map(ticket => ({
        ...ticket,
        stops: 0,
        direct: true,
        suitability_basis: 'direct_flight',
      }))
      .sort((a, b) => Number(a.price || 0) - Number(b.price || 0));

    res.json({
      success: true,
      count: suitableTickets.length,
      origin: params.origin,
      destination: params.destination,
      currency: params.currency,
      suitability_basis: 'direct_flight',
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
  res.status(410).json({ error: 'Demo flight search was removed. Use the live Travelpayouts /top endpoint.' });
});

module.exports = router;
