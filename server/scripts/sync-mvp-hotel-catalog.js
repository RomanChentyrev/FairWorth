require('dotenv').config();
require('../config/env').validateEnv();
const { init, close } = require('../db/database');
const { enqueueCatalogSync, syncCatalog } = require('../services/hotelCatalog');

const destinations = [
  ['Singapore', 'SIN'],
  ['Dubai', 'DXB'],
  ['Abu Dhabi', 'AUH'],
  ['Paris', 'PAR'],
  ['New York', 'NYC'],
  ['Moscow', 'MOW'],
  ['Beijing', 'BJS'],
  ['Shanghai', 'SHA'],
  ['Nha Trang', 'NHA'],
  ['Da Nang', 'DAD'],
  ['Kuala Lumpur', 'KUL'],
];

async function main() {
  const batchSize = Math.max(Number(process.env.CATALOG_SYNC_BATCH_HOTELS || 500), 1);
  const drain = process.argv.includes('--drain');
  const reset = process.argv.includes('--reset');
  await init();
  try {
    for (const [city, iataCode] of destinations) {
      await enqueueCatalogSync({ city, iataCode, reset });
      console.log(`${city}: queued${reset ? ' from offset 0' : ''}`);
    }
    if (!drain) return;
    let pending = true;
    while (pending) {
      pending = false;
      for (const [city, iataCode] of destinations) {
        const result = await syncCatalog({ city, iataCode, limit: batchSize });
        if (!result.complete) pending = true;
        console.log(`${city}: processed=${result.processed} created=${result.created} updated=${result.updated} offset=${result.next_offset}/${result.total_available ?? '?'} complete=${result.complete}`);
      }
    }
  } finally {
    await close();
  }
}

main().catch(error => {
  console.error(`MVP hotel catalog sync failed: ${error.message}`);
  process.exit(1);
});
