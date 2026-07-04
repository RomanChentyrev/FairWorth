const { v4: uuidv4 } = require('uuid');
const { db } = require('../db/database');
const liteapi = require('./liteapi');
const travelpayouts = require('./travelpayouts');

const activeSyncs = new Map();

async function mapConcurrent(items, concurrency, worker) {
  const results = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) { const index = next; next += 1; results[index] = await worker(items[index], index); }
  }));
  return results;
}

function normalize(value = '') {
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
}

function stripHtml(value = '') {
  return String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokens(value) { return new Set(normalize(value).split(' ').filter(word => word.length > 1)); }
function similarity(left, right) {
  const a = tokens(left); const b = tokens(right);
  if (!a.size || !b.size) return 0;
  const common = [...a].filter(value => b.has(value)).length;
  return (2 * common) / (a.size + b.size);
}

function distanceKm(a, b) {
  if (![a.latitude, a.longitude, b.latitude, b.longitude].every(value => Number.isFinite(Number(value)))) return null;
  const rad = value => Number(value) * Math.PI / 180;
  const dLat = rad(b.latitude - a.latitude); const dLon = rad(b.longitude - a.longitude);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function matchConfidence(source, candidate) {
  const name = similarity(source.name, candidate.name);
  const address = similarity(source.address, candidate.address || candidate.location);
  const distance = distanceKm(source, candidate);
  const geo = distance == null ? 0 : distance <= 0.1 ? 0.25 : distance <= 0.5 ? 0.2 : distance <= 2 ? 0.1 : 0;
  const city = normalize(source.city) === normalize(candidate.city) ? 0.05 : 0;
  return Math.min(1, name * 0.65 + address * 0.1 + geo + city);
}

function normalizedAmenity(name = '') {
  const value = normalize(name);
  const rules = [
    [/wifi|internet/, 'wifi'], [/pool|swimming/, 'pool'], [/spa|massage|sauna/, 'spa'],
    [/fitness|gym/, 'gym'], [/breakfast/, 'breakfast'], [/restaurant/, 'restaurant'],
    [/bar|lounge/, 'bar'], [/beach/, 'beach'], [/parking/, 'parking'], [/concierge/, 'concierge'],
    [/airport.*shuttle|shuttle.*airport/, 'airport_shuttle'],
  ];
  return rules.find(([pattern]) => pattern.test(value))?.[1] || value.replace(/ /g, '_').slice(0, 80);
}

async function resolveIata(city) {
  const query = normalize(city);
  if (/^[a-z]{3}$/.test(query)) return query.toUpperCase();
  const cities = await travelpayouts.getCities();
  const list = Array.isArray(cities) ? cities : Object.values(cities || {});
  const exact = list.find(item => [item.name, item.city_name, item.name_translations?.en, item.name_translations?.ru]
    .some(value => normalize(value) === query));
  if (exact?.code) return exact.code;
  const partial = list.find(item => [item.name, item.city_name, item.name_translations?.en, item.name_translations?.ru]
    .some(value => normalize(value).includes(query) || query.includes(normalize(value))));
  return partial?.code || null;
}

async function findCandidate(source) {
  const rows = await db.prepare(`SELECT h.* FROM hotels h WHERE h.active = 1 AND NOT EXISTS (SELECT 1 FROM hotel_provider_mappings m WHERE m.hotel_id = h.id AND m.provider = 'liteapi') AND (LOWER(h.city) = LOWER(?) OR (h.latitude BETWEEN ? AND ? AND h.longitude BETWEEN ? AND ?)) LIMIT 100`)
    .all(source.city || '', Number(source.latitude || 0) - 0.05, Number(source.latitude || 0) + 0.05, Number(source.longitude || 0) - 0.05, Number(source.longitude || 0) + 0.05);
  return rows.map(row => ({ row, confidence: matchConfidence(source, row) })).sort((a, b) => b.confidence - a.confidence)[0] || null;
}

async function upsertHotel(source, facilities, iataCode, claimedHotelIds = new Set()) {
  const mapped = await db.prepare(`SELECT hotel_id FROM hotel_provider_mappings WHERE provider = 'liteapi' AND provider_hotel_id = ?`).get(source.id);
  let hotelId = mapped?.hotel_id;
  let created = false;
  let match = null;
  if (!hotelId) {
    match = await findCandidate(source);
    const canClaim = match?.confidence >= 0.92 && !claimedHotelIds.has(match.row.id);
    hotelId = canClaim ? match.row.id : uuidv4();
    created = !canClaim;
    claimedHotelIds.add(hotelId);
  }

  const names = (source.facilityIds || []).map(id => facilities.get(String(id))).filter(Boolean);
  const amenities = [...new Set(names.map(normalizedAmenity).filter(Boolean))];
  const stars = Math.max(0, Math.min(5, Math.round(Number(source.stars || 0))));
  const location = source.address || source.city || source.country || 'Unknown';
  if (created) {
    await db.prepare(`INSERT INTO hotels (id, name, location, city, country, stars, description, amenities, latitude, longitude, address, postal_code, image_url, thumbnail_url, hotel_type, chain_name, content_source, source_updated_at, active, content_raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'liteapi', CURRENT_TIMESTAMP, ?, ?)`)
      .run(hotelId, source.name, location, source.city || '', String(source.country || '').toUpperCase(), stars, stripHtml(source.hotelDescription), JSON.stringify(amenities), source.latitude, source.longitude, source.address, source.zip, source.main_photo, source.thumbnail, String(source.hotelTypeId || ''), source.chain || null, source.deletedAt ? 0 : 1, JSON.stringify(source));
  } else {
    await db.prepare(`UPDATE hotels SET name = ?, location = ?, city = ?, country = ?, stars = ?, description = ?, amenities = ?, latitude = ?, longitude = ?, address = ?, postal_code = ?, image_url = ?, thumbnail_url = ?, hotel_type = ?, chain_name = ?, content_source = 'liteapi', source_updated_at = CURRENT_TIMESTAMP, active = ?, content_raw_json = ? WHERE id = ?`)
      .run(source.name, location, source.city || '', String(source.country || '').toUpperCase(), stars, stripHtml(source.hotelDescription), JSON.stringify(amenities), source.latitude, source.longitude, source.address, source.zip, source.main_photo, source.thumbnail, String(source.hotelTypeId || ''), source.chain || null, source.deletedAt ? 0 : 1, JSON.stringify(source), hotelId);
  }

  await db.prepare(`INSERT INTO hotel_provider_mappings (id, hotel_id, provider, provider_hotel_id, match_confidence, verified, match_method, metadata) VALUES (?, ?, 'liteapi', ?, ?, ?, ?, ?) ON CONFLICT (provider, provider_hotel_id) DO UPDATE SET hotel_id = EXCLUDED.hotel_id, match_confidence = EXCLUDED.match_confidence, metadata = EXCLUDED.metadata, updated_at = CURRENT_TIMESTAMP`)
    .run(uuidv4(), hotelId, source.id, match?.confidence || 1, match?.confidence >= 0.92 ? 1 : 0, mapped ? 'provider_id' : match?.confidence >= 0.92 ? 'automatic' : 'provider_import', JSON.stringify({ iata_code: iataCode }));

  if (!mapped && match && match.confidence >= 0.7 && match.confidence < 0.92) {
    await db.prepare(`INSERT INTO hotel_mapping_reviews (id, hotel_id, candidate_hotel_id, provider, provider_hotel_id, confidence, evidence) VALUES (?, ?, ?, 'liteapi', ?, ?, ?)`)
      .run(uuidv4(), hotelId, match.row.id, source.id, match.confidence, JSON.stringify({ source_name: source.name, candidate_name: match.row.name, distance_km: distanceKm(source, match.row) }));
  }
  await db.prepare(`INSERT INTO hotel_reviews (id, hotel_id, rating, count, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT (hotel_id) DO UPDATE SET rating = EXCLUDED.rating, count = EXCLUDED.count, updated_at = CURRENT_TIMESTAMP`)
    .run(uuidv4(), hotelId, Number(source.rating || 0) > 5 ? Number(source.rating) / 2 : Number(source.rating || 0), Number(source.reviewCount || 0));
  await db.prepare(`DELETE FROM hotel_images WHERE hotel_id = ? AND provider = 'liteapi'`).run(hotelId);
  for (const [index, url] of [source.main_photo, source.thumbnail].filter(Boolean).entries()) {
    await db.prepare(`INSERT INTO hotel_images (id, hotel_id, provider, url, kind, sort_order) VALUES (?, ?, 'liteapi', ?, ?, ?) ON CONFLICT DO NOTHING`).run(uuidv4(), hotelId, url, index ? 'thumbnail' : 'main', index);
  }
  await db.prepare(`DELETE FROM hotel_amenities WHERE hotel_id = ? AND provider = 'liteapi'`).run(hotelId);
  for (const facilityId of source.facilityIds || []) {
    const name = facilities.get(String(facilityId)); if (!name) continue;
    await db.prepare(`INSERT INTO hotel_amenities (id, hotel_id, provider, provider_amenity_id, name, normalized_name) VALUES (?, ?, 'liteapi', ?, ?, ?) ON CONFLICT DO NOTHING`).run(uuidv4(), hotelId, String(facilityId), name, normalizedAmenity(name));
  }
  return { hotelId, created };
}

async function syncCatalog({ city, iataCode, limit } = {}) {
  if (!liteapi.configured()) throw new Error('LiteAPI is not configured');
  const code = iataCode || await resolveIata(city);
  if (!code) throw new Error(`Could not resolve an IATA code for ${city}`);
  const maxHotels = Math.max(1, Number(limit || process.env.CATALOG_SYNC_MAX_HOTELS || 500));
  const key = code.toUpperCase();
  if (activeSyncs.has(key)) return activeSyncs.get(key);
  const job = (async () => {
    const syncId = uuidv4();
    await db.prepare(`INSERT INTO hotel_catalog_syncs (id, provider, city, iata_code, requested_limit) VALUES (?, 'liteapi', ?, ?, ?)`).run(syncId, city || code, code, maxHotels);
    let processed = 0; let created = 0; let total = 0;
    try {
      const facilitiesData = await liteapi.getFacilities();
      const facilities = new Map(facilitiesData.map(item => [String(item.facility_id), item.facility]));
      const claimedHotelIds = new Set();
      const pageSize = 100;
      for (let offset = 0; offset < maxHotels; offset += pageSize) {
        const result = await liteapi.getHotels({ iataCode: code, offset, limit: Math.min(pageSize, maxHotels - offset) });
        const hotels = Array.isArray(result.data) ? result.data : [];
        total = Number(result.total || hotels.length);
        const savedHotels = await mapConcurrent(hotels, Math.max(1, Number(process.env.CATALOG_SYNC_CONCURRENCY || 5)), hotel => upsertHotel(hotel, facilities, code, claimedHotelIds));
        processed += savedHotels.length; created += savedHotels.filter(item => item.created).length;
        if (!hotels.length || processed >= total) break;
      }
      await db.prepare(`UPDATE hotel_catalog_syncs SET status = 'completed', processed_count = ?, created_count = ?, updated_count = ?, total_available = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`).run(processed, created, processed - created, total, syncId);
      return { id: syncId, city, iata_code: code, processed, created, updated: processed - created, total_available: total };
    } catch (error) {
      await db.prepare(`UPDATE hotel_catalog_syncs SET status = 'failed', processed_count = ?, created_count = ?, error = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`).run(processed, created, error.message.slice(0, 1000), syncId);
      throw error;
    }
  })().finally(() => activeSyncs.delete(key));
  activeSyncs.set(key, job);
  return job;
}

async function ensureCatalogForCity(city) {
  if (!city || process.env.HOTEL_CATALOG_PROVIDER === 'none' || (process.env.HOTEL_CATALOG_PROVIDER && process.env.HOTEL_CATALOG_PROVIDER !== 'liteapi') || !liteapi.configured() || process.env.NODE_ENV === 'test') return null;
  const code = await resolveIata(city);
  if (!code) return null;
  const recent = await db.prepare(`SELECT * FROM hotel_catalog_syncs WHERE provider = 'liteapi' AND iata_code = ? AND status = 'completed' AND completed_at > CURRENT_TIMESTAMP - (? * INTERVAL '1 hour') ORDER BY completed_at DESC LIMIT 1`).get(code, Number(process.env.CATALOG_SYNC_INTERVAL_HOURS || 24));
  if (recent) {
    const target = Math.min(Number(recent.total_available || Infinity), Number(process.env.CATALOG_SYNC_MAX_HOTELS || 500));
    if (Number(recent.processed_count || 0) < target) syncCatalog({ city, iataCode: code }).catch(error => console.warn(`[liteapi] catalog expansion: ${error.message}`));
    return recent;
  }
  const existing = await db.prepare(`SELECT COUNT(*) AS count FROM hotel_provider_mappings WHERE provider = 'liteapi' AND metadata LIKE ?`).get(`%\"iata_code\":\"${code}\"%`);
  if (Number(existing?.count || 0) > 0) { syncCatalog({ city, iataCode: code }).catch(error => console.warn(`[liteapi] background catalog sync: ${error.message}`)); return null; }
  const initial = await syncCatalog({ city, iataCode: code, limit: Number(process.env.CATALOG_INITIAL_SYNC_HOTELS || 100) });
  setImmediate(() => syncCatalog({ city, iataCode: code }).catch(error => console.warn(`[liteapi] catalog expansion: ${error.message}`)));
  return initial;
}

function startCatalogScheduler() {
  if (!liteapi.configured() || process.env.NODE_ENV === 'test') return null;
  const interval = setInterval(async () => {
    const stale = await db.prepare(`SELECT DISTINCT ON (iata_code) city, iata_code FROM hotel_catalog_syncs WHERE provider = 'liteapi' AND status = 'completed' AND completed_at < CURRENT_TIMESTAMP - (? * INTERVAL '1 hour') ORDER BY iata_code, completed_at DESC`).all(Number(process.env.CATALOG_SYNC_INTERVAL_HOURS || 24));
    for (const item of stale) syncCatalog({ city: item.city, iataCode: item.iata_code }).catch(error => console.warn(`[liteapi] scheduled catalog sync: ${error.message}`));
  }, 60 * 60 * 1000);
  interval.unref();
  return interval;
}

module.exports = { resolveIata, syncCatalog, ensureCatalogForCity, startCatalogScheduler, normalizedAmenity, normalize, similarity, matchConfidence };
