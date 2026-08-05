const test = require('node:test');
const assert = require('node:assert/strict');

test('cache falls back to memory and coalesces identical loaders', async () => {
  const previous = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
  const cache = require('../services/cache');
  const key = cache.cacheKey('test', { id: 'same-input' });
  let calls = 0;
  const loader = async () => {
    calls += 1;
    await new Promise(resolve => setTimeout(resolve, 5));
    return { ok: true };
  };
  const [first, second] = await Promise.all([
    cache.rememberJson(key, 60, loader),
    cache.rememberJson(key, 60, loader),
  ]);
  assert.deepEqual(first.value, { ok: true });
  assert.deepEqual(second.value, { ok: true });
  assert.equal(calls, 1);
  assert.deepEqual(await cache.getJson(key), { ok: true });
  if (previous === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = previous;
});
