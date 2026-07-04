function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function defaultTravelDates() {
  const checkIn = addDays(new Date(), 30);
  return { checkIn: formatDate(checkIn), checkOut: formatDate(addDays(checkIn, 4)) };
}

function validateDateRange(checkIn, checkOut) {
  const today = formatDate(new Date());
  return /^\d{4}-\d{2}-\d{2}$/.test(checkIn || '')
    && /^\d{4}-\d{2}-\d{2}$/.test(checkOut || '')
    && checkIn >= today && checkOut > checkIn;
}

module.exports = { formatDate, addDays, defaultTravelDates, validateDateRange };
