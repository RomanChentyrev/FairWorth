const express = require('express');
const router = express.Router();
const { db } = require('../db/database');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const { sendEmail } = require('../services/email');

// GET /api/users/me
router.get('/me', async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await db.prepare('SELECT id, email, name, phone, city, country, bio, website, avatar, onboarding_completed, behavioural_tracking_consent, created_at, updated_at FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const prefs = await db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get(userId);
    res.json({ user: { ...user, onboarding_completed: Boolean(user.onboarding_completed), behavioural_tracking_consent: Boolean(user.behavioural_tracking_consent) }, preferences: prefs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/users/profile
router.put('/profile', async (req, res) => {
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
    if (req.body.name !== undefined && String(req.body.name).trim().length < 2) return res.status(400).json({ error: 'Name must contain at least 2 characters' });
    if (!fields.length) return res.status(400).json({ error: 'No profile fields supplied' });
    fields.push('updated_at = CURRENT_TIMESTAMP');
    await db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values, userId);
    const user = await db.prepare('SELECT id, email, name, birth_date, phone, city, country, bio, website, avatar, onboarding_completed FROM users WHERE id = ?').get(userId);
    res.json({ user: { ...user, onboarding_completed: Boolean(user.onboarding_completed) } });
  } catch (err) { res.status(500).json({ error: err.message }); }
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
    const recipient = await db.prepare('SELECT email, name FROM users WHERE id = ?').get(req.user.id);
    await sendEmail({ to: recipient.email, subject: 'Your Fairworth password was changed', text: `Hello ${recipient.name}, your Fairworth password was changed. Contact support immediately if this was not you.` }).catch(() => null);
    res.json({ changed: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
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
    const user = await db.prepare('SELECT password_hash, email, name FROM users WHERE id = ?').get(req.user.id);
    if (!password || !await bcrypt.compare(password, user?.password_hash || '')) return res.status(400).json({ error: 'Password is incorrect' });
    await db.transaction(async () => {
      await db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
    });
    await sendEmail({ to: user.email, subject: 'Your Fairworth account was deleted', text: `Hello ${user.name}, your Fairworth account and associated personal data were deleted.` }).catch(() => null);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/export', async (req, res) => {
  const userId = req.user.id;
  const tables = ['user_preferences', 'user_preference_weights', 'user_interactions', 'searches', 'compare_sessions', 'bookmarks', 'user_sessions', 'provider_clicks'];
  const data = { exported_at: new Date().toISOString(), user: await db.prepare('SELECT id, email, name, phone, city, country, bio, website, onboarding_completed, behavioural_tracking_consent, created_at FROM users WHERE id = ?').get(userId) };
  for (const table of tables) data[table] = await db.prepare(`SELECT * FROM ${table} WHERE user_id = ?`).all(userId);
  res.setHeader('Content-Disposition', 'attachment; filename="fairworth-data.json"');
  res.json(data);
});

router.put('/consent', async (req, res) => {
  const consent = Boolean(req.body.behavioural_tracking_consent);
  await db.prepare('UPDATE users SET behavioural_tracking_consent = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(consent ? 1 : 0, req.user.id);
  res.json({ behavioural_tracking_consent: consent });
});

// PUT /api/users/preferences
router.put('/preferences', async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      hotel_stars, room_type, room_view, hotel_amenities,
      flight_type, seat_class, seat_position, preferred_airlines, max_stops,
      travel_style, budget_level, budget_per_night_max, noise_sensitivity,
      favorite_destinations, avoid_destinations,
      alert_price_drop, alert_price_rise, alert_booking_reminder,
      alert_weekly_insights, alert_destination_deals
    } = req.body;

    const existing = await db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get(userId);

    if (!existing) {
      await db.prepare(`
        INSERT INTO user_preferences (id, user_id, hotel_stars, room_type, room_view, hotel_amenities,
          flight_type, seat_class, seat_position, preferred_airlines, max_stops,
          travel_style, budget_level, budget_per_night_max, noise_sensitivity,
          favorite_destinations, avoid_destinations,
          alert_price_drop, alert_price_rise, alert_booking_reminder, alert_weekly_insights, alert_destination_deals)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        uuidv4(), userId,
        JSON.stringify(hotel_stars), JSON.stringify(room_type), JSON.stringify(room_view), JSON.stringify(hotel_amenities),
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
    console.error(err);
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users/onboarding/complete
router.post('/onboarding/complete', async (req, res) => {
  try {
    const userId = req.user.id;
    const prefs = await db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get(userId);
    if (!prefs) return res.status(400).json({ error: 'Сначала сохраните предпочтения' });
    const stars = (() => { try { return JSON.parse(prefs.hotel_stars || '[]'); } catch { return []; } })();
    const amenities = (() => { try { return JSON.parse(prefs.hotel_amenities || '[]'); } catch { return []; } })();
    if (!stars.length || !amenities.length || !prefs.budget_per_night_max) {
      return res.status(400).json({ error: 'Выберите звёздность, удобства и бюджет' });
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
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
