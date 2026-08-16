const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const { sendEmail } = require('../services/email');
const { accountEmail } = require('../services/emailTemplates');
const { validate } = require('../middleware/validate');
const { profileSchema, preferencesSchema } = require('../config/apiSchemas');
const { normalizeLocale, SUPPORTED_LOCALES } = require('../config/locales');
const logger = require('../services/logger');

function internalUserError(res, operation, error) {
  logger.error('user_operation_failed', { operation, user_id: res.req?.user?.id, error: error?.message || 'Unknown error' });
  return res.status(500).json({ error: 'The account service is temporarily unavailable', code: 'USER_SERVICE_ERROR' });
}

// GET /api/users/me
router.get('/me', async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await db.prepare('SELECT id, email, name, phone, city, country, bio, website, avatar, locale, onboarding_completed, behavioural_tracking_consent, created_at, updated_at FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const prefs = await db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get(userId);
    res.json({ user: { ...user, onboarding_completed: Boolean(user.onboarding_completed), behavioural_tracking_consent: Boolean(user.behavioural_tracking_consent) }, preferences: prefs });
  } catch (err) {
    return internalUserError(res, 'get_profile', err);
  }
});

router.put('/locale', async (req, res) => {
  const requested = String(req.body.locale || '');
  if (!SUPPORTED_LOCALES.has(requested)) return res.status(400).json({ error: 'Unsupported locale' });
  const locale = normalizeLocale(requested);
  await db.prepare('UPDATE users SET locale = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(locale, req.user.id);
  res.json({ locale });
});

// PUT /api/users/profile
router.put('/profile', validate(profileSchema), async (req, res) => {
  try {
    const userId = req.user.id;
    const allowed = ['name', 'phone', 'city', 'country', 'bio', 'website'];
    const fields = [];
    const values = [];
    allowed.forEach(key => {
      if (req.body[key] !== undefined) {
        const value = typeof req.body[key] === 'string' ? req.body[key].trim() : req.body[key];
        fields.push(`${key} = ?`);
        values.push(value || null);
      }
    });
    fields.push('updated_at = CURRENT_TIMESTAMP');
    await db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values, userId);
    const user = await db.prepare('SELECT id, email, name, birth_date, phone, city, country, bio, website, avatar, onboarding_completed FROM users WHERE id = ?').get(userId);
    res.json({ user: { ...user, onboarding_completed: Boolean(user.onboarding_completed) } });
  } catch (err) { return internalUserError(res, 'update_profile', err); }
});

// PUT /api/users/password
router.put('/password', async (req, res) => {
  try {
    const { current_password: currentPassword, new_password: newPassword } = req.body;
    const strongPassword = typeof newPassword === 'string' && newPassword.length >= 12 && /[a-z]/.test(newPassword) && /[A-Z]/.test(newPassword) && /\d/.test(newPassword) && /[^A-Za-z0-9]/.test(newPassword);
    if (!currentPassword || !strongPassword) return res.status(400).json({ error: 'New password must be at least 12 characters and include upper/lowercase letters, a number and a symbol' });
    const user = await db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!await bcrypt.compare(currentPassword, user?.password_hash || '')) return res.status(400).json({ error: 'Current password is incorrect' });
    const hash = await bcrypt.hash(newPassword, 10);
    await db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(hash, req.user.id);
    await db.prepare('UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND id != ? AND revoked_at IS NULL').run(req.user.id, req.user.sessionId);
    const recipient = await db.prepare('SELECT email, name, locale FROM users WHERE id = ?').get(req.user.id);
    await sendEmail({ to: recipient.email, ...accountEmail({ name: recipient.name, event: 'password_changed', locale: recipient.locale }) }).catch(() => null);
    res.json({ changed: true });
  } catch (err) { return internalUserError(res, 'change_password', err); }
});

router.get('/sessions', async (req, res) => {
  const sessions = await db.prepare(`SELECT id, user_agent, ip_address, created_at, last_seen_at FROM user_sessions WHERE user_id = ? AND revoked_at IS NULL ORDER BY last_seen_at DESC`).all(req.user.id);
  res.json({ sessions: sessions.map(session => ({ ...session, current: session.id === req.user.sessionId })) });
});

router.get('/stats', async (req, res) => {
  const userId = req.user.id;
  const count = async (table, extra = '') => Number((await db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE user_id = ? ${extra}`).get(userId)).count);
  const user = await db.prepare('SELECT created_at FROM users WHERE id = ?').get(userId);
  res.json({
    searches: await count('searches'),
    saved: await count('bookmarks'),
    comparisons: await count('compare_sessions'),
    booking_intents: await count('user_interactions', `AND event_type = 'booking_intent'`),
    member_since: user?.created_at,
  });
});

router.delete('/sessions/:id', async (req, res) => {
  if (req.params.id === req.user.sessionId) return res.status(400).json({ error: 'Use logout to end the current session' });
  await db.prepare('UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.status(204).end();
});

router.delete('/me', async (req, res) => {
  try {
    const { password } = req.body;
    const user = await db.prepare('SELECT password_hash, email, name, locale FROM users WHERE id = ?').get(req.user.id);
    if (!password || !await bcrypt.compare(password, user?.password_hash || '')) return res.status(400).json({ error: 'Password is incorrect' });
    await db.transaction(async () => {
      await db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
    });
    await sendEmail({ to: user.email, ...accountEmail({ name: user.name, event: 'account_deleted', locale: user.locale }) }).catch(() => null);
    res.status(204).end();
  } catch (err) {
    return internalUserError(res, 'delete_account', err);
  }
});

router.get('/export', async (req, res) => {
  const userId = req.user.id;
  const exportQueries = {
    user_preferences: `SELECT hotel_stars, room_type, room_view, hotel_amenities, required_hotel_amenities, flight_type, seat_class, seat_position, preferred_airlines, max_stops, travel_style, budget_level, budget_per_night_max, noise_sensitivity, favorite_destinations, avoid_destinations, search_history, booking_history, ai_profile, alert_price_drop, alert_price_rise, alert_booking_reminder, alert_weekly_insights, alert_destination_deals, created_at, updated_at FROM user_preferences WHERE user_id = ?`,
    user_preference_weights: `SELECT score_weights, declared_weights, learned_weights, learning_confidence, interaction_count, updated_at FROM user_preference_weights WHERE user_id = ?`,
    contextual_preference_weights: `SELECT context_type, context_value, learned_weights, evidence_strength, interaction_count, updated_at FROM user_context_preference_weights WHERE user_id = ? ORDER BY context_type, context_value`,
    hotel_feedback: `SELECT hotel_id, context_key, reason, metadata, created_at, updated_at FROM user_hotel_feedback WHERE user_id = ? ORDER BY created_at`,
    user_interactions: `SELECT hotel_id, event_type, signal, context, session_id, created_at FROM user_interactions WHERE user_id = ? ORDER BY created_at`,
    searches: `SELECT destination, check_in, check_out, guests, filters, result_count, search_kind, created_at FROM searches WHERE user_id = ? ORDER BY created_at`,
    compare_sessions: `SELECT hotel_ids, ai_verdict, created_at FROM compare_sessions WHERE user_id = ? ORDER BY created_at`,
    bookmarks: `SELECT hotel_id, created_at FROM bookmarks WHERE user_id = ? ORDER BY created_at`,
    user_sessions: `SELECT id, user_agent, ip_address, created_at, last_seen_at, revoked_at FROM user_sessions WHERE user_id = ? ORDER BY created_at`,
    provider_clicks: `SELECT click_id, hotel_id, provider, destination_url, status, clicked_at, completed_at, booking_reference, amount, currency, created_at FROM provider_clicks WHERE user_id = ? ORDER BY created_at`,
    price_watches: `SELECT hotel_id, check_in, check_out, guests, currency, baseline_price, last_price, last_notified_price, lowest_price, target_price, notify_on_drop, notify_on_rise, active, last_checked_at, next_check_at, created_at, updated_at FROM price_watches WHERE user_id = ? ORDER BY created_at`,
    trips: `SELECT title, destination, start_date, end_date, status, reminder_enabled, created_at, updated_at FROM trips WHERE user_id = ? ORDER BY created_at`,
    notification_jobs: `SELECT channel, type, status, scheduled_at, sent_at, failed_at, created_at FROM notification_jobs WHERE user_id = ? ORDER BY created_at`,
    travel_visits: `SELECT country_code, country_name, city_name, latitude, longitude, visited_at, created_at FROM user_travel_visits WHERE user_id = ? ORDER BY created_at`,
    demo_bookings: `SELECT reference, status, currency, hotel_total, flights_total, grand_total, passenger_count, contact_email, itinerary, created_at FROM demo_bookings WHERE user_id = ? ORDER BY created_at`,
  };
  const data = {
    export_version: 1,
    exported_at: new Date().toISOString(),
    user: await db.prepare('SELECT id, email, name, phone, city, country, bio, website, onboarding_completed, behavioural_tracking_consent, terms_accepted_at, privacy_accepted_at, terms_version, privacy_version, created_at FROM users WHERE id = ?').get(userId),
  };
  for (const [section, sql] of Object.entries(exportQueries)) data[section] = await db.prepare(sql).all(userId);
  res.setHeader('Content-Disposition', 'attachment; filename="fairworth-data.json"');
  res.json(data);
});

router.put('/consent', async (req, res) => {
  const consent = Boolean(req.body.behavioural_tracking_consent);
  await db.prepare('UPDATE users SET behavioural_tracking_consent = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(consent ? 1 : 0, req.user.id);
  res.json({ behavioural_tracking_consent: consent });
});

// PUT /api/users/preferences
router.put('/preferences', validate(preferencesSchema), async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      hotel_stars, room_type, room_view, hotel_amenities, required_hotel_amenities,
      flight_type, seat_class, seat_position, preferred_airlines, max_stops,
      travel_style, budget_level, budget_per_night_max, noise_sensitivity,
      favorite_destinations, avoid_destinations,
      alert_price_drop, alert_price_rise, alert_booking_reminder,
      alert_weekly_insights, alert_destination_deals
    } = req.body;

    const existing = await db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get(userId);

    if (!existing) {
      await db.prepare(`
        INSERT INTO user_preferences (id, user_id, hotel_stars, room_type, room_view, hotel_amenities, required_hotel_amenities,
          flight_type, seat_class, seat_position, preferred_airlines, max_stops,
          travel_style, budget_level, budget_per_night_max, noise_sensitivity,
          favorite_destinations, avoid_destinations,
          alert_price_drop, alert_price_rise, alert_booking_reminder, alert_weekly_insights, alert_destination_deals)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        uuidv4(), userId,
        JSON.stringify(hotel_stars), JSON.stringify(room_type), JSON.stringify(room_view), JSON.stringify(hotel_amenities), JSON.stringify(required_hotel_amenities || []),
        flight_type, seat_class, seat_position, JSON.stringify(preferred_airlines), max_stops,
        JSON.stringify(travel_style), budget_level, budget_per_night_max, noise_sensitivity,
        JSON.stringify(favorite_destinations), JSON.stringify(avoid_destinations || []),
        alert_price_drop ? 1 : 0, alert_price_rise ? 1 : 0, alert_booking_reminder ? 1 : 0,
        alert_weekly_insights ? 1 : 0, alert_destination_deals ? 1 : 0
      );
    } else {
      const fields = [];
      const values = [];
      const fieldMap = {
        hotel_stars: v => JSON.stringify(v),
        room_type: v => JSON.stringify(v),
        room_view: v => JSON.stringify(v),
        hotel_amenities: v => JSON.stringify(v),
        required_hotel_amenities: v => JSON.stringify(v),
        preferred_airlines: v => JSON.stringify(v),
        travel_style: v => JSON.stringify(v),
        favorite_destinations: v => JSON.stringify(v),
        avoid_destinations: v => JSON.stringify(v),
        flight_type: v => v, seat_class: v => v, seat_position: v => v,
        budget_level: v => v, budget_per_night_max: v => v, noise_sensitivity: v => v, max_stops: v => v,
        alert_price_drop: v => v ? 1 : 0, alert_price_rise: v => v ? 1 : 0,
        alert_booking_reminder: v => v ? 1 : 0, alert_weekly_insights: v => v ? 1 : 0,
        alert_destination_deals: v => v ? 1 : 0,
      };

      Object.entries(req.body).forEach(([key, val]) => {
        if (fieldMap[key] !== undefined) {
          fields.push(`${key} = ?`);
          values.push(fieldMap[key](val));
        }
      });

      if (fields.length > 0) {
        fields.push('updated_at = CURRENT_TIMESTAMP');
        await db.prepare(`UPDATE user_preferences SET ${fields.join(', ')} WHERE user_id = ?`).run(...values, userId);
      }
    }

    const updated = await db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get(userId);
    const consent = await db.prepare('SELECT behavioural_tracking_consent FROM users WHERE id = ?').get(userId);
    if (consent?.behavioural_tracking_consent) {
      await db.prepare(`INSERT INTO user_interactions (id, user_id, event_type, signal, context) VALUES (?, ?, 'preference_changed', 1, ?)`)
        .run(uuidv4(), userId, JSON.stringify({ fields: Object.keys(req.body) }));
    }
    res.json({ preferences: updated, message: 'Preferences saved successfully' });
  } catch (err) {
    return internalUserError(res, 'update_preferences', err);
  }
});

// GET /api/users/bookmarks
router.get('/bookmarks', async (req, res) => {
  try {
    const userId = req.user.id;
    const bookmarks = await db.prepare(`
      SELECT h.*, b.created_at as bookmarked_at
      FROM bookmarks b
      JOIN hotels h ON h.id = b.hotel_id
      WHERE b.user_id = ?
      ORDER BY b.created_at DESC
    `).all(userId);
    res.json({ bookmarks });
  } catch (err) {
    return internalUserError(res, 'get_bookmarks', err);
  }
});

// POST /api/users/bookmarks/:hotelId
router.post('/bookmarks/:hotelId', async (req, res) => {
  try {
    const userId = req.user.id;
    const { hotelId } = req.params;
    const existing = await db.prepare('SELECT * FROM bookmarks WHERE user_id = ? AND hotel_id = ?').get(userId, hotelId);
    if (existing) {
      await db.prepare('DELETE FROM bookmarks WHERE user_id = ? AND hotel_id = ?').run(userId, hotelId);
      return res.json({ bookmarked: false });
    }
    await db.prepare('INSERT INTO bookmarks (id, user_id, hotel_id) VALUES (?, ?, ?)').run(uuidv4(), userId, hotelId);
    res.json({ bookmarked: true });
  } catch (err) {
    return internalUserError(res, 'toggle_bookmark', err);
  }
});

// GET /api/users/searches
router.get('/searches', async (req, res) => {
  try {
    const userId = req.user.id;
    const searches = await db.prepare(`
      SELECT * FROM searches WHERE user_id = ? ORDER BY created_at DESC LIMIT 20
    `).all(userId);
    res.json({ searches });
  } catch (err) {
    return internalUserError(res, 'get_searches', err);
  }
});

// POST /api/users/onboarding/complete
router.post('/onboarding/complete', async (req, res) => {
  try {
    const userId = req.user.id;
    const prefs = await db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get(userId);
    if (!prefs) return res.status(400).json({ error: 'Save your preferences first' });
    const stars = (() => { try { return JSON.parse(prefs.hotel_stars || '[]'); } catch { return []; } })();
    const amenities = (() => { try { return JSON.parse(prefs.hotel_amenities || '[]'); } catch { return []; } })();
    const requiredAmenities = (() => { try { return JSON.parse(prefs.required_hotel_amenities || '[]'); } catch { return []; } })();
    if (!stars.length || (!amenities.length && !requiredAmenities.length) || !prefs.budget_per_night_max) {
      return res.status(400).json({ error: 'Select a star rating, amenities and budget' });
    }
    await db.prepare('UPDATE users SET onboarding_completed = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
    const user = await db.prepare(`
      SELECT id, email, name, phone, city, country, bio, website, avatar,
             onboarding_completed, email_verified, role, behavioural_tracking_consent
      FROM users WHERE id = ?
    `).get(userId);
    res.json({ user: {
      ...user,
      onboarding_completed: Boolean(user.onboarding_completed),
      email_verified: Boolean(user.email_verified),
      behavioural_tracking_consent: Boolean(user.behavioural_tracking_consent),
    } });
  } catch (err) {
    return internalUserError(res, 'complete_onboarding', err);
  }
});

module.exports = router;
module.exports.internalUserError = internalUserError;
