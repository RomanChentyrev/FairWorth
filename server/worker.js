require('dotenv').config();
require('./config/env').validateEnv();
const { init, close } = require('./db/database');
const { ensureDatabaseSchema } = require('./db/schema');
const { processOne } = require('./services/notificationQueue');
const scheduler = require('./services/notificationScheduler');
const logger = require('./services/logger');

let stopping = false;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function cycle() {
  await scheduler.recoverStaleJobs();
  const removed = await scheduler.enforceDataRetention();
  const totalRemoved = Object.values(removed).reduce((sum, value) => sum + value, 0);
  if (totalRemoved) logger.info('data_retention_cleanup', { removed, total_removed: totalRemoved });
  await scheduler.processPriceWatches(Number(process.env.WORKER_PRICE_BATCH_SIZE || 20));
  await scheduler.scheduleTripReminders();
  await scheduler.scheduleBookingReminders();
  await scheduler.scheduleWeeklyDigests();
  let processed = 0;
  while (processed < Number(process.env.WORKER_EMAIL_BATCH_SIZE || 25) && await processOne()) processed += 1;
}

async function main() {
  await init();
  if (process.env.RUN_MIGRATIONS_ON_START !== 'false') await ensureDatabaseSchema();
  logger.info('notification_worker_started');
  while (!stopping) {
    try { await cycle(); } catch (error) { logger.error('notification_worker_cycle_failed', { error: error.message }); }
    if (!stopping) await wait(Number(process.env.WORKER_INTERVAL_MS || 60000));
  }
  await close();
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; });
if (require.main === module) main().catch(error => { logger.error('notification_worker_failed', { error: error.message }); process.exit(1); });
module.exports = { cycle };
