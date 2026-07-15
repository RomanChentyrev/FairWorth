const { z } = require('zod');

const booleanString = z.preprocess(value => typeof value === 'boolean' ? value : value === 'true' ? true : value === 'false' ? false : value, z.boolean());
const optionalUrl = z.string().url().or(z.literal('')).optional();
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.string().url().startsWith('postgresql://'),
  DATABASE_SSL: booleanString.default(false),
  DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  RUN_MIGRATIONS_ON_START: booleanString.default(true),
  JWT_SECRET: z.string().min(1).default('fairworth-dev-secret-change-me'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().min(3600).default(2592000),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  TRUST_PROXY: booleanString.default(false),
  AUTH_RATE_LIMIT: z.coerce.number().int().min(1).default(20),
  ADMIN_EMAILS: z.string().optional().default(''),
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: booleanString.default(false),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASSWORD: z.string().optional().default(''),
  EMAIL_FROM: z.string().optional().default(''),
  SENTRY_DSN: optionalUrl,
  LITEAPI_BASE_URL: z.string().url().default('https://api.liteapi.travel/v3.0'),
  TRAVELPAYOUTS_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(25000),
  WORKER_INTERVAL_MS: z.coerce.number().int().min(1000).default(60000),
  WORKER_PRICE_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(20),
  WORKER_EMAIL_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(25),
  LEGAL_ACTIVITY_HISTORY_MONTHS: z.coerce.number().int().min(1).max(120).default(24),
  SESSION_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  CACHE_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  TECHNICAL_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
}).passthrough().superRefine((env, context) => {
  if (env.NODE_ENV !== 'production') return;
  const required = ['SMTP_HOST', 'EMAIL_FROM', 'ADMIN_EMAILS', 'PARTNER_POSTBACK_SECRET', 'PARTNER_ALLOWED_HOSTS', 'LEGAL_OPERATOR_NAME', 'LEGAL_REGISTERED_ADDRESS', 'LEGAL_REGISTRATION_NUMBER', 'LEGAL_JURISDICTION', 'LEGAL_CONTACT_EMAIL', 'LEGAL_DATA_HOSTING_COUNTRIES', 'LEGAL_TRANSFER_SAFEGUARD'];
  for (const key of required) if (!String(env[key] || '').trim()) context.addIssue({ code: 'custom', path: [key], message: 'is required in production' });
  if (env.JWT_SECRET.length < 32) context.addIssue({ code: 'custom', path: ['JWT_SECRET'], message: 'must contain at least 32 characters in production' });
  for (const email of String(env.ADMIN_EMAILS || '').split(',').map(value => value.trim()).filter(Boolean)) if (!z.string().email().safeParse(email).success) context.addIssue({ code: 'custom', path: ['ADMIN_EMAILS'], message: `contains an invalid email: ${email}` });
  for (const key of required.filter(key => key.startsWith('LEGAL_'))) if (/^(REPLACE_|\[)/i.test(String(env[key] || ''))) context.addIssue({ code: 'custom', path: [key], message: 'still contains a placeholder' });
});

function validateEnv(source = process.env) {
  const result = schema.safeParse(source);
  if (result.success) return result.data;
  const details = result.error.issues.map(issue => `${issue.path.join('.') || 'environment'} ${issue.message}`).join('; ');
  throw new Error(`Invalid environment configuration: ${details}`);
}

module.exports = { validateEnv, envSchema: schema };
