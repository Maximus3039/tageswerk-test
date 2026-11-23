import {defineConfig, devices} from '@playwright/test';

const port = Number(process.env.PW_PORT || 4179);

export default defineConfig({
 testDir: './tests/ui',
 testMatch: ['smoke.spec.js', 'import-vorschau.spec.js', 'historical-consumption.spec.js', 'operations.spec.js', 'mobile.spec.js', 'mobile-ux-3-7.spec.js', 'mobile-abnahme-shots.spec.js', 'password-reset.spec.js', 'defect-archive.spec.js', 'temperature-settings.spec.js', 'water-history.spec.js', 'water-filters.spec.js', 'day-figures.spec.js', 'design-v2.spec.js', 'design-v3.spec.js', 'design-v4.spec.js', 'design-v41.spec.js', 'design-v42.spec.js', 'design-v43.spec.js', 'abnahme-3-6-3.spec.js'],
 fullyParallel: false,
 forbidOnly: !!process.env.CI,
 retries: process.env.CI ? 1 : 0,
 reporter: process.env.CI ? 'github' : 'line',
 use: {baseURL: `http://127.0.0.1:${port}`, serviceWorkers: 'block'},
 webServer: {
  command: 'node scripts/static-server.mjs',
  url: `http://127.0.0.1:${port}`,
  reuseExistingServer: false,
  timeout: 20000,
  env: {...process.env, PORT: String(port)}
 },
 projects: [
  {name: 'desktop', use: {...devices['Desktop Chrome']}},
  {name: 'smartphone', use: {...devices['Pixel 5']}}
 ]
});
