ALTER TABLE users ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'en';
ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE users ADD COLUMN IF NOT EXISTS digest_weekday INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN IF NOT EXISTS digest_hour INTEGER NOT NULL DEFAULT 9;

CREATE TABLE IF NOT EXISTS price_watches (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hotel_id TEXT NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  check_in DATE NOT NULL,
  check_out DATE NOT NULL,
  guests INTEGER NOT NULL DEFAULT 2,
  currency TEXT NOT NULL DEFAULT 'USD',
  baseline_price DOUBLE PRECISION,
  last_price DOUBLE PRECISION,
  last_notified_price DOUBLE PRECISION,
  lowest_price DOUBLE PRECISION,
  target_price DOUBLE PRECISION,
  notify_on_drop INTEGER NOT NULL DEFAULT 1,
  notify_on_rise INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  last_checked_at TIMESTAMPTZ,
  next_check_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, hotel_id, check_in, check_out, guests, currency),
  CHECK (check_out > check_in),
  CHECK (guests BETWEEN 1 AND 20)
);
CREATE INDEX IF NOT EXISTS idx_price_watches_due ON price_watches(active, next_check_at);

CREATE TABLE IF NOT EXISTS price_observations (
  id TEXT PRIMARY KEY,
  watch_id TEXT NOT NULL REFERENCES price_watches(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  price DOUBLE PRECISION,
  currency TEXT NOT NULL,
  available INTEGER NOT NULL DEFAULT 0,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_price_observations_watch ON price_observations(watch_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  destination TEXT,
  start_date DATE NOT NULL,
  end_date DATE,
  status TEXT NOT NULL DEFAULT 'planned',
  reminder_enabled INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status IN ('planned', 'booking_started', 'booked', 'completed', 'cancelled'))
);
CREATE INDEX IF NOT EXISTS idx_trips_reminders ON trips(reminder_enabled, status, start_date);

CREATE TABLE IF NOT EXISTS trip_items (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  provider TEXT,
  external_id TEXT,
  booking_reference TEXT,
  booking_status TEXT,
  departure_at TIMESTAMPTZ,
  check_in_at TIMESTAMPTZ,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'email',
  type TEXT NOT NULL,
  deduplication_key TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled'))
);
CREATE INDEX IF NOT EXISTS idx_notification_jobs_due ON notification_jobs(status, scheduled_at);

CREATE TABLE IF NOT EXISTS notification_unsubscribes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL DEFAULT 'all_marketing',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS weekly_digest_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  notification_id TEXT REFERENCES notification_jobs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, period_start)
);
