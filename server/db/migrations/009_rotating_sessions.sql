ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS refresh_token_hash TEXT;
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS refresh_expires_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_refresh_token ON user_sessions(refresh_token_hash) WHERE refresh_token_hash IS NOT NULL;
