ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_version TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_accepted_at TIMESTAMPTZ;

COMMENT ON COLUMN users.terms_version IS 'Version of Terms of Service explicitly accepted by the user';
COMMENT ON COLUMN users.privacy_version IS 'Version of Privacy Policy explicitly accepted by the user';
