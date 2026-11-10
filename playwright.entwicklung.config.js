import {defineConfig, devices} from '@playwright/test';

export default defineConfig({
 testDir: './tests/ui',
 testMatch: 'import-vorschau.spec.js',
 fullyParallel: false,
 retries: 0,
 reporter: 'line',
 use: {baseURL: 'http://127.0.0.1:4173'},
 webServer: {
  command: 'node scripts/static-server.mjs',
  url: 'http://127.0.0.1:4173',
  reuseExistingServer: false,
  timeout: 20000
 },
 projects: [
  {name: 'desktop', use: {...devices['Desktop Chrome']}},
  {name: 'smartphone', use: {...devices['Pixel 5']}}
 ]
});
