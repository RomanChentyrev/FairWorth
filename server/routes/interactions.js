const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db/database');
const { ensurePersonalizationSchema, getUserWeights, learnFromInteraction, tripContextKey } = require('../services/personalization');
const { validate } = require('../middleware/validate');
const { interactionSchema } = require('../config/apiSchemas');

const router = express.Router();
const SIGNALS = Object.freeze({
  impression: 0,
  view: 0,
  revisit: 1.5,
  dwell_time: 0,
  gallery_view: 0.75,
  rooms_open: 1.25,
  trip_add: 3,
  trip_remove: -2.5,
  compare_add: 2,
  compare_remove: -1,
  bookmark_add: 3,
  bookmark_remove: -2,
  checkout_started: 6,
  booking_intent: 5,
  booking: 10,
  booking_completed: 10,
  provider_click: 4,
  preference_changed: 1,
  hide: -4,
});
const HIDE_REASONS = new Set(['too_expensive', 'bad_location', 'photos', 'missing_pool', 'low_stars', 'other']);

function contextualSignal(eventType, context) {
  if (eventType !== 'dwell_time') return SIGNALS[eventType];
  const seconds = Math.max(0, Number(context?.seconds) || 0);
  if (seconds < 20) return 0;
  if (seconds < 60) return 0.5;
  if (seconds < 180) return 1;
  return 2;
}

router.post('/', validate(interactionSchema), async (req, res) => {
  try {
    await ensurePersonalizationSchema();
    const userId = req.user.id;
    await getUserWeights(userId);
    const consent = await db.prepare('SELECT behavioural_tracking_consent FROM users WHERE id = ?').get(userId);
    if (!consent?.behavioural_tracking_consent) return res.status(202).json({ recorded: 0, tracking_disabled: true });
    const { event_type: eventType, hotel_id: hotelId, hotel_ids: hotelIds, context = {}, session_id: sessionId, event_id: eventId } = req.body;
    if (eventType === 'hide' && (!hotelId || !HIDE_REASONS.has(context.feedback_reason))) {
      return res.status(400).json({ error: 'A valid feedback_reason is required when hiding a hotel' });
    }
    const ids = Array.isArray(hotelIds) ? hotelIds : [hotelId || null];
    let recorded = 0;
    let meaningfulRecorded = 0;
    for (const id of ids) {
      let storedEventType = eventType;
      if (eventType === 'view' && id) {
        const priorVisit = await db.prepare(`SELECT id FROM user_interactions WHERE user_id = ? AND hotel_id = ? AND event_type IN ('view', 'revisit') AND (session_id IS NULL OR session_id IS DISTINCT FROM ?) LIMIT 1`).get(userId, id, sessionId || null);
        if (priorVisit) storedEventType = 'revisit';
      }
      const signal = contextualSignal(storedEventType, context);
      const inserted = await db.prepare(`
        INSERT INTO user_interactions
          (id, user_id, hotel_id, event_type, signal, context, session_id, event_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (event_id) WHERE event_id IS NOT NULL DO NOTHING
      `).run(uuidv4(), userId, id, storedEventType, signal, JSON.stringify(context), sessionId || null, eventId ? `${eventId}:${id || 'none'}` : null);
      if (!inserted.rowCount) continue;
      recorded += 1;
      if (signal) meaningfulRecorded += 1;
      if (storedEventType === 'hide' && id) {
        const [hotel, preferences] = await Promise.all([
          db.prepare('SELECT city FROM hotels WHERE id = ?').get(id),
          db.prepare('SELECT travel_style FROM user_preferences WHERE user_id = ?').get(userId),
        ]);
        const contextKey = tripContextKey({ ...context, destination: context.destination || hotel?.city }, preferences || {});
        await db.prepare(`INSERT INTO user_hotel_feedback (id, user_id, hotel_id, context_key, reason, metadata) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (user_id, hotel_id, context_key) DO UPDATE SET reason = EXCLUDED.reason, metadata = EXCLUDED.metadata, updated_at = CURRENT_TIMESTAMP`)
          .run(uuidv4(), userId, id, contextKey, context.feedback_reason, JSON.stringify(context));
      }
      await learnFromInteraction(userId, id, signal, context);
    }
    await db.prepare(`
      UPDATE user_preference_weights
      SET interaction_count = interaction_count + ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `).run(meaningfulRecorded, userId);
    res.status(201).json({ recorded });
  } catch (error) {
    console.error('Interaction tracking error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
