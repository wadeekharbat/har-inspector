import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  fullyParallel: false, // Run smoke scenarios deterministically
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.APP_URL || 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.APP_URL ? undefined : {
    command: 'npm run dev -- --host 127.0.0.1 --port 5173',
    port: 5173,
    reuseExistingServer: true,
  },
});


