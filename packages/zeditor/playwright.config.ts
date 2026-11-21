import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
export default defineConfig({
  testDir: './test/browser',
  testMatch: /.*\.spec\.ts/,
  timeout: 30_000,
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/browser-results.json' }]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'retain-on-failure' },
  webServer: { command: `node ../../scripts/serve.mjs ${PORT}`, url: `http://127.0.0.1:${PORT}/examples/html/`, reuseExistingServer: true, timeout: 20_000 },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], permissions: ['clipboard-read', 'clipboard-write'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
