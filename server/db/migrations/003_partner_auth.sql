CREATE TABLE IF NOT EXISTS auth_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  sent_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_type ON auth_tokens(user_id, type, created_at DESC);

CREATE TABLE IF NOT EXISTS provider_clicks (
  id TEXT PRIMARY KEY,
  click_id TEXT NOT NULL UNIQUE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  hotel_id TEXT REFERENCES hotels(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  destination_url TEXT NOT NULL,
  deep_link_url TEXT,
  status TEXT NOT NULL DEFAULT 'created',
  clicked_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  booking_reference TEXT,
  amount DOUBLE PRECISION,
  currency TEXT,
  metadata TEXT DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_provider_clicks_user_created ON provider_clicks(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS partner_postbacks (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  click_id TEXT,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  signature_valid INTEGER NOT NULL DEFAULT 0,
  processed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(provider, event_id)
);

UPDATE users SET email_verified = 1 WHERE email_verified = 0 AND created_at < '2026-06-30T15:00:00Z';
DELETE FROM flights WHERE id LIKE 'flight-%';
DELETE FROM transfers;
DELETE FROM hotel_prices WHERE source = 'local';
DELETE FROM hotel_reviews;
DELETE FROM hotel_rooms;
