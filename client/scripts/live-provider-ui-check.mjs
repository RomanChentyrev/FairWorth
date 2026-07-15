import { chromium, expect } from '@playwright/test';

const WEB_URL = process.env.WEB_URL || 'http://127.0.0.1:5173';
const API_URL = process.env.API_URL || 'http://127.0.0.1:3001';
const PASSWORD = 'LiveCheckPass123!';

function futureDate(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function jsonFetch(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}: ${body.error || text}`);
  return body;
}

async function createAccount() {
  const legal = await jsonFetch('/api/legal/current');
  const email = `live-ui-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  const registration = await jsonFetch('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Live UI Check',
      email,
      password: PASSWORD,
      accept_terms: true,
      behavioural_tracking_consent: true,
      terms_version: legal.terms_version,
      privacy_version: legal.privacy_version,
    }),
  });
  await jsonFetch('/api/auth/verify-email', {
    method: 'POST',
    body: JSON.stringify({ token: registration.development_verification_token }),
  });
  const auth = { Authorization: `Bearer ${registration.token}` };
  await jsonFetch('/api/users/preferences', {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({
      hotel_stars: ['4', '5'],
      hotel_amenities: ['pool', 'wifi', 'breakfast'],
      travel_style: ['comfort', 'value'],
      budget_per_night_max: 1200,
      noise_sensitivity: 60,
    }),
  });
  await jsonFetch('/api/users/onboarding/complete', { method: 'POST', headers: auth });
  return registration;
}

async function deleteAccount(token) {
  try {
    await jsonFetch('/api/users/me', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ password: PASSWORD }),
    });
  } catch (error) {
    console.warn(`cleanup warning: ${error.message}`);
  }
}

async function main() {
  const account = await createAccount();
  const checkIn = futureDate(30);
  const checkOut = futureDate(32);
  const departureDate = futureDate(35);
  const csrf = `csrf-${Date.now()}`;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const network = [];

  page.on('response', response => {
    const url = response.url();
    if (url.includes('/api/hotels') || url.includes('/api/flights')) {
      network.push({ url, status: response.status() });
    }
  });
  page.on('console', message => {
    if (message.type() === 'error') console.warn(`browser console error: ${message.text()}`);
  });

  try {
    await context.addCookies([
      { name: 'fw_access', value: account.token, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' },
      { name: 'fw_csrf', value: csrf, domain: '127.0.0.1', path: '/', httpOnly: false, sameSite: 'Lax' },
    ]);
    await page.goto(WEB_URL);
    await page.evaluate(user => {
      localStorage.setItem('fw_user', JSON.stringify({ ...user, email_verified: true, onboarding_completed: true }));
      sessionStorage.clear();
    }, account.user);

    await page.goto(`${WEB_URL}/results?city=Dubai&check_in=${checkIn}&check_out=${checkOut}&guests=2`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid^="hotel-card-"]').first()).toBeVisible({ timeout: 90_000 });
    const firstCard = page.locator('[data-testid^="hotel-card-"]').first();
    const cardTestId = await firstCard.getAttribute('data-testid');
    const hotelId = cardTestId.replace('hotel-card-', '');
    const hotelName = (await firstCard.locator('h3, h2').first().textContent().catch(() => '') || '').trim();
    const hotelCardText = (await firstCard.textContent() || '').replace(/\s+/g, ' ').trim();
    await page.waitForResponse(response => response.url().includes('/api/hotels/rates/batch'), { timeout: 20_000 }).catch(() => null);

    await page.getByTestId(`hotel-details-${hotelId}`).click();
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/Where to book|Где бронировать/i)).toBeVisible({ timeout: 60_000 });
    const detailHeading = (await page.getByRole('heading').first().textContent() || '').trim();
    const priceSourceText = (await page.getByText(/Price source|Источник цены/i).locator('..').textContent().catch(() => '') || '').replace(/\s+/g, ' ').trim();

    await page.getByRole('button', { name: /Run analysis|Запустить анализ/i }).click();
    const aiOk = page.getByText(/Verdict|Вывод/i).first();
    const aiError = page.getByText(/Could not generate|Не удалось получить|Key limit exceeded|OpenRouter/i).first();
    await Promise.race([
      aiOk.waitFor({ state: 'visible', timeout: 120_000 }),
      aiError.waitFor({ state: 'visible', timeout: 120_000 }),
    ]);
    const aiRendered = await aiOk.isVisible().catch(() => false);
    const aiText = (await (aiRendered ? aiOk.locator('..') : aiError.locator('..')).textContent() || '').replace(/\s+/g, ' ').trim();

    await page.goto(`${WEB_URL}/flights?from=MOW&to=DXB&departure_date=${departureDate}&passengers=1&cabin_class=economy`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Travelpayouts fare').first()).toBeVisible({ timeout: 90_000 });
    const flightCard = page.getByText('Travelpayouts fare').first().locator('xpath=ancestor::div[contains(@class, "card")][1]');
    const flightText = (await flightCard.textContent() || '').replace(/\s+/g, ' ').trim();
    const priceMatch = flightText.match(/\$[\d,]+/);
    const airlineMatch = flightText.match(/Emirates|Qatar Airways|Turkish Airlines|flydubai|Gulf Air|Etihad Airways|Aeroflot|Air China|China Eastern|Uzbekistan Airways|Hainan Airlines|Airline/);

    const failedApi = network.filter(item => item.status >= 400);

    console.log(JSON.stringify({
      ok: true,
      hotel_search: {
        city: 'Dubai',
        dates: `${checkIn}..${checkOut}`,
        first_hotel_id: hotelId,
        first_hotel_name: hotelName || detailHeading,
        card_contains_live_price: /\$[\d,]+/.test(hotelCardText),
      },
      hotel_detail: {
        heading: detailHeading,
        price_source_visible: Boolean(priceSourceText),
      },
      ai_analysis: {
        rendered: aiRendered,
        preview: aiText.slice(0, 240),
      },
      flight_search: {
        route: 'MOW-DXB',
        departure_date: departureDate,
        airline: airlineMatch?.[0] || null,
        price: priceMatch?.[0] || null,
      },
      failed_api_calls: failedApi.map(item => ({ status: item.status, path: new URL(item.url).pathname })),
      api_calls_checked: network.length,
    }, null, 2));
  } finally {
    await browser.close();
    await deleteAccount(account.token);
  }
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
