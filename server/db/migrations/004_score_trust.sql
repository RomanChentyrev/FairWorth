ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

CREATE TABLE IF NOT EXISTS score_snapshots (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  hotel_id TEXT REFERENCES hotels(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  score_version TEXT NOT NULL,
  breakdown TEXT NOT NULL,
  completeness INTEGER NOT NULL,
  calculation_parameters TEXT NOT NULL,
  calculated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_score_snapshots_lookup ON score_snapshots(user_id, hotel_id, calculated_at DESC);

CREATE TABLE IF NOT EXISTS score_anomalies (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  hotel_id TEXT REFERENCES hotels(id) ON DELETE CASCADE,
  previous_score INTEGER NOT NULL,
  current_score INTEGER NOT NULL,
  delta INTEGER NOT NULL,
  score_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  details TEXT DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_score_anomalies_status ON score_anomalies(status, created_at DESC);

CREATE TABLE IF NOT EXISTS price_anomalies (
  id TEXT PRIMARY KEY,
  hotel_id TEXT REFERENCES hotels(id) ON DELETE CASCADE,
  price_id TEXT,
  provider TEXT,
  anomaly_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  previous_price DOUBLE PRECISION,
  current_price DOUBLE PRECISION,
  currency TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  details TEXT DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_price_anomalies_status ON price_anomalies(status, created_at DESC);
