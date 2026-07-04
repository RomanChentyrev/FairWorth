import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: process.env.CI ? 1 : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort',
      port: 4173,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm start',
      cwd: '../server',
      port: 3001,
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        AUTH_RATE_LIMIT: '200',
        ADMIN_EMAILS: 'e2e-admin@example.com',
        PARTNER_POSTBACK_SECRET: 'e2e-partner-postback-secret',
      },
    },
  ],
});
