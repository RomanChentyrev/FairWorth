const { Pool, types } = require('pg');
const { AsyncLocalStorage } = require('async_hooks');

// Keep PostgreSQL DATE values as YYYY-MM-DD. Parsing them as local Date objects
// can move a birthday or travel date to the previous day in another timezone.
types.setTypeParser(1082, value => value);

let pool;
const transactionContext = new AsyncLocalStorage();

function postgresSql(sql) {
  let index = 0;
  return String(sql)
    .replace(/\?/g, () => `$${++index}`)
    .replace(/datetime\(created_at, '\+5 minutes'\)/gi, "created_at + INTERVAL '5 minutes'")
    .replace(/datetime\('now'\)/gi, 'CURRENT_TIMESTAMP');
}

async function query(sql, params = []) {
  const connection = transactionContext.getStore() || pool;
  return connection.query(postgresSql(sql), params);
}

class Statement {
  constructor(sql) { this.sql = sql; }
  async run(...params) { return query(this.sql, params); }
  async get(...params) { return (await query(this.sql, params)).rows[0]; }
  async all(...params) { return (await query(this.sql, params)).rows; }
}

const db = {
  prepare(sql) { return new Statement(sql); },
  async exec(sql) { return query(sql); },
  async query(sql, params = []) { return query(sql, params); },
  async transaction(callback) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await transactionContext.run(client, callback);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  },
};

async function init() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
    max: Number(process.env.DATABASE_POOL_SIZE || 10),
  });
  await pool.query('SELECT 1');
  return db;
}

async function close() { if (pool) await pool.end(); }
module.exports = { db, init, close, postgresSql };
