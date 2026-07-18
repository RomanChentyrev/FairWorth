const test = require('node:test');
const assert = require('node:assert/strict');
const { validateEnv } = require('../config/env');

function productionEnv(overrides = {}) {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/fairworth',
    JWT_SECRET: 'a'.repeat(32),
    SMTP_HOST: 'smtp.example.com',
    EMAIL_FROM: 'Fairworth <mail@example.com>',
    ADMIN_EMAILS: 'admin@example.com',
    LEGAL_OPERATOR_TYPE: 'company',
    LEGAL_OPERATOR_NAME: 'Fairworth LLC',
    LEGAL_REGISTERED_ADDRESS: 'Address',
    LEGAL_REGISTRATION_NUMBER: '123',
    LEGAL_JURISDICTION: 'Test',
    LEGAL_CONTACT_EMAIL: 'legal@example.com',
    LEGAL_DATA_HOSTING_COUNTRIES: 'DE',
    LEGAL_TRANSFER_SAFEGUARD: 'SCC',
    ...overrides,
  };
}

test('central environment validation applies typed defaults', () => {
  const env = validateEnv({ DATABASE_URL: 'postgresql://user:pass@localhost:5432/fairworth' });
  assert.equal(env.PORT, 3001);
  assert.equal(env.DATABASE_SSL, false);
  assert.equal(env.RUN_MIGRATIONS_ON_START, true);
  assert.equal(env.PARTNER_BOOKING_ENABLED, false);
});

test('central environment validation rejects invalid startup values', () => {
  assert.throws(() => validateEnv({ DATABASE_URL: 'not-postgres', PORT: '70000' }), /Invalid environment configuration/);
});

test('production rejects short secrets and missing operational data', () => {
  assert.throws(() => validateEnv({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://user:pass@localhost:5432/fairworth', JWT_SECRET: 'short' }), /JWT_SECRET|SMTP_HOST/);
});

test('production rejects malformed administrator email lists', () => {
  assert.throws(() => validateEnv(productionEnv({ ADMIN_EMAILS: 'not-an-email' })), /ADMIN_EMAILS/);
});

test('production accepts disabled partner booking without referral configuration', () => {
  const env = validateEnv(productionEnv({ PARTNER_BOOKING_ENABLED: 'false' }));
  assert.equal(env.PARTNER_BOOKING_ENABLED, false);
  assert.equal(env.PARTNER_ALLOWED_HOSTS, '');
  assert.equal(env.PARTNER_DEEP_LINK_TEMPLATE, '');
  assert.equal(env.PARTNER_POSTBACK_SECRET, '');
});

test('production accepts an individual operator without a company registration number', () => {
  const env = validateEnv(productionEnv({
    LEGAL_OPERATOR_TYPE: 'individual',
    LEGAL_REGISTRATION_NUMBER: '',
  }));
  assert.equal(env.LEGAL_OPERATOR_TYPE, 'individual');
});

test('production requires complete referral configuration only when partner booking is enabled', () => {
  assert.throws(() => validateEnv(productionEnv({ PARTNER_BOOKING_ENABLED: 'true' })), /PARTNER_ALLOWED_HOSTS|PARTNER_DEEP_LINK_TEMPLATE|PARTNER_POSTBACK_SECRET/);
  const env = validateEnv(productionEnv({
    PARTNER_BOOKING_ENABLED: 'true',
    PARTNER_ALLOWED_HOSTS: 'partner.example.com',
    PARTNER_DEEP_LINK_TEMPLATE: 'https://partner.example.com/redirect?url={url}&click_id={click_id}&return_url={return_url}',
    PARTNER_POSTBACK_SECRET: 'p'.repeat(32),
  }));
  assert.equal(env.PARTNER_BOOKING_ENABLED, true);
});
