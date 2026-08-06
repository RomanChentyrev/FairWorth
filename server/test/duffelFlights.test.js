const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeOffer } = require('../services/duffelFlights');

test('Duffel offer is normalized as a live connecting fare for the complete party', () => {
  const ticket = normalizeOffer({
    id: 'off_test_private',
    total_amount: '1800.00',
    total_currency: 'USD',
    expires_at: '2030-05-01T10:30:00Z',
    slices: [{ segments: [
      {
        origin: { iata_code: 'CGK' }, destination: { iata_code: 'DOH', name: 'Doha' },
        departing_at: '2030-05-10T08:00:00Z', arriving_at: '2030-05-10T16:00:00Z',
        marketing_carrier: { iata_code: 'QR', name: 'Qatar Airways' },
        marketing_carrier_flight_number: '955', aircraft: { name: 'Airbus A350' },
        passengers: [{ cabin_class: 'business' }],
      },
      {
        origin: { iata_code: 'DOH' }, destination: { iata_code: 'CDG' },
        departing_at: '2030-05-10T18:00:00Z', arriving_at: '2030-05-10T23:30:00Z',
        marketing_carrier: { iata_code: 'QR', name: 'Qatar Airways' },
        marketing_carrier_flight_number: '37', aircraft: { name: 'Boeing 777' },
        passengers: [{ cabin_class: 'business' }],
      },
    ] }],
  }, 2);

  assert.equal(ticket.source, 'duffel');
  assert.equal(ticket.fare_type, 'live_offer');
  assert.equal(ticket.price, 900);
  assert.equal(ticket.total_price, 1800);
  assert.equal(ticket.transfers, 1);
  assert.deepEqual(ticket.connection_airports, ['DOH']);
  assert.equal(ticket.availability_confirmed, true);
  assert.equal(JSON.stringify(ticket).includes('off_test_private'), false);
});
