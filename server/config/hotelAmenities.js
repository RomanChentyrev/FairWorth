const AMENITY_DEFINITIONS = Object.freeze({
  wifi: ['wifi', 'wi fi', 'wireless internet', 'internet access', 'high speed internet'],
  pool: ['pool', 'swimming pool'],
  parking: ['parking', 'car park', 'valet parking'],
  valet: ['valet', 'valet parking', 'valet service'],
  air_conditioning: ['air conditioning', 'air conditioned', 'climate control'],
  spa: ['spa', 'massage', 'sauna', 'wellness centre', 'wellness center'],
  gym: ['gym', 'fitness', 'health club'],
  restaurant: ['restaurant', 'dining venue'],
  beach: ['beach', 'private beach', 'beachfront'],
  airport_shuttle: ['airport shuttle', 'airport transfer', 'transfer to airport', 'transfer from airport'],
  tennis: ['tennis', 'tennis court'],
  family_rooms: ['family room', 'family rooms', 'kids club', 'children club'],
  pets_allowed: ['pets allowed', 'pet friendly', 'pets welcome', 'dogs allowed'],
  accessible: ['wheelchair accessible', 'accessible room', 'disability access', 'facilities for disabled'],
  bathtub: ['bathtub', 'bath tub', 'spa bath'],
  balcony: ['balcony', 'private balcony', 'terrace'],
  kitchen: ['kitchen', 'kitchenette', 'cooking facilities'],
  soundproofing: ['soundproof', 'soundproofed room'],
  breakfast: ['breakfast'],
  bar: ['bar', 'lounge'],
  concierge: ['concierge'],
  club_lounge: ['club lounge', 'executive lounge', 'lounge access'],
});

const AMENITY_SCORE_WEIGHTS = Object.freeze({
  wifi: 0.7,
  air_conditioning: 0.9,
  parking: 1.0,
  valet: 1.3,
  restaurant: 1.0,
  breakfast: 1.1,
  gym: 1.1,
  pool: 1.2,
  spa: 1.3,
  airport_shuttle: 1.2,
  beach: 1.4,
  tennis: 1.5,
  bathtub: 1.2,
  balcony: 1.1,
  kitchen: 1.3,
  soundproofing: 1.4,
  family_rooms: 1.4,
  pets_allowed: 1.5,
  accessible: 1.6,
  bar: 0.8,
  concierge: 1.2,
  club_lounge: 1.4,
});

function normalizeText(value = '') {
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizedAmenity(name = '') {
  const value = normalizeText(name);
  for (const [key, aliases] of Object.entries(AMENITY_DEFINITIONS)) {
    if (aliases.some(alias => value.includes(alias))) return key;
  }
  return value.replace(/ /g, '_').slice(0, 80);
}

function amenitySearchTerms(key) {
  const canonical = normalizedAmenity(key);
  return [...new Set([canonical, canonical.replace(/_/g, ' '), ...(AMENITY_DEFINITIONS[canonical] || [])])];
}

function amenityMatches(actualAmenities, wanted) {
  const canonical = normalizedAmenity(wanted);
  return actualAmenities.some(item => normalizedAmenity(item) === canonical);
}

function amenityWeight(amenity) {
  return AMENITY_SCORE_WEIGHTS[normalizedAmenity(amenity)] || 1;
}

module.exports = { AMENITY_DEFINITIONS, AMENITY_SCORE_WEIGHTS, normalizeText, normalizedAmenity, amenitySearchTerms, amenityMatches, amenityWeight };
