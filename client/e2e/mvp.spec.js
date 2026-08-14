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

test.beforeEach(async ({ page }) => {
  await page.route('**/api/capabilities', route => route.fulfill({
    json: {
      capabilities: {
        hotels: { status: 'ready', provider: 'E2E fixture', features: { catalog: true, live_rates: true, price_watches: true } },
        flights: { status: 'ready', provider: 'E2E fixture', features: { search: true, indicative_fares: true } },
        ai: { status: 'ready', provider: 'E2E fixture', optional: true, features: { hotel_analysis: true } },
        hotel_photos: { status: 'ready', provider: 'E2E fixture', optional: true, features: { galleries: true, fallback_images: true } },
        partner_booking: { status: 'pending', stage: 'post_company_registration', features: { redirect: false, postback: false } },
        transfers: { status: 'unavailable', stage: 'planned', features: {} },
      },
    },
  }));
});

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

test('achievements map saves a city and places its pin', async ({ page, request }) => {
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
  await page.getByLabel('Add a city').fill('Paris');
  await page.getByRole('option').filter({ hasText: /^🇫🇷Paris/ }).first().click();
  await page.getByRole('button', { name: /mark as visited/i }).click();

  await expect(page.getByText('Paris', { exact: true }).first()).toBeVisible();
  const saved = await request.get(`${API_URL}/api/achievements`, { headers: await authHeaders(account.token) });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  expect((await saved.json()).stats).toEqual({ countries: 1, cities: 1 });
  await expect(page.getByRole('button', { name: 'Paris, France' })).toHaveCount(1);

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByLabel('Map of visited places')).toBeVisible();
  const dimensions = await page.evaluate(() => ({ viewport: window.innerWidth, content: document.documentElement.scrollWidth }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
});

test('AI Mode opens as a separate conversational workspace', async ({ page, request }) => {
  const account = await registerAccount(request, { label: 'ai-mode', verify: true, onboard: true });
  const conversation = {
    id: 'ai-e2e-conversation', title: 'Paris trip', intent: 'inspiration',
    search_context: {}, selected_entities: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  const longReply = `Tell me your destination and dates. ${'I will keep the current trip context visible while we continue planning. '.repeat(45)}`;
  let messageRequestCount = 0;
  let hotelSearchCount = 0;
  await page.context().addCookies([
    { name: 'fw_access', value: account.token, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' },
    { name: 'fw_csrf', value: 'e2e-ai-csrf', domain: '127.0.0.1', path: '/', httpOnly: false, sameSite: 'Lax' },
  ]);
  await page.addInitScript(user => localStorage.setItem('fw_user', JSON.stringify({ ...user, onboarding_completed: true, email_verified: true })), account.user);
  await page.route('**/api/ai-mode/conversations**', async route => {
    const requestUrl = new URL(route.request().url());
    if (route.request().method() === 'GET' && requestUrl.pathname.endsWith('/conversations')) {
      return route.fulfill({ json: { conversations: [conversation] } });
    }
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: { conversation, messages: [] } });
    }
    if (requestUrl.pathname.endsWith('/messages')) {
      const body = route.request().postDataJSON();
      messageRequestCount += 1;
      const comparing = /compare/i.test(body.content);
      const planning = /itinerary|plan/i.test(body.content);
      const searchingHotels = messageRequestCount > 1 && !comparing && !planning;
      const action = comparing ? { type: 'compare', result_indexes: [1] }
        : planning ? { type: 'itinerary' }
          : { type: searchingHotels ? 'hotel_search' : 'none' };
      return route.fulfill({ json: {
        user_message: { id: 'ai-user-message', role: 'user', content: body.content },
        assistant_message: { id: `ai-assistant-message-${messageRequestCount}`, role: 'assistant', content: comparing ? 'I will compare it.' : planning ? 'I will build an itinerary.' : searchingHotels ? 'I will check live hotel rates now.' : longReply, metadata: { intent: planning ? 'itinerary' : comparing ? 'compare' : 'hotel_search', action, missing_fields: [] } },
        conversation: {
          ...conversation, title: body.content, intent: planning ? 'itinerary' : comparing ? 'compare' : 'hotel_search',
          search_context: { origin: 'Moscow', destination: messageRequestCount > 1 ? 'Nha Trang' : 'Southeast Asia', date_start: '2026-09-01', date_end: '2026-09-14', travelers: 2, budget_amount: 4000, currency: 'USD' },
        },
        action,
      } });
    }
    if (requestUrl.pathname.endsWith('/tool-results')) {
      const body = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { message: {
        id: `ai-tool-${Date.now()}`, role: 'tool', message_type: 'results', content: body.summary,
        metadata: { tool: body.tool, status: body.status, request: body.request, results: body.results, result_timestamp: new Date().toISOString() },
      } } });
    }
    return route.fulfill({ status: 201, json: { recorded: true } });
  });
  await page.route('**/api/hotels/search**', route => {
    hotelSearchCount += 1;
    const firstPage = hotelSearchCount === 1;
    return route.fulfill({ json: {
      hotels: [{ id: firstPage ? 'pending-hotel' : 'available-hotel', name: firstPage ? 'Pending Hotel' : 'Nha Trang Beach Hotel', city: 'Nha Trang', location: 'Beachfront', stars: 5 }],
      has_more: firstPage, next_offset: firstPage ? 1 : 2,
    } });
  });
  await page.route('**/api/hotels/rates/batch', route => {
    const body = route.request().postDataJSON();
    const available = body.hotel_ids.includes('available-hotel');
    return route.fulfill({ json: { hotels: available ? [{
      id: 'available-hotel', name: 'Nha Trang Beach Hotel', city: 'Nha Trang', location: 'Beachfront', stars: 5,
      min_price: 210, availability_status: 'available', fairworth_score: 88, adjusted_score: 84,
      price_details: { currency: 'USD' },
    }] : [{ id: 'pending-hotel', name: 'Pending Hotel', min_price: null, availability_status: 'unavailable' }] } });
  });

  await page.goto('/ai');
  await expect(page.getByText('AI Travel Assistant')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Where should we take you next?' })).toBeVisible();
  await page.getByPlaceholder(/ask about a destination/i).fill('Find a hotel for my trip');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText(/Tell me your destination and dates/)).toBeVisible();
  const desktopConversation = await page.evaluate(() => {
    const composer = document.querySelector('textarea[placeholder*="Ask about"]')?.closest('div');
    const scrollable = [...document.querySelectorAll('div')].find(element => element.scrollHeight > element.clientHeight + 100 && getComputedStyle(element).overflowY === 'auto');
    const rect = composer?.getBoundingClientRect();
    return {
      composerBottom: rect?.bottom || 0,
      viewportHeight: window.innerHeight,
      pageScroll: window.scrollY,
      timelineScrollable: Boolean(scrollable),
    };
  });
  expect(desktopConversation.composerBottom).toBeLessThanOrEqual(desktopConversation.viewportHeight);
  expect(desktopConversation.pageScroll).toBe(0);
  expect(desktopConversation.timelineScrollable).toBe(true);

  await page.getByPlaceholder(/ask about a destination/i).fill('Show me available hotels');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('Nha Trang Beach Hotel')).toBeVisible();
  expect(hotelSearchCount).toBeGreaterThan(1);

  await page.getByPlaceholder(/ask about a destination/i).fill('Compare option 1');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('I will compare it.')).toBeVisible();
  await expect(page.getByText('Nha Trang Beach Hotel')).toHaveCount(2);

  await page.getByPlaceholder(/ask about a destination/i).fill('Build an itinerary');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('I will build an itinerary.')).toBeVisible();
  await expect(page.getByText('Day 1', { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByText('AI Travel Assistant')).toBeVisible();
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
    { id: 'hotel-marina-bay-sands', name: 'Marina Bay Sands', city: 'Singapore', country: 'Singapore', location: 'Marina Bay', stars: 5, amenities: '["pool"]', min_price: 500, fairworth_score: 91, top_pick_eligible: true, availability_status: 'available', rate_freshness: 'fresh', price_details: { provider: 'Test Partner', currency: 'USD', refundable: true, includes_breakfast: true } },
    { id: 'hotel-raffles-singapore', name: 'Raffles Singapore', city: 'Singapore', country: 'Singapore', location: 'City Hall', stars: 5, amenities: '["pool"]', min_price: 600, fairworth_score: 89, availability_status: 'available', rate_freshness: 'cached', price_details: { provider: 'Test Partner', currency: 'USD', refundable: true, includes_breakfast: true } },
  ];
  const unavailableHotel = { id: 'hotel-price-pending', name: 'Price Pending Hotel', city: 'Singapore', country: 'Singapore', location: 'Orchard', stars: 5, amenities: '[]', min_price: null, fairworth_score: 99, top_pick_eligible: false, availability_status: 'unavailable', price_details: null };
  const searchRequests = [];

  await page.route('**/api/hotels/search**', route => {
    searchRequests.push(route.request().url());
    return route.fulfill({ json: { hotels: [...hotels, unavailableHotel], total: 3, has_more: false, facets: { locations: ['Marina Bay', 'City Hall', 'Orchard'] } } });
  });
  await page.route('**/api/hotels/rates/batch', route => route.fulfill({ json: { hotels: [...hotels, unavailableHotel], checked: 3, available: 2, unavailable_hotel_ids: [unavailableHotel.id] } }));
  await page.route('**/api/hotels/rates/stream?**', route => route.fulfill({
    contentType: 'text/event-stream',
    body: [
      `event: batch\ndata: ${JSON.stringify({ hotels: [...hotels, unavailableHotel], checked: 3, available: 2, unavailable_hotel_ids: [unavailableHotel.id] })}\n\n`,
      'event: complete\ndata: {"checked":3,"available":2,"total":3}\n\n',
    ].join(''),
  }));
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
  await page.route('**/api/hotels/hotel-marina-bay-sands/analyze/stream', route => route.fulfill({
    contentType: 'application/x-ndjson',
    body: `${JSON.stringify({ type: 'status', stage: 'analysing' })}\n${JSON.stringify({ type: 'analysis', analysis: { verdict: 'Strong value for this trip.', match_analysis: 'Matches the selected preferences.' } })}\n`,
  }));
  await page.context().addCookies([{ name: 'fw_access', value: account.token, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  await page.addInitScript(({ token, user }) => {
    localStorage.setItem('fw_user', JSON.stringify({ ...user, onboarding_completed: true, email_verified: true }));
  }, account);

  await page.goto('/results?city=Singapore');
  await expect(page.getByTestId('hotel-card-hotel-marina-bay-sands')).toBeVisible();
  await expect(page.getByTestId('hotel-card-hotel-price-pending')).toHaveCount(0);
  await expect(page.getByText(/2 available options in Singapore/i)).toBeVisible();
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

  const searchRequestCountBeforeDetails = searchRequests.length;
  await page.getByTestId('hotel-details-hotel-marina-bay-sands').click();
  await expect(page.getByRole('heading', { name: 'Marina Bay Sands' })).toBeVisible();
  await page.getByRole('button', { name: /search results/i }).click();
  await expect(page.getByTestId('hotel-card-hotel-marina-bay-sands')).toBeVisible();
  await page.waitForTimeout(800);
  expect(searchRequests).toHaveLength(searchRequestCountBeforeDetails);

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

test('flight search renders an indicative provider fare', async ({ page, request }) => {
  const account = await registerAccount(request, { label: 'flight-search', verify: true, onboard: true });
  const departure = new Date(Date.now() + 35 * 86400000).toISOString().slice(0, 10);
  await page.route('**/api/flights/top**', async route => {
    const query = new URL(route.request().url()).searchParams;
    expect(query.get('max_stops')).toBe('any');
    await route.fulfill({ json: { success: true, data: [{ origin: 'MOW', destination: 'DXB', airline: 'EK', flight_number: '134', departure_at: `${query.get('depart_date')}T08:30:00Z`, duration_to: 510, transfers: 1, price: 3740, link: '/search/EK134', fare_type: 'indicative', fare_observed_at: new Date().toISOString(), fare_cache_status: 'provider_cached', availability_confirmed: false, seat_availability_confirmed: false, fare_confidence: 52 }] } });
  });
  await page.context().addCookies([{ name: 'fw_access', value: account.token, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  await page.addInitScript(user => localStorage.setItem('fw_user', JSON.stringify({ ...user, onboarding_completed: true, email_verified: true })), account.user);
  await page.goto(`/flights?from=MOW&to=DXB&departure_date=${departure}&passengers=1&cabin_class=economy`);
  await expect(page.getByText('Emirates').first()).toBeVisible();
  await expect(page.getByText('$3,740').first()).toBeVisible();
  await expect(page.getByText(/Travelpayouts indicative fare/i).first()).toBeVisible();
  await expect(page.getByText(/Final price and seat availability are not confirmed/i).first()).toBeVisible();
  await expect(page.getByText(/Fare confidence: 52%/i).first()).toBeVisible();
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

test('login uses the light Fairworth layout on desktop and mobile', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByText('AI remembers your hotel and flight preferences')).toHaveCount(0);
  const background = await page.locator('main').evaluate(main => getComputedStyle(main.parentElement).backgroundColor);
  expect(background).toBe('rgb(250, 250, 250)');

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  const dimensions = await page.evaluate(() => ({ viewport: window.innerWidth, content: document.documentElement.scrollWidth }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
});

test('English is default and RU toggle translates the interface', async ({ page }) => {
  await page.goto('/register');
  await expect(page.getByRole('heading', { name: /^create account$/i })).toBeVisible();
  await page.getByRole('combobox', { name: 'Select language' }).selectOption('ru');
  await expect(page.getByRole('heading', { name: /создать аккаунт/i })).toBeVisible();
});
