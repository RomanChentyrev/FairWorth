ALTER TABLE hotel_reviews ADD COLUMN IF NOT EXISTS latest_review_at TIMESTAMPTZ;
ALTER TABLE hotel_reviews ADD COLUMN IF NOT EXISTS recent_review_share DOUBLE PRECISION;
ALTER TABLE hotel_reviews ADD COLUMN IF NOT EXISTS previous_rating DOUBLE PRECISION;
ALTER TABLE hotel_reviews ADD COLUMN IF NOT EXISTS rating_trend DOUBLE PRECISION;

CREATE TABLE IF NOT EXISTS hotel_review_snapshots (
  id TEXT PRIMARY KEY,
  hotel_id TEXT NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  rating DOUBLE PRECISION,
  review_count INTEGER,
  latest_review_at TIMESTAMPTZ,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_review_snapshots_hotel_time
  ON hotel_review_snapshots(hotel_id, captured_at DESC);
