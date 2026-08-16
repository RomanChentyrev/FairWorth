const test = require('node:test');
const assert = require('node:assert/strict');

const { internalUserError } = require('../routes/users');

test('authenticated user errors do not expose internal details', () => {
  let statusCode;
  let body;
  const response = {
    req: { user: { id: 'test-user' } },
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    },
  };

  internalUserError(response, 'test', new Error('relation users_private does not exist'));

  assert.equal(statusCode, 500);
  assert.deepEqual(body, {
    error: 'The account service is temporarily unavailable',
    code: 'USER_SERVICE_ERROR',
  });
  assert.doesNotMatch(JSON.stringify(body), /users_private/);
});
