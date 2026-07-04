ALTER TABLE hotels ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE hotels ADD COLUMN IF NOT EXISTS postal_code TEXT;
ALTER TABLE hotels ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE hotels ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;
ALTER TABLE hotels ADD COLUMN IF NOT EXISTS hotel_type TEXT;
ALTER TABLE hotels ADD COLUMN IF NOT EXISTS chain_name TEXT;
ALTER TABLE hotels ADD COLUMN IF NOT EXISTS content_source TEXT;
ALTER TABLE hotels ADD COLUMN IF NOT EXISTS source_updated_at TIMESTAMPTZ;
ALTER TABLE hotels ADD COLUMN IF NOT EXISTS active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE hotels ADD COLUMN IF NOT EXISTS content_raw_json TEXT DEFAULT '{}';

ALTER TABLE hotel_prices ADD COLUMN IF NOT EXISTS offer_id TEXT;
ALTER TABLE hotel_prices ADD COLUMN IF NOT EXISTS room_type_id TEXT;
ALTER TABLE hotel_prices ADD COLUMN IF NOT EXISTS rate_id TEXT;
ALTER TABLE hotel_prices ADD COLUMN IF NOT EXISTS board_name TEXT;
ALTER TABLE hotel_prices ADD COLUMN IF NOT EXISTS refundable INTEGER;

CREATE TABLE IF NOT EXISTS hotel_provider_mappings (
  id TEXT PRIMARY KEY,
  hotel_id TEXT NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_hotel_id TEXT NOT NULL,
  match_confidence DOUBLE PRECISION NOT NULL DEFAULT 1,
  verified INTEGER NOT NULL DEFAULT 0,
  match_method TEXT NOT NULL DEFAULT 'provider_import',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider, provider_hotel_id),
  UNIQUE(hotel_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_hotel_provider_mappings_hotel ON hotel_provider_mappings(hotel_id);

CREATE TABLE IF NOT EXISTS hotel_catalog_syncs (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  city TEXT,
  iata_code TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  requested_limit INTEGER,
  processed_count INTEGER NOT NULL DEFAULT 0,
  created_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  total_available INTEGER,
  error TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_hotel_catalog_syncs_lookup ON hotel_catalog_syncs(provider, iata_code, started_at DESC);

CREATE TABLE IF NOT EXISTS hotel_images (
  id TEXT PRIMARY KEY,
  hotel_id TEXT NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  url TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'gallery',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(hotel_id, provider, url)
);

CREATE TABLE IF NOT EXISTS hotel_amenities (
  id TEXT PRIMARY KEY,
  hotel_id TEXT NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_amenity_id TEXT NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(hotel_id, provider, provider_amenity_id)
);

CREATE TABLE IF NOT EXISTS hotel_mapping_reviews (
  id TEXT PRIMARY KEY,
  hotel_id TEXT NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  candidate_hotel_id TEXT REFERENCES hotels(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  provider_hotel_id TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  evidence TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_hotel_mapping_reviews_status ON hotel_mapping_reviews(status, created_at DESC);
