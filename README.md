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
- Node Test Runner, Supertest, Vitest, Playwright and ESLint

There is no hardcoded user ID. Protected APIs derive the user from the JWT and every user-owned query is scoped by that ID.

## Start locally

Requirements: Node.js 20+, npm and Docker Desktop.

```bash
npm install
npm run install:all
cp server/.env.example server/.env
docker compose up -d postgres
npm run setup
npm run dev
```

- Web: http://localhost:5173
- API: http://localhost:3001
- Readiness: http://localhost:3001/api/ready
- Dependency diagnostics: http://localhost:3001/api/health
- PostgreSQL: `localhost:5433`

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
LITEAPI_KEY=
LITEAPI_BASE_URL=https://api.liteapi.travel/v3.0
HOTEL_CATALOG_PROVIDER=liteapi
HOTEL_RATE_PROVIDERS=liteapi,xotelo
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
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_CONNECTION_TIMEOUT_MS=10000
EMAIL_FROM=Fairworth <no-reply@fairworth.app>
PARTNER_ALLOWED_HOSTS=tripadvisor.com,booking.com,expedia.com,agoda.com
PARTNER_DEEP_LINK_TEMPLATE=
PARTNER_POSTBACK_SECRET=replace_with_a_long_random_partner_secret
```

Client-side Sentry can be enabled with `VITE_SENTRY_DSN`.

## Tests and quality

```bash
npm test                 # Score unit tests, API isolation/filter tests, RU/EN tests
npm run lint             # server and client ESLint
npm run test:e2e         # full browser MVP scenario
npm --prefix client run build
```

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
- `GET /api/flights/search`, `GET /api/transfers/search`
- `GET/PUT /api/users/*` for profile, preferences, sessions and consent
- `GET /api/users/export`, `DELETE /api/users/me`
- `POST /api/interactions`
- `POST /api/partners/clicks`, `GET /api/partners/redirect/:clickId`
- `POST /api/partners/postback/:provider`

The web client authenticates with `HttpOnly`, `Secure`, `SameSite=Lax` cookies. Its access JWT expires after 15 minutes by default; the refresh token is rotated on every refresh and only its SHA-256 hash is stored in PostgreSQL. State-changing cookie-authenticated requests require the `X-CSRF-Token` double-submit header. Bearer JWT authentication remains available for trusted non-browser clients and automated tests.

Partner postbacks send `event_id`, `click_id`, `event_type: "booking_completed"`, optional `booking_reference`, `amount` and `currency`. The `x-fairworth-signature` header is a SHA-256 HMAC of the canonical JSON body using `PARTNER_POSTBACK_SECRET`. Duplicate provider/event IDs are idempotent. Providers should redirect the user to the supplied `return_url` after checkout.

## Score and analytics

LiteAPI is the canonical hotel-content catalog and supplies live room rates. Xotelo remains a secondary rate/referral source. Hotels use internal UUIDs; provider IDs, match confidence and verification state are stored separately. The first search for a city resolves its IATA code and imports the catalog; subsequent imports run after `CATALOG_SYNC_INTERVAL_HOURS`. Admins can manually sync a city and review uncertain hotel matches at `/admin`.

The hotel Score combines value, quality, review trust and personal preference match. Each result reports price source, update time, currency/tax metadata, available and unavailable features, and a short explanation.

Every Score also includes `score_version`, `calculated_at`, effective calculation parameters and a data-completeness percentage. Price metadata distinguishes included, excluded and unknown taxes, normalises the total, and flags stale or non-live prices. Score changes above `SCORE_CHANGE_THRESHOLD` and suspicious provider prices are recorded for review. Users listed in `ADMIN_EMAILS` can open `/admin` to resolve price and Score anomalies.

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

## Production deployment

The production stack consists of immutable API and web images, Caddy as the HTTPS reverse proxy, and an external managed PostgreSQL database. Caddy obtains and renews TLS certificates automatically. The web image serves the Vite SPA through Nginx; `/api/*` is routed to Express.

Deployment files are in `deploy/`. Full provisioning, CI/CD, backup and rollback instructions are in [`deploy/README.md`](deploy/README.md).

- `server/Dockerfile` builds the production API image as a non-root user.
- `client/Dockerfile` builds the Vite bundle and serves it with the SPA fallback.
- `deploy/docker-compose.deploy.yml` runs HTTPS, frontend, migrations and API.
- `.github/workflows/ci.yml` tests and publishes commit-addressed images.
- `.github/workflows/deploy.yml` deploys `staging` automatically and production manually through protected GitHub Environments.

Production application containers do not mutate the database schema. A one-shot `migrate` service applies ordered migrations under a PostgreSQL advisory lock before the API becomes available.
