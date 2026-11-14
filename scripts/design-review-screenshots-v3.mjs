import {chromium, devices} from '@playwright/test';
import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'docs', 'design-review-3.6.0-v3');
mkdirSync(outDir, {recursive: true});

const server = spawn(process.execPath, [join(root, 'scripts', 'static-server.mjs')], {
 cwd: root,
 stdio: ['ignore', 'pipe', 'pipe']
});
await new Promise(resolve => setTimeout(resolve, 1200));

const mock = `function query(){const promise=Promise.resolve({data:[],error:{code:'PGRST205',message:'missing'}});const chain={select(){return chain},eq(){return chain},order(){return chain},limit(){return chain},then(ok,bad){return promise.then(ok,bad)}};return chain}export function createClient(){return {from:query,rpc(){return Promise.resolve({data:null,error:null})},auth:{getUser:async()=>({data:{user:null},error:null}),getSession:async()=>({data:{session:null},error:null}),onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}},signInWithPassword:async()=>({data:null,error:{message:'blockiert'}}),signOut:async()=>({error:null})},channel(){return {on(){return this},subscribe(){}}},removeChannel(){}}}`;

async function shoot(label, device) {
 const browser = await chromium.launch();
 const context = await browser.newContext(device ? devices[device] : {viewport: {width: 1280, height: 900}});
 const page = await context.newPage();
 await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({contentType: 'text/javascript', body: mock}));
 await page.route(/supabase\.co/, route => route.abort());
 await page.route(/open-meteo\.com/, route => route.abort());
 await page.goto('http://127.0.0.1:4173/', {waitUntil: 'domcontentloaded'});
 await page.locator('#login').evaluate(node => node.classList.remove('hidden'));
 await page.screenshot({path: join(outDir, `${label}-login.png`)});
 await page.evaluate(() => {
  document.querySelector('#app')?.classList.remove('hidden');
  document.querySelector('#login')?.classList.add('hidden');
  document.querySelector('#home-greeting') && (document.querySelector('#home-greeting').textContent = 'Guten Abend!');
  document.querySelector('#home-facility') && (document.querySelector('#home-facility').textContent = 'Demo-Betrieb Nord');
  document.querySelector('#nexus-date') && (document.querySelector('#nexus-date').textContent = 'Sa., 14.11.2026');
  const status = document.querySelector('#nexus-status');
  if (status) {
   status.textContent = '1 kritisch';
   status.className = 'nexus-chip status-alert';
  }
  for (const [id, value] of [['metric-open', '3'], ['metric-mine', '1'], ['metric-critical', '1'], ['metric-progress', '2']]) {
   const node = document.getElementById(id);
   if (node) node.textContent = value;
  }
  const weather = document.querySelector('#dash-weather');
  if (weather) {
   weather.innerHTML = '<div class="weather-card compact"><div class="weather-icon" aria-hidden="true">☁</div><div><strong class="panel-value">12 °C</strong><p class="panel-meta">Bewölkt · Demo-Betrieb Nord</p></div></div><div class="weather-facts"><div><span>Max</span><strong>14°</strong></div><div><span>Min</span><strong>7°</strong></div><div><span>Regen</span><strong>20%</strong></div><div><span>Wind</span><strong>12</strong></div></div>';
  }
  const analytics = document.querySelector('#dash-analytics');
  if (analytics) {
   analytics.innerHTML = '<div class="stats-grid"><div class="stat-chip"><span>Aktuell</span><strong>1.240 kWh</strong></div><div class="stat-chip"><span>Vergleich</span><strong>1.100 kWh</strong></div><div class="stat-chip"><span>Veränderung</span><strong class="delta-up">+12,7 %</strong></div></div><div class="sparkline" aria-hidden="true"><i style="height:28px"></i><i style="height:36px"></i><i style="height:24px"></i><i style="height:42px"></i></div>';
  }
 });
 await page.locator('.dash-command').scrollIntoViewIfNeeded();
 await page.screenshot({path: join(outDir, `${label}-dashboard.png`)});
 await page.evaluate(() => {
  document.querySelector('#view-dashboard')?.classList.add('hidden');
  document.querySelector('#view-defects')?.classList.remove('hidden');
  const list = document.querySelector('#defect-list');
  if (list) {
   list.innerHTML = '<div class="defect defect-card priority-critical status-open"><div class="help">Demo-Betrieb Nord</div><strong>Leckage Technikraum</strong><div class="defect-badges"><span class="badge priority-critical">Kritisch</span><span class="badge status-open">Offen</span></div></div><div class="defect defect-card priority-normal status-in_progress"><div class="help">Demo-Betrieb Nord</div><strong>Beleuchtung Flur</strong><div class="defect-badges"><span class="badge priority-normal">Normal</span><span class="badge status-in_progress">In Bearbeitung</span></div></div>';
  }
 });
 await page.locator('#defects-card').scrollIntoViewIfNeeded();
 await page.screenshot({path: join(outDir, `${label}-maengel.png`)});
 await page.evaluate(() => {
  document.querySelector('#view-defects')?.classList.add('hidden');
  document.querySelector('#view-more')?.classList.remove('hidden');
  document.querySelector('#operations-card')?.classList.remove('hidden');
 });
 await page.locator('#operations-card').scrollIntoViewIfNeeded();
 await page.screenshot({path: join(outDir, `${label}-betrieb.png`)});
 await browser.close();
}

try {
 await shoot('desktop');
 await shoot('smartphone', 'Pixel 5');
 writeFileSync(join(outDir, 'README.md'), `# Design Review 3.6.0 v3 – Tageswerk Nexus

| Datei | Ansicht |
|-------|---------|
| desktop-login.png | Login |
| desktop-dashboard.png | Betriebszentrale |
| desktop-maengel.png | Mängel |
| desktop-betrieb.png | Betriebsmodule |
| smartphone-login.png | Login mobil |
| smartphone-dashboard.png | Dashboard mobil |
| smartphone-maengel.png | Mängel mobil |
| smartphone-betrieb.png | Module mobil |
`);
 console.log(`Screenshots: ${outDir}`);
} finally {
 server.kill();
}
