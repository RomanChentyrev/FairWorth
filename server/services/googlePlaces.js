const { withRetry } = require('../utils/retry');
const { configured: configuredSecret } = require('../config/capabilities');
const { db } = require('../db/database');
const { v4: uuidv4 } = require('uuid');

const BASE_URL = 'https://places.googleapis.com/v1';

function apiKey() {
  return process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';
}

function configured() {
  return configuredSecret(apiKey()) && process.env.GOOGLE_PLACES_PHOTOS_ENABLED !== 'false';
}

function normalize(value = '') {
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokens(value) {
  return new Set(normalize(value).split(' ').filter(word => word.length > 1));
}

function similarity(left, right) {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  const common = [...a].filter(value => b.has(value)).length;
  return (2 * common) / (a.size + b.size);
}

function distanceKm(a, b) {
  if (![a.latitude, a.longitude, b?.latitude, b?.longitude].every(value => Number.isFinite(Number(value)))) return null;
  const rad = value => Number(value) * Math.PI / 180;
  const dLat = rad(Number(b.latitude) - Number(a.latitude));
  const dLon = rad(Number(b.longitude) - Number(a.longitude));
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

async function request(path, { method = 'GET', body, fieldMask } = {}) {
  if (!configured()) throw new Error('GOOGLE_PLACES_API_KEY is not configured');
  return withRetry(async () => {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      signal: AbortSignal.timeout(Number(process.env.GOOGLE_PLACES_TIMEOUT_MS || 12000)),
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey(),
        ...(fieldMask ? { 'X-Goog-FieldMask': fieldMask } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
    if (!response.ok) {
      const detail = data?.error?.message || data?.message || 'request failed';
      const error = new Error(`Google Places HTTP ${response.status}: ${detail}`);
      error.status = response.status;
      throw error;
    }
    return data;
  }, { attempts: 2, baseDelayMs: 350 });
}

function placeLocation(place) {
  return {
    latitude: place?.location?.latitude,
    longitude: place?.location?.longitude,
  };
}

function scorePlace(hotel, place) {
  const name = place?.displayName?.text || '';
  const address = place?.formattedAddress || '';
  const nameScore = similarity(hotel.name, name);
  const addressScore = similarity(`${hotel.address || hotel.location || ''} ${hotel.city || ''}`, address);
  const distance = distanceKm(hotel, placeLocation(place));
  const geoScore = distance == null ? 0.08 : distance <= 0.2 ? 0.3 : distance <= 1 ? 0.22 : distance <= 3 ? 0.12 : 0;
  return {
    score: Math.min(1, nameScore * 0.58 + addressScore * 0.12 + geoScore),
    distance_km: distance,
    name_score: nameScore,
  };
}

function searchBody(hotel) {
  const textQuery = [hotel.name, hotel.address || hotel.location, hotel.city, hotel.country]
    .filter(Boolean)
    .join(', ');
  const body = { textQuery, maxResultCount: 5 };
  if (Number.isFinite(Number(hotel.latitude)) && Number.isFinite(Number(hotel.longitude))) {
    body.locationBias = {
      circle: {
        center: { latitude: Number(hotel.latitude), longitude: Number(hotel.longitude) },
        radius: Number(process.env.GOOGLE_PLACES_SEARCH_RADIUS_METERS || 1500),
      },
    };
  }
  return body;
}

async function findBestPlace(hotel) {
  const result = await request('/places:searchText', {
    method: 'POST',
    fieldMask: 'places.id,places.displayName,places.formattedAddress,places.location,places.photos',
    body: searchBody(hotel),
  });
  const candidates = (result.places || [])
    .map(place => ({ place, confidence: scorePlace(hotel, place) }))
    .sort((a, b) => b.confidence.score - a.confidence.score);
  const best = candidates[0];
  const threshold = Number(process.env.GOOGLE_PLACES_MATCH_THRESHOLD || 0.46);
  if (!best || best.confidence.score < threshold) return null;
  return best;
}

async function placeDetails(placeId) {
  return request(`/places/${encodeURIComponent(placeId)}`, {
    fieldMask: 'id,displayName,formattedAddress,location,photos',
  });
}

async function resolvePlace(hotel) {
  const mapped = await db.prepare(`
    SELECT provider_hotel_id, metadata
    FROM hotel_provider_mappings
    WHERE hotel_id = ? AND provider = 'google_places'
    LIMIT 1
  `).get(hotel.id);
  if (mapped?.provider_hotel_id) {
    const place = await placeDetails(mapped.provider_hotel_id);
    return { place, confidence: JSON.parse(mapped.metadata || '{}').confidence || {} };
  }

  const best = await findBestPlace(hotel);
  if (!best?.place?.id) return null;
  await db.prepare(`
    INSERT INTO hotel_provider_mappings (id, hotel_id, provider, provider_hotel_id, match_confidence, verified, match_method, metadata)
    VALUES (?, ?, 'google_places', ?, ?, ?, 'automatic', ?)
    ON CONFLICT (hotel_id, provider)
    DO UPDATE SET provider_hotel_id = EXCLUDED.provider_hotel_id,
                  match_confidence = EXCLUDED.match_confidence,
                  metadata = EXCLUDED.metadata,
                  updated_at = CURRENT_TIMESTAMP
  `).run(
    uuidv4(),
    hotel.id,
    best.place.id,
    best.confidence.score,
    best.confidence.score >= 0.68 ? 1 : 0,
    JSON.stringify({
      displayName: best.place.displayName?.text || null,
      formattedAddress: best.place.formattedAddress || null,
      confidence: best.confidence,
    })
  );
  return best;
}

async function photoUri(photo, maxWidthPx) {
  if (!photo?.name) return null;
  const params = new URLSearchParams({
    maxWidthPx: String(maxWidthPx),
    skipHttpRedirect: 'true',
    key: apiKey(),
  });
  const result = await request(`/${photo.name}/media?${params.toString()}`);
  return result.photoUri || null;
}

function normalizeAttributions(attributions = []) {
  return attributions.map(item => ({
    displayName: item.displayName || '',
    uri: item.uri || '',
    photoUri: item.photoUri || '',
  })).filter(item => item.displayName || item.uri || item.photoUri);
}

async function hotelPhotos(hotel, { maxPhotos = Number(process.env.GOOGLE_PLACES_MAX_PHOTOS || 8), maxWidthPx = Number(process.env.GOOGLE_PLACES_PHOTO_WIDTH_PX || 1600) } = {}) {
  if (!configured()) return [];
  const resolved = await resolvePlace(hotel);
  const photos = (resolved?.place?.photos || []).slice(0, Math.max(1, maxPhotos));
  if (!photos.length) return [];
  const images = [];
  for (const [index, photo] of photos.entries()) {
    const url = await photoUri(photo, maxWidthPx).catch(error => {
      console.warn(`[google-places] photo skipped for ${hotel.name}: ${error.message}`);
      return null;
    });
    if (!url) continue;
    images.push({
      url,
      provider: 'google_places',
      kind: index === 0 ? 'main' : 'gallery',
      sort_order: index,
      width_px: photo.widthPx || null,
      height_px: photo.heightPx || null,
      attribution: normalizeAttributions(photo.authorAttributions),
      place_id: resolved.place.id,
    });
  }
  return images;
}

module.exports = { configured, hotelPhotos };
