const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db/database');
const { validate } = require('../middleware/validate');
const { demoBookingSchema } = require('../config/apiSchemas');
const { learnFromInteraction } = require('../services/personalization');

const router = express.Router();

function reference() {
  return `FW-DEMO-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

function publicBooking(row) {
  return {
    reference: row.reference, status: row.status, currency: row.currency,
    hotel_total: Number(row.hotel_total), flights_total: Number(row.flights_total),
    grand_total: Number(row.grand_total), passenger_count: Number(row.passenger_count),
    contact_email: row.contact_email, itinerary: typeof row.itinerary === 'string' ? JSON.parse(row.itinerary) : row.itinerary,
    created_at: row.created_at,
  };
}

router.post('/', validate(demoBookingSchema), async (req, res, next) => {
  try {
    let learningHotelId = null;
    let learningRecorded = false;
    const hotelTotal = Number(req.body.hotel.totalPrice);
    const flightsTotal = req.body.flights.reduce((sum, flight) => sum + Number(flight.totalPrice), 0);
    const grandTotal = Math.round((hotelTotal + flightsTotal) * 100) / 100;
    const travelers = req.body.travelers.map(traveler => ({
      first_name: traveler.first_name, last_name: traveler.last_name, birth_date: traveler.birth_date,
      gender: traveler.gender, nationality: traveler.nationality, document_type: traveler.document_type,
      document_last4: traveler.document_number.replace(/\s+/g, '').slice(-4).toUpperCase(),
      document_expiry: traveler.document_expiry,
    }));
    const booking = await db.transaction(async () => {
      const created = await db.prepare(`
        INSERT INTO demo_bookings
          (id, reference, user_id, currency, hotel_total, flights_total, grand_total, passenger_count,
           contact_email, contact_phone, travelers, itinerary, special_requests)
        VALUES (?, ?, ?, 'USD', ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING *
      `).get(uuidv4(), reference(), req.user.id, hotelTotal, flightsTotal, grandTotal, travelers.length,
        req.body.contact_email, req.body.contact_phone, JSON.stringify(travelers),
        JSON.stringify({ hotel: req.body.hotel, flights: req.body.flights }), req.body.special_requests || null);
      const consent = await db.prepare('SELECT behavioural_tracking_consent FROM users WHERE id = ?').get(req.user.id);
      if (consent?.behavioural_tracking_consent) {
        const knownHotel = await db.prepare('SELECT id FROM hotels WHERE id = ?').get(req.body.hotel.id);
        learningHotelId = knownHotel?.id || null;
        await db.prepare(`INSERT INTO user_interactions (id, user_id, hotel_id, event_type, signal, context) VALUES (?, ?, ?, 'booking_completed', 10, ?)`)
          .run(uuidv4(), req.user.id, knownHotel?.id || null, JSON.stringify({ demo: true, reference: created.reference, amount: grandTotal, currency: 'USD', external_hotel_id: req.body.hotel.id }));
        learningRecorded = Boolean(knownHotel?.id);
      }
      return created;
    });
    if (learningRecorded) {
      try {
        await learnFromInteraction(req.user.id, learningHotelId, 10, {
          check_in: req.body.hotel.checkIn, check_out: req.body.hotel.checkOut,
          destination: req.body.hotel.city, guests: travelers.length,
        });
        await db.prepare(`UPDATE user_preference_weights SET interaction_count = interaction_count + 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`).run(req.user.id);
      } catch (learningError) {
        console.warn('Booking learning update failed:', learningError.message);
      }
    }
    res.status(201).json({ booking: publicBooking(booking) });
  } catch (error) { next(error); }
});

router.get('/:reference', async (req, res, next) => {
  try {
    const booking = await db.prepare('SELECT * FROM demo_bookings WHERE reference = ? AND user_id = ?').get(req.params.reference, req.user.id);
    if (!booking) return res.status(404).json({ error: 'Booking not found', code: 'NOT_FOUND' });
    res.json({ booking: publicBooking(booking) });
  } catch (error) { next(error); }
});

module.exports = router;
