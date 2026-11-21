import {defineConfig, devices} from '@playwright/test';

const port = Number(process.env.PW_PORT || 4180);

export default defineConfig({
 testDir: './tests/ui',
 testMatch: 'import-vorschau.spec.js',
 fullyParallel: false,
 retries: 0,
 reporter: 'line',
 use: {baseURL: `http://127.0.0.1:${port}`},
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
