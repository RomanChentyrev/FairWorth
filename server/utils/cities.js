const HOTEL_CITY_ALIASES = new Map([
  ['сингапур', 'Singapore'],
  ['дубай', 'Dubai'],
  ['абу-даби', 'Abu Dhabi'],
  ['париж', 'Paris'],
  ['нью-йорк', 'New York'],
  ['москва', 'Moscow'],
  ['пекин', 'Beijing'],
  ['шанхай', 'Shanghai'],
  ['нячанг', 'Nha Trang'],
  ['дананг', 'Da Nang'],
  ['куала-лумпур', 'Kuala Lumpur'],
]);

function canonicalHotelCity(value = '') {
  const cleaned = String(value).replace(/\s*\([^)]*\)/, '').trim();
  return HOTEL_CITY_ALIASES.get(cleaned.toLocaleLowerCase()) || cleaned;
}

module.exports = { canonicalHotelCity };
