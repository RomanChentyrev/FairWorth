require('dotenv').config();
process.env.PARTNER_POSTBACK_SECRET = 'integration-postback-secret';
process.env.ADMIN_EMAILS = 'admin-test@example.com';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, ready } = require('../index');
const { db, close } = require('../db/database');
const { defaultTravelDates } = require('../utils/dates');
const crypto = require('crypto');

const users = [];
async function register(label) {
  const email = `p2-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  const response = await request(app).post('/api/auth/register').send({ name: `Test ${label}`, email, password: 'TestPass123!', accept_terms: true, behavioural_tracking_consent: true });
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

test('hotel filters are applied and filter refresh is not logged as a search', async () => {
  const user = await register('filters');
  const before = Number((await db.prepare('SELECT COUNT(*) count FROM searches WHERE user_id = ?').get(user.user.id)).count);
  const five = await request(app).get('/api/hotels/search?city=Singapore&stars=5&rating_min=4.5&amenities=pool').set('Authorization', `Bearer ${user.token}`);
  assert.equal(five.status, 200, five.text); assert.ok(five.body.hotels.every(h => h.stars === 5 && Number(h.rating) >= 4.5));
  const afterFilter = Number((await db.prepare('SELECT COUNT(*) count FROM searches WHERE user_id = ?').get(user.user.id)).count);
  assert.equal(afterFilter, before);
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

test('partner postback completes a tracked referral', async () => {
  const account = await register('partner');
  const clickResponse = await request(app).post('/api/partners/clicks').set('Authorization', `Bearer ${account.token}`).send({ hotel_id: 'test-live-hotel', provider: 'Test Partner', destination_url: 'https://partner.example/hotel', amount: 500, currency: 'USD' });
  assert.equal(clickResponse.status, 201, clickResponse.text);
  const payload = { event_id: `event-${Date.now()}`, click_id: clickResponse.body.click_id, event_type: 'booking_completed', booking_reference: 'BOOK-123', amount: 500, currency: 'USD' };
  const stable = value => Array.isArray(value) ? `[${value.map(stable).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}` : JSON.stringify(value);
  const signature = crypto.createHmac('sha256', process.env.PARTNER_POSTBACK_SECRET).update(stable(payload)).digest('hex');
  const postback = await request(app).post('/api/partners/postback/test-partner').set('x-fairworth-signature', signature).send(payload);
  assert.equal(postback.status, 200, postback.text);
  const status = await request(app).get(`/api/partners/clicks/${clickResponse.body.click_id}`).set('Authorization', `Bearer ${account.token}`);
  assert.equal(status.body.click.status, 'booking_completed'); assert.equal(status.body.click.booking_reference, 'BOOK-123');
});

test('admin can review and resolve suspicious prices', async () => {
  await db.prepare(`DELETE FROM users WHERE email = 'admin-test@example.com'`).run();
  const registration = await request(app).post('/api/auth/register').send({ name: 'Admin Test', email: 'admin-test@example.com', password: 'TestPass123!', accept_terms: true });
  users.push(registration.body.user.id);
  const token = registration.body.token;
  await request(app).post('/api/auth/verify-email').send({ token: registration.body.development_verification_token });
  const anomalyId = crypto.randomUUID();
  await db.prepare(`INSERT INTO price_anomalies (id, hotel_id, provider, anomaly_type, previous_price, current_price, currency) VALUES (?, 'test-live-hotel', 'Test Partner', 'sudden_price_change', 500, 900, 'USD')`).run(anomalyId);
  const list = await request(app).get('/api/admin/anomalies').set('Authorization', `Bearer ${token}`);
  assert.equal(list.status, 200, list.text); assert.ok(list.body.price_anomalies.some(item => item.id === anomalyId));
  const resolved = await request(app).patch(`/api/admin/anomalies/price/${anomalyId}/resolve`).set('Authorization', `Bearer ${token}`);
  assert.equal(resolved.status, 200, resolved.text);
});

test('cookie sessions enforce CSRF and rotate refresh tokens', async () => {
  const agent = request.agent(app);
  const email = `cookie-security-${Date.now()}@example.com`;
  const registration = await agent.post('/api/auth/register').send({ name: 'Cookie Security', email, password: 'TestPass123!', accept_terms: true });
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
  const response = await request(app).post('/api/auth/register').send({ name: 'Weak Password', email: `weak-${Date.now()}@example.com`, password: 'password123', accept_terms: true });
  assert.equal(response.status, 400);
});
