require('dotenv').config();
require('./config/env').validateEnv();
const { init, close } = require('./db/database');
const { ensureDatabaseSchema } = require('./db/schema');
const { processCatalogQueue } = require('./services/hotelCatalog');
const logger = require('./services/logger');

let stopping = false;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  await init();
  if (process.env.RUN_MIGRATIONS_ON_START !== 'false') await ensureDatabaseSchema();
  logger.info('hotel_catalog_worker_started');
  while (!stopping) {
    let worked = false;
    try {
      const results = await processCatalogQueue(Number(process.env.CATALOG_WORKER_BATCHES || 1));
      worked = results.length > 0;
      for (const result of results) logger.info('hotel_catalog_batch_completed', result);
    } catch (error) {
      logger.error('hotel_catalog_worker_cycle_failed', { error: error.message });
    }
    if (!stopping) await wait(worked
      ? positiveDelay(process.env.CATALOG_WORKER_ACTIVE_INTERVAL_MS, 5000)
      : positiveDelay(process.env.CATALOG_WORKER_IDLE_INTERVAL_MS, 60000));
  }
  await close();
}

function positiveDelay(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1000 ? parsed : fallback;
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; });
if (require.main === module) main().catch(error => {
  logger.error('hotel_catalog_worker_failed', { error: error.message });
  process.exit(1);
});

module.exports = { positiveDelay };
