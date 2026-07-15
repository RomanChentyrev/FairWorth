ALTER TABLE hotel_images ADD COLUMN IF NOT EXISTS width_px INTEGER;
ALTER TABLE hotel_images ADD COLUMN IF NOT EXISTS height_px INTEGER;
ALTER TABLE hotel_images ADD COLUMN IF NOT EXISTS attribution_json TEXT DEFAULT '[]';
ALTER TABLE hotel_images ADD COLUMN IF NOT EXISTS source_photo_name TEXT;
ALTER TABLE hotel_images ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_hotel_images_hotel_sort ON hotel_images(hotel_id, sort_order);
