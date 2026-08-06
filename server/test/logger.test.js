const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const logger = require('../services/logger');

function completedRequest(path, status) {
  const req = { method: 'GET', originalUrl: path };
  const res = new EventEmitter();
  res.statusCode = status;
  logger.requestLogger(req, res, () => {});
  res.emit('finish');
}

test('successful orchestration probes do not flood application logs', () => {
  const output = [];
  const original = console.log;
  console.log = value => output.push(value);
  try {
    completedRequest('/api/ready', 200);
    completedRequest('/api/live', 200);
    completedRequest('/api/ready', 503);
    completedRequest('/api/hotels/search?city=Paris', 200);
  } finally {
    console.log = original;
  }

  assert.equal(output.length, 2);
  assert.equal(JSON.parse(output[0]).status, 503);
  assert.equal(JSON.parse(output[1]).path, '/api/hotels/search');
});
