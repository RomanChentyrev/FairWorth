async function callAIChat(messages, options = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = options.model || process.env.OPENROUTER_MODEL || 'openrouter/auto';

  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured on the server');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.OPENROUTER_TIMEOUT_MS || 30000));

  let res;
  try { res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:5173',
      'X-Title': 'Fairworth',
    },
    signal: controller.signal,
    body: JSON.stringify({
      model,
      max_tokens: options.maxTokens || 1024,
      temperature: options.temperature ?? 0.2,
      messages,
      ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
    }),
  }); } finally { clearTimeout(timeout); }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const rawMessage = data?.error?.message || data?.message || `OpenRouter HTTP ${res.status}`;
    const message = String(rawMessage).replace(/\s*Manage it using https:\/\/openrouter\.ai\/\S+/i, '');
    throw new Error(message);
  }

  const text = data?.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error('OpenRouter returned an empty response');
  }

  return text.trim();
}

async function callAI(prompt) {
  return callAIChat([{ role: 'user', content: prompt }]);
}

const LANGUAGE_NAMES = {
  en: 'English',
  ru: 'Russian',
  de: 'German',
  fr: 'French',
  it: 'Italian',
  es: 'Spanish',
  'zh-CN': 'Simplified Chinese',
  ar: 'Modern Standard Arabic',
};

function supportedLanguage(language) {
  return Object.hasOwn(LANGUAGE_NAMES, language) ? language : 'en';
}

function languageName(language) {
  return LANGUAGE_NAMES[supportedLanguage(language)];
}

function parseAIJson(text) {
  const clean = String(text || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  try {
    return JSON.parse(clean);
  } catch {
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('AI response did not contain JSON');
    return JSON.parse(match[0]);
  }
}

/**
 * Generate personalised hotel analysis based on user preferences
 */
async function analyzeHotel(hotel, rooms, reviews, prices, userPrefs, checkIn, checkOut, language = 'en') {
  const nights = Math.ceil((new Date(checkOut) - new Date(checkIn)) / (1000 * 60 * 60 * 24));

  const responseLanguage = languageName(language);
  const prompt = `You are a luxury travel AI analyst. Analyze this hotel for a specific traveler and return a JSON response. Write all user-facing text in ${responseLanguage}.

HOTEL DATA:
- Name: ${hotel.name}
- Location: ${hotel.location}, ${hotel.city}
- Stars: ${hotel.stars}
- Description: ${hotel.description}
- Amenities: ${JSON.parse(hotel.amenities).join(', ')}

ROOM OPTIONS:
${rooms.map(r => `- ${r.name}: ${r.size_sqm}m², ${r.view_type} view, $${r.base_price_per_night}/night`).join('\n')}

REVIEWS:
- Overall rating: ${reviews?.rating}/5 (${reviews?.count?.toLocaleString()} reviews)
- Cleanliness: ${reviews?.cleanliness}/5
- Service: ${reviews?.service}/5
- Location: ${reviews?.location_score}/5
- Value: ${reviews?.value}/5

PRICES (per night):
${prices.map(p => `- ${p.operator}: $${p.price_per_night} (${p.includes_breakfast ? 'breakfast included' : 'no breakfast'}, ${p.cancellation_policy})`).join('\n')}

TRAVEL DATES: ${checkIn} to ${checkOut} (${nights} nights)

USER PREFERENCES:
- Hotel category: ${JSON.parse(userPrefs.hotel_stars || '[]').join(', ')} stars
- Room type: ${JSON.parse(userPrefs.room_type || '[]').join(', ')}
- Preferred views: ${JSON.parse(userPrefs.room_view || '[]').join(', ')}
- Amenities needed: ${JSON.parse(userPrefs.hotel_amenities || '[]').join(', ')}
- Required amenities: ${JSON.parse(userPrefs.required_hotel_amenities || '[]').join(', ')}
- Travel style: ${JSON.parse(userPrefs.travel_style || '[]').join(', ')}
- Budget max per night: $${userPrefs.budget_per_night_max}
- Noise sensitivity: ${userPrefs.noise_sensitivity}/100 (higher = more sensitive)
- Preferred airlines: ${JSON.parse(userPrefs.preferred_airlines || '[]').join(', ')}

Respond ONLY with valid JSON (no markdown, no explanation), in this exact structure:
{
  "fairworth_score": <number 0-100>,
  "score_breakdown": {
    "value": <number 0-100>,
    "quality": <number 0-100>,
    "trust": <number 0-100>,
    "risk": "low" | "medium" | "high"
  },
  "verdict": "<2-3 sentence overall verdict in ${responseLanguage}>",
  "best_room": {
    "name": "<room name>",
    "why": "<reason in ${responseLanguage}, 2 sentences>",
    "price_per_night": <number>
  },
  "booking_timing": "<advice on when/whether to book now, in ${responseLanguage}, 2 sentences>",
  "warnings": ["<warning in ${responseLanguage}>", ...],
  "weather_note": "<brief weather note for the travel dates in ${responseLanguage}>",
  "personalization_match": {
    "matches": ["<matched preference in ${responseLanguage}>", ...],
    "mismatches": ["<unmatched preference in ${responseLanguage}>", ...]
  },
  "best_operator": {
    "name": "<operator name>",
    "price": <number>,
    "why": "<reason in ${responseLanguage}>"
  }
}`;

  const text = await callAI(prompt);
  return parseAIJson(text);
}

/**
 * Generate AI comparison verdict for multiple hotels
 */
async function compareHotels(hotelsData, userPrefs, language = 'en') {
  const responseLanguage = languageName(language);
  const prompt = `You are a luxury travel AI analyst. Compare these hotels and give a recommendation. Return JSON only. Write all user-facing text in ${responseLanguage}.

HOTELS TO COMPARE:
${hotelsData.map((h, i) => `
${i + 1}. ${h.hotel.name} (${h.hotel.location})
   - Fairworth Score: ${h.score || 'N/A'}
   - Price: $${h.bestPrice}/night
   - Rating: ${h.reviews?.rating}/5
   - Key features: ${JSON.parse(h.hotel.amenities || '[]').slice(0, 5).join(', ')}
`).join('')}

USER PREFERENCES:
- Travel style: ${JSON.parse(userPrefs.travel_style || '[]').join(', ')}
- Budget max: $${userPrefs.budget_per_night_max}/night
- Noise sensitivity: ${userPrefs.noise_sensitivity}/100
- Preferred views: ${JSON.parse(userPrefs.room_view || '[]').join(', ')}
- Amenities needed: ${JSON.parse(userPrefs.hotel_amenities || '[]').join(', ')}
- Required amenities: ${JSON.parse(userPrefs.required_hotel_amenities || '[]').join(', ')}

Return ONLY valid JSON:
{
  "winner_id": "<hotel id>",
  "winner_name": "<hotel name>",
  "verdict": "<paragraph in ${responseLanguage} explaining the best choice and why>",
  "rankings": [
    {"hotel_name": "<name>", "rank": 1, "one_line": "<reason in ${responseLanguage}>"},
    ...
  ],
  "budget_pick": "<hotel name> — <reason in ${responseLanguage}, 1 sentence>",
  "luxury_pick": "<hotel name> — <reason in ${responseLanguage}, 1 sentence>"
}`;

  const text = await callAI(prompt);
  return parseAIJson(text);
}

/**
 * Update user AI profile based on search/booking behavior
 */
async function updateUserProfile(userPrefs, recentSearches) {
  if (!recentSearches.length) return userPrefs.ai_profile ? JSON.parse(userPrefs.ai_profile) : {};

  const prompt = `Analyze this user's travel search behavior and extract insights. Return JSON only.

CURRENT PREFERENCES: ${JSON.stringify(userPrefs)}
RECENT SEARCHES: ${JSON.stringify(recentSearches)}

Return ONLY valid JSON:
{
  "inferred_budget": "<budget range>",
  "travel_frequency": "<estimated trips per year>",
  "preferred_trip_duration": "<days>",
  "top_destinations": ["<dest>"],
  "travel_persona": "<luxury seeker / family traveler / business traveler / adventurer>",
  "insights": ["<insight in Russian>", ...]
}`;

  const text = await callAI(prompt);
  return parseAIJson(text);
}

module.exports = { analyzeHotel, compareHotels, updateUserProfile, callAI, callAIChat, languageName, supportedLanguage, parseAIJson };
