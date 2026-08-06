-- These codes came from fuzzy city matching and are not valid catalog
-- destinations for the affected imports. Keep the cleanup transactional and
-- repeatable as part of the release instead of relying on a server-side script.
UPDATE hotel_mapping_reviews reviews
SET status = 'rejected',
    resolved_at = NOW(),
    evidence = (reviews.evidence::jsonb || '{"resolution":"invalid_destination_mapping"}'::jsonb)::text
WHERE reviews.status = 'open'
  AND EXISTS (
    SELECT 1
    FROM hotel_provider_mappings mapping
    WHERE mapping.provider = reviews.provider
      AND mapping.provider_hotel_id = reviews.provider_hotel_id
      AND UPPER(mapping.metadata::jsonb ->> 'iata_code') IN ('ONX', 'PRX', 'PHT')
  );

WITH removed_mappings AS (
  DELETE FROM hotel_provider_mappings
  WHERE UPPER(metadata::jsonb ->> 'iata_code') IN ('ONX', 'PRX', 'PHT')
  RETURNING hotel_id
)
UPDATE hotels hotel
SET active = 0, source_updated_at = NOW()
WHERE hotel.id IN (SELECT hotel_id FROM removed_mappings)
  AND NOT EXISTS (
    SELECT 1
    FROM hotel_provider_mappings remaining
    WHERE remaining.hotel_id = hotel.id
      AND COALESCE(UPPER(remaining.metadata::jsonb ->> 'iata_code'), '') NOT IN ('ONX', 'PRX', 'PHT')
  );

DELETE FROM hotel_catalog_cursors
WHERE UPPER(iata_code) IN ('ONX', 'PRX', 'PHT');

UPDATE hotel_catalog_syncs
SET metadata = (metadata::jsonb || '{"invalid_destination_cleaned":true}'::jsonb)::text
WHERE UPPER(iata_code) IN ('ONX', 'PRX', 'PHT');

-- Existing low-confidence candidates are conservatively kept as separate
-- properties. This avoids merging distinct rooms or apartments in one building.
UPDATE hotel_mapping_reviews
SET status = 'rejected',
    resolved_at = NOW(),
    evidence = (evidence::jsonb || '{"resolution":"kept_separate_below_automatic_threshold"}'::jsonb)::text
WHERE status = 'open'
  AND confidence < 0.92;
