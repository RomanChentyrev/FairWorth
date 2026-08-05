ALTER TABLE hotels ADD COLUMN IF NOT EXISTS identity_key TEXT;
CREATE INDEX IF NOT EXISTS idx_hotels_identity_key ON hotels(identity_key) WHERE identity_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS hotel_catalog_cursors (
  provider TEXT NOT NULL,
  iata_code TEXT NOT NULL,
  city TEXT NOT NULL,
  next_offset INTEGER NOT NULL DEFAULT 0,
  total_available INTEGER,
  page_size INTEGER NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'pending',
  lease_id TEXT,
  lease_until TIMESTAMPTZ,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  full_sync_started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider, iata_code)
);
CREATE INDEX IF NOT EXISTS idx_hotel_catalog_cursors_queue
  ON hotel_catalog_cursors(status, requested_at DESC, updated_at ASC);

INSERT INTO hotel_catalog_cursors (
  provider, iata_code, city, next_offset, total_available, status,
  requested_at, full_sync_started_at, completed_at, updated_at
)
SELECT
  latest.provider,
  UPPER(latest.iata_code),
  latest.city,
  LEAST(COALESCE(latest.processed_count, 0), COALESCE(latest.total_available, latest.processed_count, 0)),
  latest.total_available,
  CASE
    WHEN latest.total_available IS NOT NULL AND latest.processed_count >= latest.total_available THEN 'completed'
    ELSE 'pending'
  END,
  NOW(),
  latest.started_at,
  CASE
    WHEN latest.total_available IS NOT NULL AND latest.processed_count >= latest.total_available THEN latest.completed_at
    ELSE NULL
  END,
  NOW()
FROM (
  SELECT DISTINCT ON (provider, UPPER(iata_code)) *
  FROM hotel_catalog_syncs
  WHERE provider = 'liteapi'
    AND status = 'completed'
    AND iata_code IS NOT NULL
    AND UPPER(iata_code) NOT IN ('ONX', 'PRX', 'PHT')
  ORDER BY provider, UPPER(iata_code), completed_at DESC NULLS LAST, started_at DESC
) latest
ON CONFLICT (provider, iata_code) DO NOTHING;

UPDATE hotel_mapping_reviews older
SET status = 'superseded', resolved_at = NOW()
WHERE older.status = 'open'
  AND EXISTS (
    SELECT 1
    FROM hotel_mapping_reviews newer
    WHERE newer.status = 'open'
      AND newer.provider = older.provider
      AND newer.provider_hotel_id = older.provider_hotel_id
      AND (newer.created_at, newer.id) > (older.created_at, older.id)
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_hotel_mapping_reviews_one_open
  ON hotel_mapping_reviews(provider, provider_hotel_id)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_hotel_provider_mappings_iata
  ON hotel_provider_mappings(((metadata::jsonb ->> 'iata_code')));
