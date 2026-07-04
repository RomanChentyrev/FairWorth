ALTER TABLE users ADD COLUMN IF NOT EXISTS behavioural_tracking_consent INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;
ALTER TABLE searches ADD COLUMN IF NOT EXISTS search_session_id TEXT;
ALTER TABLE searches ADD COLUMN IF NOT EXISTS search_kind TEXT DEFAULT 'explicit';
ALTER TABLE searches ADD COLUMN IF NOT EXISTS fingerprint TEXT;
ALTER TABLE user_interactions ADD COLUMN IF NOT EXISTS event_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_interactions_event_id ON user_interactions(event_id) WHERE event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_searches_session_fingerprint ON searches(user_id, search_session_id, fingerprint) WHERE search_session_id IS NOT NULL AND fingerprint IS NOT NULL;
UPDATE searches SET search_kind = 'legacy' WHERE search_session_id IS NULL;
