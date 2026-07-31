CREATE TABLE IF NOT EXISTS localized_content (
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  field_name TEXT NOT NULL,
  locale TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (entity_type, entity_id, field_name, locale)
);

CREATE INDEX IF NOT EXISTS localized_content_lookup
  ON localized_content (entity_type, entity_id, locale);
