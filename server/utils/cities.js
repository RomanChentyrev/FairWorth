const HOTEL_CITY_ALIASES = new Map([
  ['сингапур', 'Singapore'],
  ['дубай', 'Dubai'],
  ['абу-даби', 'Abu Dhabi'],
  ['париж', 'Paris'],
  ['parigi', 'Paris'],
  ['parís', 'Paris'],
  ['нью-йорк', 'New York'],
  ['nueva york', 'New York'],
  ['москва', 'Moscow'],
  ['moskau', 'Moscow'],
  ['moscou', 'Moscow'],
  ['mosca', 'Moscow'],
  ['moscú', 'Moscow'],
  ['пекин', 'Beijing'],
  ['peking', 'Beijing'],
  ['pékin', 'Beijing'],
  ['pechino', 'Beijing'],
  ['pekín', 'Beijing'],
  ['шанхай', 'Shanghai'],
  ['shanghái', 'Shanghai'],
  ['нячанг', 'Nha Trang'],
  ['дананг', 'Da Nang'],
  ['куала-лумпур', 'Kuala Lumpur'],
]);

function canonicalHotelCity(value = '') {
  const cleaned = String(value).replace(/\s*\([^)]*\)/, '').trim();
  return HOTEL_CITY_ALIASES.get(cleaned.toLocaleLowerCase()) || cleaned;
}

module.exports = { canonicalHotelCity };
