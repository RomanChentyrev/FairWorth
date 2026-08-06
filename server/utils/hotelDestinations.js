const { canonicalHotelCity } = require('./cities');

const INVALID_HOTEL_DESTINATION_CODES = new Set(['ONX', 'PRX', 'PHT']);

const HOTEL_DESTINATION_CODES = new Map([
  ['singapore', 'SIN'],
  ['dubai', 'DXB'],
  ['abu dhabi', 'AUH'],
  ['paris', 'PAR'],
  ['new york', 'NYC'],
  ['moscow', 'MOW'],
  ['beijing', 'BJS'],
  ['shanghai', 'SHA'],
  ['nha trang', 'NHA'],
  ['da nang', 'DAD'],
  ['kuala lumpur', 'KUL'],
]);

function validHotelDestinationCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) && !INVALID_HOTEL_DESTINATION_CODES.has(code) ? code : null;
}

function hotelDestinationCode(value = '') {
  const raw = String(value).trim();
  const explicitCode = raw.match(/\(([A-Za-z]{3})\)\s*$/)?.[1];
  if (explicitCode) return validHotelDestinationCode(explicitCode);
  const directCode = validHotelDestinationCode(raw);
  if (directCode && raw.length === 3) return directCode;
  return HOTEL_DESTINATION_CODES.get(canonicalHotelCity(raw).toLocaleLowerCase()) || null;
}

function hotelDestinationFilter(alias, city, iataCode) {
  const pattern = `%${String(city || '').toLocaleLowerCase()}%`;
  return {
    sql: `(
      LOWER(${alias}.city) LIKE ?
      OR LOWER(${alias}.location) LIKE ?
      OR LOWER(${alias}.country) LIKE ?
      OR EXISTS (
        SELECT 1
        FROM hotel_provider_mappings destination_mapping
        WHERE destination_mapping.hotel_id = ${alias}.id
          AND destination_mapping.metadata::jsonb ->> 'iata_code' = ?
      )
    )`,
    params: [pattern, pattern, pattern, validHotelDestinationCode(iataCode) || ''],
  };
}

module.exports = {
  INVALID_HOTEL_DESTINATION_CODES,
  HOTEL_DESTINATION_CODES,
  validHotelDestinationCode,
  hotelDestinationCode,
  hotelDestinationFilter,
};
