import {chromium, devices} from '@playwright/test';
import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'docs', 'design-review-3.6.0-v4.2');
mkdirSync(outDir, {recursive: true});

const server = spawn(process.execPath, [join(root, 'scripts', 'static-server.mjs')], {
 cwd: root,
 stdio: ['ignore', 'pipe', 'pipe']
});
await new Promise(resolve => setTimeout(resolve, 1200));

const mock = `function query(){const promise=Promise.resolve({data:[],error:{code:'PGRST205',message:'missing'}});const chain={select(){return chain},eq(){return chain},order(){return chain},limit(){return chain},then(ok,bad){return promise.then(ok,bad)}};return chain}export function createClient(){return {from:query,rpc(){return Promise.resolve({data:null,error:null})},auth:{getUser:async()=>({data:{user:null},error:null}),getSession:async()=>({data:{session:null},error:null}),onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}},signInWithPassword:async()=>({data:null,error:{message:'blockiert'}}),signOut:async()=>({error:null})},channel(){return {on(){return this},subscribe(){}}},removeChannel(){}}}`;

const DEMO = {
 facilityId: 'demo-nord',
 facilityName: 'Demo-Betrieb Nord',
 greeting: 'Guten Abend, Max!',
 open: 2,
 mine: 1,
 critical: 1,
 progress: 1
};

async function paintDesignDemo(page) {
 await page.evaluate(async (demo) => {
  document.querySelector('#app')?.classList.remove('hidden');
  document.querySelector('#login')?.classList.add('hidden');
  const status = document.querySelector('#status');
  if (status) {
   status.textContent = 'DESIGN-DEMO · simulierte Inhalte · keine Live-Daten';
   status.className = 'ok';
  }
  const notice = document.querySelector('.notice-compact');
  if (notice) notice.classList.add('hidden');

  document.querySelector('#home-greeting') && (document.querySelector('#home-greeting').textContent = demo.greeting);
  document.querySelector('#home-facility') && (document.querySelector('#home-facility').textContent = demo.facilityName);
  document.querySelector('#nexus-date') && (document.querySelector('#nexus-date').textContent = 'Sa., 15.11.2026');
  const chip = document.querySelector('#nexus-status');
  if (chip) {
   chip.textContent = `${demo.critical} kritisch`;
   chip.className = 'nexus-chip status-alert';
  }
  const select = document.querySelector('#dashboard-facility');
  if (select) {
   select.innerHTML = '';
   const opt = document.createElement('option');
   opt.value = demo.facilityId;
   opt.textContent = demo.facilityName;
   select.append(opt);
   select.value = demo.facilityId;
  }
  const spotlightName = document.querySelector('#facility-spotlight-name');
  if (spotlightName) spotlightName.textContent = demo.facilityName;
  const spotlightStatus = document.querySelector('#facility-spotlight-status');
  if (spotlightStatus) {
   spotlightStatus.innerHTML = `<span class="nexus-chip status-warn">${demo.open} Mängel</span><span class="nexus-chip status-warn">${demo.progress} laufend</span><span class="nexus-chip status-alert">${demo.critical} kritisch</span>`;
  }
  for (const [id, value] of [
   ['metric-open', String(demo.open)],
   ['metric-mine', String(demo.mine)],
   ['metric-critical', String(demo.critical)],
   ['metric-progress', String(demo.progress)],
   ['metric-review', '0'],
   ['metric-resolved', '0']
  ]) {
   const node = document.getElementById(id);
   if (node) node.textContent = value;
  }
  const weather = document.querySelector('#dash-weather');
  if (weather) {
   weather.innerHTML = `<div class="weather-card compact"><div class="weather-icon" aria-hidden="true">☁</div><div><strong class="panel-value">12 °C</strong><p class="panel-meta">Bewölkt · ${demo.facilityName}</p></div></div><div class="weather-facts"><div><span>Max</span><strong>14°</strong></div><div><span>Min</span><strong>7°</strong></div><div><span>Regen</span><strong>20%</strong></div><div><span>Wind</span><strong>12</strong></div></div>`;
  }
  const analytics = document.querySelector('#dash-analytics');
  if (analytics) {
   analytics.innerHTML = '<div class="stats-grid"><div class="stat-chip"><span>Aktuell</span><strong>1.240 kWh</strong></div><div class="stat-chip"><span>Vergleich</span><strong>1.100 kWh</strong></div><div class="stat-chip"><span>Veränderung</span><strong class="delta-up">+12,7 %</strong></div></div><div class="sparkline" aria-hidden="true"><i style="height:28px"></i><i style="height:36px"></i><i style="height:24px"></i><i style="height:42px"></i></div>';
  }
  const {decorateModuleIcons, decorateNavIcons} = await import('/js/nexus-icons.js');
  decorateNavIcons();
  decorateModuleIcons();
 }, DEMO);
}

async function paintDefectsDemo(page) {
 await page.evaluate((demo) => {
  document.querySelector('#view-dashboard')?.classList.add('hidden');
  document.querySelector('#view-defects')?.classList.remove('hidden');
  const mine = document.querySelector('#mine-count');
  if (mine) mine.textContent = String(demo.mine);
  const list = document.querySelector('#defect-list');
  if (list) {
   list.innerHTML = `
<div class="defect defect-card priority-critical status-open"><div class="help">${demo.facilityName}</div><strong>Leckage Technikraum</strong><div class="defect-badges"><span class="badge priority-critical">Kritisch</span><span class="badge status-open">Offen</span></div></div>
<div class="defect defect-card priority-normal status-in_progress"><div class="help">${demo.facilityName}</div><strong>Beleuchtung Flur</strong><div class="defect-badges"><span class="badge priority-normal">Normal</span><span class="badge status-in_progress">In Bearbeitung</span></div></div>`;
  }
 }, DEMO);
}

async function shoot(label, device) {
 const browser = await chromium.launch();
 const context = await browser.newContext(device ? devices[device] : {viewport: {width: 1280, height: 900}});
 const page = await context.newPage();
 await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({contentType: 'text/javascript', body: mock}));
 await page.route(/supabase\.co/, route => route.abort());
 await page.route(/open-meteo\.com/, route => route.abort());
 await page.goto('http://127.0.0.1:4173/', {waitUntil: 'domcontentloaded'});
 await page.locator('#login').evaluate(node => node.classList.remove('hidden'));
 await page.evaluate(() => {
  const status = document.querySelector('#status');
  if (status) status.textContent = 'DESIGN-DEMO · Login-Ansicht · keine Live-Anmeldung';
 });
 await page.screenshot({path: join(outDir, `${label}-login.png`)});
 await paintDesignDemo(page);
 await page.locator('.dash-command').scrollIntoViewIfNeeded();
 await page.screenshot({path: join(outDir, `${label}-dashboard.png`)});
 await paintDefectsDemo(page);
 await page.locator('#defects-card').scrollIntoViewIfNeeded();
 await page.screenshot({path: join(outDir, `${label}-maengel.png`)});
 await page.evaluate(async () => {
  document.querySelector('#view-defects')?.classList.add('hidden');
  document.querySelector('#view-more')?.classList.remove('hidden');
  document.querySelector('#operations-card')?.classList.remove('hidden');
  const {decorateModuleIcons} = await import('/js/nexus-icons.js');
  decorateModuleIcons();
 });
 await page.locator('#operations-card').scrollIntoViewIfNeeded();
 await page.screenshot({path: join(outDir, `${label}-betrieb.png`)});
 await browser.close();
}

try {
 await shoot('desktop');
 await shoot('smartphone', 'Pixel 5');
 writeFileSync(join(outDir, 'README.md'), `# Design Review 3.6.0 v4.2 – Tageswerk Nexus

**DESIGN-DEMO:** Alle Ansichten außer dem Login-Gerüst nutzen simulierte DOM-Inhalte.
Keine produktiven Supabase-Anfragen, keine Live-Anmeldung, keine echten Betriebsdaten.

Demo-Konsistenz:
- Betrieb: Demo-Betrieb Nord (Auswahl und Spotlight identisch)
- Kennzahlen: 2 offen · 1 Aufgabe · 1 kritisch · 1 laufend
- Mängelliste: 2 Karten; „Meine Aufgaben“-Zähler = 1

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
