const fs = require('fs');
const path = require('path');
const { db } = require('./database');

async function ensureDatabaseSchema() {
  const directory = path.join(__dirname, 'migrations');
  // Only one release may migrate a shared database at a time.
  await db.query('SELECT pg_advisory_lock($1)', [74321901]);
  try {
    await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW())`);
    for (const file of fs.readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) {
      const applied = await db.prepare('SELECT filename FROM schema_migrations WHERE filename = ?').get(file);
      if (applied) continue;
      await db.transaction(async () => {
        await db.exec(fs.readFileSync(path.join(directory, file), 'utf8'));
        await db.prepare('INSERT INTO schema_migrations (filename) VALUES (?)').run(file);
      });
      console.log(`Applied migration ${file}`);
    }
  } finally {
    await db.query('SELECT pg_advisory_unlock($1)', [74321901]);
  }
}
module.exports = { ensureDatabaseSchema };
