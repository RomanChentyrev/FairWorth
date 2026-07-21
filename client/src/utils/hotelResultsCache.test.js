import { beforeEach, describe, expect, it } from 'vitest';
import {
  HOTEL_RESULTS_CACHE_KEY,
  HOTEL_RESULTS_CACHE_VERSION,
  hotelResultsRequestKey,
  readHotelResultsCache,
} from './hotelResultsCache';

const search = { city: 'Singapore', checkIn: '2026-08-17', checkOut: '2026-08-18', guests: 2, tripPurpose: 'leisure' };
const filters = { sort: 'score', stars: ['5'], priceRange: [0, 2000], ratingMin: 0, amenities: ['pool'], districts: [], freeCancel: false, breakfastIncl: false };

describe('hotel results cache', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it('restores a fresh cache for the same user and search', () => {
    window.sessionStorage.setItem(HOTEL_RESULTS_CACHE_KEY, JSON.stringify({
      version: HOTEL_RESULTS_CACHE_VERSION,
      userKey: '7',
      language: 'ru',
      search,
      filters,
      hotels: [{ id: 'hotel-1' }],
      savedAt: 1_000,
    }));

    expect(readHotelResultsCache({ search, language: 'ru', userKey: '7', now: 2_000 })?.hotels).toEqual([{ id: 'hotel-1' }]);
  });

  it('does not restore another user cache or an expired cache', () => {
    window.sessionStorage.setItem(HOTEL_RESULTS_CACHE_KEY, JSON.stringify({
      version: HOTEL_RESULTS_CACHE_VERSION,
      userKey: '7',
      language: 'ru',
      search,
      filters,
      hotels: [{ id: 'hotel-1' }],
      savedAt: 1_000,
    }));

    expect(readHotelResultsCache({ search, language: 'ru', userKey: '8', now: 2_000 })).toBeNull();
    expect(readHotelResultsCache({ search, language: 'ru', userKey: '7', now: 1_000 + 16 * 60 * 1000 })).toBeNull();
  });

  it('uses a stable request key for unordered filter values', () => {
    const first = hotelResultsRequestKey({ search, filters, language: 'ru' });
    const second = hotelResultsRequestKey({ search, filters: { ...filters, stars: ['5'], amenities: ['pool'] }, language: 'ru' });
    expect(first).toBe(second);
  });
});
