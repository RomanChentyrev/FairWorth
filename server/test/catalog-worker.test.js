const test = require('node:test');
const assert = require('node:assert/strict');
const { positiveDelay } = require('../catalogWorker');

test('catalog worker accepts safe intervals and rejects busy loops', () => {
  assert.equal(positiveDelay('2500', 5000), 2500);
  assert.equal(positiveDelay('10', 5000), 5000);
  assert.equal(positiveDelay('invalid', 60000), 60000);
});
