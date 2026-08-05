require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const { init, close, db } = require('../db/database');
const liteapi = require('../services/liteapi');
const { syncCatalog } = require('../services/hotelCatalog');

test('catalog sync resumes from its persisted provider offset until inventory is complete', async t => {
  await init();
  const originals = {
    configured: liteapi.configured,
    getFacilities: liteapi.getFacilities,
    getHotels: liteapi.getHotels,
  };
  const calls = [];
  liteapi.configured = () => true;
  liteapi.getFacilities = async () => [];
  liteapi.getHotels = async ({ offset, limit }) => {
    calls.push({ offset, limit });
    const data = Array.from({ length: Math.max(0, Math.min(limit, 5 - offset)) }, (_, index) => {
      const position = offset + index;
      const identityPosition = position === 4 ? 0 : position;
      return {
        id: `cursor-test-${position}`,
        name: `Cursor Test Hotel ${identityPosition}`,
        city: 'Cursor Test City',
        country: 'TS',
        latitude: 10 + identityPosition / 100,
        longitude: 20 + identityPosition / 100,
        facilityIds: [],
        rating: 4,
        reviewCount: 10,
      };
    });
    return { data, total: 5 };
  };

  t.after(async () => {
    liteapi.configured = originals.configured;
    liteapi.getFacilities = originals.getFacilities;
    liteapi.getHotels = originals.getHotels;
    const mappings = await db.query(`SELECT hotel_id FROM hotel_provider_mappings WHERE provider = 'liteapi' AND metadata::jsonb ->> 'iata_code' = $1`, ['TST']);
    if (mappings.rows.length) await db.query('DELETE FROM hotels WHERE id = ANY($1::text[])', [mappings.rows.map(row => row.hotel_id)]);
    await db.query('DELETE FROM hotel_catalog_syncs WHERE iata_code = $1', ['TST']);
    await db.query('DELETE FROM hotel_catalog_cursors WHERE iata_code = $1', ['TST']);
    await close();
  });

  const first = await syncCatalog({ city: 'Cursor Test City', iataCode: 'TST', limit: 2, reset: true });
  const second = await syncCatalog({ city: 'Cursor Test City', iataCode: 'TST', limit: 2 });
  const third = await syncCatalog({ city: 'Cursor Test City', iataCode: 'TST', limit: 2 });

  assert.deepEqual(calls.map(call => call.offset), [0, 2, 4]);
  assert.equal(first.next_offset, 2);
  assert.equal(first.complete, false);
  assert.equal(second.next_offset, 4);
  assert.equal(third.next_offset, 5);
  assert.equal(third.complete, true);
  const cursor = await db.query('SELECT status, next_offset, total_available FROM hotel_catalog_cursors WHERE iata_code = $1', ['TST']);
  assert.deepEqual(cursor.rows[0], { status: 'completed', next_offset: 5, total_available: 5 });
  const mappings = await db.query(`SELECT COUNT(*)::int mapping_count, COUNT(DISTINCT hotel_id)::int hotel_count FROM hotel_provider_mappings WHERE provider = 'liteapi' AND metadata::jsonb ->> 'iata_code' = $1`, ['TST']);
  assert.deepEqual(mappings.rows[0], { mapping_count: 5, hotel_count: 4 });
});
