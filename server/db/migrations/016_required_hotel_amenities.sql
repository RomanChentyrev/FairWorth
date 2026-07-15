ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS required_hotel_amenities TEXT DEFAULT '[]';
