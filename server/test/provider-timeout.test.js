const test = require('node:test');
const assert = require('node:assert/strict');
const liteapi = require('../services/liteapi');

test('LiteAPI timeout is retried and surfaced instead of returning partial fake data', async () => {
  const previous = { fetch: global.fetch, key: process.env.LITEAPI_KEY, timeout: process.env.LITEAPI_TIMEOUT_MS };
  let attempts = 0; process.env.LITEAPI_KEY = 'test-key'; process.env.LITEAPI_TIMEOUT_MS = '10';
  global.fetch = async () => { attempts += 1; const error = new Error('external provider timed out'); error.name = 'TimeoutError'; throw error; };
  try { await assert.rejects(() => liteapi.getHotels({ countryCode: 'SG' }), /timed out/); assert.equal(attempts, 3); }
  finally { global.fetch = previous.fetch; if (previous.key === undefined) delete process.env.LITEAPI_KEY; else process.env.LITEAPI_KEY = previous.key; if (previous.timeout === undefined) delete process.env.LITEAPI_TIMEOUT_MS; else process.env.LITEAPI_TIMEOUT_MS = previous.timeout; }
});
