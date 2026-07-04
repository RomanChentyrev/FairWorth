require('dotenv').config();
const { init, close } = require('../db/database');
const { ensureDatabaseSchema } = require('../db/schema');
const { ensurePersonalizationSchema } = require('../services/personalization');

async function setup() {
  try {
    await init();
    await ensureDatabaseSchema();
    await ensurePersonalizationSchema();
    console.log('PostgreSQL schema is ready.');
  } finally {
    await close();
  }
}

setup().catch(error => {
  console.error('PostgreSQL setup failed:', error);
  process.exitCode = 1;
});
