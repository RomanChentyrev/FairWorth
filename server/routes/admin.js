const express = require('express');
const { db } = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { syncCatalog } = require('../services/hotelCatalog');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
router.use(requireAuth, requireAdmin);

async function recordAdminAction(req, action, entityType, entityId, details = {}) {
  await db.prepare(`INSERT INTO admin_audit_logs (id, actor_user_id, actor_email, action, entity_type, entity_id, details, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(uuidv4(), req.user.id, req.user.email, action, entityType || null, entityId || null, JSON.stringify(details), req.ip || null, req.get('user-agent') || null);
}

router.get('/anomalies', async (req, res) => {
  const status = req.query.status === 'resolved' ? 'resolved' : 'open';
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 250);
  const price = await db.prepare(`SELECT pa.*, h.name AS hotel_name, h.city FROM price_anomalies pa LEFT JOIN hotels h ON h.id = pa.hotel_id WHERE pa.status = ? ORDER BY CASE pa.severity WHEN 'critical' THEN 0 ELSE 1 END, pa.created_at DESC LIMIT ?`).all(status, limit);
  const score = await db.prepare(`SELECT sa.*, h.name AS hotel_name, u.email AS user_email FROM score_anomalies sa LEFT JOIN hotels h ON h.id = sa.hotel_id LEFT JOIN users u ON u.id = sa.user_id WHERE sa.status = ? ORDER BY ABS(sa.delta) DESC, sa.created_at DESC LIMIT ?`).all(status, limit);
  const stale = await db.prepare(`SELECT hp.id AS price_id, hp.hotel_id, h.name AS hotel_name, hp.operator AS provider, hp.price_per_night, hp.currency, hp.updated_at FROM hotel_prices hp JOIN hotels h ON h.id = hp.hotel_id WHERE hp.source = 'xotelo' AND hp.updated_at < CURRENT_TIMESTAMP - INTERVAL '12 hours' ORDER BY hp.updated_at ASC LIMIT ?`).all(limit);
  res.json({ price_anomalies: price, score_anomalies: score, stale_prices: stale, totals: { price: price.length, score: score.length, stale: stale.length } });
});

router.patch('/anomalies/:type/:id/resolve', async (req, res) => {
  const table = req.params.type === 'price' ? 'price_anomalies' : req.params.type === 'score' ? 'score_anomalies' : null;
  if (!table) return res.status(400).json({ error: 'Unknown anomaly type' });
  const result = await db.prepare(`UPDATE ${table} SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP, resolved_by = ? WHERE id = ? AND status = 'open'`).run(req.user.id, req.params.id);
  if (!result.rowCount) return res.status(404).json({ error: 'Open anomaly not found' });
  await recordAdminAction(req, 'anomaly.resolve', req.params.type, req.params.id);
  return res.json({ resolved: true });
});

router.post('/catalog/sync', async (req, res) => {
  try {
    const { city, iata_code, limit } = req.body || {};
    if (!city && !iata_code) return res.status(400).json({ error: 'city or iata_code is required' });
    const result = await syncCatalog({ city, iataCode: iata_code, limit });
    await recordAdminAction(req, 'catalog.sync', 'hotel_catalog', result?.id || result?.sync_id || null, { city: city || null, iata_code: iata_code || null, requested_limit: limit || null });
    return res.json(result);
  } catch (error) { return res.status(502).json({ error: error.message }); }
});

router.get('/catalog/syncs', async (req, res) => {
  const rows = await db.prepare(`SELECT * FROM hotel_catalog_syncs ORDER BY started_at DESC LIMIT 100`).all();
  res.json({ syncs: rows });
});

router.get('/catalog/mapping-reviews', async (req, res) => {
  const rows = await db.prepare(`SELECT r.*, h.name AS imported_name, c.name AS candidate_name FROM hotel_mapping_reviews r JOIN hotels h ON h.id = r.hotel_id LEFT JOIN hotels c ON c.id = r.candidate_hotel_id WHERE r.status = ? ORDER BY r.created_at DESC`).all(req.query.status || 'open');
  res.json({ reviews: rows });
});

router.patch('/catalog/mapping-reviews/:id', async (req, res) => {
  const status = req.body.status;
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'status must be approved or rejected' });
  const review = await db.prepare(`SELECT * FROM hotel_mapping_reviews WHERE id = ? AND status = 'open'`).get(req.params.id);
  if (!review) return res.status(404).json({ error: 'Open review not found' });
  if (status === 'approved' && review.candidate_hotel_id) {
    await db.transaction(async () => {
      await db.prepare(`DELETE FROM hotel_provider_mappings WHERE hotel_id = ? AND provider = ?`).run(review.candidate_hotel_id, review.provider);
      await db.prepare(`UPDATE hotel_provider_mappings SET hotel_id = ?, verified = 1, match_method = 'admin', updated_at = CURRENT_TIMESTAMP WHERE provider = ? AND provider_hotel_id = ?`).run(review.candidate_hotel_id, review.provider, review.provider_hotel_id);
      await db.prepare(`UPDATE hotel_prices SET hotel_id = ? WHERE hotel_id = ?`).run(review.candidate_hotel_id, review.hotel_id);
      await db.prepare(`UPDATE hotels SET active = 0 WHERE id = ?`).run(review.hotel_id);
    });
  }
  await db.prepare(`UPDATE hotel_mapping_reviews SET status = ?, resolved_at = CURRENT_TIMESTAMP, resolved_by = ? WHERE id = ?`).run(status, req.user.id, review.id);
  await recordAdminAction(req, 'mapping_review.resolve', 'hotel_mapping_review', review.id, { status, provider: review.provider, provider_hotel_id: review.provider_hotel_id });
  return res.json({ status });
});

router.get('/audit-log', async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 250);
  const rows = await db.prepare(`SELECT id, actor_user_id, actor_email, action, entity_type, entity_id, details, ip_address, user_agent, created_at FROM admin_audit_logs ORDER BY created_at DESC LIMIT ?`).all(limit);
  res.json({ audit_log: rows });
});

module.exports = router;
