ALTER TABLE hotel_prices ADD COLUMN IF NOT EXISTS currency_unit TEXT NOT NULL DEFAULT 'major';
ALTER TABLE hotel_prices ADD COLUMN IF NOT EXISTS requested_currency TEXT;
ALTER TABLE hotel_prices ADD COLUMN IF NOT EXISTS fx_rate DOUBLE PRECISION;
ALTER TABLE hotel_prices ADD COLUMN IF NOT EXISTS price_valid INTEGER NOT NULL DEFAULT 1;
ALTER TABLE hotel_prices ADD COLUMN IF NOT EXISTS anomaly_reason TEXT;

UPDATE hotel_prices
SET
  price_per_night = ROUND(price_per_night::numeric, 2)::double precision,
  total_price = ROUND(COALESCE((raw_json::jsonb ->> 'stay_total')::numeric, total_price::numeric), 2)::double precision,
  tax = ROUND((COALESCE(tax, 0) * GREATEST(COALESCE((raw_json::jsonb ->> 'nights')::integer, 1), 1))::numeric, 2)::double precision,
  currency_unit = 'major', requested_currency = currency
WHERE source = 'liteapi' AND raw_json IS NOT NULL AND raw_json LIKE '{%';

UPDATE hotel_prices
SET
  price_per_night = ROUND(((raw_json::jsonb ->> 'rate')::numeric + COALESCE((raw_json::jsonb ->> 'tax')::numeric, 0)), 2)::double precision,
  total_price = ROUND((((raw_json::jsonb ->> 'rate')::numeric + COALESCE((raw_json::jsonb ->> 'tax')::numeric, 0)) * GREATEST((check_out - check_in), 1))::numeric, 2)::double precision,
  tax = ROUND((COALESCE((raw_json::jsonb ->> 'tax')::numeric, 0) * GREATEST((check_out - check_in), 1))::numeric, 2)::double precision,
  currency_unit = 'major', requested_currency = currency
WHERE source = 'xotelo' AND raw_json IS NOT NULL AND raw_json LIKE '{%';

UPDATE hotel_prices SET price_valid = 0, anomaly_reason = 'invalid_or_extreme_nightly_price'
WHERE price_per_night <= 0 OR price_per_night > 10000;

WITH market AS (
  SELECT hotel_id, check_in, check_out, source,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY price_per_night) AS median_price
  FROM hotel_prices WHERE price_valid = 1
  GROUP BY hotel_id, check_in, check_out, source HAVING COUNT(*) >= 3
)
UPDATE hotel_prices hp SET price_valid = 0, anomaly_reason = 'provider_market_outlier'
FROM market m
WHERE hp.hotel_id = m.hotel_id AND hp.check_in IS NOT DISTINCT FROM m.check_in
  AND hp.check_out IS NOT DISTINCT FROM m.check_out AND hp.source = m.source
  AND (hp.price_per_night < m.median_price / 8 OR hp.price_per_night > m.median_price * 8);
