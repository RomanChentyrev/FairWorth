const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db/database');
const { ensurePersonalizationSchema, getUserWeights, learnFromInteraction } = require('../services/personalization');

const router = express.Router();
const SIGNALS = Object.freeze({
  impression: 0,
  view: 1,
  trip_add: 2,
  compare_add: 2,
  compare_remove: -1,
  bookmark_add: 3,
  bookmark_remove: -2,
  booking_intent: 5,
  booking: 10,
  booking_completed: 10,
  provider_click: 4,
  preference_changed: 1,
  hide: -4,
});

router.post('/', async (req, res) => {
  try {
    await ensurePersonalizationSchema();
    const userId = req.user.id;
    await getUserWeights(userId);
    const consent = await db.prepare('SELECT behavioural_tracking_consent FROM users WHERE id = ?').get(userId);
    if (!consent?.behavioural_tracking_consent) return res.status(202).json({ recorded: 0, tracking_disabled: true });
    const { event_type: eventType, hotel_id: hotelId, hotel_ids: hotelIds, context = {}, session_id: sessionId, event_id: eventId } = req.body;
    if (!Object.prototype.hasOwnProperty.call(SIGNALS, eventType)) {
      return res.status(400).json({ error: 'Unsupported interaction event' });
    }
    const ids = Array.isArray(hotelIds) ? hotelIds.slice(0, 100) : [hotelId || null];
    let recorded = 0;
    for (const id of ids) {
      const inserted = await db.prepare(`
        INSERT INTO user_interactions
          (id, user_id, hotel_id, event_type, signal, context, session_id, event_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (event_id) WHERE event_id IS NOT NULL DO NOTHING
      `).run(uuidv4(), userId, id, eventType, SIGNALS[eventType], JSON.stringify(context), sessionId || null, eventId ? `${eventId}:${id || 'none'}` : null);
      if (!inserted.rowCount) continue;
      recorded += 1;
      await learnFromInteraction(userId, id, SIGNALS[eventType]);
    }
    await db.prepare(`
      UPDATE user_preference_weights
      SET interaction_count = interaction_count + ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `).run(recorded, userId);
    res.status(201).json({ recorded });
  } catch (error) {
    console.error('Interaction tracking error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
