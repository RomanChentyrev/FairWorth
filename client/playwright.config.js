import { defineConfig } from '@playwright/test';

const apiPort = Number(process.env.E2E_API_PORT || 3101);
const webPort = Number(process.env.E2E_WEB_PORT || 4173);
const apiUrl = process.env.E2E_API_URL || `http://127.0.0.1:${apiPort}`;
const webUrl = process.env.E2E_WEB_URL || `http://127.0.0.1:${webPort}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: process.env.CI ? 1 : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: webUrl,
    browserName: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: `npm run dev -- --host 127.0.0.1 --port ${webPort} --strictPort`,
      port: webPort,
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        VITE_API_PROXY_TARGET: apiUrl,
      },
    },
    {
      command: 'npm start',
      cwd: '../server',
      port: apiPort,
      reuseExistingServer: false,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PORT: String(apiPort),
        AUTH_RATE_LIMIT: '500',
        API_RATE_LIMIT: '5000',
        ADMIN_EMAILS: 'e2e-admin@example.com',
        PARTNER_POSTBACK_SECRET: 'e2e-partner-postback-secret',
        PROVIDER_FIXTURES_ENABLED: 'true',
      },
    },
  ],
});
