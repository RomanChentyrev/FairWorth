const test = require('node:test');
const assert = require('node:assert/strict');
const { validateEnv } = require('../config/env');

test('central environment validation applies typed defaults', () => { const env = validateEnv({ DATABASE_URL: 'postgresql://user:pass@localhost:5432/fairworth' }); assert.equal(env.PORT, 3001); assert.equal(env.DATABASE_SSL, false); assert.equal(env.RUN_MIGRATIONS_ON_START, true); });
test('central environment validation rejects invalid startup values', () => { assert.throws(() => validateEnv({ DATABASE_URL: 'not-postgres', PORT: '70000' }), /Invalid environment configuration/); });
test('production rejects short secrets and missing operational data', () => { assert.throws(() => validateEnv({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://user:pass@localhost:5432/fairworth', JWT_SECRET: 'short' }), /JWT_SECRET|SMTP_HOST/); });
test('production rejects malformed administrator email lists', () => { assert.throws(() => validateEnv({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://user:pass@localhost:5432/fairworth', JWT_SECRET: 'a'.repeat(32), SMTP_HOST: 'smtp.example.com', EMAIL_FROM: 'Fairworth <mail@example.com>', ADMIN_EMAILS: 'not-an-email', PARTNER_POSTBACK_SECRET: 'secret', PARTNER_ALLOWED_HOSTS: 'partner.example.com', LEGAL_OPERATOR_NAME: 'Fairworth LLC', LEGAL_REGISTERED_ADDRESS: 'Address', LEGAL_REGISTRATION_NUMBER: '123', LEGAL_JURISDICTION: 'Test', LEGAL_CONTACT_EMAIL: 'legal@example.com', LEGAL_DATA_HOSTING_COUNTRIES: 'DE', LEGAL_TRANSFER_SAFEGUARD: 'SCC' }), /ADMIN_EMAILS/); });
