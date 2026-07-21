export const HOTEL_RESULTS_CACHE_KEY = 'fairworth_hotel_results_cache';
export const HOTEL_RESULTS_CACHE_VERSION = 17;
export const HOTEL_RESULTS_CACHE_TTL_MS = 15 * 60 * 1000;

export function hotelResultsUserKey() {
  try {
    const user = JSON.parse(window.localStorage.getItem('fw_user') || 'null');
    return user?.id ? String(user.id) : null;
  } catch {
    return null;
  }
}

export function hotelResultsRequestKey({ search, filters, language }) {
  return JSON.stringify({
    search: {
      city: search.city,
      checkIn: search.checkIn,
      checkOut: search.checkOut,
      guests: String(search.guests),
      tripPurpose: search.tripPurpose,
    },
    filters: {
      sort: filters.sort,
      stars: [...filters.stars].sort(),
      priceRange: filters.priceRange,
      ratingMin: filters.ratingMin,
      amenities: [...filters.amenities].sort(),
      districts: [...filters.districts].sort(),
      freeCancel: filters.freeCancel,
      breakfastIncl: filters.breakfastIncl,
    },
    language,
  });
}

export function readHotelResultsCache({ search, language, userKey = hotelResultsUserKey(), now = Date.now() }) {
  try {
    const cached = JSON.parse(window.sessionStorage.getItem(HOTEL_RESULTS_CACHE_KEY) || 'null');
    const sameSearch = cached?.version === HOTEL_RESULTS_CACHE_VERSION
      && cached?.userKey === userKey
      && cached?.language === language
      && cached?.search?.city === search.city
      && cached.search.checkIn === search.checkIn
      && cached.search.checkOut === search.checkOut
      && String(cached.search.guests) === String(search.guests)
      && cached.search.tripPurpose === search.tripPurpose;
    if (!sameSearch || now - cached.savedAt > HOTEL_RESULTS_CACHE_TTL_MS || !Array.isArray(cached.hotels)) return null;
    return cached;
  } catch {
    return null;
  }
}

export function compactCachedHotel(hotel) {
  const { content_raw_json, description, ...cardData } = hotel;
  return cardData;
}
