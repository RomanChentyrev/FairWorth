CREATE TABLE IF NOT EXISTS hotel_rate_checks (
  id TEXT PRIMARY KEY,
  hotel_id TEXT NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  check_in DATE NOT NULL,
  check_out DATE NOT NULL,
  guests INTEGER NOT NULL DEFAULT 2,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(hotel_id, provider, check_in, check_out, guests, currency)
);
CREATE INDEX IF NOT EXISTS idx_hotel_rate_checks_cache ON hotel_rate_checks(hotel_id, provider, check_in, check_out, checked_at DESC);
