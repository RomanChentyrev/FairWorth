CREATE TABLE IF NOT EXISTS user_travel_visits (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  country_code TEXT NOT NULL,
  country_name TEXT NOT NULL,
  city_name TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  visited_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_travel_visits_country_code CHECK (country_code ~ '^[A-Z]{2}$'),
  CONSTRAINT user_travel_visits_coordinates CHECK (
    (city_name IS NULL AND latitude IS NULL AND longitude IS NULL)
    OR
    (city_name IS NOT NULL AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_travel_visits_unique_place
  ON user_travel_visits (user_id, country_code, COALESCE(LOWER(city_name), ''));

CREATE INDEX IF NOT EXISTS idx_user_travel_visits_user
  ON user_travel_visits (user_id, created_at DESC);
