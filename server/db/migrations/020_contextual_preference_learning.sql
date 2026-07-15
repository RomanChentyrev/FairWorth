CREATE TABLE IF NOT EXISTS user_context_preference_weights (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  context_type TEXT NOT NULL,
  context_value TEXT NOT NULL,
  learned_weights TEXT NOT NULL,
  evidence_strength DOUBLE PRECISION NOT NULL DEFAULT 0,
  interaction_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, context_type, context_value)
);

CREATE INDEX IF NOT EXISTS idx_context_weights_user
  ON user_context_preference_weights(user_id, context_type, context_value);
