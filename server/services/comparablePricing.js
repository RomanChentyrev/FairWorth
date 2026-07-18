const { normalizePrice } = require('./pricing');

function roomCategory(value = '') {
  const text = String(value).toLowerCase();
  if (/villa/.test(text)) return 'villa';
  if (/suite|penthouse/.test(text)) return 'suite';
  if (/executive|club/.test(text)) return 'executive';
  if (/deluxe|premium|superior/.test(text)) return 'deluxe';
  if (/family/.test(text)) return 'family';
  if (/standard|classic/.test(text)) return 'standard';
  return text.trim() ? 'other' : null;
}

function parseRaw(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

function selectComparableRate(prices, {
  guests = 2,
  preferredRoomTypes = [],
  breakfastPreferred = false,
  breakfastRequired = false,
  refundableRequired = false,
  ttlHours = 12,
} = {}) {
  const requestedGuests = Math.max(1, Number(guests) || 2);
  const preferredCategories = preferredRoomTypes.map(roomCategory).filter(Boolean);
  const candidates = prices.map(price => {
    const normalized = normalizePrice(price, ttlHours);
    if (!normalized?.is_displayable || !(Number(normalized.stay_total_price) > 0)) return null;
    const raw = parseRaw(price.raw_json);
    const rateGuests = Number(price.guests || raw.guests || raw.adults || 0) || null;
    if (rateGuests && rateGuests < requestedGuests) return null;
    const category = roomCategory(price.room_name || raw.room_name || raw.roomName || raw.roomTypeName || price.room_type_id);
    const roomMatch = !preferredCategories.length || (category && preferredCategories.includes(category));
    const refundable = price.refundable === 1 || price.refundable === true || price.cancellation_policy === 'free_cancellation';
    const breakfast = price.includes_breakfast === 1 || price.includes_breakfast === true;
    if (breakfastRequired && !breakfast) return null;
    if (refundableRequired && !refundable) return null;
    const taxKnown = normalized.tax_status !== 'unknown';
    let adjustment = 1;
    const adjustments = [];
    if (!roomMatch) { adjustment *= 1.12; adjustments.push('room_type_mismatch'); }
    if (!rateGuests) { adjustment *= 1.07; adjustments.push('occupancy_unverified'); }
    if (!refundable) { adjustment *= 1.08; adjustments.push('non_refundable'); }
    if (breakfastPreferred && !breakfast) { adjustment *= 1.06; adjustments.push('breakfast_not_included'); }
    if (!taxKnown) { adjustment *= 1.05; adjustments.push('tax_status_unknown'); }
    const nights = Math.max(1, Number(raw.nights) || Math.round(Number(normalized.stay_total_price) / Number(normalized.nightly_total_price)) || 1);
    return {
      ...normalized,
      requested_guests: requestedGuests,
      rate_guests: rateGuests,
      room_category: category,
      room_match: roomMatch,
      refundable,
      includes_breakfast: breakfast,
      comparison_adjustments: adjustments,
      comparable_nightly_price: Number(normalized.stay_total_price) / nights * adjustment,
      payable_nightly_price: Number(normalized.stay_total_price) / nights,
      comparison_adjustment_factor: adjustment,
    };
  }).filter(Boolean);
  return candidates.sort((a, b) => a.comparable_nightly_price - b.comparable_nightly_price || a.payable_nightly_price - b.payable_nightly_price)[0] || null;
}

function rateAvailability(rate, { checkIn, checkOut, guests = 2 } = {}) {
  const requestedGuests = Math.max(1, Number(guests) || 2);
  const rateGuests = Number(rate?.rate_guests || rate?.guests || 0) || null;
  let status = 'unavailable';
  if (rate?.is_demonstration) status = 'demonstration';
  else if (rate?.is_stale) status = 'stale';
  else if (rate && rate.is_displayable !== false && !(Number(rate.payable_nightly_price) > 0)) status = 'invalid_price';
  else if (rate && (!rateGuests || rateGuests < requestedGuests)) status = 'occupancy_unverified';
  else if (rate?.is_displayable !== false && Number(rate?.payable_nightly_price) > 0) status = 'available';

  return {
    availability_status: status,
    rate_freshness: status === 'available'
      ? (Number(rate.price_age_hours) <= 0.1 ? 'fresh' : 'cached')
      : null,
    rate_checked_for: {
      check_in: checkIn,
      check_out: checkOut,
      guests: requestedGuests,
    },
  };
}

function percentile(sorted, ratio) {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * ratio;
  const lower = Math.floor(index);
  const fraction = index - lower;
  return sorted[lower + 1] === undefined ? sorted[lower] : sorted[lower] + fraction * (sorted[lower + 1] - sorted[lower]);
}

function marketBenchmark(target, offers, minimumSample = 3) {
  const sameCity = offers.filter(item => String(item.city).toLowerCase() === String(target.city).toLowerCase() && item.hotel_id !== target.hotel_id);
  const levels = [
    { name: 'city_stars_district_room', match: item => Number(item.stars) === Number(target.stars) && item.location === target.location && item.room_category === target.room_category },
    { name: 'city_stars_district', match: item => Number(item.stars) === Number(target.stars) && item.location === target.location },
    { name: 'city_stars_room', match: item => Number(item.stars) === Number(target.stars) && item.room_category === target.room_category },
    { name: 'city_stars', match: item => Number(item.stars) === Number(target.stars) },
    { name: 'city', match: () => true },
  ];
  let segment = null;
  let sample = [];
  for (const level of levels) {
    const matches = sameCity.filter(level.match);
    if (matches.length >= minimumSample) { segment = level.name; sample = matches; break; }
  }
  if (!sample.length) return null;
  const values = sample.map(item => Number(item.comparable_nightly_price)).filter(value => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (values.length < minimumSample) return null;
  return {
    segment,
    sample_size: values.length,
    p25: percentile(values, 0.25),
    median: percentile(values, 0.5),
    p75: percentile(values, 0.75),
    currency: target.currency || 'USD',
  };
}

function benchmarkPriceScore(price, benchmark) {
  if (!Number.isFinite(Number(price)) || !benchmark) return null;
  const value = Number(price);
  const { p25, median, p75 } = benchmark;
  if (value <= p25) return 100;
  if (value <= median) return 100 - ((value - p25) / Math.max(1, median - p25)) * 25;
  if (value <= p75) return 75 - ((value - median) / Math.max(1, p75 - median)) * 25;
  return Math.max(0, 50 - ((value - p75) / Math.max(1, p75)) * 50);
}

module.exports = { roomCategory, selectComparableRate, rateAvailability, marketBenchmark, benchmarkPriceScore };
