const express = require('express');
const { normalizeLocale } = require('../config/locales');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db/database');
const { requireCapability } = require('../config/capabilities');
const { validate } = require('../middleware/validate');
const { tripCreateSchema, tripUpdateSchema } = require('../config/apiSchemas');
const router = express.Router();

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
function validStay(checkIn, checkOut) {
  return datePattern.test(checkIn) && datePattern.test(checkOut) && checkIn >= new Date().toISOString().slice(0, 10) && checkOut > checkIn;
}

router.get('/watches', async (req, res) => {
  const watches = await db.prepare(`SELECT pw.*, h.name AS hotel_name, h.city FROM price_watches pw JOIN hotels h ON h.id = pw.hotel_id WHERE pw.user_id = ? ORDER BY pw.active DESC, pw.created_at DESC`).all(req.user.id);
  res.json({ watches: watches.map(row => ({ ...row, active: Boolean(row.active), notify_on_drop: Boolean(row.notify_on_drop), notify_on_rise: Boolean(row.notify_on_rise) })) });
});

router.post('/watches', requireCapability('hotels'), async (req, res) => {
  const hotelId = String(req.body.hotel_id || ''); const checkIn = String(req.body.check_in || ''); const checkOut = String(req.body.check_out || '');
  const guests = Math.max(1, Math.min(20, Number(req.body.guests || 2))); const currency = String(req.body.currency || 'USD').toUpperCase().slice(0, 3);
  if (!validStay(checkIn, checkOut)) return res.status(400).json({ error: 'Choose valid future check-in and check-out dates' });
  const hotel = await db.prepare(`SELECT id FROM hotels WHERE id = ?`).get(hotelId);
  if (!hotel) return res.status(404).json({ error: 'Hotel not found' });
  const current = await db.prepare(`SELECT price_per_night FROM hotel_prices WHERE hotel_id = ? AND check_in = ? AND check_out = ? AND price_valid = 1 AND currency = ? ORDER BY price_per_night LIMIT 1`).get(hotelId, checkIn, checkOut, currency);
  const id = uuidv4(); const price = Number(current?.price_per_night || 0) || null; const target = Number(req.body.target_price || 0) || null;
  const watch = await db.prepare(`INSERT INTO price_watches (id, user_id, hotel_id, check_in, check_out, guests, currency, baseline_price, last_price, lowest_price, target_price, notify_on_drop, notify_on_rise) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (user_id, hotel_id, check_in, check_out, guests, currency) DO UPDATE SET active = 1, target_price = EXCLUDED.target_price, notify_on_drop = EXCLUDED.notify_on_drop, notify_on_rise = EXCLUDED.notify_on_rise, next_check_at = NOW(), updated_at = NOW() RETURNING *`)
    .get(id, req.user.id, hotelId, checkIn, checkOut, guests, currency, price, price, price, target, req.body.notify_on_drop === false ? 0 : 1, req.body.notify_on_rise === false ? 0 : 1);
  res.status(201).json({ watch: { ...watch, active: Boolean(watch.active) } });
});

router.patch('/watches/:id', async (req, res) => {
  const target = req.body.target_price === null || req.body.target_price === '' ? null : Number(req.body.target_price);
  const watch = await db.prepare(`UPDATE price_watches SET active = COALESCE(?, active), target_price = ?, notify_on_drop = COALESCE(?, notify_on_drop), notify_on_rise = COALESCE(?, notify_on_rise), next_check_at = CASE WHEN ? = 1 THEN NOW() ELSE next_check_at END, updated_at = NOW() WHERE id = ? AND user_id = ? RETURNING *`)
    .get(req.body.active === undefined ? null : req.body.active ? 1 : 0, target, req.body.notify_on_drop === undefined ? null : req.body.notify_on_drop ? 1 : 0, req.body.notify_on_rise === undefined ? null : req.body.notify_on_rise ? 1 : 0, req.body.active ? 1 : 0, req.params.id, req.user.id);
  if (!watch) return res.status(404).json({ error: 'Price watch not found' });
  res.json({ watch });
});

router.delete('/watches/:id', async (req, res) => {
  const result = await db.prepare(`DELETE FROM price_watches WHERE id = ? AND user_id = ?`).run(req.params.id, req.user.id);
  if (!result.rowCount) return res.status(404).json({ error: 'Price watch not found' });
  res.status(204).end();
});

router.get('/settings', async (req, res) => {
  const settings = await db.prepare(`SELECT locale, timezone, digest_weekday, digest_hour FROM users WHERE id = ?`).get(req.user.id);
  res.json({ settings });
});

router.put('/settings', async (req, res) => {
  const timezone = String(req.body.timezone || 'UTC');
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(); } catch { return res.status(400).json({ error: 'Unknown timezone' }); }
  const weekday = Math.max(0, Math.min(6, Number(req.body.digest_weekday ?? 1))); const hour = Math.max(0, Math.min(23, Number(req.body.digest_hour ?? 9)));
  const locale = normalizeLocale(req.body.locale);
  const settings = await db.prepare(`UPDATE users SET locale = ?, timezone = ?, digest_weekday = ?, digest_hour = ?, updated_at = NOW() WHERE id = ? RETURNING locale, timezone, digest_weekday, digest_hour`).get(locale, timezone, weekday, hour, req.user.id);
  res.json({ settings });
});

router.get('/trips', async (req, res) => {
  const trips = await db.prepare(`SELECT * FROM trips WHERE user_id = ? ORDER BY start_date`).all(req.user.id);
  res.json({ trips });
});

router.post('/trips', validate(tripCreateSchema), async (req, res) => {
  const startDate = String(req.body.start_date || ''); const endDate = req.body.end_date ? String(req.body.end_date) : null;
  if (!datePattern.test(startDate) || startDate < new Date().toISOString().slice(0, 10) || (endDate && endDate < startDate)) return res.status(400).json({ error: 'Choose valid trip dates' });
  const trip = await db.prepare(`INSERT INTO trips (id, user_id, title, destination, start_date, end_date, reminder_enabled) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`).get(uuidv4(), req.user.id, String(req.body.title || req.body.destination || 'Trip').slice(0, 120), String(req.body.destination || '').slice(0, 160) || null, startDate, endDate, req.body.reminder_enabled === false ? 0 : 1);
  for (const item of req.body.items) await db.prepare(`INSERT INTO trip_items (id, trip_id, type, provider, external_id, booking_status, departure_at, check_in_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(uuidv4(), trip.id, item.type, item.provider || null, item.external_id || null, item.booking_status || 'planned', item.departure_at || null, item.check_in_at || null, JSON.stringify(item.metadata));
  res.status(201).json({ trip });
});

router.patch('/trips/:id', validate(tripUpdateSchema), async (req, res) => {
  const trip = await db.prepare(`UPDATE trips SET reminder_enabled = COALESCE(?, reminder_enabled), status = COALESCE(?, status), updated_at = NOW() WHERE id = ? AND user_id = ? RETURNING *`).get(req.body.reminder_enabled === undefined ? null : req.body.reminder_enabled ? 1 : 0, req.body.status || null, req.params.id, req.user.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  res.json({ trip });
});

module.exports = router;
