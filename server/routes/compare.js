const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const { v4: uuidv4 } = require('uuid');
const { compareHotels } = require('../services/ai');
const { defaultTravelDates, validateDateRange } = require('../utils/dates');
const { calculateHotelScore, getUserWeights } = require('../services/personalization');

// POST /api/compare
router.post('/', async (req, res) => {
  try {
    const defaults = defaultTravelDates();
    const { hotel_ids, check_in = defaults.checkIn, check_out = defaults.checkOut, language = 'en' } = req.body;
    const userId = req.user.id;

    if (!hotel_ids || hotel_ids.length < 2) {
      return res.status(400).json({ error: 'Need at least 2 hotels to compare' });
    }
    if (hotel_ids.length > 3) return res.status(400).json({ error: 'You can compare up to 3 hotels' });
    if (!validateDateRange(check_in, check_out)) return res.status(400).json({ error: 'Dates must be in the future' });

    const userPrefs = await db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get(userId);

    const rawHotelsData = (await Promise.all(hotel_ids.map(async id => {
      const hotel = await db.prepare('SELECT * FROM hotels WHERE id = ?').get(id);
      if (!hotel) return null;
      const rooms = await db.prepare('SELECT * FROM hotel_rooms WHERE hotel_id = ? ORDER BY base_price_per_night').all(id);
      const prices = await db.prepare(`SELECT * FROM hotel_prices WHERE hotel_id = ? AND price_valid = 1 AND ((check_in = ? AND check_out = ?) OR check_in IS NULL) ORDER BY price_per_night`).all(id, check_in, check_out);
      const reviews = await db.prepare('SELECT * FROM hotel_reviews WHERE hotel_id = ?').get(id);
      const bestPrice = prices.length ? prices[0] : null;

      const nights = Math.ceil((new Date(check_out) - new Date(check_in)) / (1000 * 60 * 60 * 24));
      const bestOfficialPrice = prices.find(p => p.operator === 'Official Website') || bestPrice;
      const packagePrice = prices.find(p => p.operator === 'Expedia');

      return {
        hotel, rooms, prices, reviews,
        score: 0,
        bestPrice: bestPrice?.price_per_night || 0,
        totalPrice: (bestPrice?.price_per_night || 0) * nights,
        officialPrice: bestOfficialPrice?.price_per_night,
        packagePrice: packagePrice?.price_per_night,
        hasBreakfast: prices.some(p => p.includes_breakfast),
        hasFreeCancellation: prices.some(p => p.cancellation_policy === 'free_cancellation'),
        nights
      };
    }))).filter(Boolean);
    if (rawHotelsData.length !== hotel_ids.length) return res.status(404).json({ error: 'One or more hotels were not found' });

    const weights = await getUserWeights(userId);
    const roomsByHotel = Object.fromEntries(rawHotelsData.map(item => [item.hotel.id, item.rooms]));
    const cities = [...new Set(rawHotelsData.map(item => item.hotel.city))];
    const priceContext = (await db.prepare(`
      SELECT MIN(hp.price_per_night) AS min_price FROM hotels h
      JOIN hotel_prices hp ON hp.hotel_id = h.id AND hp.price_valid = 1
      WHERE h.city IN (${cities.map(() => '?').join(',')}) GROUP BY h.id
    `).all(...cities)).map(row => Number(row.min_price)).filter(price => price > 0);
    const hotelsData = rawHotelsData.map(item => {
      const scored = calculateHotelScore({
        ...item.hotel,
        min_price: item.bestPrice,
        rating: item.reviews?.rating,
        review_count: item.reviews?.count,
        cleanliness: item.reviews?.cleanliness,
        service: item.reviews?.service,
        location_score: item.reviews?.location_score,
        value_score: item.reviews?.value,
      }, userPrefs, weights, { roomsByHotel, prices: priceContext, language });
      return { ...item, score: scored.fairworth_score, score_breakdown: scored.score_breakdown, personal_fit: scored.personal_fit };
    });

    let aiVerdict = null;
    try {
      aiVerdict = await compareHotels(hotelsData, userPrefs || {}, language);
    } catch (e) {
      console.warn('AI compare failed:', e.message);
    }

    // Save session
    const sessionId = uuidv4();
    await db.prepare(`
      INSERT INTO compare_sessions (id, user_id, hotel_ids, ai_verdict)
      VALUES (?, ?, ?, ?)
    `).run(sessionId, userId, JSON.stringify(hotel_ids), aiVerdict ? JSON.stringify(aiVerdict) : null);

    res.json({ comparison: hotelsData, ai_verdict: aiVerdict, session_id: sessionId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
