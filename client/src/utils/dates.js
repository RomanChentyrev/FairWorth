export function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function defaultTravelDates() {
  const checkIn = addDays(new Date(), 30);
  return {
    check_in: formatLocalDate(checkIn),
    check_out: formatLocalDate(addDays(checkIn, 4)),
  };
}

export function validFutureDates(saved = {}) {
  const defaults = defaultTravelDates();
  const today = formatLocalDate(new Date());
  if (!saved.check_in || !saved.check_out || saved.check_in < today || saved.check_out <= saved.check_in) return defaults;
  return saved;
}

export function validFutureDate(value, fallback = defaultTravelDates().check_in) {
  return value && value >= formatLocalDate(new Date()) ? value : fallback;
}
