require('dotenv').config();
process.env.PARTNER_POSTBACK_SECRET = 'integration-postback-secret';
process.env.PARTNER_ALLOWED_HOSTS = 'partner.example,tripadvisor.com,booking.com,expedia.com,agoda.com';
process.env.ADMIN_EMAILS = 'admin-test@example.com';
process.env.PROVIDER_FIXTURES_ENABLED = 'true';
process.env.TRAVELPAYOUTS_TOKEN = 'integration-travelpayouts-token';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, ready } = require('../index');
const { db, close } = require('../db/database');
const { defaultTravelDates } = require('../utils/dates');
const crypto = require('crypto');
const { TERMS_VERSION, PRIVACY_VERSION } = require('../config/legal');
const travelpayouts = require('../services/travelpayouts');
const legalAcceptance = { terms_version: TERMS_VERSION, privacy_version: PRIVACY_VERSION };

const users = [];
async function register(label) {
  const email = `p2-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  const response = await request(app).post('/api/auth/register').send({ name: `Test ${label}`, email, password: 'TestPass123!', accept_terms: true, behavioural_tracking_consent: true, ...legalAcceptance });
  assert.equal(response.status, 201, response.text); users.push(response.body.user.id);
  await request(app).post('/api/auth/verify-email').send({ token: response.body.development_verification_token });
  await request(app).put('/api/users/preferences').set('Authorization', `Bearer ${response.body.token}`).send({ hotel_stars: ['5'], hotel_amenities: ['pool'], budget_per_night_max: 1000 });
  await request(app).post('/api/users/onboarding/complete').set('Authorization', `Bearer ${response.body.token}`);
  return response.body;
}

test.before(async () => {
  await ready;
  const dates = defaultTravelDates();
  await db.prepare(`INSERT INTO hotels (id, name, location, city, country, stars, amenities) VALUES ('test-live-hotel', 'Test Live Hotel', 'Marina Bay', 'Singapore', 'Singapore', 5, '["pool"]') ON CONFLICT (id) DO NOTHING`).run();
  await db.prepare(`INSERT INTO hotel_prices (id, hotel_id, operator, price_per_night, check_in, check_out, currency, source, url) VALUES ('test-live-price', 'test-live-hotel', 'Test Partner', 500, ?, ?, 'USD', 'xotelo', 'https://partner.example/hotel') ON CONFLICT (id) DO UPDATE SET check_in = EXCLUDED.check_in, check_out = EXCLUDED.check_out`).run(dates.checkIn, dates.checkOut);
  await db.prepare(`INSERT INTO hotel_reviews (id, hotel_id, rating, count) VALUES ('test-live-review', 'test-live-hotel', 4.8, 500) ON CONFLICT (hotel_id) DO NOTHING`).run();
  await db.prepare(`UPDATE hotels SET amenities = '["pool","wifi","tennis"]' WHERE id = 'test-live-hotel'`).run();
  await db.prepare(`INSERT INTO hotel_rooms (id, hotel_id, name, amenities, base_price_per_night) VALUES ('test-live-room', 'test-live-hotel', 'Deluxe', '["Private bath tub"]', 500) ON CONFLICT (id) DO UPDATE SET amenities = EXCLUDED.amenities`).run();
});
test.after(async () => { for (const id of users) await db.prepare('DELETE FROM users WHERE id = ?').run(id); await db.prepare(`DELETE FROM hotels WHERE id = 'test-live-hotel'`).run(); await close(); });

test('registration requires legal acceptance and isolates bookmarks', async () => {
  const rejected = await request(app).post('/api/auth/register').send({ name: 'No Terms', email: `no-terms-${Date.now()}@example.com`, password: 'TestPass123!' });
  assert.equal(rejected.status, 400);
  const a = await register('a'); const b = await register('b');
  const search = await request(app).get('/api/hotels/search?city=Singapore&stars=5').set('Authorization', `Bearer ${a.token}`);
  assert.equal(search.status, 200, search.text); assert.ok(search.body.hotels.length > 0);
  const hotelId = search.body.hotels[0].id;
  await request(app).post(`/api/users/bookmarks/${hotelId}`).set('Authorization', `Bearer ${a.token}`);
  const bookmarksA = await request(app).get('/api/users/bookmarks').set('Authorization', `Bearer ${a.token}`);
  const bookmarksB = await request(app).get('/api/users/bookmarks').set('Authorization', `Bearer ${b.token}`);
  assert.equal(bookmarksA.body.bookmarks.length, 1); assert.equal(bookmarksB.body.bookmarks.length, 0);
});

test('travel achievements persist visits and remain private to each user', async () => {
  const owner = await register('achievements-owner');
  const stranger = await register('achievements-stranger');
  const ownerAuth = { Authorization: `Bearer ${owner.token}` };
  const strangerAuth = { Authorization: `Bearer ${stranger.token}` };

  const country = await request(app).post('/api/achievements/visits').set(ownerAuth).send({
    country_code: 'FR', country_name: 'France', city_name: null, latitude: null, longitude: null,
  });
  assert.equal(country.status, 201, country.text);
  const city = await request(app).post('/api/achievements/visits').set(ownerAuth).send({
    country_code: 'FR', country_name: 'France', city_name: 'Paris', latitude: 48.8566, longitude: 2.3522,
  });
  assert.equal(city.status, 201, city.text);

  const ownerMap = await request(app).get('/api/achievements').set(ownerAuth);
  assert.equal(ownerMap.status, 200, ownerMap.text);
  assert.equal(ownerMap.body.stats.countries, 1);
  assert.equal(ownerMap.body.stats.cities, 1);
  assert.equal(ownerMap.body.visits.length, 2);

  const strangerMap = await request(app).get('/api/achievements').set(strangerAuth);
  assert.equal(strangerMap.status, 200, strangerMap.text);
  assert.equal(strangerMap.body.visits.length, 0);
  const strangerDelete = await request(app).delete(`/api/achievements/visits/${city.body.visit.id}`).set(strangerAuth);
  assert.equal(strangerDelete.status, 404);

  const duplicate = await request(app).post('/api/achievements/visits').set(ownerAuth).send({
    country_code: 'FR', country_name: 'France', city_name: 'paris', latitude: 48.8566, longitude: 2.3522,
  });
  assert.equal(duplicate.status, 409);
  const invalid = await request(app).post('/api/achievements/visits').set(ownerAuth).send({
    country_code: 'FR', country_name: 'France', city_name: 'Paris', latitude: 200, longitude: 2.3522,
  });
  assert.equal(invalid.status, 400);

  const removed = await request(app).delete(`/api/achievements/visits/${city.body.visit.id}`).set(ownerAuth);
  assert.equal(removed.status, 204);
});

test('demo checkout confirms a trip, calculates totals and protects document data', async () => {
  const owner = await register('demo-booking-owner');
  const stranger = await register('demo-booking-stranger');
  const dates = defaultTravelDates();
  const auth = { Authorization: `Bearer ${owner.token}` };
  const payload = {
    currency: 'USD',
    hotel: { id: 'test-live-hotel', name: 'Test Live Hotel', city: 'Singapore', checkIn: dates.checkIn, checkOut: dates.checkOut, nights: 4, totalPrice: 800 },
    flights: [{ flightId: 'demo-flight', title: 'Demo Air 101', originCode: 'MOW', destinationCode: 'SIN', date: dates.checkIn, departureTime: '09:00', arrivalTime: '20:00', provider: 'Demo', cabinClass: 'economy', passengers: 1, totalPrice: 450 }],
    contact_email: owner.user.email, contact_phone: '+375 29 000 00 00',
    travelers: [{ first_name: 'Roman', last_name: 'Test', birth_date: '1990-01-01', gender: 'male', nationality: 'Belarus', document_type: 'passport', document_number: 'AB1234567', document_expiry: '2035-01-01' }],
    special_requests: 'Quiet room', accept_demo_terms: true,
  };
  const created = await request(app).post('/api/bookings').set(auth).send(payload);
  assert.equal(created.status, 201, created.text);
  assert.match(created.body.booking.reference, /^FW-DEMO-[A-F0-9]{10}$/);
  assert.equal(created.body.booking.hotel_total, 800);
  assert.equal(created.body.booking.flights_total, 450);
  assert.equal(created.body.booking.grand_total, 1250);

  const stored = await db.prepare('SELECT travelers FROM demo_bookings WHERE reference = ?').get(created.body.booking.reference);
  assert.ok(stored);
  assert.ok(!String(stored.travelers).includes('AB1234567'));
  assert.ok(String(stored.travelers).includes('4567'));
  const ownBooking = await request(app).get(`/api/bookings/${created.body.booking.reference}`).set(auth);
  assert.equal(ownBooking.status, 200);
  const hidden = await request(app).get(`/api/bookings/${created.body.booking.reference}`).set('Authorization', `Bearer ${stranger.token}`);
  assert.equal(hidden.status, 404);
});

test('capability endpoint reports deterministic test providers', async () => {
  const response = await request(app).get('/api/capabilities');
  assert.equal(response.status, 200);
  assert.equal(response.body.capabilities.hotels.status, 'ready');
  assert.equal(response.body.capabilities.flights.status, 'ready');
  assert.equal(response.body.capabilities.partner_booking.stage, 'post_company_registration');
});

test('registration records exact legal versions and rejects stale documents', async () => {
  const stale = await request(app).post('/api/auth/register').send({ name: 'Stale Legal', email: `stale-${Date.now()}@example.com`, password: 'TestPass123!', accept_terms: true, terms_version: '0.9', privacy_version: PRIVACY_VERSION });
  assert.equal(stale.status, 409); assert.equal(stale.body.code, 'LEGAL_VERSION_MISMATCH');
  const account = await register('legal-version');
  const row = await db.prepare(`SELECT terms_version, privacy_version, terms_accepted_at, privacy_accepted_at FROM users WHERE id = ?`).get(account.user.id);
  assert.equal(row.terms_version, TERMS_VERSION); assert.equal(row.privacy_version, PRIVACY_VERSION);
  assert.ok(row.terms_accepted_at); assert.ok(row.privacy_accepted_at);
});

test('hotel filters are applied and filter refresh is not logged as a search', async () => {
  const user = await register('filters');
  const before = Number((await db.prepare('SELECT COUNT(*) count FROM searches WHERE user_id = ?').get(user.user.id)).count);
  const five = await request(app).get('/api/hotels/search?city=Singapore&stars=5&rating_min=4.5&amenities=pool').set('Authorization', `Bearer ${user.token}`);
  assert.equal(five.status, 200, five.text); assert.ok(five.body.hotels.every(h => h.stars === 5 && Number(h.rating) >= 4.5));
  const afterFilter = Number((await db.prepare('SELECT COUNT(*) count FROM searches WHERE user_id = ?').get(user.user.id)).count);
  assert.equal(afterFilter, before);
  const strictAmenities = await request(app).get('/api/hotels/search?city=Singapore&amenities=tennis,bathtub').set('Authorization', `Bearer ${user.token}`);
  assert.equal(strictAmenities.status, 200, strictAmenities.text);
  assert.ok(strictAmenities.body.hotels.some(hotel => hotel.id === 'test-live-hotel'));
  const savedRequired = await request(app).put('/api/users/preferences').set('Authorization', `Bearer ${user.token}`).send({ required_hotel_amenities: ['tennis', 'bathtub'] });
  assert.equal(savedRequired.status, 200, savedRequired.text);
  const preferenceStrict = await request(app).get('/api/hotels/search?city=Singapore').set('Authorization', `Bearer ${user.token}`);
  assert.equal(preferenceStrict.status, 200, preferenceStrict.text);
  assert.ok(preferenceStrict.body.hotels.length > 0);
  assert.ok(preferenceStrict.body.hotels.every(hotel => hotel.id === 'test-live-hotel'));
  await request(app).get('/api/hotels/search?city=Singapore&search_event=1&search_session_id=test-session').set('Authorization', `Bearer ${user.token}`);
  await request(app).get('/api/hotels/search?city=Singapore&search_event=1&search_session_id=test-session').set('Authorization', `Bearer ${user.token}`);
  const afterExplicit = Number((await db.prepare('SELECT COUNT(*) count FROM searches WHERE user_id = ?').get(user.user.id)).count);
  assert.equal(afterExplicit, before + 1);
});

test('hotel pagination is applied after global Score ranking', async () => {
  const account = await register('global-ranking');
  const city = `Ranking-${Date.now()}`;
  const hotelIds = [];
  try {
    for (let index = 0; index < 31; index += 1) {
      const best = index === 30;
      const id = `${best ? 'zz' : 'aa'}-ranking-${index}-${crypto.randomUUID()}`;
      hotelIds.push(id);
      await db.prepare(`INSERT INTO hotels (id, name, location, city, country, stars, amenities) VALUES (?, ?, 'Center', ?, 'Test', ?, ?)`)
        .run(id, best ? 'Global Best Hotel' : `Ordinary Hotel ${index}`, city, best ? 5 : 1, best ? '["pool"]' : '[]');
      await db.prepare(`INSERT INTO hotel_reviews (id, hotel_id, rating, count) VALUES (?, ?, ?, ?)`)
        .run(crypto.randomUUID(), id, best ? 5 : 2, best ? 5000 : 1);
    }
    const firstPage = await request(app).get(`/api/hotels/search?city=${encodeURIComponent(city)}&sort=score&limit=30&offset=0`).set('Authorization', `Bearer ${account.token}`);
    assert.equal(firstPage.status, 200, firstPage.text);
    assert.equal(firstPage.body.total, 31);
    assert.equal(firstPage.body.hotels.length, 30);
    assert.equal(firstPage.body.hotels[0].name, 'Global Best Hotel');
    assert.equal(firstPage.body.has_more, true);
  } finally {
    for (const id of hotelIds) await db.prepare('DELETE FROM hotels WHERE id = ?').run(id);
  }
});

test('password reset uses a one-time token', async () => {
  const account = await register('reset');
  const forgot = await request(app).post('/api/auth/forgot-password').send({ email: account.user.email });
  assert.equal(forgot.status, 200); assert.ok(forgot.body.development_token);
  const reset = await request(app).post('/api/auth/reset-password').send({ token: forgot.body.development_token, password: 'NewTestPass123!' });
  assert.equal(reset.status, 200, reset.text);
  const reused = await request(app).post('/api/auth/reset-password').send({ token: forgot.body.development_token, password: 'AnotherPass123!' });
  assert.equal(reused.status, 400);
  const login = await request(app).post('/api/auth/login').send({ email: account.user.email, password: 'NewTestPass123!' });
  assert.equal(login.status, 200);
});

test('email verification can be resent before confirmation', async () => {
  const email = `resend-${Date.now()}@example.com`;
  const registration = await request(app).post('/api/auth/register').send({ name: 'Resend User', email, password: 'TestPass123!', accept_terms: true, language: 'ru', behavioural_tracking_consent: false, ...legalAcceptance });
  assert.equal(registration.status, 201, registration.text); users.push(registration.body.user.id);
  const throttled = await request(app).post('/api/auth/resend-verification').send({ email });
  assert.equal(throttled.status, 429, throttled.text);
  await db.prepare(`UPDATE auth_tokens SET sent_at = NOW() - INTERVAL '2 minutes' WHERE user_id = ? AND type = 'email_verification'`).run(registration.body.user.id);
  const resent = await request(app).post('/api/auth/resend-verification').send({ email });
  assert.equal(resent.status, 200, resent.text); assert.ok(resent.body.development_token);
  assert.notEqual(resent.body.development_token, registration.body.development_verification_token);
  const verified = await request(app).post('/api/auth/verify-email').send({ token: resent.body.development_token });
  assert.equal(verified.status, 200, verified.text);
});

test('users can manage price watches, notification settings and trip reminders', async () => {
  const account = await register('notifications');
  const dates = defaultTravelDates();
  const auth = { Authorization: `Bearer ${account.token}` };
  const created = await request(app).post('/api/notifications/watches').set(auth).send({ hotel_id: 'test-live-hotel', check_in: dates.checkIn, check_out: dates.checkOut, guests: 2, currency: 'USD' });
  assert.equal(created.status, 201, created.text);
  const watches = await request(app).get('/api/notifications/watches').set(auth);
  assert.ok(watches.body.watches.some(watch => watch.id === created.body.watch.id));
  const settings = await request(app).put('/api/notifications/settings').set(auth).send({ locale: 'ru', timezone: 'Europe/Moscow', digest_weekday: 5, digest_hour: 10 });
  assert.equal(settings.status, 200, settings.text); assert.equal(settings.body.settings.timezone, 'Europe/Moscow');
  const trip = await request(app).post('/api/notifications/trips').set(auth).send({ title: 'Singapore', destination: 'Singapore', start_date: dates.checkIn, end_date: dates.checkOut, reminder_enabled: true });
  assert.equal(trip.status, 201, trip.text);
  const disabled = await request(app).patch(`/api/notifications/trips/${trip.body.trip.id}`).set(auth).send({ reminder_enabled: false });
  assert.equal(disabled.status, 200); assert.equal(Number(disabled.body.trip.reminder_enabled), 0);
});

test('partner postback completes a tracked referral', async () => {
  const account = await register('partner');
  const clickResponse = await request(app).post('/api/partners/clicks').set('Authorization', `Bearer ${account.token}`).send({ hotel_id: 'test-live-hotel', provider: 'Test Partner', destination_url: 'https://partner.example/hotel', amount: 500, currency: 'USD' });
  assert.equal(clickResponse.status, 201, clickResponse.text);
  const redirect = await request(app).get(`/api/partners/redirect/${clickResponse.body.click_id}`);
  assert.equal(redirect.status, 302); assert.match(redirect.headers.location, /^https:\/\/partner\.example\/hotel/);
  const payload = { event_id: `event-${Date.now()}`, click_id: clickResponse.body.click_id, event_type: 'booking_completed', booking_reference: 'BOOK-123', amount: 500, currency: 'USD' };
  const stable = value => Array.isArray(value) ? `[${value.map(stable).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}` : JSON.stringify(value);
  const signature = crypto.createHmac('sha256', process.env.PARTNER_POSTBACK_SECRET).update(stable(payload)).digest('hex');
  const postback = await request(app).post('/api/partners/postback/test-partner').set('x-fairworth-signature', signature).send(payload);
  assert.equal(postback.status, 200, postback.text);
  const status = await request(app).get(`/api/partners/clicks/${clickResponse.body.click_id}`).set('Authorization', `Bearer ${account.token}`);
  assert.equal(status.body.click.status, 'booking_completed'); assert.equal(status.body.click.booking_reference, 'BOOK-123');
});

test('admin can review and resolve suspicious prices', async () => {
  const configuredAdmins = process.env.ADMIN_EMAILS;
  await db.prepare(`DELETE FROM users WHERE email = 'admin-test@example.com'`).run();
  const registration = await request(app).post('/api/auth/register').send({ name: 'Admin Test', email: 'admin-test@example.com', password: 'TestPass123!', accept_terms: true, ...legalAcceptance });
  users.push(registration.body.user.id);
  assert.equal(registration.body.user.role, 'admin');
  assert.equal((await db.prepare(`SELECT role FROM users WHERE id = ?`).get(registration.body.user.id)).role, 'user');
  const token = registration.body.token;
  await request(app).post('/api/auth/verify-email').send({ token: registration.body.development_verification_token });
  const anomalyId = crypto.randomUUID();
  await db.prepare(`INSERT INTO price_anomalies (id, hotel_id, provider, anomaly_type, previous_price, current_price, currency) VALUES (?, 'test-live-hotel', 'Test Partner', 'sudden_price_change', 500, 900, 'USD')`).run(anomalyId);
  const list = await request(app).get('/api/admin/anomalies').set('Authorization', `Bearer ${token}`);
  assert.equal(list.status, 200, list.text); assert.ok(list.body.price_anomalies.some(item => item.id === anomalyId));
  const resolved = await request(app).patch(`/api/admin/anomalies/price/${anomalyId}/resolve`).set('Authorization', `Bearer ${token}`);
  assert.equal(resolved.status, 200, resolved.text);
  const audit = await db.prepare(`SELECT * FROM admin_audit_logs WHERE actor_user_id = ? AND action = 'anomaly.resolve' AND entity_id = ?`).get(registration.body.user.id, anomalyId);
  assert.ok(audit); assert.equal(audit.actor_email, 'admin-test@example.com');

  process.env.ADMIN_EMAILS = '';
  try {
    const revoked = await request(app).get('/api/admin/anomalies').set('Authorization', `Bearer ${token}`);
    assert.equal(revoked.status, 403);
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    assert.equal(me.status, 200); assert.equal(me.body.user.role, 'user');
  } finally { process.env.ADMIN_EMAILS = configuredAdmins; }
});

test('cookie sessions enforce CSRF and rotate refresh tokens', async () => {
  const agent = request.agent(app);
  const email = `cookie-security-${Date.now()}@example.com`;
  const registration = await agent.post('/api/auth/register').send({ name: 'Cookie Security', email, password: 'TestPass123!', accept_terms: true, ...legalAcceptance });
  assert.equal(registration.status, 201, registration.text);
  users.push(registration.body.user.id);
  const initialCookies = registration.headers['set-cookie'];
  assert.ok(initialCookies.some(value => value.startsWith('fw_access=') && value.includes('HttpOnly')));
  assert.ok(initialCookies.some(value => value.startsWith('fw_refresh=') && value.includes('HttpOnly')));
  assert.ok(initialCookies.some(value => value.startsWith('fw_csrf=') && !value.includes('HttpOnly')));
  const csrf = initialCookies.find(value => value.startsWith('fw_csrf=')).split(';')[0].split('=')[1];

  const blocked = await agent.put('/api/users/preferences').send({ hotel_stars: ['5'] });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'CSRF_INVALID');
  const allowed = await agent.put('/api/users/preferences').set('x-csrf-token', csrf).send({ hotel_stars: ['5'], hotel_amenities: ['pool'], budget_per_night_max: 1000 });
  assert.equal(allowed.status, 200, allowed.text);

  const refreshed = await agent.post('/api/auth/refresh').set('x-csrf-token', csrf);
  assert.equal(refreshed.status, 200, refreshed.text);
  const rotatedCookies = refreshed.headers['set-cookie'];
  assert.ok(rotatedCookies.some(value => value.startsWith('fw_refresh=')));
  const replay = await request(app).post('/api/auth/refresh')
    .set('Cookie', initialCookies.map(value => value.split(';')[0]).join('; '))
    .set('x-csrf-token', csrf);
  assert.equal(replay.status, 401);
});

test('weak passwords are rejected', async () => {
  const response = await request(app).post('/api/auth/register').send({ name: 'Weak Password', email: `weak-${Date.now()}@example.com`, password: 'password123', accept_terms: true, ...legalAcceptance });
  assert.equal(response.status, 400);
});

test('hotel API rejects invalid dates and oversized rate batches', async () => {
  const account = await register('validation');
  const auth = { Authorization: `Bearer ${account.token}` };
  const invalidDates = await request(app).get('/api/hotels/search?city=Singapore&check_in=2030-05-10&check_out=2030-05-09').set(auth);
  assert.equal(invalidDates.status, 400);
  const oversized = await request(app).post('/api/hotels/rates/batch').set(auth).send({ hotel_ids: Array.from({ length: 51 }, (_, index) => `hotel-${index}`), check_in: '2030-05-10', check_out: '2030-05-12' });
  assert.equal(oversized.status, 400);
});

test('hotel learning ignores shallow views and weights stronger intent signals', async () => {
  const account = await register('interaction-strength');
  const auth = { Authorization: `Bearer ${account.token}` };
  const send = (event_type, session_id, context = {}) => request(app).post('/api/interactions').set(auth).send({
    event_type, hotel_id: 'test-live-hotel', session_id, context,
    event_id: `${account.user.id}:${event_type}:${session_id}:${JSON.stringify(context)}`,
  });

  const dates = defaultTravelDates();
  const context = { check_in: dates.checkIn, check_out: dates.checkOut, guests: 1, trip_purpose: 'business' };
  assert.equal((await send('view', 'visit-one', context)).status, 201);
  assert.equal((await send('dwell_time', 'visit-one', { ...context, seconds: 10 })).status, 201);
  assert.equal((await send('view', 'visit-two', context)).status, 201);
  assert.equal((await send('dwell_time', 'visit-two', { ...context, seconds: 90 })).status, 201);
  const rows = await db.prepare(`SELECT event_type, signal FROM user_interactions WHERE user_id = ? AND hotel_id = 'test-live-hotel' ORDER BY created_at`).all(account.user.id);
  assert.deepEqual(rows.map(row => [row.event_type, Number(row.signal)]), [
    ['view', 0], ['dwell_time', 0], ['revisit', 1.5], ['dwell_time', 1],
  ]);
  const learning = await db.prepare('SELECT interaction_count, learning_confidence FROM user_preference_weights WHERE user_id = ?').get(account.user.id);
  assert.equal(Number(learning.interaction_count), 2);
  assert.ok(Number(learning.learning_confidence) > 0);
  const contexts = await db.prepare(`SELECT context_type, context_value, interaction_count FROM user_context_preference_weights WHERE user_id = ? ORDER BY context_type`).all(account.user.id);
  const nights = Math.round((new Date(dates.checkOut) - new Date(dates.checkIn)) / 86400000);
  const duration = nights <= 3 ? 'short' : nights <= 7 ? 'medium' : 'long';
  assert.deepEqual(contexts.map(row => `${row.context_type}:${row.context_value}`).sort(), [
    'destination:singapore', `duration:${duration}`, 'guests:solo', 'purpose:business', `season:${[12, 1, 2].includes(new Date(dates.checkIn).getUTCMonth() + 1) ? 'winter' : [3, 4, 5].includes(new Date(dates.checkIn).getUTCMonth() + 1) ? 'spring' : [6, 7, 8].includes(new Date(dates.checkIn).getUTCMonth() + 1) ? 'summer' : 'autumn'}`,
  ].sort());
  assert.ok(contexts.every(row => Number(row.interaction_count) === 2));
});

test('hotel hide reasons drive targeted learning and remain trip-context specific', async () => {
  const account = await register('hide-reason');
  const auth = { Authorization: `Bearer ${account.token}` };
  const dates = defaultTravelDates();
  const query = `city=Singapore&check_in=${dates.checkIn}&check_out=${dates.checkOut}&guests=1&trip_purpose=business`;
  const before = await request(app).get(`/api/hotels/search?${query}`).set(auth);
  assert.equal(before.status, 200, before.text);
  assert.ok(before.body.hotels.some(hotel => hotel.id === 'test-live-hotel'));

  const invalid = await request(app).post('/api/interactions').set(auth).send({ event_type: 'hide', hotel_id: 'test-live-hotel', context: {} });
  assert.equal(invalid.status, 400);
  const weightsBefore = JSON.parse((await db.prepare('SELECT learned_weights FROM user_preference_weights WHERE user_id = ?').get(account.user.id)).learned_weights);
  const hidden = await request(app).post('/api/interactions').set(auth).send({
    event_type: 'hide', hotel_id: 'test-live-hotel', session_id: 'hide-business', event_id: `${account.user.id}:hide:business`,
    context: { feedback_reason: 'too_expensive', check_in: dates.checkIn, check_out: dates.checkOut, guests: 1, trip_purpose: 'business', destination: 'Singapore', price_per_night: 500 },
  });
  assert.equal(hidden.status, 201, hidden.text);
  const weightsAfter = JSON.parse((await db.prepare('SELECT learned_weights FROM user_preference_weights WHERE user_id = ?').get(account.user.id)).learned_weights);
  assert.ok(weightsAfter.budget > weightsBefore.budget);
  const nonBudgetRatios = Object.keys(weightsBefore).filter(key => key !== 'budget').map(key => weightsAfter[key] / weightsBefore[key]);
  assert.ok(Math.max(...nonBudgetRatios) - Math.min(...nonBudgetRatios) < 1e-9);

  const feedback = await db.prepare('SELECT reason, context_key FROM user_hotel_feedback WHERE user_id = ? AND hotel_id = ?').get(account.user.id, 'test-live-hotel');
  assert.equal(feedback.reason, 'too_expensive');
  assert.match(feedback.context_key, /purpose:business/);
  const sameContext = await request(app).get(`/api/hotels/search?${query}`).set(auth);
  assert.ok(!sameContext.body.hotels.some(hotel => hotel.id === 'test-live-hotel'));
  const leisure = await request(app).get(`/api/hotels/search?city=Singapore&check_in=${dates.checkIn}&check_out=${dates.checkOut}&guests=1&trip_purpose=leisure`).set(auth);
  assert.ok(leisure.body.hotels.some(hotel => hotel.id === 'test-live-hotel'));
});

test('Zod API validation rejects malformed profile, preferences, interactions, trips and partner payloads', async () => {
  const account = await register('zod-validation');
  const auth = { Authorization: `Bearer ${account.token}` };
  const cases = [
    request(app).put('/api/users/profile').set(auth).send({ website: 'javascript:alert(1)' }),
    request(app).put('/api/users/preferences').set(auth).send({ hotel_stars: '5', budget_per_night_max: -10, noise_sensitivity: 101 }),
    request(app).post('/api/interactions').set(auth).send({ event_type: 'view', context: { oversized: 'x'.repeat(6000) } }),
    request(app).post('/api/notifications/trips').set(auth).send({ title: 'Invalid metadata', start_date: '2030-05-10', items: [{ type: 'hotel', metadata: { oversized: 'x'.repeat(6000) } }] }),
    request(app).patch('/api/notifications/trips/not-a-trip').set(auth).send({ status: 'deleted' }),
    request(app).post('/api/partners/clicks').set(auth).send({ destination_url: 'javascript:alert(1)', amount: -1, metadata: {} }),
    request(app).post('/api/partners/postback/test').send({ event_id: '', click_id: '', event_type: 'something_else' }),
  ];
  for (const pending of cases) {
    const response = await pending;
    assert.equal(response.status, 400, response.text);
    assert.equal(response.body.code, 'VALIDATION_ERROR');
    assert.equal(response.body.error, 'Request validation failed');
    assert.ok(Array.isArray(response.body.details) && response.body.details.length > 0);
  }
  const profile = await db.prepare('SELECT website FROM users WHERE id = ?').get(account.user.id);
  assert.equal(profile.website, null);
});

test('flight API distinguishes provider timeout, provider error and a successful empty result', async () => {
  const account = await register('flight-provider-errors');
  const auth = { Authorization: `Bearer ${account.token}` };
  const url = '/api/flights/top?origin=MOW&destination=DXB&depart_date=2030-05-10&currency=USD';
  const methods = ['pricesForDates', 'cheapestTickets', 'priceCalendar', 'getAirports'];
  const originals = Object.fromEntries(methods.map(method => [method, travelpayouts[method]]));
  const setSearchProviders = implementation => {
    travelpayouts.pricesForDates = implementation;
    travelpayouts.cheapestTickets = implementation;
    travelpayouts.priceCalendar = implementation;
  };
  try {
    const timeout = new Error('upstream socket timed out with private diagnostics');
    timeout.name = 'TimeoutError'; timeout.code = 'ETIMEDOUT';
    setSearchProviders(async () => { throw timeout; });
    const timedOut = await request(app).get(url).set(auth);
    assert.equal(timedOut.status, 504, timedOut.text);
    assert.deepEqual(timedOut.body, { success: false, error: 'Travelpayouts did not respond in time', code: 'PROVIDER_TIMEOUT', provider: 'Travelpayouts', retryable: true });
    assert.equal(timedOut.text.includes('private diagnostics'), false);

    setSearchProviders(async () => { throw new Error('upstream rejected the request with private diagnostics'); });
    const failed = await request(app).get(url).set(auth);
    assert.equal(failed.status, 502, failed.text);
    assert.deepEqual(failed.body, { success: false, error: 'Travelpayouts request failed', code: 'PROVIDER_ERROR', provider: 'Travelpayouts', retryable: true });
    assert.equal(failed.text.includes('private diagnostics'), false);

    setSearchProviders(async () => []);
    travelpayouts.getAirports = async () => [];
    const empty = await request(app).get(url).set(auth);
    assert.equal(empty.status, 200, empty.text);
    assert.equal(empty.body.success, true); assert.equal(empty.body.count, 0); assert.deepEqual(empty.body.data, []);
  } finally {
    for (const method of methods) travelpayouts[method] = originals[method];
  }
});

test('provider-backed API explicitly reports missing credentials', async () => {
  const account = await register('provider-missing');
  const previous = { fixtures: process.env.PROVIDER_FIXTURES_ENABLED, key: process.env.LITEAPI_KEY, hotelRateProviders: process.env.HOTEL_RATE_PROVIDERS };
  process.env.PROVIDER_FIXTURES_ENABLED = 'false'; delete process.env.LITEAPI_KEY;
  process.env.HOTEL_RATE_PROVIDERS = 'none';
  try {
    const response = await request(app).get('/api/hotels/search?city=Singapore').set('Authorization', `Bearer ${account.token}`);
    assert.equal(response.status, 503); assert.equal(response.body.code, 'PROVIDER_NOT_CONFIGURED'); assert.equal(response.body.retryable, false);
  } finally {
    if (previous.fixtures === undefined) delete process.env.PROVIDER_FIXTURES_ENABLED; else process.env.PROVIDER_FIXTURES_ENABLED = previous.fixtures;
    if (previous.key === undefined) delete process.env.LITEAPI_KEY; else process.env.LITEAPI_KEY = previous.key;
    if (previous.hotelRateProviders === undefined) delete process.env.HOTEL_RATE_PROVIDERS; else process.env.HOTEL_RATE_PROVIDERS = previous.hotelRateProviders;
  }
});

test('data export uses allowlists and never exposes session or notification secrets', async () => {
  const account = await register('safe-export');
  const sessionSecret = `refresh-secret-${crypto.randomUUID()}`;
  const payloadSecret = `payload-secret-${crypto.randomUUID()}`;
  const errorSecret = `smtp-secret-${crypto.randomUUID()}`;
  await db.prepare(`UPDATE user_sessions SET refresh_token_hash = ? WHERE user_id = ?`).run(sessionSecret, account.user.id);
  await db.prepare(`INSERT INTO notification_jobs (id, user_id, type, deduplication_key, payload, status, attempts, locked_at, last_error) VALUES (?, ?, 'weekly_digest', ?, ?, 'failed', 5, NOW(), ?)`)
    .run(crypto.randomUUID(), account.user.id, `export-test:${crypto.randomUUID()}`, JSON.stringify({ private: payloadSecret }), errorSecret);

  const response = await request(app).get('/api/users/export').set('Authorization', `Bearer ${account.token}`);
  assert.equal(response.status, 200, response.text);
  assert.equal(response.body.export_version, 1);
  assert.ok(response.body.user_sessions.length > 0);
  assert.ok(response.body.notification_jobs.length > 0);

  const forbiddenKeys = new Set(['refresh_token_hash', 'refresh_expires_at', 'payload', 'deduplication_key', 'attempts', 'locked_at', 'last_error']);
  const visit = value => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key), false, `export contains forbidden field: ${key}`);
      visit(child);
    }
  };
  visit(response.body);
  const serialized = JSON.stringify(response.body);
  assert.equal(serialized.includes(sessionSecret), false);
  assert.equal(serialized.includes(payloadSecret), false);
  assert.equal(serialized.includes(errorSecret), false);
});

test('account deletion requires the password and removes user data', async () => {
  const account = await register('delete-api');
  const auth = { Authorization: `Bearer ${account.token}` };
  const rejected = await request(app).delete('/api/users/me').set(auth).send({ password: 'WrongPass123!' });
  assert.equal(rejected.status, 400);
  const removed = await request(app).delete('/api/users/me').set(auth).send({ password: 'TestPass123!' });
  assert.equal(removed.status, 204, removed.text);
  const row = await db.prepare('SELECT id FROM users WHERE id = ?').get(account.user.id);
  assert.equal(row, undefined);
  const denied = await request(app).post('/api/auth/login').send({ email: account.user.email, password: 'TestPass123!' });
  assert.ok([400, 401].includes(denied.status));
});
