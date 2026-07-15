ALTER TABLE hotel_prices ADD COLUMN IF NOT EXISTS guests INTEGER;
ALTER TABLE hotel_prices ADD COLUMN IF NOT EXISTS room_name TEXT;

CREATE INDEX IF NOT EXISTS idx_hotel_prices_comparable
  ON hotel_prices(check_in, check_out, guests, hotel_id)
  WHERE price_valid = 1;
