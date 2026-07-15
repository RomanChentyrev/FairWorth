const { db } = require('../db/database');
const { v4: uuidv4 } = require('uuid');
const { amenityMatches, amenityWeight } = require('../config/hotelAmenities');
const { benchmarkPriceScore } = require('./comparablePricing');
const SCORE_VERSION = '4.5.0';
const SCORE_CHANGE_THRESHOLD = Number(process.env.SCORE_CHANGE_THRESHOLD || 15);

const DEFAULT_SCORE_WEIGHTS = Object.freeze({
  value: 0.25,
  quality: 0.25,
  trust: 0.15,
  preferences: 0.35,
});

const DEFAULT_PREFERENCE_WEIGHTS = Object.freeze({
  hotel_stars: 0.16,
  hotel_amenities: 0.20,
  room_type: 0.12,
  room_view: 0.08,
  budget: 0.14,
  travel_tier: 0.22,
  noise: 0.08,
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

function normalizeRoomText(value) {
  return String(value || '').toLowerCase().replace(/[_-]+/g, ' ').replace(/[^a-z0-9а-яё ]/gi, ' ').replace(/\s+/g, ' ').trim();
}

const ROOM_CATEGORY_RANK = Object.freeze({ standard: 0, superior: 1, deluxe: 2, executive: 3, junior_suite: 3.25, suite: 4, apartment: 4, villa: 5 });
function roomCategory(value) {
  const text = normalizeRoomText(value);
  if (/\bjunior\s+suite\b/.test(text)) return 'junior_suite';
  if (/\b(villa|bungalow)\b/.test(text)) return 'villa';
  if (/\b(apartment|aparthotel|residence)\b/.test(text)) return 'apartment';
  if (/\b(suite|studio)\b/.test(text)) return 'suite';
  if (/\bexecutive\b/.test(text)) return 'executive';
  if (/\b(deluxe|premium)\b/.test(text)) return 'deluxe';
  if (/\b(superior|comfort)\b/.test(text)) return 'superior';
  if (/\b(standard|classic|economy)\b/.test(text)) return 'standard';
  return null;
}

function bedType(value) {
  const text = normalizeRoomText(value);
  return ['king', 'queen', 'twin', 'double', 'single'].find(type => new RegExp(`\\b${type}\\b`).test(text)) || null;
}

function roomTypeSimilarity(wanted, actual) {
  const preferred = normalizeRoomText(wanted);
  const offered = normalizeRoomText(actual);
  if (!preferred || !offered) return null;
  const preferredBed = bedType(preferred);
  const offeredBed = bedType(offered);
  if (preferredBed) {
    if (preferredBed === offeredBed) return 100;
    if (!offeredBed) return 55;
    return ({ king: { queen: 65, double: 55, twin: 20, single: 10 }, queen: { king: 85, double: 70, twin: 25, single: 15 }, twin: { double: 35, king: 25, queen: 25, single: 55 } }[preferredBed]?.[offeredBed]) ?? 30;
  }
  const preferredCategory = roomCategory(preferred);
  const offeredCategory = roomCategory(offered);
  if (preferredCategory && offeredCategory) {
    if (preferredCategory === offeredCategory) return 100;
    if (preferredCategory === 'suite' && offeredCategory === 'junior_suite') return 80;
    if (preferredCategory === 'junior_suite' && offeredCategory === 'suite') return 95;
    const distance = Math.abs(ROOM_CATEGORY_RANK[preferredCategory] - ROOM_CATEGORY_RANK[offeredCategory]);
    return clamp(100 - distance * 22, 20, 100);
  }
  if (offered.includes(preferred)) return 100;
  if (preferred.includes(offered)) return 80;
  const preferredTokens = new Set(preferred.split(' '));
  const overlap = offered.split(' ').filter(token => preferredTokens.has(token)).length;
  return overlap ? clamp((overlap / preferredTokens.size) * 80) : 20;
}

const VIEW_ALIASES = Object.freeze({
  sea: /\b(sea|ocean|oceanfront|seafront|beach|beachfront|coast|coastal|marine)\b/, city: /\b(city|urban|skyline|downtown)\b/,
  garden: /\b(garden|park|courtyard|greenery)\b/, pool: /\b(pool|swimming)\b/,
  mountain: /\b(mountain|hill|alpine|valley)\b/, river: /\b(river|canal)\b/, lake: /\b(lake|lagoon)\b/,
});
function viewCategory(value) {
  const text = normalizeRoomText(value);
  return Object.entries(VIEW_ALIASES).find(([, pattern]) => pattern.test(text))?.[0] || null;
}

function roomViewSimilarity(wanted, actual) {
  const preferred = normalizeRoomText(wanted);
  const offered = normalizeRoomText(actual);
  if (!preferred || !offered) return null;
  const preferredCategory = viewCategory(preferred);
  const offeredCategory = viewCategory(offered);
  if (preferredCategory && preferredCategory === offeredCategory) return /\b(partial|side|limited|glimpse|obstructed)\b/.test(offered) ? 75 : 100;
  if (preferredCategory && offeredCategory) {
    const related = new Set(['sea:lake', 'sea:river', 'garden:mountain', 'city:river']);
    return related.has(`${preferredCategory}:${offeredCategory}`) || related.has(`${offeredCategory}:${preferredCategory}`) ? 45 : 10;
  }
  if (offered.includes(preferred)) return 100;
  return 20;
}

function bestDescriptorMatch(wantedValues, actualValues, similarity) {
  if (!wantedValues.length || !actualValues.length) return { score: null, wanted: null, actual: null };
  let best = { score: 0, wanted: wantedValues[0], actual: actualValues[0] };
  wantedValues.forEach(wanted => actualValues.forEach(actual => {
    const score = similarity(wanted, actual);
    if (score !== null && score > best.score) best = { score, wanted, actual };
  }));
  return best;
}

function tripContextSegments(context = {}, preferences = {}) {
  const segments = [];
  const styles = parseJson(preferences.travel_style, []).map(value => String(value).toLowerCase());
  const explicitPurpose = String(context.trip_purpose || context.purpose || '').toLowerCase();
  const purpose = ['business', 'family', 'couple', 'leisure'].includes(explicitPurpose) ? explicitPurpose
    : styles.includes('business') ? 'business'
      : styles.includes('family') ? 'family'
        : styles.some(style => ['couple', 'romantic', 'honeymoon'].includes(style)) ? 'couple' : 'leisure';
  segments.push({ type: 'purpose', value: purpose });

  const checkIn = context.check_in || context.checkIn;
  const checkOut = context.check_out || context.checkOut;
  if (checkIn && checkOut) {
    const nights = Math.max(1, Math.round((new Date(checkOut) - new Date(checkIn)) / 86400000));
    if (Number.isFinite(nights)) segments.push({ type: 'duration', value: nights <= 3 ? 'short' : nights <= 7 ? 'medium' : 'long' });
  }
  const destination = String(context.destination || context.city || '').trim().toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '_').replace(/^_|_$/g, '');
  if (destination) segments.push({ type: 'destination', value: destination.slice(0, 100) });
  if (checkIn) {
    const month = new Date(checkIn).getUTCMonth() + 1;
    const season = [12, 1, 2].includes(month) ? 'winter' : [3, 4, 5].includes(month) ? 'spring' : [6, 7, 8].includes(month) ? 'summer' : 'autumn';
    segments.push({ type: 'season', value: season });
  }
  const guests = Math.max(0, Number(context.guests) || 0);
  if (guests) segments.push({ type: 'guests', value: guests === 1 ? 'solo' : guests === 2 ? 'two' : guests <= 4 ? 'small_group' : 'large_group' });
  return segments;
}

function tripContextKey(context = {}, preferences = {}) {
  return tripContextSegments(context, preferences).map(segment => `${segment.type}:${segment.value}`).sort().join('|');
}

function normalizeWeights(weights) {
  const normalized = Object.fromEntries(Object.keys(DEFAULT_PREFERENCE_WEIGHTS).map(key => [key, Math.max(0.02, Number(weights[key]) || DEFAULT_PREFERENCE_WEIGHTS[key])]));
  const total = Object.values(normalized).reduce((sum, value) => sum + value, 0);
  Object.keys(normalized).forEach(key => { normalized[key] /= total; });
  return normalized;
}

async function getUserWeights(userId, context = null) {
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
  let learned = parseJson(row.learned_weights, DEFAULT_PREFERENCE_WEIGHTS);
  let contextualConfidence = 0;
  let activeContexts = [];
  if (context) {
    const preferences = await db.prepare('SELECT travel_style FROM user_preferences WHERE user_id = ?').get(userId) || {};
    const segments = tripContextSegments(context, preferences);
    if (segments.length) {
      const contextualRows = await db.prepare(`SELECT * FROM user_context_preference_weights WHERE user_id = ? AND (${segments.map(() => '(context_type = ? AND context_value = ?)').join(' OR ')})`)
        .all(userId, ...segments.flatMap(segment => [segment.type, segment.value]));
      const evidenceTotal = contextualRows.reduce((sum, item) => sum + Math.min(40, Number(item.evidence_strength) || 0), 0);
      if (evidenceTotal > 0) {
        const contextualLearned = Object.fromEntries(Object.keys(DEFAULT_PREFERENCE_WEIGHTS).map(key => [key,
          contextualRows.reduce((sum, item) => sum + (Number(parseJson(item.learned_weights, DEFAULT_PREFERENCE_WEIGHTS)[key]) || 0) * Math.min(40, Number(item.evidence_strength) || 0), 0) / evidenceTotal,
        ]));
        contextualConfidence = Math.min(0.7, evidenceTotal / (segments.length * 40) * 0.7);
        learned = normalizeWeights(Object.fromEntries(Object.keys(DEFAULT_PREFERENCE_WEIGHTS).map(key => [key,
          Number(learned[key]) * (1 - contextualConfidence) + contextualLearned[key] * contextualConfidence,
        ])));
        activeContexts = contextualRows.map(item => `${item.context_type}:${item.context_value}`);
      }
    }
  }
  return {
    score: parseJson(row.score_weights, DEFAULT_SCORE_WEIGHTS),
    declared: parseJson(row.declared_weights, DEFAULT_PREFERENCE_WEIGHTS),
    learned,
    confidence: Math.max(clamp(row.learning_confidence, 0, 0.8), contextualConfidence),
    interactionCount: Number(row.interaction_count || 0),
    contextualConfidence,
    activeContexts,
  };
}

function effectivePreferenceWeights(weights) {
  const confidence = weights.confidence;
  return Object.fromEntries(Object.keys(DEFAULT_PREFERENCE_WEIGHTS).map(key => [
    key,
    (Number.isFinite(Number(weights.declared[key])) ? Number(weights.declared[key]) : DEFAULT_PREFERENCE_WEIGHTS[key]) * (1 - confidence)
      + (Number.isFinite(Number(weights.learned[key])) ? Number(weights.learned[key]) : DEFAULT_PREFERENCE_WEIGHTS[key]) * confidence,
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

function weightedAverageOrNull(values, weights) {
  const known = Object.entries(values).filter(([, value]) => value !== null && value !== undefined);
  return known.length ? normalizedWeightedAverage(Object.fromEntries(known), weights) : null;
}

function includesAmenity(hotelAmenities, wanted) {
  return amenityMatches(hotelAmenities, wanted);
}

function amenityMatchScore(wanted, matched) {
  if (!wanted.length) return null;
  const totalWeight = wanted.reduce((sum, item) => sum + amenityWeight(item), 0);
  const matchedWeight = matched.reduce((sum, item) => sum + amenityWeight(item), 0);
  return totalWeight ? clamp((matchedWeight / totalWeight) * 100) : null;
}

const PREMIUM_BRANDS = /ritz|four seasons|mandarin oriental|st\.? regis|waldorf|aman|rosewood|peninsula|raffles|park hyatt|belmond|banyan tree|six senses|one&only|shangri-la|jumeirah|capella|edition/i;

function contentObject(hotel) {
  return parseJson(hotel.content_raw_json, {});
}

function findContentValue(value, wantedKeys) {
  if (!value || typeof value !== 'object') return null;
  for (const [key, item] of Object.entries(value)) {
    if (wantedKeys.has(String(key).toLowerCase()) && item !== null && item !== '') return item;
    const nested = findContentValue(item, wantedKeys);
    if (nested !== null) return nested;
  }
  return null;
}

function normalizedProviderScore(hotel, keys) {
  const rawValue = findContentValue(contentObject(hotel), new Set(keys.map(key => key.toLowerCase())));
  if (rawValue === null || rawValue === undefined || rawValue === '') return null;
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < 0) return null;
  if (value <= 1) return clamp(value * 100);
  if (value <= 5) return clamp(value * 20);
  if (value <= 10) return clamp(value * 10);
  return clamp(value);
}

function reviewText(hotel) {
  const parts = [];
  function collect(value, reviewContext = false) {
    if (!value || parts.length >= 30) return;
    if (Array.isArray(value)) return value.forEach(item => collect(item, reviewContext));
    if (typeof value !== 'object') {
      if (reviewContext && typeof value === 'string') parts.push(value);
      return;
    }
    Object.entries(value).forEach(([key, item]) => collect(item, reviewContext || /review|guest.*comment|testimonial/i.test(key)));
  }
  collect(contentObject(hotel));
  return parts.join(' ').toLowerCase();
}

function semanticScore(text, positivePatterns, negativePatterns) {
  if (!text) return null;
  const positives = positivePatterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
  const negatives = negativePatterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
  return positives || negatives ? clamp(50 + positives * 12 - negatives * 18) : null;
}

function luxuryReviewFit(hotel) {
  return normalizedProviderScore(hotel, ['luxurySentiment', 'luxuryScore']) ?? semanticScore(
    reviewText(hotel),
    [/luxur/, /impeccable service/, /exceptional service/, /premium experience/, /elegant/, /five.star/, /lavish/],
    [/outdated/, /dated room/, /worn/, /tired room/, /poor service/, /dirty/, /needs renovation/]
  );
}

function roomConditionFit(hotel) {
  return normalizedProviderScore(hotel, ['roomCondition', 'roomConditionScore', 'conditionScore']) ?? semanticScore(
    reviewText(hotel),
    [/spotless room/, /newly renovated/, /modern room/, /well maintained/, /pristine/],
    [/outdated/, /dated room/, /worn/, /tired room/, /dirty room/, /needs renovation/]
  );
}

function breakfastQualityFit(hotel) {
  return normalizedProviderScore(hotel, ['breakfastQuality', 'breakfastScore']) ?? semanticScore(
    reviewText(hotel),
    [/excellent breakfast/, /great breakfast/, /outstanding breakfast/, /breakfast.*variety/, /high.quality breakfast/],
    [/poor breakfast/, /limited breakfast/, /disappointing breakfast/, /cold breakfast/]
  );
}

function renovationFit(hotel) {
  const rawYear = Number(hotel.renovation_year || findContentValue(contentObject(hotel), new Set([
    'renovationyear', 'lastrenovationyear', 'yearofrenovation', 'renovatedyear',
  ])));
  const currentYear = new Date().getUTCFullYear();
  if (!Number.isInteger(rawYear) || rawYear < 1900 || rawYear > currentYear) return null;
  const age = currentYear - rawYear;
  return age <= 2 ? 100 : age <= 5 ? 90 : age <= 10 ? 72 : age <= 15 ? 50 : 25;
}

function roomSizeFit(level, rooms) {
  const sizes = rooms.map(room => Number(room.size_sqm)).filter(size => Number.isFinite(size) && size > 0).sort((a, b) => a - b);
  if (!sizes.length) return null;
  const median = sizes[Math.floor(sizes.length / 2)];
  if (level === 'luxury') return median >= 55 ? 100 : median >= 42 ? 90 : median >= 32 ? 70 : median >= 24 ? 45 : 20;
  if (level === 'upscale') return median >= 34 ? 100 : median >= 27 ? 85 : median >= 21 ? 65 : 35;
  if (level === 'mid') return median >= 24 ? 100 : median >= 18 ? 80 : 55;
  return null;
}

function roomCategoryFit(level, rooms) {
  if (!rooms.length) return null;
  const names = rooms.map(room => String(room.name || '').toLowerCase());
  const luxury = names.some(name => /presidential|royal|villa|suite|club|executive|penthouse/.test(name));
  const upscale = luxury || names.some(name => /deluxe|premium|superior/.test(name));
  if (level === 'luxury') return luxury ? 100 : upscale ? 65 : 30;
  if (level === 'upscale') return upscale ? 100 : 50;
  if (level === 'mid') return upscale ? 85 : 100;
  return null;
}

function premiumAmenityFit(level, amenities) {
  if (!amenities.length || level === 'mid') return null;
  const premium = ['spa', 'concierge', 'valet', 'club_lounge', 'pool', 'beach', 'bathtub'];
  const count = premium.filter(item => includesAmenity(amenities, item)).length;
  if (level === 'luxury') return clamp((count / 4) * 100);
  if (level === 'upscale') return clamp((count / 3) * 100);
  return null;
}

function brandFit(level, hotel) {
  if (!hotel.chain_name) return null;
  const premium = PREMIUM_BRANDS.test(String(hotel.chain_name));
  if (level === 'luxury') return premium ? 100 : 60;
  if (level === 'upscale') return premium ? 95 : 85;
  if (level === 'mid') return premium ? 75 : 100;
  return null;
}

function travelTierAssessment(level, hotel, relativePrice, { rooms, amenities, explicitStarPreference }) {
  if (!level) return { score: null, reliability: 0, breakdown: {}, weights: {} };
  if (level === 'budget') return {
    score: relativePrice,
    reliability: relativePrice === null ? 0 : 100,
    breakdown: { market_price: relativePrice },
    weights: { market_price: 1 },
  };
  const stars = Number(hotel.stars) || null;
  const starScores = {
    luxury: { 1: 0, 2: 0, 3: 15, 4: 58, 5: 100 },
    upscale: { 1: 10, 2: 25, 3: 60, 4: 100, 5: 95 },
    mid: { 1: 35, 2: 65, 3: 100, 4: 95, 5: 78 },
  };
  const starFit = stars ? starScores[level]?.[stars] ?? null : null;
  const qualityValues = [hotel.rating, hotel.cleanliness, hotel.location_score]
    .filter(value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)))
    .map(value => clamp(Number(value) * 20));
  const verifiedQuality = qualityValues.length ? qualityValues.reduce((sum, value) => sum + value, 0) / qualityValues.length : null;
  const service = hotel.service !== null && hotel.service !== undefined && Number.isFinite(Number(hotel.service))
    ? clamp(Number(hotel.service) * 20) : null;
  const breakdown = {
    star_fit: starFit,
    verified_quality: verifiedQuality,
    service,
    room_size: roomSizeFit(level, rooms),
    premium_amenities: premiumAmenityFit(level, amenities),
    brand: brandFit(level, hotel),
    room_category: roomCategoryFit(level, rooms),
    room_condition: roomConditionFit(hotel),
    breakfast_quality: breakfastQualityFit(hotel),
    luxury_review_sentiment: level === 'luxury' ? luxuryReviewFit(hotel) : null,
    renovation_freshness: renovationFit(hotel),
  };
  const tierWeights = {
    star_fit: explicitStarPreference ? 0.05 : 0.15,
    verified_quality: 0.13,
    service: 0.14,
    room_condition: 0.10,
    room_size: 0.09,
    premium_amenities: 0.08,
    brand: 0.07,
    breakfast_quality: 0.07,
    room_category: 0.06,
    luxury_review_sentiment: 0.07,
    renovation_freshness: 0.04,
  };
  const knownWeight = Object.entries(breakdown).reduce((sum, [key, value]) => sum + (value === null ? 0 : tierWeights[key]), 0);
  const totalWeight = Object.values(tierWeights).reduce((sum, value) => sum + value, 0);
  return {
    score: weightedAverageOrNull(breakdown, tierWeights),
    reliability: totalWeight ? clamp((knownWeight / totalWeight) * 100) : 0,
    breakdown,
    weights: tierWeights,
  };
}

const QUALITY_PROFILES = Object.freeze({
  default: { rating: 0.225, cleanliness: 0.225, service: 0.225, location: 0.225, style_facilities: 0, review_freshness: 0.10 },
  luxury: { rating: 0.135, cleanliness: 0.225, service: 0.36, location: 0.09, style_facilities: 0.09, review_freshness: 0.10 },
  family: { rating: 0.135, cleanliness: 0.36, service: 0.09, location: 0.225, style_facilities: 0.09, review_freshness: 0.10 },
  business: { rating: 0.09, cleanliness: 0.18, service: 0.225, location: 0.315, style_facilities: 0.09, review_freshness: 0.10 },
  resort: { rating: 0.135, cleanliness: 0.18, service: 0.18, location: 0.135, style_facilities: 0.27, review_freshness: 0.10 },
  gastronomy: { rating: 0.18, cleanliness: 0.18, service: 0.225, location: 0.135, style_facilities: 0.18, review_freshness: 0.10 },
  active: { rating: 0.18, cleanliness: 0.18, service: 0.135, location: 0.135, style_facilities: 0.27, review_freshness: 0.10 },
});

const QUALITY_FACILITIES = Object.freeze({
  luxury: ['concierge', 'valet', 'club_lounge', 'spa'],
  family: ['family_rooms', 'kitchen', 'breakfast', 'pool', 'accessible'],
  business: ['wifi', 'soundproofing', 'concierge'],
  resort: ['pool', 'beach', 'spa', 'restaurant', 'breakfast'],
  gastronomy: ['restaurant', 'breakfast', 'bar'],
  active: ['gym', 'tennis', 'pool'],
});

function reviewFreshnessAssessment(hotel) {
  const rawLatest = hotel.latest_review_at || findContentValue(contentObject(hotel), new Set(['latestreviewat', 'latestreviewdate', 'mostrecentreviewdate']));
  const latestDate = rawLatest ? new Date(rawLatest) : null;
  const ageDays = latestDate && !Number.isNaN(latestDate.getTime()) ? Math.max(0, (Date.now() - latestDate.getTime()) / 86400000) : null;
  const dateScore = ageDays === null ? null : ageDays <= 90 ? 100 : ageDays <= 180 ? 90 : ageDays <= 365 ? 75 : ageDays <= 730 ? 55 : ageDays <= 1095 ? 35 : 15;
  const rawShare = hotel.recent_review_share ?? findContentValue(contentObject(hotel), new Set(['recentreviewshare', 'recentreviewsratio']));
  const numericShare = rawShare === null || rawShare === undefined || rawShare === '' ? null : Number(rawShare);
  const recentShareScore = Number.isFinite(numericShare) ? clamp((numericShare <= 1 ? numericShare : numericShare / 100) * 100) : null;
  const rawTrend = hotel.rating_trend ?? findContentValue(contentObject(hotel), new Set(['ratingtrend', 'ratingchange']));
  const trend = rawTrend === null || rawTrend === undefined || rawTrend === '' ? null : Number(rawTrend);
  const trendScore = !Number.isFinite(trend) ? null : trend <= -0.5 ? 0 : trend <= -0.3 ? 20 : trend <= -0.1 ? 45 : trend < 0.1 ? 70 : trend < 0.3 ? 85 : 100;
  const renovation = renovationFit(hotel);
  const components = { latest_review: dateScore, recent_review_share: recentShareScore, rating_trend: trendScore, renovation_freshness: renovation };
  const componentWeights = { latest_review: 0.40, recent_review_share: 0.25, rating_trend: 0.25, renovation_freshness: 0.10 };
  const knownWeight = Object.entries(components).reduce((sum, [key, value]) => sum + (value === null ? 0 : componentWeights[key]), 0);
  return {
    score: weightedAverageOrNull(components, componentWeights),
    reliability: clamp(knownWeight * 100),
    components,
    trend: Number.isFinite(trend) ? trend : null,
    trend_direction: !Number.isFinite(trend) ? 'unknown' : trend <= -0.3 ? 'sharp_decline' : trend < -0.1 ? 'decline' : trend >= 0.3 ? 'sharp_improvement' : trend > 0.1 ? 'improvement' : 'stable',
  };
}

function qualityAssessment(hotel, amenities, preferences) {
  const styles = parseJson(preferences?.travel_style, []).map(value => String(value).toLowerCase());
  const profiles = [];
  if (preferences?.budget_level === 'luxury') profiles.push('luxury');
  if (styles.includes('family')) profiles.push('family');
  if (styles.includes('business')) profiles.push('business');
  if (styles.includes('resort') || styles.includes('beach') || styles.includes('spa')) profiles.push('resort');
  if (styles.includes('gastronomy')) profiles.push('gastronomy');
  if (styles.includes('active')) profiles.push('active');
  const activeProfiles = [...new Set(profiles.length ? profiles : ['default'])];
  const qualityWeights = Object.fromEntries(Object.keys(QUALITY_PROFILES.default).map(key => [
    key,
    activeProfiles.reduce((sum, profile) => sum + QUALITY_PROFILES[profile][key], 0) / activeProfiles.length,
  ]));
  const facilityScores = activeProfiles
    .map(profile => QUALITY_FACILITIES[profile])
    .filter(Boolean)
    .map(wanted => amenities.length ? amenityMatchScore(wanted, wanted.filter(item => includesAmenity(amenities, item))) : null)
    .filter(value => value !== null);
  const styleFacilities = facilityScores.length ? facilityScores.reduce((sum, value) => sum + value, 0) / facilityScores.length : null;
  const reviewFreshness = reviewFreshnessAssessment(hotel);
  const scaleReview = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? clamp(Number(value) * 20) : null;
  const components = {
    rating: scaleReview(hotel.rating),
    cleanliness: scaleReview(hotel.cleanliness),
    service: scaleReview(hotel.service),
    location: scaleReview(hotel.location_score),
    style_facilities: styleFacilities,
    review_freshness: reviewFreshness.score,
  };
  const totalWeight = Object.values(qualityWeights).reduce((sum, value) => sum + value, 0);
  const knownWeight = Object.entries(components).reduce((sum, [key, value]) => sum + (value === null ? 0 : qualityWeights[key]), 0);
  return {
    score: weightedAverageOrNull(components, qualityWeights),
    reliability: totalWeight ? clamp((knownWeight / totalWeight) * 100) : 0,
    components,
    weights: qualityWeights,
    profiles: activeProfiles,
    reviewFreshness,
  };
}

function reviewConfidenceAssessment(hotel, freshness) {
  const optionalNumber = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
  const reviewCount = Math.max(0, Number(hotel.review_count) || 0);
  const countScore = reviewCount > 0 ? clamp((Math.log10(reviewCount + 1) / Math.log10(5001)) * 100) : null;
  const rawConsistency = optionalNumber(hotel.review_source_consistency);
  const sourceConsistency = rawConsistency === null ? null : clamp(rawConsistency * (rawConsistency <= 1 ? 100 : 1));
  const rawVerifiedShare = optionalNumber(hotel.verified_review_share);
  const verifiedShare = rawVerifiedShare === null ? null : clamp(rawVerifiedShare * (rawVerifiedShare <= 1 ? 100 : 1));
  const rawSuspiciousShare = optionalNumber(hotel.suspicious_review_share);
  const suspiciousShare = rawSuspiciousShare === null ? null : clamp(rawSuspiciousShare * (rawSuspiciousShare <= 1 ? 100 : 1));
  const integrityScore = suspiciousShare === null ? null : 100 - suspiciousShare;
  const stddev = optionalNumber(hotel.rating_stddev);
  const dispersionScore = stddev === null ? null
    : stddev <= 0.15 ? 65 : stddev <= 0.8 ? 100 : stddev <= 1.2 ? 85 : stddev <= 1.6 ? 65 : 40;
  const components = {
    review_volume: countScore,
    review_freshness: freshness.score,
    source_consistency: sourceConsistency,
    verified_stays: verifiedShare,
    review_integrity: weightedAverageOrNull({ suspicious_share: integrityScore, rating_dispersion: dispersionScore }, { suspicious_share: 0.7, rating_dispersion: 0.3 }),
  };
  const componentWeights = { review_volume: 0.40, review_freshness: 0.25, source_consistency: 0.20, verified_stays: 0.10, review_integrity: 0.05 };
  const knownWeight = Object.entries(components).reduce((sum, [key, value]) => sum + (value === null ? 0 : componentWeights[key]), 0);
  return {
    score: weightedAverageOrNull(components, componentWeights),
    reliability: clamp(knownWeight * 100),
    components,
    componentWeights,
    sourceCount: Math.max(0, Number(hotel.review_source_count) || (reviewCount > 0 ? 1 : 0)),
    structure: { rating_dispersion: dispersionScore, suspicious_share: integrityScore },
  };
}

function calculateHotelScore(hotel, preferences, weights, context) {
  const calculatedAt = new Date().toISOString();
  const isRu = context.language === 'ru';
  const pref = preferences || {};
  const rooms = context.roomsByHotel[hotel.id] || [];
  const hotelAmenities = [
    ...parseJson(hotel.amenities, []).map(String),
    ...rooms.flatMap(room => parseJson(room.amenities, []).map(String)),
  ];
  const views = [...new Set(rooms.map(room => room.view_type).filter(Boolean))];
  const roomNames = rooms.map(room => String(room.name || '')).filter(Boolean);
  const wantedStars = parseJson(pref.hotel_stars, []).map(Number);
  const wantedAmenities = parseJson(pref.hotel_amenities, []);
  const requiredAmenities = parseJson(pref.required_hotel_amenities, []);
  const scoredAmenities = wantedAmenities.filter(item => !requiredAmenities.includes(item));
  const wantedRoomTypes = parseJson(pref.room_type, []).map(value => String(value).toLowerCase());
  const wantedViews = parseJson(pref.room_view, []).map(value => String(value).toLowerCase());
  const budgetLevel = ['budget', 'mid', 'upscale', 'luxury'].includes(pref.budget_level) ? pref.budget_level : null;
  const budget = Number(pref.budget_per_night_max) || null;
  const numericPrice = Number(hotel.min_price);
  const price = Number.isFinite(numericPrice) && numericPrice > 0 ? numericPrice : null;
  const numericComparablePrice = Number(hotel.comparable_price);
  const comparablePrice = Number.isFinite(numericComparablePrice) && numericComparablePrice > 0 ? numericComparablePrice : price;

  const marketBenchmark = context.priceBenchmarkByHotel?.[hotel.id] || null;
  const relativePrice = benchmarkPriceScore(comparablePrice, marketBenchmark);
  const comparablePriceDetails = context.priceMetadataByHotel?.[hotel.id] || null;
  const priceDetails = comparablePriceDetails || {
    source: hotel.price_source || null, currency: null, tax_status: 'unknown', updated_at: null,
    price_warnings: ['price_metadata_unavailable'], is_stale: true, is_demonstration: false,
    is_displayable: false,
  };
  const reviewValue = hotel.value_score ? clamp(hotel.value_score * 20) : null;
  const priceValue = ['luxury', 'upscale'].includes(budgetLevel) ? null : relativePrice;
  const value = weightedAverageOrNull(
    { market_price: priceValue, guest_value: reviewValue },
    { market_price: 0.6, guest_value: 0.4 }
  );

  const qualityResult = qualityAssessment(hotel, hotelAmenities, pref);
  const quality = qualityResult.score;
  const reviewCount = Math.max(0, Number(hotel.review_count) || 0);
  const reviewConfidence = reviewConfidenceAssessment(hotel, qualityResult.reviewFreshness);
  const trust = reviewConfidence.score;

  const matchedAmenities = scoredAmenities.filter(item => includesAmenity(hotelAmenities, item));
  const unmatchedAmenities = scoredAmenities.filter(item => !matchedAmenities.includes(item));
  const roomTypeMatch = bestDescriptorMatch(wantedRoomTypes, roomNames, roomTypeSimilarity);
  const roomViewMatch = bestDescriptorMatch(wantedViews, views, roomViewSimilarity);
  const tierAssessment = travelTierAssessment(budgetLevel, hotel, relativePrice, {
    rooms, amenities: hotelAmenities, explicitStarPreference: wantedStars.length > 0,
  });
  const tierFit = tierAssessment.score;

  const preferenceParts = {
    hotel_stars: wantedStars.length && hotel.stars ? (wantedStars.includes(Number(hotel.stars)) ? 100 : 0) : null,
    // A non-empty provider catalogue makes selected optional amenities comparable;
    // a completely missing catalogue stays unknown and cannot lower the score.
    hotel_amenities: scoredAmenities.length && hotelAmenities.length ? amenityMatchScore(scoredAmenities, matchedAmenities) : null,
    room_type: wantedRoomTypes.length && roomNames.length ? roomTypeMatch.score : null,
    room_view: wantedViews.length && views.length ? roomViewMatch.score : null,
    budget: budget && price !== null
      ? (price <= budget ? 100 : clamp(100 - ((price - budget) / budget) * 150))
      : null,
    travel_tier: tierFit,
    // There is no reliable noise feature in the hotel catalogue yet.
    noise: null,
  };
  const effectiveWeights = effectivePreferenceWeights(weights);
  const personalFit = weightedAverageOrNull(preferenceParts, effectiveWeights);
  const breakdown = { value, quality, trust, preferences: personalFit };
  const fairworthScore = Math.round(normalizedWeightedAverage(breakdown, weights.score));

  // Reliability measures how much evidence supports the score. It is kept
  // separate so missing provider data never lowers the FairWorth Score itself.
  const comparisonWarnings = comparablePriceDetails?.comparison_adjustments || [];
  const rateEvidenceReliability = clamp(100
    - (comparisonWarnings.includes('tax_status_unknown') ? 20 : 0)
    - (comparisonWarnings.includes('occupancy_unverified') ? 20 : 0)
    - (comparisonWarnings.includes('room_type_mismatch') ? 15 : 0)
    - (comparablePriceDetails?.is_stale ? 20 : 0));
  const benchmarkReliability = marketBenchmark ? clamp((marketBenchmark.sample_size / 10) * 100) : 0;
  const marketPriceReliability = relativePrice === null ? 0 : Math.min(rateEvidenceReliability, benchmarkReliability);
  const valueReliability = ['luxury', 'upscale'].includes(budgetLevel)
    ? (reviewValue !== null ? 100 : 0)
    : normalizedWeightedAverage(
      { market_price: marketPriceReliability, guest_value: reviewValue !== null ? 100 : 0 },
      { market_price: 0.6, guest_value: 0.4 }
    );
  const preferenceReliabilityParts = {
    hotel_stars: wantedStars.length ? (hotel.stars ? 100 : 0) : null,
    hotel_amenities: scoredAmenities.length ? (hotelAmenities.length ? 100 : 0) : null,
    room_type: wantedRoomTypes.length ? (roomNames.length ? 100 : 0) : null,
    room_view: wantedViews.length ? (views.length ? 100 : 0) : null,
    budget: budget ? (price !== null ? 100 : 0) : null,
    travel_tier: budgetLevel ? tierAssessment.reliability : null,
    noise: Number(pref.noise_sensitivity) > 0 ? 0 : null,
  };
  const preferenceReliability = weightedAverageOrNull(preferenceReliabilityParts, effectiveWeights) ?? 0;
  const reliabilityBreakdown = {
    value: valueReliability,
    quality: qualityResult.reliability,
    trust: reviewConfidence.reliability,
    preferences: preferenceReliability,
  };
  const scoreReliability = Math.round(normalizedWeightedAverage(reliabilityBreakdown, weights.score));
  const liveSource = ['liteapi', 'xotelo'].includes(String(priceDetails.source || '').toLowerCase());
  const priceAge = Number(priceDetails.price_age_hours);
  let priceConfidence = price !== null && priceDetails.is_displayable !== false ? (liveSource ? 100 : 70) : 0;
  if (priceConfidence && Number.isFinite(priceAge)) {
    if (priceAge > 12) priceConfidence -= 40;
    else if (priceAge > 6) priceConfidence -= 20;
    else if (priceAge > 1) priceConfidence -= 15;
  }
  if (priceDetails.tax_status === 'unknown') priceConfidence -= 20;
  if (comparisonWarnings.includes('occupancy_unverified')) priceConfidence -= 15;
  if (comparisonWarnings.includes('room_type_mismatch')) priceConfidence -= 10;
  if (priceDetails.is_stale) priceConfidence = Math.min(priceConfidence, 35);
  if (priceDetails.is_demonstration || priceDetails.is_displayable === false) priceConfidence = 0;
  priceConfidence = Math.round(clamp(priceConfidence));
  const priceConfidenceLevel = priceConfidence >= 90 ? 'high' : priceConfidence >= 60 ? 'medium' : 'low';
  const topPickEligible = priceConfidence >= 60 && !priceDetails.is_stale && !priceDetails.is_demonstration && priceDetails.is_displayable !== false;
  const adjustedScore = Math.round(fairworthScore * 0.80 + scoreReliability * 0.10 + priceConfidence * 0.10);
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
  const strongest = Object.entries(breakdown).filter(([, value]) => value !== null).sort((a, b) => b[1] - a[1])[0] || ['value', 50];
  const unknownPreferenceData = [];
  if (wantedStars.length && !hotel.stars) unknownPreferenceData.push('star_rating');
  if (budget && price === null) unknownPreferenceData.push('price');
  if (budgetLevel && tierFit === null) unknownPreferenceData.push('travel_tier');
  if (budgetLevel && budgetLevel !== 'budget') {
    Object.entries(tierAssessment.breakdown)
      .filter(([key, value]) => value === null && !(key === 'luxury_review_sentiment' && budgetLevel !== 'luxury'))
      .forEach(([key]) => unknownPreferenceData.push(`travel_tier:${key}`));
  }
  Object.entries(qualityResult.components)
    .filter(([key, value]) => value === null && qualityResult.weights[key] > 0)
    .forEach(([key]) => unknownPreferenceData.push(`quality:${key}`));
  Object.entries(qualityResult.reviewFreshness.components)
    .filter(([, value]) => value === null)
    .forEach(([key]) => unknownPreferenceData.push(`review_freshness:${key}`));
  if (!hotelAmenities.length) scoredAmenities.forEach(item => unknownPreferenceData.push(`amenity:${item}`));
  if (wantedRoomTypes.length && !roomNames.length) unknownPreferenceData.push('room_type');
  if (wantedViews.length && !views.length) unknownPreferenceData.push('room_view');
  if (Number(pref.noise_sensitivity) > 0) unknownPreferenceData.push('noise_level');
  const explanation = isRu
    ? `Оценка ${fairworthScore}/100: сильнее всего повлиял компонент «${{ value: 'ценность', quality: 'качество', trust: 'доверие к отзывам', preferences: 'совпадение с предпочтениями' }[strongest[0]]}» (${Math.round(strongest[1])}/100).${personalFit === null ? ' Неподтверждённые предпочтения не снижали оценку.' : ` Персональное совпадение — ${Math.round(personalFit)}/100.`}`
    : `Score ${fairworthScore}/100: the strongest component is ${{ value: 'value', quality: 'quality', trust: 'review trust', preferences: 'preference match' }[strongest[0]]} (${Math.round(strongest[1])}/100).${personalFit === null ? ' Unconfirmed preferences did not reduce the score.' : ` Personal fit is ${Math.round(personalFit)}/100.`}`;

  const matches = [];
  const mismatches = [];
  if (preferenceParts.hotel_stars === 100) matches.push(isRu ? 'Подходящая звёздность' : 'Preferred star rating');
  else if (preferenceParts.hotel_stars === 0) mismatches.push(isRu ? 'Звёздность не совпадает' : 'Star rating does not match');
  if (wantedAmenities.length) {
    if (matchedAmenities.length) matches.push(`${isRu ? 'Совпали удобства' : 'Matching amenities'}: ${matchedAmenities.join(', ')}`);
    if (hotelAmenities.length && unmatchedAmenities.length) mismatches.push(`${isRu ? 'Не подтверждены желательные удобства' : 'Preferred amenities not confirmed'}: ${unmatchedAmenities.join(', ')}`);
  }
  if (preferenceParts.budget === 100) matches.push(isRu ? 'Цена в пределах вашего бюджета' : 'Price is within your budget');
  else if (preferenceParts.budget !== null) mismatches.push(isRu ? 'Цена выше вашего бюджета' : 'Price is above your budget');
  if (preferenceParts.travel_tier >= 80) matches.push(isRu ? 'Класс отеля соответствует стилю отдыха' : 'Hotel class matches your travel tier');
  else if (preferenceParts.travel_tier !== null && preferenceParts.travel_tier < 50) mismatches.push(isRu ? 'Класс отеля ниже выбранного уровня отдыха' : 'Hotel class is below your selected travel tier');
  if (preferenceParts.room_type >= 70) matches.push(isRu ? 'Тип номера близок к предпочтению' : 'Room type closely matches your preference');
  else if (preferenceParts.room_type !== null && preferenceParts.room_type < 50) mismatches.push(isRu ? 'Тип номера слабо соответствует предпочтению' : 'Room type is a weak match');
  if (preferenceParts.room_view >= 70) matches.push(isRu ? 'Есть предпочитаемый или близкий вид из номера' : 'Preferred or similar room view is available');
  else if (preferenceParts.room_view !== null && preferenceParts.room_view < 50) mismatches.push(isRu ? 'Вид из номера слабо соответствует предпочтению' : 'Room view is a weak match');

  return {
    ...hotel,
    fairworth_score: fairworthScore,
    adjusted_score: adjustedScore,
    price_confidence: priceConfidence,
    price_confidence_level: priceConfidenceLevel,
    top_pick_eligible: topPickEligible,
    score_reliability: scoreReliability,
    score_reliability_level: scoreReliability >= 80 ? 'high' : scoreReliability >= 60 ? 'medium' : 'low',
    base_score: Math.round(normalizedWeightedAverage(
      { value, quality, trust },
      { value: weights.score.value, quality: weights.score.quality, trust: weights.score.trust }
    )),
    personal_fit: personalFit === null ? null : Math.round(personalFit),
    travel_tier_score: tierFit === null ? null : Math.round(tierFit),
    personalized: Boolean(preferences),
    score_version: SCORE_VERSION,
    calculated_at: calculatedAt,
    calculation_parameters: {
      score_weights: weights.score,
      effective_preference_weights: effectiveWeights,
      learning_confidence: weights.confidence,
      contextual_learning_confidence: weights.contextualConfidence || 0,
      active_learning_contexts: weights.activeContexts || [],
      market_price_sample_size: marketBenchmark?.sample_size || 0,
      market_price_segment: marketBenchmark?.segment || null,
      ranking_formula: 'fairworth_score * 0.80 + score_reliability * 0.10 + price_confidence * 0.10',
      language: context.language,
    },
    learning_confidence: weights.confidence,
    score_breakdown: Object.fromEntries(Object.entries(breakdown).map(([key, value]) => [key, value === null ? null : Math.round(value)])),
    reliability_breakdown: Object.fromEntries(Object.entries(reliabilityBreakdown).map(([key, value]) => [key, Math.round(value)])),
    quality_breakdown: Object.fromEntries(Object.entries(qualityResult.components).map(([key, value]) => [key, value === null ? null : Math.round(value)])),
    quality_weights: qualityResult.weights,
    quality_profiles: qualityResult.profiles,
    review_freshness_breakdown: Object.fromEntries(Object.entries(qualityResult.reviewFreshness.components).map(([key, value]) => [key, value === null ? null : Math.round(value)])),
    review_freshness_reliability: Math.round(qualityResult.reviewFreshness.reliability),
    latest_review_at: hotel.latest_review_at || null,
    recent_review_share: hotel.recent_review_share === null || hotel.recent_review_share === undefined || hotel.recent_review_share === '' || !Number.isFinite(Number(hotel.recent_review_share)) ? null : Number(hotel.recent_review_share),
    rating_trend: qualityResult.reviewFreshness.trend,
    rating_trend_direction: qualityResult.reviewFreshness.trend_direction,
    review_confidence: trust === null ? null : Math.round(trust),
    review_confidence_reliability: Math.round(reviewConfidence.reliability),
    review_confidence_breakdown: Object.fromEntries(Object.entries(reviewConfidence.components).map(([key, value]) => [key, value === null ? null : Math.round(value)])),
    review_confidence_weights: reviewConfidence.componentWeights,
    review_source_count: reviewConfidence.sourceCount,
    review_structure_breakdown: Object.fromEntries(Object.entries(reviewConfidence.structure).map(([key, value]) => [key, value === null ? null : Math.round(value)])),
    travel_tier_breakdown: Object.fromEntries(Object.entries(tierAssessment.breakdown).map(([key, value]) => [key, value === null ? null : Math.round(value)])),
    travel_tier_weights: tierAssessment.weights,
    preference_matches: matches,
    preference_mismatches: mismatches,
    room_preference_match: {
      type: { ...roomTypeMatch, score: roomTypeMatch.score === null ? null : Math.round(roomTypeMatch.score) },
      view: { ...roomViewMatch, score: roomViewMatch.score === null ? null : Math.round(roomViewMatch.score) },
    },
    unknown_preference_data: [...new Set(unknownPreferenceData)],
    price_details: priceDetails,
    comparable_price: comparablePrice,
    market_price_benchmark: marketBenchmark,
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

async function learnFromInteraction(userId, hotelId, signal, context = {}) {
  if (!hotelId || !signal) return;
  const hotel = await db.prepare('SELECT * FROM hotels WHERE id = ?').get(hotelId);
  const prefs = await db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get(userId);
  if (!hotel || !prefs) return;
  const row = await db.prepare('SELECT learned_weights FROM user_preference_weights WHERE user_id = ?').get(userId);
  if (!row) return;
  const learned = parseJson(row.learned_weights, { ...DEFAULT_PREFERENCE_WEIGHTS });
  const hotelAmenities = parseJson(hotel.amenities, []);
  const wantedAmenities = parseJson(prefs.hotel_amenities, []);
  const requiredAmenities = parseJson(prefs.required_hotel_amenities, []);
  const scoredAmenities = wantedAmenities.filter(item => !requiredAmenities.includes(item));
  const wantedStars = parseJson(prefs.hotel_stars, []).map(Number);
  const wantedTypes = parseJson(prefs.room_type, []).map(value => String(value).toLowerCase());
  const wantedViews = parseJson(prefs.room_view, []).map(value => String(value).toLowerCase());
  const budgetLevel = ['budget', 'mid', 'upscale', 'luxury'].includes(prefs.budget_level) ? prefs.budget_level : null;
  const rooms = await db.prepare('SELECT name, size_sqm, view_type, amenities FROM hotel_rooms WHERE hotel_id = ?').all(hotelId);
  const allAmenities = [...hotelAmenities, ...rooms.flatMap(room => parseJson(room.amenities, []))];
  const minPrice = (await db.prepare('SELECT MIN(price_per_night) AS price FROM hotel_prices WHERE hotel_id = ? AND price_valid = 1').get(hotelId))?.price;
  const review = await db.prepare('SELECT rating, cleanliness, service, location_score FROM hotel_reviews WHERE hotel_id = ?').get(hotelId);
  const learnedTierFit = budgetLevel ? travelTierAssessment(budgetLevel, { ...hotel, ...review }, null, {
    rooms, amenities: allAmenities, explicitStarPreference: wantedStars.length > 0,
  }).score : null;
  const confirmedAmenities = scoredAmenities.filter(item => includesAmenity(allAmenities, item));
  const typeMatch = bestDescriptorMatch(wantedTypes, rooms.map(room => room.name).filter(Boolean), roomTypeSimilarity);
  const viewMatch = bestDescriptorMatch(wantedViews, rooms.map(room => room.view_type).filter(Boolean), roomViewSimilarity);
  const matches = {
    hotel_stars: wantedStars.length ? (hotel.stars ? (wantedStars.includes(Number(hotel.stars)) ? 1 : 0) : null) : 0.5,
    hotel_amenities: scoredAmenities.length && allAmenities.length ? amenityMatchScore(scoredAmenities, confirmedAmenities) / 100 : null,
    room_type: wantedTypes.length && rooms.some(room => room.name) ? typeMatch.score / 100 : null,
    room_view: wantedViews.length && rooms.some(room => room.view_type) ? viewMatch.score / 100 : null,
    budget: prefs.budget_per_night_max && minPrice ? (Number(minPrice) <= Number(prefs.budget_per_night_max) ? 1 : 0) : null,
    travel_tier: budgetLevel ? (learnedTierFit == null ? null : learnedTierFit / 100) : 0.5,
    noise: null,
  };
  const feedbackReason = String(context.feedback_reason || '');
  const feedbackTargets = {
    too_expensive: ['budget'], low_stars: ['hotel_stars'], missing_pool: ['hotel_amenities'],
    bad_location: [], photos: [], other: [],
  };
  const targetKeys = feedbackTargets[feedbackReason] || Object.keys(DEFAULT_PREFERENCE_WEIGHTS);
  if (feedbackReason === 'too_expensive') matches.budget = 0;
  if (feedbackReason === 'low_stars') matches.hotel_stars = 0;
  if (feedbackReason === 'missing_pool') matches.hotel_amenities = allAmenities.some(item => includesAmenity([item], 'pool')) ? 1 : 0;
  if (feedbackReason && !targetKeys.length) return;
  const alpha = Math.min(0.12, 0.015 * Math.abs(signal));
  Object.keys(DEFAULT_PREFERENCE_WEIGHTS).forEach(key => {
    if (!targetKeys.includes(key)) return;
    if (matches[key] === null) return;
    const target = signal > 0 ? matches[key] : 1 - matches[key];
    const current = Number.isFinite(Number(learned[key])) ? Number(learned[key]) : DEFAULT_PREFERENCE_WEIGHTS[key];
    learned[key] = Math.max(0.02, current + alpha * (target - current));
  });
  const total = Object.values(learned).reduce((sum, value) => sum + value, 0);
  Object.keys(learned).forEach(key => { learned[key] /= total; });
  const evidence = Number((await db.prepare(`SELECT COALESCE(SUM(LEAST(ABS(signal), 10)), 0) AS strength FROM user_interactions WHERE user_id = ? AND signal != 0`).get(userId)).strength || 0);
  const confidence = Math.min(0.8, evidence / 100 * 0.8);
  await db.prepare(`UPDATE user_preference_weights SET learned_weights = ?, learning_confidence = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`)
    .run(JSON.stringify(learned), confidence, userId);

  const segments = tripContextSegments({ ...context, destination: context.destination || context.city || hotel.city }, prefs);
  for (const segment of segments) {
    let contextual = await db.prepare(`SELECT * FROM user_context_preference_weights WHERE user_id = ? AND context_type = ? AND context_value = ?`).get(userId, segment.type, segment.value);
    if (!contextual) {
      await db.prepare(`INSERT INTO user_context_preference_weights (id, user_id, context_type, context_value, learned_weights) VALUES (?, ?, ?, ?, ?) ON CONFLICT (user_id, context_type, context_value) DO NOTHING`)
        .run(uuidv4(), userId, segment.type, segment.value, JSON.stringify(DEFAULT_PREFERENCE_WEIGHTS));
      contextual = await db.prepare(`SELECT * FROM user_context_preference_weights WHERE user_id = ? AND context_type = ? AND context_value = ?`).get(userId, segment.type, segment.value);
    }
    const contextualWeights = parseJson(contextual.learned_weights, { ...DEFAULT_PREFERENCE_WEIGHTS });
    Object.keys(DEFAULT_PREFERENCE_WEIGHTS).forEach(key => {
      if (!targetKeys.includes(key)) return;
      if (matches[key] === null) return;
      const target = signal > 0 ? matches[key] : 1 - matches[key];
      const current = Number(contextualWeights[key]) || DEFAULT_PREFERENCE_WEIGHTS[key];
      contextualWeights[key] = Math.max(0.02, current + alpha * (target - current));
    });
    await db.prepare(`UPDATE user_context_preference_weights SET learned_weights = ?, evidence_strength = evidence_strength + ?, interaction_count = interaction_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(JSON.stringify(normalizeWeights(contextualWeights)), Math.min(10, Math.abs(signal)), contextual.id);
  }
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
  tripContextSegments,
  tripContextKey,
  roomTypeSimilarity,
  roomViewSimilarity,
};
