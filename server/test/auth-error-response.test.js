process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { internalAuthError } = require('../routes/auth');

test('public authentication errors do not expose internal provider details', () => {
  let statusCode = null;
  let body = null;
  const response = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      body = value;
      return this;
    },
  };

  internalAuthError(response, 'register', new Error('duplicate key users_email_key at postgres.internal:5432'));

  assert.equal(statusCode, 500);
  assert.deepEqual(body, {
    error: 'Authentication service is temporarily unavailable',
    code: 'AUTH_SERVICE_ERROR',
  });
  assert.doesNotMatch(JSON.stringify(body), /users_email_key|postgres\.internal|5432/);
});

test('email cooldown remains a rate-limit response without exposing internals', () => {
  let statusCode = null;
  let body = null;
  const response = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      body = value;
      return this;
    },
  };
  const error = new Error('token row for user 42 already exists');
  error.status = 429;

  internalAuthError(response, 'forgot_password', error);

  assert.equal(statusCode, 429);
  assert.deepEqual(body, {
    error: 'Please wait before requesting another email',
    code: 'AUTH_EMAIL_RATE_LIMITED',
  });
  assert.doesNotMatch(JSON.stringify(body), /token row|user 42/);
});
