CREATE TABLE IF NOT EXISTS demo_bookings (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'confirmed',
  currency TEXT NOT NULL DEFAULT 'USD',
  hotel_total DOUBLE PRECISION NOT NULL,
  flights_total DOUBLE PRECISION NOT NULL,
  grand_total DOUBLE PRECISION NOT NULL,
  passenger_count INTEGER NOT NULL,
  contact_email TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  travelers TEXT NOT NULL DEFAULT '[]',
  itinerary TEXT NOT NULL DEFAULT '{}',
  special_requests TEXT,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status IN ('confirmed', 'cancelled')),
  CHECK (passenger_count BETWEEN 1 AND 9),
  CHECK (hotel_total >= 0 AND flights_total >= 0 AND grand_total >= 0)
);

CREATE INDEX IF NOT EXISTS idx_demo_bookings_user_created
  ON demo_bookings(user_id, created_at DESC);
