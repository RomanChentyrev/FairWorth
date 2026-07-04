CREATE TABLE IF NOT EXISTS insights_cache (
  cache_key TEXT PRIMARY KEY,
  payload TEXT,
  status TEXT NOT NULL DEFAULT 'empty',
  error TEXT,
  updated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  refresh_started_at TIMESTAMPTZ
);
