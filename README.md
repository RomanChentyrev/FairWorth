# Fairworth

Fairworth is a personalised travel comparison and referral MVP. It ranks live API offers with a transparent weighted Score and sends users to external providers; Fairworth does not take payment or issue bookings.

## Stack

- React 18, Vite and React Router
- Node.js and Express
- PostgreSQL 16 through `pg`
- Short-lived JWT access cookies with rotating refresh sessions, CSRF protection and per-user database isolation
- OpenRouter for optional AI analysis
- Xotelo for hotel rates and Travelpayouts for flight data
- Sentry (optional), JSON structured logs
- PostgreSQL-backed price-watch and notification worker with retries, deduplication, trip reminders and weekly digests
- Node Test Runner, Supertest, Vitest, Playwright and ESLint

There is no hardcoded user ID. Protected APIs derive the user from the JWT and every user-owned query is scoped by that ID.

## Start locally

Requirements: Node.js 20+, npm and Docker Desktop.

```bash
npm install
npm run install:all
cp server/.env.example server/.env
docker compose up -d postgres mailpit
npm run setup
npm run dev
```

`npm run dev` starts the API, web client and notification worker. Development defaults to the local Mailpit SMTP service at `127.0.0.1:1025`; production treats missing SMTP delivery as a retryable failure.

- Web: http://localhost:5173
- API: http://localhost:3001
- Readiness: http://localhost:3001/api/ready
- Dependency diagnostics: http://localhost:3001/api/health
- PostgreSQL: `localhost:5433`
- Mailpit inbox: http://localhost:8025
- Mailpit SMTP: `localhost:1025`

The database schema is applied from `server/db/migrations` in filename order. Synthetic hotel prices, flights and transfers are not served. Hotel rates come from Xotelo and flights from Travelpayouts. Transfers are outside the current user-facing MVP and are hidden in the web application. The existing backend endpoint returns an explicit unavailable response until a live supplier is connected.

## Configuration

Important server variables:

```dotenv
DATABASE_URL=postgresql://fairworth:fairworth@localhost:5433/fairworth
DATABASE_SSL=false
JWT_SECRET=replace_with_at_least_32_random_characters
ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_TOKEN_TTL_SECONDS=2592000
CORS_ORIGINS=http://localhost:5173
OPENROUTER_API_KEY=
OPENROUTER_MODEL=openrouter/auto
TRAVELPAYOUTS_TOKEN=
SEARCHAPI_KEY=
SEARCHAPI_MARKET=us
TRAVELPAYOUTS_TIMEOUT_MS=25000
LITEAPI_KEY=
LITEAPI_BASE_URL=https://api.liteapi.travel/v3.0
HOTEL_CATALOG_PROVIDER=liteapi
HOTEL_RATE_PROVIDERS=liteapi,xotelo
GOOGLE_PLACES_API_KEY=
GOOGLE_PLACES_PHOTOS_ENABLED=true
GOOGLE_PLACES_MAX_PHOTOS=8
CATALOG_SYNC_CONCURRENCY=5
CATALOG_SYNC_INTERVAL_HOURS=24
CATALOG_INITIAL_SYNC_HOTELS=100
CATALOG_SYNC_MAX_HOTELS=500
INSIGHTS_CACHE_TTL_HOURS=6
INSIGHTS_JOB_TIMEOUT_MS=20000
MAX_HOTEL_NIGHTLY_PRICE_USD=10000
SENTRY_DSN=
ADMIN_EMAILS=admin@example.com
SCORE_CHANGE_THRESHOLD=15
FRONTEND_URL=http://localhost:5173
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
SMTP_CONNECTION_TIMEOUT_MS=10000
EMAIL_FROM=Fairworth <fairworth@gmail.com>
PARTNER_BOOKING_ENABLED=false
PARTNER_ALLOWED_HOSTS=
PARTNER_DEEP_LINK_TEMPLATE=
PARTNER_POSTBACK_SECRET=
```

Client-side Sentry can be enabled with `VITE_SENTRY_DSN`.

## Local email acceptance

Mailpit captures messages locally and never delivers them to the public internet. `fairworth@gmail.com` is only the development sender identity; it does not authenticate or use the real Gmail service.

```bash
docker compose up -d mailpit
npm run mail:check
```

Open http://localhost:8025 to inspect responsive RU/EN HTML messages. The check sends and verifies examples for registration confirmation, resend confirmation and password recovery. Auth templates escape names and URLs before inserting them into HTML. API integration tests separately verify registration, the 60-second resend throttle, a fresh resend token, one-time password reset and session revocation.

## MVP provider readiness

`GET /api/capabilities` is the source of truth for product availability. Hotels require a non-placeholder `LITEAPI_KEY`. Flight search uses current Google Flights metasearch fares through SearchAPI when `SEARCHAPI_KEY` is configured, and can supplement them with indicative Travelpayouts data when `TRAVELPAYOUTS_TOKEN` is present. SearchAPI fares must still be verified with the seller and are never presented as confirmed seat inventory. Optional hotel AI analysis requires `OPENROUTER_API_KEY`. Without any key for a capability the related API returns `503 PROVIDER_NOT_CONFIGURED`; it never substitutes synthetic bookable offers.

After adding credentials, verify the real upstream APIs locally:

```bash
npm run providers:check
```

The check loads a LiteAPI catalog sample and room-rate response, a Travelpayouts route sample, and the OpenRouter model list. Override its harmless sample route with `PROVIDER_SMOKE_IATA`, `PROVIDER_SMOKE_ORIGIN`, and `PROVIDER_SMOKE_DESTINATION`.

Then complete the browser acceptance path: hotel search → progressive live price → hotel card/detail → AI analysis, and flight search → live fare card. Partner deep links, return URLs and production postbacks remain explicitly `post_company_registration` and are not a launch requirement for this local MVP phase. `PROVIDER_FIXTURES_ENABLED=true` is reserved for non-production automated tests and is ignored as a live credential in production.

## Tests and quality

```bash
npm test                 # Score unit tests, API isolation/filter tests, RU/EN tests
npm run lint             # server and client ESLint
npm run test:e2e         # full browser MVP scenario
npm --prefix client run build
```

Run the complete local release acceptance on an isolated disposable database:

```bash
npm run acceptance:local
```

The runner creates `fairworth_acceptance` without touching the normal `fairworth` database, applies every migration twice, runs lint/build/unit/API/browser/email/provider checks, creates a PostgreSQL custom-format backup, drops and recreates the acceptance database, restores the backup, verifies a data marker and migration count, then removes the temporary database and container backup. Set `ACCEPTANCE_LIVE_PROVIDERS=0` only when intentionally running offline.

Install the Playwright browser once before the first E2E run:

```bash
npx --prefix client playwright install chromium
```

The E2E scenario covers registration, preferences, search, comparison and a provider booking click. Integration tests use PostgreSQL and delete their temporary users when complete.

## API overview

- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`
- `POST /api/auth/verify-email`, `/resend-verification`, `/forgot-password`, `/reset-password`
- `GET /api/hotels/search`, `GET /api/hotels/:id`, `POST /api/compare`
- `POST /api/admin/catalog/sync`, `GET /api/admin/catalog/syncs`, `GET/PATCH /api/admin/catalog/mapping-reviews`
- `GET /api/admin/audit-log` for administrator action history
- `GET /api/flights/search`, `GET /api/transfers/search`
- `GET/PUT /api/users/*` for profile, preferences, sessions and consent
- `GET /api/users/export`, `DELETE /api/users/me`
- `POST /api/interactions`
- `POST /api/partners/clicks`, `GET /api/partners/redirect/:clickId`
- `POST /api/partners/postback/:provider`

The web client authenticates with `HttpOnly`, `Secure`, `SameSite=Lax` cookies. Its access JWT expires after 15 minutes by default; the refresh token is rotated on every refresh and only its SHA-256 hash is stored in PostgreSQL. State-changing cookie-authenticated requests require the `X-CSRF-Token` double-submit header. Bearer JWT authentication remains available for trusted non-browser clients and automated tests.

Partner redirects and postbacks are disabled for the closed MVP with `PARTNER_BOOKING_ENABLED=false`. When referral booking is enabled later, `PARTNER_ALLOWED_HOSTS`, `PARTNER_DEEP_LINK_TEMPLATE` and a 32-character-or-longer `PARTNER_POSTBACK_SECRET` all become required. Postbacks send `event_id`, `click_id`, `event_type: "booking_completed"`, optional `booking_reference`, `amount` and `currency`. The `x-fairworth-signature` header is a SHA-256 HMAC of the canonical JSON body. Duplicate provider/event IDs are idempotent. Providers should redirect the user to the supplied `return_url` after checkout.

## Score and analytics

LiteAPI is the canonical hotel-content catalog and supplies live room rates. Xotelo remains a secondary rate/referral source. Hotels use internal UUIDs; provider IDs, match confidence and verification state are stored separately. The first search for a city resolves its IATA code and imports the catalog; subsequent imports run after `CATALOG_SYNC_INTERVAL_HOURS`. Admins can manually sync a city and review uncertain hotel matches at `/admin`.

The hotel Score combines value, quality, review trust and personal preference match. Each result reports price source, update time, currency/tax metadata, available and unavailable features, and a short explanation.

Every Score also includes `score_version`, `calculated_at`, effective calculation parameters and a data-completeness percentage. Price metadata distinguishes included, excluded and unknown taxes, normalises the total, and flags stale or non-live prices. Score changes above `SCORE_CHANGE_THRESHOLD` and suspicious provider prices are recorded for review. `ADMIN_EMAILS` is the sole source of administrator access; database roles do not grant it, and removing an address revokes access on the next request. Sensitive admin changes are recorded in `admin_audit_logs`.

Only explicit searches create `searches` records. Filter refreshes are debounced and are not counted as new searches. `search_session_id`, fingerprints and event IDs prevent StrictMode/network duplicates. Behavioural events (`impression`, `provider_click`, `booking_completed`, `hide`, `preference_changed`, and others) are stored only after optional tracking consent.

## Reliability and privacy

- External HTTP calls use bounded exponential retry.
- `/api/health` checks PostgreSQL and reports LiteAPI/Xotelo/OpenRouter/Travelpayouts state.
- The UI has an Error Boundary, 404 route, API status messages and loading/empty/error states.
- Server logs are structured JSON; server and client exceptions can be sent to Sentry.
- Registration requires Terms and Privacy acceptance. Behavioural tracking is optional.
- Date of birth is not collected because it is not used by the product.
- Users can change tracking consent, export all account data and permanently delete the account.

Legal MVP pages are available at `/legal/privacy` and `/legal/terms`. They are a product baseline and should receive jurisdiction-specific legal review before a public launch.

Legal operator fields are supplied through `LEGAL_*` server variables and exposed by `/api/legal/current`. Registration stores the exact Terms and Privacy versions accepted by the user. To publish a material revision, update the versions and effective date in `server/config/legal.js`, update both documents, and deploy them together; stale registration forms are rejected with `LEGAL_VERSION_MISMATCH`.

## Production deployment

The production stack consists of immutable API and web images, Caddy as the HTTPS reverse proxy, and an external managed PostgreSQL database. Caddy obtains and renews TLS certificates automatically. The web image serves the Vite SPA through Nginx; `/api/*` is routed to Express.

Deployment files are in `deploy/`. Full provisioning, CI/CD, backup and rollback instructions are in [`deploy/README.md`](deploy/README.md).

- `server/Dockerfile` builds the production API image as a non-root user.
- `client/Dockerfile` builds the Vite bundle and serves it with the SPA fallback.
- `deploy/docker-compose.deploy.yml` runs HTTPS, frontend, migrations and API.
- `.github/workflows/ci.yml` tests and publishes commit-addressed images.
- `.github/workflows/deploy.yml` deploys `staging` automatically and production manually through protected GitHub Environments.

Production application containers do not mutate the database schema. A one-shot `migrate` service applies ordered migrations under a PostgreSQL advisory lock before the API becomes available.
