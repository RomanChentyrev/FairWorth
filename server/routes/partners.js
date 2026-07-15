const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { partnerClickSchema, partnerPostbackSchema } = require('../config/apiSchemas');

const router = express.Router();
const frontendUrl = () => process.env.FRONTEND_URL || 'http://localhost:5173';

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''), 'hex'); const right = Buffer.from(String(b || ''), 'hex');
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}
function buildDeepLink(destination, clickId) {
  const returnUrl = `${frontendUrl()}/booking/return?click_id=${encodeURIComponent(clickId)}`;
  const template = process.env.PARTNER_DEEP_LINK_TEMPLATE;
  if (template) return template.replaceAll('{url}', encodeURIComponent(destination)).replaceAll('{click_id}', encodeURIComponent(clickId)).replaceAll('{return_url}', encodeURIComponent(returnUrl));
  const url = new URL(destination); url.searchParams.set('sub_id', clickId); url.searchParams.set('return_url', returnUrl); return url.toString();
}

router.post('/clicks', requireAuth, validate(partnerClickSchema), async (req, res) => {
  try {
    const destination = new URL(String(req.body.destination_url || ''));
    if (!['http:', 'https:'].includes(destination.protocol)) throw new Error('Unsupported destination URL');
    const allowed = String(process.env.PARTNER_ALLOWED_HOSTS || '').split(',').map(v => v.trim()).filter(Boolean);
    if (allowed.length && !allowed.some(host => destination.hostname === host || destination.hostname.endsWith(`.${host}`))) return res.status(400).json({ error: 'Provider destination is not allowed' });
    const clickId = crypto.randomBytes(18).toString('base64url');
    const deepLink = buildDeepLink(destination.toString(), clickId);
    await db.prepare(`INSERT INTO provider_clicks (id, click_id, user_id, hotel_id, provider, destination_url, deep_link_url, amount, currency, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(uuidv4(), clickId, req.user.id, req.body.hotel_id || null, String(req.body.provider || destination.hostname), destination.toString(), deepLink, Number(req.body.amount) || null, req.body.currency || null, JSON.stringify(req.body.metadata || {}));
    const consent = await db.prepare('SELECT behavioural_tracking_consent FROM users WHERE id = ?').get(req.user.id);
    if (consent?.behavioural_tracking_consent) await db.prepare(`INSERT INTO user_interactions (id, user_id, hotel_id, event_type, signal, context, event_id) VALUES (?, ?, ?, 'provider_click', 4, ?, ?)`)
      .run(uuidv4(), req.user.id, req.body.hotel_id || null, JSON.stringify({ provider: req.body.provider, click_id: clickId }), `provider-click:${clickId}`);
    res.status(201).json({ click_id: clickId, redirect_url: `/api/partners/redirect/${clickId}`, return_url: `${frontendUrl()}/booking/return?click_id=${clickId}` });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

router.get('/redirect/:clickId', async (req, res) => {
  const click = await db.prepare('SELECT * FROM provider_clicks WHERE click_id = ?').get(req.params.clickId);
  if (!click) return res.status(404).send('Unknown partner click');
  await db.prepare(`UPDATE provider_clicks SET status = CASE WHEN status = 'created' THEN 'redirected' ELSE status END, clicked_at = COALESCE(clicked_at, CURRENT_TIMESTAMP) WHERE id = ?`).run(click.id);
  return res.redirect(302, click.deep_link_url || click.destination_url);
});

router.get('/clicks/:clickId', requireAuth, async (req, res) => {
  const click = await db.prepare('SELECT click_id, provider, status, booking_reference, amount, currency, created_at, clicked_at, completed_at FROM provider_clicks WHERE click_id = ? AND user_id = ?').get(req.params.clickId, req.user.id);
  if (!click) return res.status(404).json({ error: 'Partner click not found' });
  return res.json({ click });
});

router.post('/postback/:provider', validate(partnerPostbackSchema), async (req, res) => {
  const secret = process.env.PARTNER_POSTBACK_SECRET;
  if (!secret) return res.status(503).json({ error: 'Partner postback is not configured' });
  const expected = crypto.createHmac('sha256', secret).update(stableJson(req.body)).digest('hex');
  const valid = safeEqual(req.get('x-fairworth-signature'), expected);
  if (!valid) return res.status(401).json({ error: 'Invalid postback signature' });
  const { event_id: eventId, click_id: clickId, event_type: eventType, booking_reference: bookingReference, amount, currency } = req.body;
  const duplicate = await db.prepare('SELECT id FROM partner_postbacks WHERE provider = ? AND event_id = ?').get(req.params.provider, eventId);
  if (duplicate) return res.json({ accepted: true, duplicate: true });
  const click = await db.prepare('SELECT * FROM provider_clicks WHERE click_id = ?').get(clickId);
  if (!click) return res.status(404).json({ error: 'Unknown click_id' });
  await db.transaction(async () => {
    await db.prepare(`INSERT INTO partner_postbacks (id, provider, event_id, click_id, event_type, payload, signature_valid) VALUES (?, ?, ?, ?, ?, ?, 1) ON CONFLICT (provider, event_id) DO NOTHING`)
      .run(uuidv4(), req.params.provider, eventId, clickId, eventType, JSON.stringify(req.body));
    await db.prepare(`UPDATE provider_clicks SET status = 'booking_completed', completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP), booking_reference = COALESCE(?, booking_reference), amount = COALESCE(?, amount), currency = COALESCE(?, currency) WHERE id = ?`)
      .run(bookingReference || null, Number(amount) || null, currency || null, click.id);
    const consent = click.user_id ? await db.prepare('SELECT behavioural_tracking_consent FROM users WHERE id = ?').get(click.user_id) : null;
    if (consent?.behavioural_tracking_consent) await db.prepare(`INSERT INTO user_interactions (id, user_id, hotel_id, event_type, signal, context, event_id) VALUES (?, ?, ?, 'booking_completed', 10, ?, ?) ON CONFLICT (event_id) WHERE event_id IS NOT NULL DO NOTHING`)
      .run(uuidv4(), click.user_id, click.hotel_id, JSON.stringify({ provider: req.params.provider, booking_reference: bookingReference, amount, currency }), `postback:${req.params.provider}:${eventId}`);
  });
  return res.json({ accepted: true });
});

module.exports = router;
