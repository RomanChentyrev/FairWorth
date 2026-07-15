const TERMS_VERSION = '1.0';
const PRIVACY_VERSION = '1.0';
const EFFECTIVE_DATE = '2026-07-05';

function publicLegalConfig() {
  return {
    terms_version: TERMS_VERSION,
    privacy_version: PRIVACY_VERSION,
    effective_date: EFFECTIVE_DATE,
    operator: {
      name: process.env.LEGAL_OPERATOR_NAME || '[SERVICE OPERATOR NAME]',
      registered_address: process.env.LEGAL_REGISTERED_ADDRESS || '[REGISTERED ADDRESS]',
      registration_number: process.env.LEGAL_REGISTRATION_NUMBER || '[COMPANY / REGISTRATION NUMBER]',
      jurisdiction: process.env.LEGAL_JURISDICTION || '[JURISDICTION]',
      contact_email: process.env.LEGAL_CONTACT_EMAIL || '[LEGAL CONTACT EMAIL]',
      privacy_email: process.env.LEGAL_PRIVACY_EMAIL || process.env.LEGAL_CONTACT_EMAIL || '[PRIVACY CONTACT EMAIL]',
    },
    processors: {
      email: process.env.LEGAL_SMTP_PROVIDER || '[SMTP / EMAIL PROVIDER]',
      monitoring: process.env.SENTRY_DSN ? 'Sentry' : 'Sentry (when enabled)',
      ai: process.env.OPENROUTER_API_KEY ? 'OpenRouter' : 'OpenRouter (when enabled)',
      hotels: process.env.LITEAPI_KEY ? 'LiteAPI and connected hotel-rate providers' : 'LiteAPI / connected hotel-rate providers',
      flights: process.env.TRAVELPAYOUTS_TOKEN ? 'Travelpayouts' : 'Travelpayouts (when enabled)',
    },
    transfers: {
      countries: process.env.LEGAL_DATA_HOSTING_COUNTRIES || '[DATA HOSTING / PROCESSING COUNTRIES]',
      safeguard: process.env.LEGAL_TRANSFER_SAFEGUARD || '[TRANSFER SAFEGUARD]',
    },
    retention: {
      account_deletion_days: Number(process.env.LEGAL_ACCOUNT_DELETION_DAYS || 30),
      technical_logs_days: Number(process.env.LEGAL_TECHNICAL_LOGS_DAYS || 90),
      activity_history_months: Number(process.env.LEGAL_ACTIVITY_HISTORY_MONTHS || 24),
      backup_days: Number(process.env.BACKUP_RETENTION_DAYS || 14),
    },
  };
}

module.exports = { TERMS_VERSION, PRIVACY_VERSION, EFFECTIVE_DATE, publicLegalConfig };
