const crypto = require('crypto');
const { createClient } = require('redis');
const logger = require('./logger');

const memory = new Map();
const inflight = new Map();
let client = null;
let connectPromise = null;
let redisUnavailableUntil = 0;

function cacheKey(namespace, value) {
  const digest = crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return `tripalora:${namespace}:${digest}`;
}

function memoryGet(key) {
  const item = memory.get(key);
  if (!item) return null;
  if (item.expiresAt <= Date.now()) {
    memory.delete(key);
    return null;
  }
  return item.value;
}

function memorySet(key, value, ttlSeconds) {
  memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  if (memory.size > 1000) {
    for (const [candidate, item] of memory) {
      if (item.expiresAt <= Date.now() || memory.size > 900) memory.delete(candidate);
      if (memory.size <= 900) break;
    }
  }
}

async function redisClient() {
  if (!process.env.REDIS_URL || Date.now() < redisUnavailableUntil) return null;
  if (client?.isReady) return client;
  if (connectPromise) return connectPromise;
  client = createClient({ url: process.env.REDIS_URL, socket: { connectTimeout: 1200, reconnectStrategy: false } });
  client.on('error', error => logger.warn('redis_error', { error: error.message }));
  connectPromise = client.connect()
    .then(() => client)
    .catch(error => {
      redisUnavailableUntil = Date.now() + 30000;
      logger.warn('redis_unavailable_using_memory_cache', { error: error.message });
      client?.destroy();
      client = null;
      return null;
    })
    .finally(() => { connectPromise = null; });
  return connectPromise;
}

async function getJson(key) {
  const local = memoryGet(key);
  if (local !== null) return local;
  const redis = await redisClient();
  if (!redis) return null;
  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    const value = JSON.parse(raw);
    memorySet(key, value, 15);
    return value;
  } catch (error) {
    logger.warn('redis_get_failed', { error: error.message });
    return null;
  }
}

async function setJson(key, value, ttlSeconds) {
  memorySet(key, value, ttlSeconds);
  const redis = await redisClient();
  if (!redis) return;
  try { await redis.set(key, JSON.stringify(value), { EX: ttlSeconds }); }
  catch (error) { logger.warn('redis_set_failed', { error: error.message }); }
}

async function rememberJson(key, ttlSeconds, loader) {
  const cached = await getJson(key);
  if (cached !== null) return { value: cached, cached: true };
  if (inflight.has(key)) return { value: await inflight.get(key), cached: true };
  const pending = Promise.resolve().then(loader).then(async value => {
    await setJson(key, value, ttlSeconds);
    return value;
  }).finally(() => inflight.delete(key));
  inflight.set(key, pending);
  return { value: await pending, cached: false };
}

async function health() {
  const redis = await redisClient();
  if (!redis) return { status: process.env.REDIS_URL ? 'fallback' : 'not_configured' };
  try {
    await redis.ping();
    return { status: 'ok' };
  } catch {
    return { status: 'fallback' };
  }
}

module.exports = { cacheKey, getJson, setJson, rememberJson, health };
