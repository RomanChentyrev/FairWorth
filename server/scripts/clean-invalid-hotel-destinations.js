require('dotenv').config();
require('../config/env').validateEnv();
const { init, close, db } = require('../db/database');

const invalidCodes = ['ONX', 'PRX', 'PHT'];

async function main() {
  await init();
  try {
    const affected = await db.query(`
      UPDATE hotels h
      SET active = 0, source_updated_at = CURRENT_TIMESTAMP
      WHERE h.content_source = 'liteapi'
        AND EXISTS (
          SELECT 1 FROM hotel_provider_mappings m
          WHERE m.hotel_id = h.id
            AND m.provider = 'liteapi'
            AND UPPER(m.metadata::jsonb ->> 'iata_code') = ANY($1::text[])
        )
      RETURNING h.id, h.name, h.city
    `, [invalidCodes]);
    await db.query(`DELETE FROM hotel_catalog_cursors WHERE provider = 'liteapi' AND UPPER(iata_code) = ANY($1::text[])`, [invalidCodes]);
    await db.query(`UPDATE hotel_catalog_syncs SET metadata = (metadata::jsonb || '{"invalid_destination_cleaned":true}'::jsonb)::text
      WHERE provider = 'liteapi' AND UPPER(iata_code) = ANY($1::text[])`, [invalidCodes]);
    console.log(JSON.stringify({ invalid_codes: invalidCodes, deactivated_hotels: affected.rowCount }, null, 2));
  } finally {
    await close();
  }
}

main().catch(error => {
  console.error(`Invalid hotel destination cleanup failed: ${error.message}`);
  process.exit(1);
});
