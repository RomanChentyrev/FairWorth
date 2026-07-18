const test = require('node:test');
const assert = require('node:assert/strict');
const { isEmailVerificationRequired } = require('../config/auth');

test('email verification remains required unless explicitly disabled', () => {
  const previous = process.env.EMAIL_VERIFICATION_REQUIRED;
  try {
    delete process.env.EMAIL_VERIFICATION_REQUIRED;
    assert.equal(isEmailVerificationRequired(), true);
    process.env.EMAIL_VERIFICATION_REQUIRED = 'true';
    assert.equal(isEmailVerificationRequired(), true);
    process.env.EMAIL_VERIFICATION_REQUIRED = 'false';
    assert.equal(isEmailVerificationRequired(), false);
  } finally {
    if (previous === undefined) delete process.env.EMAIL_VERIFICATION_REQUIRED;
    else process.env.EMAIL_VERIFICATION_REQUIRED = previous;
  }
});
