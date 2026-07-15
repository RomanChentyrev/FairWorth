ALTER TABLE hotel_reviews ADD COLUMN IF NOT EXISTS rating_stddev DOUBLE PRECISION;
ALTER TABLE hotel_reviews ADD COLUMN IF NOT EXISTS suspicious_review_share DOUBLE PRECISION;
ALTER TABLE hotel_reviews ADD COLUMN IF NOT EXISTS verified_review_share DOUBLE PRECISION;
ALTER TABLE hotel_reviews ADD COLUMN IF NOT EXISTS review_source_count INTEGER;
ALTER TABLE hotel_reviews ADD COLUMN IF NOT EXISTS review_source_consistency DOUBLE PRECISION;

CREATE TABLE IF NOT EXISTS hotel_review_sources (
  id TEXT PRIMARY KEY,
  hotel_id TEXT NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  rating DOUBLE PRECISION,
  review_count INTEGER,
  rating_stddev DOUBLE PRECISION,
  suspicious_review_share DOUBLE PRECISION,
  verified_review_share DOUBLE PRECISION,
  latest_review_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (hotel_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_review_sources_hotel ON hotel_review_sources(hotel_id);
