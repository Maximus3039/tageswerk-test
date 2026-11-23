import {expect, test} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const docsDir = path.resolve('docs/abnahme-mobile-3.7.0');
const outDir = path.resolve('test-results/abnahme-mobile-3.7.0');
fs.mkdirSync(outDir, {recursive: true});
fs.mkdirSync(docsDir, {recursive: true});

function publish(fileName) {
 try {
  fs.copyFileSync(path.join(outDir, fileName), path.join(docsDir, fileName));
 } catch {
  /* docs-Ordner kann unter Windows gesperrt sein */
 }
}

function supabaseMock() {
 return `const tables = {
 organizations: [{id: 'org', name: 'Freizeitpark'}],
 facilities: [{id: 'fac', name: 'Prignitzer', organization_id: 'org'}, {id: 'fac2', name: 'Nordbad', organization_id: 'org'}],
 memberships: [{user_id: 'user-1', organization_id: 'org', facility_id: null, role: 'company_admin', is_active: true}],
 profiles: [{id: 'user-1', full_name: 'Maximilian'}],
 staff_invitations: [],
 defects: [{id: 'd1', title: 'Pumpe undicht', status: 'open', facility_id: 'fac', organization_id: 'org', priority: 'high', created_at: '2026-11-20T08:00:00Z'}]
};
function query(name) {
 const result = Promise.resolve({data: tables[name] || [], error: null});
 const chain = {
  select() {return chain}, eq() {return chain}, in() {return chain}, order() {return chain}, limit() {return chain}, range() {return chain},
  maybeSingle() {return Promise.resolve({data: null, error: null})},
  insert() {return chain}, update() {return chain}, upsert() {return Promise.resolve({error: {message: 'relation does not exist', code: '42P01'}})},
  then(ok, bad) {return result.then(ok, bad)}
 };
 return chain;
}
export function createClient() {
 return {
  from: query,
  rpc() {return Promise.resolve({data: [], error: null})},
  functions: {invoke: async () => ({data: {ok: false}, error: null})},
  auth: {
   getUser: async () => ({data: {user: {id: 'user-1', email: 'leitung@example.invalid'}}, error: null}),
   getSession: async () => ({data: {session: {user: {id: 'user-1'}}}, error: null}),
   onAuthStateChange() {return {data: {subscription: {unsubscribe() {}}}}},
   signInWithPassword: async () => ({data: null, error: null}),
   signOut: async () => ({error: null})
  },
  channel() {return {on() {return this}, subscribe(cb) {if (cb) cb('SUBSCRIBED'); return this}}},
  removeChannel() {}
 };
}`;
}

async function openApp(page) {
 await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({contentType: 'text/javascript', body: supabaseMock()}));
 await page.route(/supabase\.co/, route => route.abort());
 await page.route(/open-meteo/, route => route.abort());
 await page.goto('/');
 await page.evaluate(async () => {
  const {show} = await import('./js/utils.js');
  show('login', false);
  show('app', true);
 });
}

async function saveScreenshot(page, file) {
 const buf = await page.screenshot({fullPage: false});
 const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
 fs.writeFileSync(tmp, buf);
 try {
  fs.renameSync(tmp, file);
 } catch {
  fs.copyFileSync(tmp, file);
  fs.unlinkSync(tmp);
 }
}

function metricsFn() {
 return {
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  scrollHeight: document.documentElement.scrollHeight,
  inner: {w: window.innerWidth, h: window.innerHeight},
  fab: (() => {
   const n = document.querySelector('#mobile-capture-fab');
   if (!n) return null;
   const b = n.getBoundingClientRect();
   return {display: getComputedStyle(n).display, y: Math.round(b.y), h: Math.round(b.height), right: Math.round(window.innerWidth - b.right), navOverlap: b.bottom > window.innerHeight - 52};
  })(),
  nav: [...document.querySelectorAll('.bottom-nav button')].map(b => b.innerText.replace(/\s+/g, ' ').trim()),
  hub: [...document.querySelectorAll('#more-hub button')].map(b => b.textContent.trim()),
  tiles: [...document.querySelectorAll('#more-modules-card button:not(.hidden)')].map(b => b.textContent.trim()),
  mgmtVisible: !document.querySelector('#management-board-card')?.classList.contains('hidden'),
  opsVisible: !document.querySelector('#operations-card')?.classList.contains('hidden')
 };
}

test('Mobile-Abnahme speichert Screenshots und Metriken', async ({page}, testInfo) => {
 test.skip(testInfo.project.name !== 'smartphone', 'Screenshots nur im Smartphone-Projekt');
 test.setTimeout(120000);
 await openApp(page);
 await expect(page.locator('#mobile-capture-fab')).toBeVisible();
 const report = {widths: {}, flows: {}};
 const widths = [320, 360, 375, 390, 430, 768];
 for (const width of widths) {
  const height = width === 768 ? 1024 : 844;
  await page.setViewportSize({width, height});
  report.widths[width] = {};
  for (const [name, sel] of [['dashboard', '[data-view="dashboard"]:visible'], ['tagesgeschaeft', '[data-view="agenda"]:visible'], ['vorgaenge', '[data-view="defects"]:visible'], ['mehr', '[data-view="more"]:visible']]) {
   await page.locator(sel).first().click();
   await page.waitForTimeout(200);
   const file = path.join(outDir, `${width}-${name}.png`);
   await saveScreenshot(page, file);
   publish(`${width}-${name}.png`);
   report.widths[width][name] = {file: `docs/abnahme-mobile-3.7.0/${width}-${name}.png`, ...(await page.evaluate(metricsFn))};
  }
  await page.locator('#mobile-capture-fab').click({force: true});
  const file = path.join(outDir, `${width}-erfassen.png`);
  await saveScreenshot(page, file);
  publish(`${width}-erfassen.png`);
  report.widths[width].erfassen = {file: `docs/abnahme-mobile-3.7.0/${width}-erfassen.png`, ...(await page.evaluate(metricsFn))};
  await page.locator('#capture-close').click();
 }

 await page.setViewportSize({width: 390, height: 844});
 const shot = async name => {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);
  const file = path.join(outDir, `390-${name}.png`);
  await saveScreenshot(page, file);
  publish(`390-${name}.png`);
  return `docs/abnahme-mobile-3.7.0/390-${name}.png`;
 };

 let clicks = 0;
 await page.locator('#mobile-capture-fab').click({force: true}); clicks += 1;
 await page.locator('#capture-sheet [data-capture="reading"]').click(); clicks += 1;
 await page.waitForTimeout(400);
 report.flows.reading = {clicks, file: await shot('zaehlerstaende')};

 clicks = 0;
 await page.locator('#mobile-capture-fab').click({force: true}); clicks += 1;
 await page.locator('#capture-sheet [data-capture="defect"]').click(); clicks += 1;
 await page.waitForTimeout(400);
 report.flows.defect = {clicks, file: await shot('mangel-melden'), titleY: await page.locator('#defect-title').evaluate(n => Math.round(n.getBoundingClientRect().top)).catch(() => null)};

 clicks = 0;
 await page.locator('#mobile-capture-fab').click({force: true}); clicks += 1;
 await page.locator('#capture-sheet [data-capture="temperature"]').click(); clicks += 1;
 await page.waitForTimeout(500);
 report.flows.temperature = {clicks, file: await shot('temperatur')};

 clicks = 0;
 await page.locator('#mobile-capture-fab').click({force: true}); clicks += 1;
 await page.locator('#capture-sheet [data-capture="daily-report"]').click(); clicks += 1;
 await page.waitForTimeout(500);
 report.flows.report = {clicks, file: await shot('tagesberichte')};

 clicks = 0;
 await page.locator('[data-view="defects"]:visible').click(); clicks += 1;
 await page.waitForTimeout(300);
 report.flows.manageDefect = {clicks, file: await shot('maengelmanagement')};

 clicks = 0;
 await page.locator('[data-view="more"]:visible').click(); clicks += 1;
 await page.waitForTimeout(400);
 report.flows.mehr = {clicks, file: await shot('mehr-voll'), ...(await page.evaluate(metricsFn))};
 const mgmt = page.locator('#more-hub').getByRole('button', {name: 'Management-Dashboard'});
 if (await mgmt.isVisible()) {
  await mgmt.click();
  clicks += 1;
 }
 await page.waitForTimeout(400);
 report.flows.management = {clicks, file: await shot('management-dashboard')};

 if (await page.locator('#mgmt-back-more').isVisible()) await page.locator('#mgmt-back-more').click();
 await page.locator('#more-hub').getByRole('button', {name: 'Mitarbeiter'}).click();
 report.flows.staff = {file: await shot('mitarbeiterverwaltung')};
 await page.locator('[data-view="more"]:visible').click();
 const opsHub = page.locator('#more-hub').getByRole('button', {name: 'Betriebserfassung'});
 if (await opsHub.isVisible()) await opsHub.click();
 await page.locator('[data-operation="water"]').click();
 await page.waitForTimeout(300);
 report.flows.water = {file: await shot('wasserhygiene')};
 await page.locator('[data-operation="stock"]').click();
 await page.waitForTimeout(300);
 report.flows.stock = {file: await shot('materialverwaltung')};

 await page.locator('#mobile-capture-fab').click({force: true});
 await page.locator('#capture-close').click();
 report.flows.captureClosed = await page.locator('#capture-sheet').evaluate(n => n.classList.contains('hidden'));

 fs.writeFileSync(path.join(outDir, 'metrics.json'), JSON.stringify(report, null, 2));
 publish('metrics.json');
 expect(report.widths[390].dashboard.overflow).toBeLessThanOrEqual(2);
 expect(report.flows.reading.clicks).toBeLessThanOrEqual(3);
 expect(report.flows.defect.clicks).toBeLessThanOrEqual(3);
});
