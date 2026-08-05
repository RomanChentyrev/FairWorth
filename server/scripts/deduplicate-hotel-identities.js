require('dotenv').config();
require('../config/env').validateEnv();
const { init, close, db } = require('../db/database');

async function main() {
  await init();
  try {
    const groups = (await db.query(`
      SELECT identity_key, ARRAY_AGG(id ORDER BY
        (SELECT COUNT(*) FROM hotel_prices p WHERE p.hotel_id = hotels.id) DESC,
        source_updated_at DESC NULLS LAST,
        id
      ) AS hotel_ids
      FROM hotels
      WHERE active = 1 AND identity_key IS NOT NULL
      GROUP BY identity_key
      HAVING COUNT(*) > 1
    `)).rows;
    let deactivated = 0;
    let aliasesMoved = 0;
    let pricesMoved = 0;
    for (const group of groups) {
      const [canonicalId, ...duplicateIds] = group.hotel_ids;
      if (!duplicateIds.length) continue;
      await db.transaction(async () => {
        const mappings = await db.query('UPDATE hotel_provider_mappings SET hotel_id = $1, match_method = CASE WHEN match_method = $2 THEN $3 ELSE match_method END, updated_at = NOW() WHERE hotel_id = ANY($4::text[])', [canonicalId, 'provider_import', 'identity_alias', duplicateIds]);
        const prices = await db.query('UPDATE hotel_prices SET hotel_id = $1 WHERE hotel_id = ANY($2::text[])', [canonicalId, duplicateIds]);
        await db.query(`UPDATE hotel_mapping_reviews SET status = 'superseded', resolved_at = NOW()
          WHERE status = 'open' AND (hotel_id = ANY($1::text[]) OR candidate_hotel_id = ANY($1::text[]))`, [duplicateIds]);
        await db.query('UPDATE hotels SET active = 0 WHERE id = ANY($1::text[])', [duplicateIds]);
        aliasesMoved += mappings.rowCount;
        pricesMoved += prices.rowCount;
        deactivated += duplicateIds.length;
      });
    }
    console.log(JSON.stringify({ duplicate_groups: groups.length, deactivated_hotels: deactivated, provider_aliases_moved: aliasesMoved, prices_moved: pricesMoved }, null, 2));
  } finally {
    await close();
  }
}

main().catch(error => {
  console.error(`Hotel identity deduplication failed: ${error.message}`);
  process.exit(1);
});
