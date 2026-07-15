const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const { v4: uuidv4 } = require('uuid');
const { compareHotels } = require('../services/ai');
const { defaultTravelDates, validateDateRange } = require('../utils/dates');
const { calculateHotelScore, getUserWeights } = require('../services/personalization');
const { selectComparableRate, marketBenchmark } = require('../services/comparablePricing');

// POST /api/compare
router.post('/', async (req, res) => {
  try {
    const defaults = defaultTravelDates();
    const { hotel_ids, check_in = defaults.checkIn, check_out = defaults.checkOut, language = 'en', guests = 2, trip_purpose: tripPurpose } = req.body;
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

    const weights = await getUserWeights(userId, { destination: rawHotelsData[0]?.hotel?.city, check_in, check_out, guests, trip_purpose: tripPurpose });
    const roomsByHotel = Object.fromEntries(rawHotelsData.map(item => [item.hotel.id, item.rooms]));
    const cities = [...new Set(rawHotelsData.map(item => item.hotel.city))];
    const marketRows = await db.prepare(`
      SELECT hp.*, h.city, h.location, h.stars FROM hotels h
      JOIN hotel_prices hp ON hp.hotel_id = h.id AND hp.price_valid = 1
      WHERE h.city IN (${cities.map(() => '?').join(',')})
        AND hp.check_in = ? AND hp.check_out = ? AND hp.source IN ('liteapi', 'xotelo')
        AND (hp.guests = ? OR hp.guests IS NULL)
    `).all(...cities, check_in, check_out, Math.max(1, Number(guests) || 2));
    const preferredRoomTypes = (() => { try { return JSON.parse(userPrefs?.room_type || '[]'); } catch { return []; } })();
    const preferredAmenities = (() => { try { return JSON.parse(userPrefs?.hotel_amenities || '[]'); } catch { return []; } })();
    const requiredAmenities = (() => { try { return JSON.parse(userPrefs?.required_hotel_amenities || '[]'); } catch { return []; } })();
    const priceOptions = { guests, preferredRoomTypes, breakfastPreferred: preferredAmenities.includes('breakfast'), breakfastRequired: requiredAmenities.includes('breakfast') };
    const marketByHotel = marketRows.reduce((map, row) => ((map[row.hotel_id] ||= []).push(row), map), {});
    const marketOffers = [];
    for (const rows of Object.values(marketByHotel)) {
      const rate = selectComparableRate(rows, priceOptions);
      if (rate) marketOffers.push({ hotel_id: rows[0].hotel_id, city: rows[0].city, location: rows[0].location, stars: rows[0].stars, room_category: rate.room_category, comparable_nightly_price: rate.comparable_nightly_price, currency: rate.currency });
    }
    const hotelsData = rawHotelsData.map(item => {
      const comparable = selectComparableRate(item.prices, priceOptions);
      const benchmark = comparable ? marketBenchmark({ hotel_id: item.hotel.id, city: item.hotel.city, location: item.hotel.location, stars: item.hotel.stars, room_category: comparable.room_category, currency: comparable.currency }, marketOffers) : null;
      const scored = calculateHotelScore({
        ...item.hotel,
        min_price: comparable?.payable_nightly_price ?? null,
        comparable_price: comparable?.comparable_nightly_price ?? null,
        rating: item.reviews?.rating,
        review_count: item.reviews?.count,
        cleanliness: item.reviews?.cleanliness,
        service: item.reviews?.service,
        location_score: item.reviews?.location_score,
        value_score: item.reviews?.value,
        latest_review_at: item.reviews?.latest_review_at,
        recent_review_share: item.reviews?.recent_review_share,
        previous_rating: item.reviews?.previous_rating,
        rating_trend: item.reviews?.rating_trend,
        rating_stddev: item.reviews?.rating_stddev,
        suspicious_review_share: item.reviews?.suspicious_review_share,
        verified_review_share: item.reviews?.verified_review_share,
        review_source_count: item.reviews?.review_source_count,
        review_source_consistency: item.reviews?.review_source_consistency,
      }, userPrefs, weights, {
        roomsByHotel,
        language,
        priceBenchmarkByHotel: { [item.hotel.id]: benchmark },
        priceMetadataByHotel: { [item.hotel.id]: comparable ? { ...comparable, provider: comparable.operator } : null },
      });
      return {
        ...item,
        score: scored.fairworth_score,
        adjusted_score: scored.adjusted_score,
        score_reliability: scored.score_reliability,
        score_reliability_level: scored.score_reliability_level,
        price_confidence: scored.price_confidence,
        price_confidence_level: scored.price_confidence_level,
        top_pick_eligible: scored.top_pick_eligible,
        travel_tier_score: scored.travel_tier_score,
        travel_tier_breakdown: scored.travel_tier_breakdown,
        score_breakdown: scored.score_breakdown,
        quality_breakdown: scored.quality_breakdown,
        quality_profiles: scored.quality_profiles,
        review_freshness_breakdown: scored.review_freshness_breakdown,
        review_freshness_reliability: scored.review_freshness_reliability,
        rating_trend: scored.rating_trend,
        rating_trend_direction: scored.rating_trend_direction,
        review_confidence: scored.review_confidence,
        review_confidence_reliability: scored.review_confidence_reliability,
        review_confidence_breakdown: scored.review_confidence_breakdown,
        review_source_count: scored.review_source_count,
        personal_fit: scored.personal_fit,
      };
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
