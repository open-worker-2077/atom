import { defineConfig } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

export default defineConfig({
  testDir: './tests/browser',
  outputDir: path.join(os.tmpdir(), 'atom-playwright-test-results'),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4796',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 960 }
  },
  webServer: {
    command: 'node scripts/start-browser-acceptance-server.mjs 4796',
    url: 'http://127.0.0.1:4796/__spatial/api/health',
    reuseExistingServer: false,
    timeout: 30_000
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }]
});
