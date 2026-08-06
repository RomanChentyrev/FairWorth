require('dotenv').config();
require('../config/env').validateEnv();
const { init, close, db } = require('../db/database');

const invalidCodes = ['ONX', 'PRX', 'PHT'];

async function main() {
  await init();
  try {
    const result = await db.transaction(async () => {
      const reviews = await db.query(`UPDATE hotel_mapping_reviews reviews
        SET status = 'rejected', resolved_at = NOW(),
            evidence = (reviews.evidence::jsonb || '{"resolution":"invalid_destination_mapping"}'::jsonb)::text
        WHERE reviews.status = 'open' AND EXISTS (
          SELECT 1 FROM hotel_provider_mappings mapping
          WHERE mapping.provider = reviews.provider
            AND mapping.provider_hotel_id = reviews.provider_hotel_id
            AND UPPER(mapping.metadata::jsonb ->> 'iata_code') = ANY($1::text[])
        )`, [invalidCodes]);
      const mappings = await db.query(`DELETE FROM hotel_provider_mappings
        WHERE UPPER(metadata::jsonb ->> 'iata_code') = ANY($1::text[])
        RETURNING hotel_id`, [invalidCodes]);
      const hotelIds = [...new Set(mappings.rows.map(row => row.hotel_id))];
      const hotels = hotelIds.length ? await db.query(`UPDATE hotels hotel
        SET active = 0, source_updated_at = NOW()
        WHERE hotel.id = ANY($1::text[])
          AND NOT EXISTS (SELECT 1 FROM hotel_provider_mappings remaining WHERE remaining.hotel_id = hotel.id)`, [hotelIds]) : { rowCount: 0 };
      const cursors = await db.query(`DELETE FROM hotel_catalog_cursors WHERE UPPER(iata_code) = ANY($1::text[])`, [invalidCodes]);
      await db.query(`UPDATE hotel_catalog_syncs SET metadata = (metadata::jsonb || '{"invalid_destination_cleaned":true}'::jsonb)::text
        WHERE UPPER(iata_code) = ANY($1::text[])`, [invalidCodes]);
      return { reviews: reviews.rowCount, mappings: mappings.rowCount, hotels: hotels.rowCount, cursors: cursors.rowCount };
    });
    console.log(JSON.stringify({ invalid_codes: invalidCodes, ...result }, null, 2));
  } finally {
    await close();
  }
}

main().catch(error => {
  console.error(`Invalid hotel destination cleanup failed: ${error.message}`);
  process.exit(1);
});
