const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db/database');
const { validate } = require('../middleware/validate');
const { travelVisitSchema } = require('../config/apiSchemas');

const router = express.Router();

function serializeVisit(visit) {
  return {
    ...visit,
    latitude: visit.latitude == null ? null : Number(visit.latitude),
    longitude: visit.longitude == null ? null : Number(visit.longitude),
  };
}

router.get('/', async (req, res, next) => {
  try {
    const visits = await db.prepare(`
      SELECT id, country_code, country_name, city_name, latitude, longitude, visited_at, created_at
      FROM user_travel_visits
      WHERE user_id = ?
      ORDER BY country_name, city_name NULLS FIRST, created_at
    `).all(req.user.id);
    const countries = new Set(visits.map(visit => visit.country_code));
    const cities = visits.filter(visit => visit.city_name);
    res.json({
      visits: visits.map(serializeVisit),
      stats: { countries: countries.size, cities: cities.length },
    });
  } catch (error) { next(error); }
});

router.post('/visits', validate(travelVisitSchema), async (req, res, next) => {
  try {
    const { country_code: countryCode, country_name: countryName, city_name: cityName = null,
      latitude = null, longitude = null, visited_at: visitedAt = null } = req.body;
    const existing = await db.prepare(`
      SELECT id FROM user_travel_visits
      WHERE user_id = ? AND country_code = ? AND COALESCE(LOWER(city_name), '') = COALESCE(LOWER(?), '')
    `).get(req.user.id, countryCode, cityName);
    if (existing) return res.status(409).json({ error: 'This place is already on your map', code: 'VISIT_EXISTS', visit_id: existing.id });

    const id = uuidv4();
    await db.prepare(`
      INSERT INTO user_travel_visits
        (id, user_id, country_code, country_name, city_name, latitude, longitude, visited_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.user.id, countryCode, countryName, cityName, latitude, longitude, visitedAt);
    const visit = await db.prepare(`
      SELECT id, country_code, country_name, city_name, latitude, longitude, visited_at, created_at
      FROM user_travel_visits WHERE id = ? AND user_id = ?
    `).get(id, req.user.id);
    res.status(201).json({ visit: serializeVisit(visit) });
  } catch (error) { next(error); }
});

router.delete('/visits/:id', async (req, res, next) => {
  try {
    const result = await db.prepare('DELETE FROM user_travel_visits WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    if (!result.rowCount) return res.status(404).json({ error: 'Visit not found', code: 'NOT_FOUND' });
    res.status(204).end();
  } catch (error) { next(error); }
});

module.exports = router;
