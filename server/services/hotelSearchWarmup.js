const { db } = require('../db/database');
const cache = require('./cache');

const POPULAR_DESTINATIONS = [
  'Singapore', 'Dubai', 'Abu Dhabi', 'Paris', 'New York', 'Moscow',
  'Beijing', 'Shanghai', 'Nha Trang', 'Da Nang', 'Kuala Lumpur',
];

function destinationKey(city) {
  return cache.cacheKey('hotel-destination-warm-v1', String(city || '').trim().toLowerCase());
}

async function warmDestination(city) {
  const pattern = `%${city.toLowerCase()}%`;
  const [rows, locations] = await Promise.all([
    db.prepare(`
      SELECT h.id
      FROM hotels h
      LEFT JOIN hotel_reviews hr ON hr.hotel_id = h.id
      WHERE h.active = 1 AND (LOWER(h.city) LIKE ? OR LOWER(h.country) LIKE ?)
      ORDER BY hr.rating DESC NULLS LAST, hr.count DESC NULLS LAST, h.stars DESC NULLS LAST
      LIMIT 300
    `).all(pattern, pattern),
    db.prepare(`
      SELECT DISTINCT location FROM hotels
      WHERE active = 1 AND (LOWER(city) LIKE ? OR LOWER(country) LIKE ?)
      ORDER BY location
    `).all(pattern, pattern),
  ]);
  const value = { city, hotel_ids: rows.map(row => row.id), locations: locations.map(row => row.location), warmed_at: new Date().toISOString() };
  await cache.setJson(destinationKey(city), value, Math.max(300, Number(process.env.HOTEL_DESTINATION_WARM_TTL_SECONDS || 3600)));
  return value;
}

async function warmedDestination(city) {
  return cache.getJson(destinationKey(city));
}

async function warmPopularDestinations() {
  const results = [];
  for (const city of POPULAR_DESTINATIONS) results.push(await warmDestination(city));
  return results;
}

module.exports = { POPULAR_DESTINATIONS, warmDestination, warmedDestination, warmPopularDestinations };
