import { test, expect } from '@playwright/test';

const API_URL = process.env.E2E_API_URL || `http://127.0.0.1:${process.env.E2E_API_PORT || 3101}`;
const PASSWORD = 'TestPass123!';
const cleanupAccounts = [];

function uniqueEmail(label) {
  return `e2e-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
}

async function registerAccount(request, { label = 'user', email = uniqueEmail(label), verify = false, onboard = false } = {}) {
  const legalResponse = await request.get(`${API_URL}/api/legal/current`);
  const legal = await legalResponse.json();
  const response = await request.post(`${API_URL}/api/auth/register`, {
    data: {
      name: `E2E ${label}`,
      email,
      password: PASSWORD,
      accept_terms: true,
      behavioural_tracking_consent: true,
      terms_version: legal.terms_version,
      privacy_version: legal.privacy_version,
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const account = await response.json();
  cleanupAccounts.push({ token: account.token, password: PASSWORD });

  if (verify) {
    const verified = await request.post(`${API_URL}/api/auth/verify-email`, {
      data: { token: account.development_verification_token },
    });
    expect(verified.ok(), await verified.text()).toBeTruthy();
  }
  if (onboard) {
    await request.put(`${API_URL}/api/users/preferences`, {
      headers: { Authorization: `Bearer ${account.token}` },
      data: { hotel_stars: ['5'], hotel_amenities: ['pool'], budget_per_night_max: 1200 },
    });
    const completed = await request.post(`${API_URL}/api/users/onboarding/complete`, {
      headers: { Authorization: `Bearer ${account.token}` },
    });
    expect(completed.ok(), await completed.text()).toBeTruthy();
  }
  return account;
}

async function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

test.afterEach(async ({ request }) => {
  for (const account of cleanupAccounts.splice(0)) {
    await request.delete(`${API_URL}/api/users/me`, {
      headers: await authHeaders(account.token),
      data: { password: account.password },
    }).catch(() => null);
  }
});

test('registration → email verification → onboarding', async ({ page }) => {
  await page.goto('/register');
  await page.locator('input[type="text"]').first().fill('E2E Browser User');
  await page.locator('input[type="email"]').fill(uniqueEmail('browser'));
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('input[type="checkbox"]').first().check();
  const registrationResponse = page.waitForResponse(response => response.url().endsWith('/api/auth/register') && response.request().method() === 'POST');
  await page.getByRole('button', { name: /create account/i }).click();

  await expect(page).toHaveURL(/\/preferences\?onboarding=1/, { timeout: 15_000 });
  const registration = await (await registrationResponse).json();
  cleanupAccounts.push({ token: registration.token, password: PASSWORD });
  await page.getByRole('button', { name: /5 stars/i }).click();
  await page.getByRole('button', { name: /pool/i }).nth(1).click();
  await page.getByRole('button', { name: /save and start/i }).click();
  await expect(page).toHaveURL(/\/$/);

  const user = await page.evaluate(() => JSON.parse(localStorage.getItem('fw_user')));
  expect(user.email_verified).toBe(true);
  expect(user.onboarding_completed).toBe(true);
});

test('achievements map saves a city and marks its country', async ({ page, request }) => {
  const account = await registerAccount(request, { label: 'achievements', verify: true, onboard: true });
  await page.context().addCookies([
    { name: 'fw_access', value: account.token, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' },
    { name: 'fw_csrf', value: 'e2e-achievements-csrf', domain: '127.0.0.1', path: '/', httpOnly: false, sameSite: 'Lax' },
  ]);
  await page.addInitScript(user => localStorage.setItem('fw_user', JSON.stringify({ ...user, onboarding_completed: true, email_verified: true })), account.user);

  await page.goto('/achievements');
  await expect(page.getByRole('heading', { name: 'Achievements' })).toBeVisible();
  const desktopLayout = await page.evaluate(() => {
    const map = document.querySelector('[aria-label="Map of visited places"]');
    const workspace = map?.closest('section');
    return { scrollY: window.scrollY, viewport: window.innerHeight, bottom: workspace?.getBoundingClientRect().bottom || 0 };
  });
  expect(desktopLayout.scrollY).toBe(0);
  expect(desktopLayout.bottom).toBeLessThanOrEqual(desktopLayout.viewport);
  await page.getByLabel('Map of visited places').hover();
  await page.mouse.wheel(0, -500);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.getByLabel('Add a place').fill('Paris');
  await page.getByRole('option').filter({ hasText: /^🇫🇷Paris/ }).first().click();
  await page.getByRole('button', { name: /mark as visited/i }).click();

  await expect(page.getByText('Paris', { exact: true }).first()).toBeVisible();
  const saved = await request.get(`${API_URL}/api/achievements`, { headers: await authHeaders(account.token) });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  expect((await saved.json()).stats).toEqual({ countries: 1, cities: 1 });
  await expect(page.locator('[data-visited="true"]')).toHaveCount(1);

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByLabel('Map of visited places')).toBeVisible();
  const dimensions = await page.evaluate(() => ({ viewport: window.innerWidth, content: document.documentElement.scrollWidth }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
});

test('demo checkout shows the cost breakdown and confirms a booking', async ({ page, request }) => {
  const account = await registerAccount(request, { label: 'demo-checkout', verify: true, onboard: true });
  const checkIn = new Date(Date.now() + 35 * 86400000).toISOString().slice(0, 10);
  const checkOut = new Date(Date.now() + 39 * 86400000).toISOString().slice(0, 10);
  const basket = {
    hotel: { id: 'test-live-hotel', name: 'Test Live Hotel', city: 'Singapore', checkIn, checkOut, nights: 4, totalPrice: 800, pricePerNight: 200, currency: 'USD' },
    outboundFlight: { flightId: 'demo-flight', title: 'Demo Air 101', originCode: 'MOW', destinationCode: 'SIN', date: checkIn, departureTime: '09:00', arrivalTime: '20:00', provider: 'Demo', cabinClass: 'economy', passengers: 1, totalPrice: 450 },
    returnFlight: null, transfer: null,
  };
  await page.context().addCookies([
    { name: 'fw_access', value: account.token, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' },
    { name: 'fw_csrf', value: 'e2e-booking-csrf', domain: '127.0.0.1', path: '/', httpOnly: false, sameSite: 'Lax' },
  ]);
  await page.addInitScript(({ user, trip }) => {
    localStorage.setItem('fw_user', JSON.stringify({ ...user, onboarding_completed: true, email_verified: true }));
    sessionStorage.setItem('fairworth_trip_basket', JSON.stringify(trip));
  }, { user: account.user, trip: basket });

  await page.goto('/booking/demo');
  await expect(page.getByRole('heading', { name: 'Demo trip booking' })).toBeVisible();
  await expect(page.getByText('$1,250', { exact: true }).first()).toBeVisible();
  await page.getByLabel('Phone').fill('+375 29 000 00 00');
  await page.getByLabel('First name').fill('Roman');
  await page.getByLabel('Last name').fill('Test');
  await page.getByLabel('Date of birth').fill('1990-01-01');
  await page.getByLabel('Nationality').fill('Belarus');
  await page.getByLabel('Document number').fill('AB1234567');
  await page.getByLabel('Document expiry').fill('2035-01-01');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /confirm demo booking/i }).click();
  await expect(page.getByText(/FW-DEMO-[A-F0-9]{10}/)).toBeVisible();
  await expect(page.getByText(/no payment was charged/i)).toBeVisible();
});

test('search → live price → filter → compare → details → booking pending', async ({ page, request }) => {
  const account = await registerAccount(request, { label: 'journey', verify: true, onboard: true });
  const hotels = [
    { id: 'hotel-marina-bay-sands', name: 'Marina Bay Sands', city: 'Singapore', country: 'Singapore', location: 'Marina Bay', stars: 5, amenities: '["pool"]', min_price: 500, fairworth_score: 91, price_details: { provider: 'Test Partner', currency: 'USD' } },
    { id: 'hotel-raffles-singapore', name: 'Raffles Singapore', city: 'Singapore', country: 'Singapore', location: 'City Hall', stars: 5, amenities: '["pool"]', min_price: 600, fairworth_score: 89, price_details: { provider: 'Test Partner', currency: 'USD' } },
  ];
  const searchRequests = [];

  await page.route('**/api/hotels/search**', route => {
    searchRequests.push(route.request().url());
    return route.fulfill({ json: { hotels, total: 2, has_more: false, facets: { locations: ['Marina Bay', 'City Hall'] } } });
  });
  await page.route('**/api/hotels/rates/batch', route => route.fulfill({ json: { hotels } }));
  await page.route('**/api/interactions', route => route.fulfill({ status: 201, json: { recorded: 1 } }));
  await page.route('**/api/compare', route => route.fulfill({
    json: {
      comparison: hotels.map(hotel => ({
        hotel, score: hotel.fairworth_score, prices: [{ operator: 'Test Partner', price_per_night: hotel.min_price, currency: 'USD', url: 'https://partner.example/hotel' }],
        rooms: [], reviews: { rating: 4.8, count: 500 }, bestPrice: hotel.min_price, totalPrice: hotel.min_price * 4, nights: 4,
      })),
      session_id: 'e2e-comparison',
    },
  }));
  await page.route('**/api/hotels/hotel-marina-bay-sands?**', route => route.fulfill({
    json: {
      hotel: { ...hotels[0], tripadvisor_url: 'https://www.tripadvisor.com/' }, rooms: [], reviews: null,
      prices: [{ operator: 'Test Partner', price_per_night: 500, currency: 'USD', url: 'https://partner.example/hotel', source: 'xotelo' }],
      scoring: { ...hotels[0], score_version: 'e2e', calculated_at: new Date().toISOString(), score_explanation: 'E2E score' },
    },
  }));
  await page.route('**/api/hotels/hotel-marina-bay-sands/analyze', route => route.fulfill({ json: { analysis: { verdict: 'Strong value for this trip.', match_analysis: 'Matches the selected preferences.' } } }));
  await page.context().addCookies([{ name: 'fw_access', value: account.token, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  await page.addInitScript(({ token, user }) => {
    localStorage.setItem('fw_user', JSON.stringify({ ...user, onboarding_completed: true, email_verified: true }));
  }, account);

  await page.goto('/results?city=Singapore');
  await expect(page.getByTestId('hotel-card-hotel-marina-bay-sands')).toBeVisible();
  await page.getByRole('button', { name: /^Trip 0$/ }).click();
  const basketDrawer = page.getByTestId('trip-basket-drawer');
  await expect(basketDrawer).toBeVisible();
  const basketIsTopLayer = await basketDrawer.evaluate(drawer => {
    const rect = drawer.getBoundingClientRect();
    const topElement = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return drawer === topElement || drawer.contains(topElement);
  });
  expect(basketIsTopLayer).toBe(true);
  await basketDrawer.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: '★★★★★' }).click();
  await expect.poll(() => searchRequests.some(url => new URL(url).searchParams.get('stars') === '5')).toBe(true);
  await page.getByRole('button', { name: /required amenities/i }).click();
  await page.getByRole('checkbox', { name: 'Tennis court' }).check();
  await expect.poll(() => searchRequests.some(url => new URL(url).searchParams.get('amenities') === 'tennis')).toBe(true);

  await page.getByTestId('hotel-compare-hotel-raffles-singapore').click();
  await page.getByTestId('hotel-compare-hotel-marina-bay-sands').click();
  await page.getByTestId('open-comparison').click();
  await expect(page.getByRole('heading', { name: /compare options/i })).toBeVisible();

  await page.getByTestId('comparison-details-hotel-marina-bay-sands').click();
  await expect(page.getByRole('heading', { name: 'Marina Bay Sands' })).toBeVisible();
  await page.getByRole('button', { name: /run analysis/i }).click();
  await expect(page.getByText('Strong value for this trip.')).toBeVisible();
  await expect(page.getByTestId('continue-at-provider')).toBeDisabled();
  await expect(page.getByTestId('continue-at-provider')).toContainText(/booking will be soon/i);
});

test('real hotel detail response renders without crashing', async ({ page, request }) => {
  const account = await registerAccount(request, { label: 'real-hotel-detail', verify: true, onboard: true });
  await page.context().addCookies([
    { name: 'fw_access', value: account.token, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' },
    { name: 'fw_csrf', value: 'e2e-real-detail-csrf', domain: '127.0.0.1', path: '/', httpOnly: false, sameSite: 'Lax' },
  ]);
  await page.addInitScript(user => localStorage.setItem('fw_user', JSON.stringify({ ...user, onboarding_completed: true, email_verified: true })), account.user);
  const search = await request.get(`${API_URL}/api/hotels/search?city=Singapore`, { headers: await authHeaders(account.token) });
  expect(search.ok(), await search.text()).toBeTruthy();
  const hotel = (await search.json()).hotels[0];
  expect(hotel?.id).toBeTruthy();
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  await page.goto(`/hotel/${hotel.id}`);
  await page.waitForTimeout(1500);
  expect(browserErrors, await page.locator('body').innerText()).toEqual([]);
  await expect(page.getByRole('heading', { name: hotel.name })).toBeVisible();
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
});

test('password recovery token is one-time and old sessions are revoked', async ({ request }) => {
  const account = await registerAccount(request, { label: 'reset' });
  const forgot = await request.post(`${API_URL}/api/auth/forgot-password`, { data: { email: account.user.email } });
  const { development_token: resetToken } = await forgot.json();
  expect(resetToken).toBeTruthy();

  const reset = await request.post(`${API_URL}/api/auth/reset-password`, { data: { token: resetToken, password: 'NewTestPass123!' } });
  expect(reset.ok(), await reset.text()).toBeTruthy();
  const reused = await request.post(`${API_URL}/api/auth/reset-password`, { data: { token: resetToken, password: 'AnotherPass123!' } });
  expect(reused.status()).toBe(400);
  expect((await request.get(`${API_URL}/api/auth/me`, { headers: await authHeaders(account.token) })).status()).toBe(401);

  const login = await request.post(`${API_URL}/api/auth/login`, { data: { email: account.user.email, password: 'NewTestPass123!' } });
  expect(login.ok(), await login.text()).toBeTruthy();
  const loggedIn = await login.json();
  cleanupAccounts.push({ token: loggedIn.token, password: 'NewTestPass123!' });
});

test('flight search renders a live-provider fare', async ({ page, request }) => {
  const account = await registerAccount(request, { label: 'flight-search', verify: true, onboard: true });
  const departure = new Date(Date.now() + 35 * 86400000).toISOString().slice(0, 10);
  await page.route('**/api/flights/top**', async route => {
    const query = new URL(route.request().url()).searchParams;
    await route.fulfill({ json: { success: true, data: [{ origin: 'MOW', destination: 'DXB', airline: 'EK', flight_number: '134', departure_at: `${query.get('depart_date')}T08:30:00Z`, duration_to: 330, transfers: 0, price: 420, link: '/search/EK134' }] } });
  });
  await page.context().addCookies([{ name: 'fw_access', value: account.token, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  await page.addInitScript(user => localStorage.setItem('fw_user', JSON.stringify({ ...user, onboarding_completed: true, email_verified: true })), account.user);
  await page.goto(`/flights?from=MOW&to=DXB&departure_date=${departure}&passengers=1&cabin_class=economy`);
  await expect(page.getByText('Emirates').first()).toBeVisible();
  await expect(page.getByText('$420').first()).toBeVisible();
  await expect(page.getByText(/Travelpayouts fare/i).first()).toBeVisible();
});

test('a user can revoke another own session', async ({ request }) => {
  const account = await registerAccount(request, { label: 'sessions' });
  const login = await request.post(`${API_URL}/api/auth/login`, { data: { email: account.user.email, password: PASSWORD } });
  const second = await login.json();
  const sessions = await request.get(`${API_URL}/api/users/sessions`, { headers: await authHeaders(account.token) });
  const secondary = (await sessions.json()).sessions.find(session => !session.current);
  expect(secondary).toBeTruthy();
  expect((await request.delete(`${API_URL}/api/users/sessions/${secondary.id}`, { headers: await authHeaders(account.token) })).status()).toBe(204);
  expect((await request.get(`${API_URL}/api/auth/me`, { headers: await authHeaders(second.token) })).status()).toBe(401);
});

test('account deletion removes access and prevents login', async ({ request }) => {
  const account = await registerAccount(request, { label: 'delete' });
  const exported = await request.get(`${API_URL}/api/users/export`, { headers: await authHeaders(account.token) });
  expect(exported.status()).toBe(200);
  expect(exported.headers()['content-disposition']).toContain('fairworth-data.json');
  expect((await exported.json()).user.email).toBe(account.user.email);
  const deleted = await request.delete(`${API_URL}/api/users/me`, { headers: await authHeaders(account.token), data: { password: PASSWORD } });
  expect(deleted.status()).toBe(204);
  cleanupAccounts.splice(0);
  expect((await request.get(`${API_URL}/api/auth/me`, { headers: await authHeaders(account.token) })).status()).toBe(401);
  expect((await request.post(`${API_URL}/api/auth/login`, { data: { email: account.user.email, password: PASSWORD } })).status()).toBe(400);
});

test('users cannot revoke sessions belonging to another account', async ({ request }) => {
  const first = await registerAccount(request, { label: 'isolation-a' });
  const second = await registerAccount(request, { label: 'isolation-b' });
  const sessions = await request.get(`${API_URL}/api/users/sessions`, { headers: await authHeaders(second.token) });
  const secondSessionId = (await sessions.json()).sessions.find(session => session.current).id;

  expect((await request.delete(`${API_URL}/api/users/sessions/${secondSessionId}`, { headers: await authHeaders(first.token) })).status()).toBe(204);
  expect((await request.get(`${API_URL}/api/auth/me`, { headers: await authHeaders(second.token) })).status()).toBe(200);
});

test('admin endpoints distinguish an admin from a regular user', async ({ request }) => {
  const regular = await registerAccount(request, { label: 'regular' });
  expect((await request.get(`${API_URL}/api/admin/anomalies`, { headers: await authHeaders(regular.token) })).status()).toBe(403);

  const admin = await registerAccount(request, { label: 'admin', email: 'e2e-admin@example.com' });
  expect(admin.user.role).toBe('admin');
  expect((await request.get(`${API_URL}/api/admin/anomalies`, { headers: await authHeaders(admin.token) })).status()).toBe(200);
});

test('an unavailable transfer supplier returns an explicit service error', async ({ request }) => {
  const account = await registerAccount(request, { label: 'supplier', verify: true, onboard: true });
  const response = await request.get(`${API_URL}/api/transfers/search`, { headers: await authHeaders(account.token) });
  expect(response.status()).toBe(503);
  expect(await response.json()).toMatchObject({ code: 'TRANSFER_PROVIDER_UNAVAILABLE', transfers: [] });
});

test('registration remains usable on a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/register');
  await expect(page.getByRole('heading', { name: /^create account$/i })).toBeVisible();
  const dimensions = await page.evaluate(() => ({ viewport: window.innerWidth, content: document.documentElement.scrollWidth }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
});

test('English is default and RU toggle translates the interface', async ({ page }) => {
  await page.goto('/register');
  await expect(page.getByRole('heading', { name: /^create account$/i })).toBeVisible();
  await page.getByRole('button', { name: 'RU' }).click();
  await expect(page.getByRole('heading', { name: /создать аккаунт/i })).toBeVisible();
});
