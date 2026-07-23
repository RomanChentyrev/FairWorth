const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeOffer, stopsFilter, travelClass, searchAirportIds } = require('../services/searchApiFlights');

test('SearchAPI filters map to Google Flights values', () => {
  assert.equal(stopsFilter(0), 'nonstop');
  assert.equal(stopsFilter(1), 'one_stop_or_fewer');
  assert.equal(stopsFilter(undefined), 'any');
  assert.equal(travelClass('premium-economy'), 'premium_economy');
  assert.equal(travelClass('first'), 'first_class');
  assert.equal(searchAirportIds('MOW'), 'SVO,DME,VKO');
  assert.equal(searchAirportIds('NYC'), 'JFK,EWR,LGA');
  assert.equal(searchAirportIds('SIN'), 'SIN');
});

test('SearchAPI connecting fare is normalized for the complete party', () => {
  const ticket = normalizeOffer({
    flights: [
      {
        departure_airport: { id: 'SVO', date: '2030-05-10', time: '09:00' },
        arrival_airport: { id: 'IST', date: '2030-05-10', time: '13:10' },
        duration: 250, airline: 'Turkish Airlines', flight_number: 'TK 416',
        airplane: 'Airbus A330', travel_class: 'Economy',
      },
      {
        departure_airport: { id: 'IST', date: '2030-05-10', time: '15:00' },
        arrival_airport: { id: 'SIN', date: '2030-05-11', time: '05:20' },
        duration: 620, airline: 'Turkish Airlines', flight_number: 'TK 54',
        airplane: 'Boeing 787', travel_class: 'Economy',
      },
    ],
    layovers: [{ id: 'IST', name: 'Istanbul Airport', duration: 110 }],
    total_duration: 980,
    price: 1600,
    booking_token: 'private-provider-token',
    extensions: ['Separate tickets booked together'],
  }, 2, '2030-01-01T00:00:00.000Z');

  assert.equal(ticket.source, 'searchapi');
  assert.equal(ticket.fare_type, 'current_metasearch_fare');
  assert.equal(ticket.price, 800);
  assert.equal(ticket.total_price, 1600);
  assert.equal(ticket.transfers, 1);
  assert.deepEqual(ticket.connection_airports, ['IST']);
  assert.equal(ticket.availability_confirmed, false);
  assert.equal(ticket.self_transfer, true);
  assert.equal(ticket.protected_itinerary, false);
  assert.equal(ticket.booking_token_available, true);
  assert.equal(JSON.stringify(ticket).includes('private-provider-token'), false);
});
