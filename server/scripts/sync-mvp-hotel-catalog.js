require('dotenv').config();
require('../config/env').validateEnv();
const { init, close } = require('../db/database');
const { syncCatalog } = require('../services/hotelCatalog');

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
  const limit = Math.min(Math.max(Number(process.env.CATALOG_BOOTSTRAP_LIMIT || 100), 1), 500);
  await init();
  try {
    for (const [city, iataCode] of destinations) {
      const result = await syncCatalog({ city, iataCode, limit });
      console.log(`${city}: processed=${result.processed} created=${result.created} updated=${result.updated}`);
    }
  } finally {
    await close();
  }
}

main().catch(error => {
  console.error(`MVP hotel catalog sync failed: ${error.message}`);
  process.exit(1);
});
