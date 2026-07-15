CREATE TABLE IF NOT EXISTS user_hotel_feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hotel_id TEXT NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  context_key TEXT NOT NULL,
  reason TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, hotel_id, context_key)
);

CREATE INDEX IF NOT EXISTS idx_hotel_feedback_user_context
  ON user_hotel_feedback(user_id, context_key);
