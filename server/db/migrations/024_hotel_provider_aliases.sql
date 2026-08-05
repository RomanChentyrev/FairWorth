ALTER TABLE hotel_provider_mappings
  DROP CONSTRAINT IF EXISTS hotel_provider_mappings_hotel_id_provider_key;

CREATE INDEX IF NOT EXISTS idx_hotel_provider_mappings_hotel_provider
  ON hotel_provider_mappings(hotel_id, provider);
