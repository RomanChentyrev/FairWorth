const { db } = require('../db/database');
const { v4: uuidv4 } = require('uuid');
const SCORE_VERSION = '3.0.0';
const SCORE_CHANGE_THRESHOLD = Number(process.env.SCORE_CHANGE_THRESHOLD || 15);

const DEFAULT_SCORE_WEIGHTS = Object.freeze({
  value: 0.25,
  quality: 0.25,
  trust: 0.15,
  preferences: 0.35,
});

const DEFAULT_PREFERENCE_WEIGHTS = Object.freeze({
  hotel_stars: 0.20,
  hotel_amenities: 0.25,
  room_type: 0.15,
  room_view: 0.10,
  budget: 0.20,
  noise: 0.10,
});

async function ensurePersonalizationSchema() { return true; }

function parseJson(value, fallback) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

async function getUserWeights(userId) {
  let row = await db.prepare('SELECT * FROM user_preference_weights WHERE user_id = ?').get(userId);
  if (!row) {
    await db.prepare(`
      INSERT INTO user_preference_weights
        (id, user_id, score_weights, declared_weights, learned_weights)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      uuidv4(), userId, JSON.stringify(DEFAULT_SCORE_WEIGHTS),
      JSON.stringify(DEFAULT_PREFERENCE_WEIGHTS), JSON.stringify(DEFAULT_PREFERENCE_WEIGHTS)
    );
    row = await db.prepare('SELECT * FROM user_preference_weights WHERE user_id = ?').get(userId);
  }
  return {
    score: parseJson(row.score_weights, DEFAULT_SCORE_WEIGHTS),
    declared: parseJson(row.declared_weights, DEFAULT_PREFERENCE_WEIGHTS),
    learned: parseJson(row.learned_weights, DEFAULT_PREFERENCE_WEIGHTS),
    confidence: clamp(row.learning_confidence, 0, 0.8),
    interactionCount: Number(row.interaction_count || 0),
  };
}

function effectivePreferenceWeights(weights) {
  const confidence = weights.confidence;
  return Object.fromEntries(Object.keys(DEFAULT_PREFERENCE_WEIGHTS).map(key => [
    key,
    (Number(weights.declared[key]) || 0) * (1 - confidence)
      + (Number(weights.learned[key]) || 0) * confidence,
  ]));
}

function normalizedWeightedAverage(values, weights) {
  let sum = 0;
  let totalWeight = 0;
  Object.entries(values).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    const weight = Number(weights[key]) || 0;
    sum += clamp(value) * weight;
    totalWeight += weight;
  });
  return totalWeight ? sum / totalWeight : 50;
}

function includesAmenity(hotelAmenities, wanted) {
  const needle = String(wanted).toLowerCase();
  return hotelAmenities.some(item => {
    const value = String(item).toLowerCase();
    return value === needle || value.includes(needle) || needle.includes(value);
  });
}

function matchListScore(wanted, actual, matcher = (list, item) => list.includes(item)) {
  if (!wanted.length) return null;
  return (wanted.filter(item => matcher(actual, item)).length / wanted.length) * 100;
}

function pricePosition(price, prices) {
  const valid = prices.filter(Number.isFinite).sort((a, b) => a - b);
  if (!Number.isFinite(price) || !valid.length) return 50;
  if (valid.length === 1) return 70;
  const rank = valid.filter(candidate => candidate < price).length / (valid.length - 1);
  return 100 - rank * 100;
}

function calculateHotelScore(hotel, preferences, weights, context) {
  const calculatedAt = new Date().toISOString();
  const isRu = context.language === 'ru';
  const pref = preferences || {};
  const hotelAmenities = parseJson(hotel.amenities, []).map(String);
  const rooms = context.roomsByHotel[hotel.id] || [];
  const views = [...new Set(rooms.map(room => room.view_type).filter(Boolean))];
  const roomNames = rooms.map(room => String(room.name || '').toLowerCase());
  const wantedStars = parseJson(pref.hotel_stars, []).map(Number);
  const wantedAmenities = parseJson(pref.hotel_amenities, []);
  const wantedRoomTypes = parseJson(pref.room_type, []).map(value => String(value).toLowerCase());
  const wantedViews = parseJson(pref.room_view, []).map(value => String(value).toLowerCase());
  const budget = Number(pref.budget_per_night_max) || null;
  const numericPrice = Number(hotel.min_price);
  const price = Number.isFinite(numericPrice) && numericPrice > 0 ? numericPrice : null;

  const relativePrice = pricePosition(price, context.prices);
  const reviewValue = hotel.value_score ? clamp(hotel.value_score * 20) : null;
  const value = normalizedWeightedAverage(
    { market_price: relativePrice, guest_value: reviewValue },
    { market_price: 0.6, guest_value: 0.4 }
  );

  const qualityParts = [hotel.rating, hotel.cleanliness, hotel.service, hotel.location_score]
    .filter(value => Number.isFinite(Number(value)))
    .map(value => clamp(Number(value) * 20));
  const quality = qualityParts.length
    ? qualityParts.reduce((sum, value) => sum + value, 0) / qualityParts.length
    : 70;
  const reviewCount = Math.max(0, Number(hotel.review_count) || 0);
  const trust = clamp((Math.log10(reviewCount + 1) / Math.log10(5001)) * 100);

  const preferenceParts = {
    hotel_stars: wantedStars.length ? (wantedStars.includes(Number(hotel.stars)) ? 100 : 0) : null,
    hotel_amenities: matchListScore(wantedAmenities, hotelAmenities, includesAmenity),
    room_type: wantedRoomTypes.length && roomNames.length
      ? matchListScore(wantedRoomTypes, roomNames, (names, type) => names.some(name => name.includes(type)))
      : null,
    room_view: wantedViews.length && views.length
      ? matchListScore(wantedViews, views.map(String), (list, view) => list.some(value => value.toLowerCase() === view))
      : null,
    budget: budget && price !== null
      ? (price <= budget ? 100 : clamp(100 - ((price - budget) / budget) * 150))
      : null,
    // There is no reliable noise feature in the hotel catalogue yet.
    noise: null,
  };
  const effectiveWeights = effectivePreferenceWeights(weights);
  const personalFit = normalizedWeightedAverage(preferenceParts, effectiveWeights);
  const breakdown = { value, quality, trust, preferences: personalFit };
  const fairworthScore = Math.round(normalizedWeightedAverage(breakdown, weights.score));
  const availableFeatures = [];
  const unavailableFeatures = [];
  if (price !== null) availableFeatures.push('price'); else unavailableFeatures.push('price');
  if (hotel.stars) availableFeatures.push('star_rating'); else unavailableFeatures.push('star_rating');
  if (hotelAmenities.length) availableFeatures.push('amenities'); else unavailableFeatures.push('amenities');
  if (hotel.rating) availableFeatures.push('guest_rating', 'review_trust'); else unavailableFeatures.push('guest_rating', 'review_trust');
  if (rooms.length) availableFeatures.push('room_type', 'room_view'); else unavailableFeatures.push('room_type', 'room_view');
  unavailableFeatures.push('noise_level');
  const completenessFields = ['price', 'star_rating', 'amenities', 'guest_rating', 'review_trust', 'room_type', 'room_view', 'noise_level'];
  const completenessScore = Math.round((completenessFields.filter(field => availableFeatures.includes(field)).length / completenessFields.length) * 100);
  const priceDetails = context.priceMetadataByHotel?.[hotel.id] || {
    source: hotel.price_source || null, currency: null, tax_status: 'unknown', updated_at: null,
    price_warnings: ['price_metadata_unavailable'], is_stale: true, is_demonstration: false,
  };
  const strongest = Object.entries(breakdown).sort((a, b) => b[1] - a[1])[0];
  const explanation = isRu
    ? `Оценка ${fairworthScore}/100: сильнее всего повлиял компонент «${{ value: 'ценность', quality: 'качество', trust: 'доверие к отзывам', preferences: 'совпадение с предпочтениями' }[strongest[0]]}» (${Math.round(strongest[1])}/100). Персональное совпадение — ${Math.round(personalFit)}/100.`
    : `Score ${fairworthScore}/100: the strongest component is ${{ value: 'value', quality: 'quality', trust: 'review trust', preferences: 'preference match' }[strongest[0]]} (${Math.round(strongest[1])}/100). Personal fit is ${Math.round(personalFit)}/100.`;

  const matches = [];
  const mismatches = [];
  if (preferenceParts.hotel_stars === 100) matches.push(isRu ? 'Подходящая звёздность' : 'Preferred star rating');
  else if (preferenceParts.hotel_stars === 0) mismatches.push(isRu ? 'Звёздность не совпадает' : 'Star rating does not match');
  if (wantedAmenities.length) {
    const matched = wantedAmenities.filter(item => includesAmenity(hotelAmenities, item));
    if (matched.length) matches.push(`${isRu ? 'Совпали удобства' : 'Matching amenities'}: ${matched.join(', ')}`);
    const missing = wantedAmenities.filter(item => !includesAmenity(hotelAmenities, item));
    if (missing.length) mismatches.push(`${isRu ? 'Нет удобств' : 'Missing amenities'}: ${missing.join(', ')}`);
  }
  if (preferenceParts.budget === 100) matches.push(isRu ? 'Цена в пределах вашего бюджета' : 'Price is within your budget');
  else if (preferenceParts.budget !== null) mismatches.push(isRu ? 'Цена выше вашего бюджета' : 'Price is above your budget');
  if (preferenceParts.room_view >= 50) matches.push(isRu ? 'Есть предпочитаемый вид из номера' : 'Preferred room view is available');
  else if (preferenceParts.room_view !== null) mismatches.push(isRu ? 'Нет предпочитаемого вида из номера' : 'Preferred room view is unavailable');

  return {
    ...hotel,
    fairworth_score: fairworthScore,
    base_score: Math.round(normalizedWeightedAverage(
      { value, quality, trust },
      { value: weights.score.value, quality: weights.score.quality, trust: weights.score.trust }
    )),
    personal_fit: Math.round(personalFit),
    personalized: Boolean(preferences),
    score_version: SCORE_VERSION,
    calculated_at: calculatedAt,
    calculation_parameters: {
      score_weights: weights.score,
      effective_preference_weights: effectiveWeights,
      learning_confidence: weights.confidence,
      market_price_sample_size: context.prices.length,
      language: context.language,
    },
    learning_confidence: weights.confidence,
    score_breakdown: Object.fromEntries(Object.entries(breakdown).map(([key, value]) => [key, Math.round(value)])),
    preference_matches: matches,
    preference_mismatches: mismatches,
    price_details: priceDetails,
    feature_availability: { available: availableFeatures, unavailable: unavailableFeatures },
    data_completeness: { score: completenessScore, available_fields: availableFeatures, missing_fields: unavailableFeatures },
    score_explanation: explanation,
  };
}

async function recordScoreSnapshot(userId, scoreResult) {
  if (!scoreResult?.id || !Number.isFinite(Number(scoreResult.fairworth_score))) return;
  const previous = await db.prepare(`SELECT * FROM score_snapshots WHERE user_id = ? AND hotel_id = ? ORDER BY calculated_at DESC LIMIT 1`).get(userId, scoreResult.id);
  const current = Number(scoreResult.fairworth_score);
  const shouldStore = !previous || Number(previous.score) !== current || Date.now() - new Date(previous.calculated_at).getTime() > 6 * 60 * 60 * 1000;
  if (!shouldStore) return;
  await db.prepare(`INSERT INTO score_snapshots (id, user_id, hotel_id, score, score_version, breakdown, completeness, calculation_parameters, calculated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(uuidv4(), userId, scoreResult.id, current, scoreResult.score_version, JSON.stringify(scoreResult.score_breakdown), scoreResult.data_completeness.score, JSON.stringify(scoreResult.calculation_parameters), scoreResult.calculated_at);
  if (previous) {
    const delta = current - Number(previous.score);
    if (Math.abs(delta) >= SCORE_CHANGE_THRESHOLD) {
      const open = await db.prepare(`SELECT id FROM score_anomalies WHERE user_id = ? AND hotel_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1`).get(userId, scoreResult.id);
      if (!open) await db.prepare(`INSERT INTO score_anomalies (id, user_id, hotel_id, previous_score, current_score, delta, score_version, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(uuidv4(), userId, scoreResult.id, Number(previous.score), current, delta, scoreResult.score_version, JSON.stringify({ previous_calculated_at: previous.calculated_at, current_calculated_at: scoreResult.calculated_at }));
    }
  }
}

async function learnFromInteraction(userId, hotelId, signal) {
  if (!hotelId || !signal) return;
  const hotel = await db.prepare('SELECT * FROM hotels WHERE id = ?').get(hotelId);
  const prefs = await db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get(userId);
  if (!hotel || !prefs) return;
  const row = await db.prepare('SELECT learned_weights FROM user_preference_weights WHERE user_id = ?').get(userId);
  if (!row) return;
  const learned = parseJson(row.learned_weights, { ...DEFAULT_PREFERENCE_WEIGHTS });
  const hotelAmenities = parseJson(hotel.amenities, []);
  const wantedAmenities = parseJson(prefs.hotel_amenities, []);
  const wantedStars = parseJson(prefs.hotel_stars, []).map(Number);
  const wantedTypes = parseJson(prefs.room_type, []).map(value => String(value).toLowerCase());
  const wantedViews = parseJson(prefs.room_view, []).map(value => String(value).toLowerCase());
  const rooms = await db.prepare('SELECT name, view_type FROM hotel_rooms WHERE hotel_id = ?').all(hotelId);
  const minPrice = (await db.prepare('SELECT MIN(price_per_night) AS price FROM hotel_prices WHERE hotel_id = ? AND price_valid = 1').get(hotelId))?.price;
  const matches = {
    hotel_stars: wantedStars.length ? (wantedStars.includes(Number(hotel.stars)) ? 1 : 0) : 0.5,
    hotel_amenities: wantedAmenities.length ? wantedAmenities.filter(item => includesAmenity(hotelAmenities, item)).length / wantedAmenities.length : 0.5,
    room_type: wantedTypes.length && rooms.length ? wantedTypes.filter(type => rooms.some(room => String(room.name).toLowerCase().includes(type))).length / wantedTypes.length : 0.5,
    room_view: wantedViews.length && rooms.length ? wantedViews.filter(view => rooms.some(room => String(room.view_type).toLowerCase() === view)).length / wantedViews.length : 0.5,
    budget: prefs.budget_per_night_max && minPrice ? (Number(minPrice) <= Number(prefs.budget_per_night_max) ? 1 : 0) : 0.5,
    noise: 0.5,
  };
  const alpha = Math.min(0.12, 0.015 * Math.abs(signal));
  Object.keys(DEFAULT_PREFERENCE_WEIGHTS).forEach(key => {
    const target = signal > 0 ? matches[key] : 1 - matches[key];
    learned[key] = Math.max(0.02, Number(learned[key] || 0) + alpha * (target - Number(learned[key] || 0)));
  });
  const total = Object.values(learned).reduce((sum, value) => sum + value, 0);
  Object.keys(learned).forEach(key => { learned[key] /= total; });
  const meaningful = (await db.prepare(`SELECT COUNT(*) AS count FROM user_interactions WHERE user_id = ? AND signal != 0`).get(userId)).count;
  const confidence = Math.min(0.8, meaningful / 50 * 0.8);
  await db.prepare(`UPDATE user_preference_weights SET learned_weights = ?, learning_confidence = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`)
    .run(JSON.stringify(learned), confidence, userId);
}

module.exports = {
  DEFAULT_SCORE_WEIGHTS,
  DEFAULT_PREFERENCE_WEIGHTS,
  SCORE_VERSION,
  ensurePersonalizationSchema,
  getUserWeights,
  calculateHotelScore,
  recordScoreSnapshot,
  learnFromInteraction,
};
