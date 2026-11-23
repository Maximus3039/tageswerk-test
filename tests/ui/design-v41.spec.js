import {test, expect} from '@playwright/test';

const mock = `function query(){const promise=Promise.resolve({data:[],error:{code:'PGRST205',message:'missing'}});const chain={select(){return chain},eq(){return chain},order(){return chain},limit(){return chain},then(ok,bad){return promise.then(ok,bad)}};return chain}export function createClient(){return {from:query,rpc(){return Promise.resolve({data:null,error:null})},auth:{getUser:async()=>({data:{user:null},error:null}),getSession:async()=>({data:{session:null},error:null}),onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}},signInWithPassword:async()=>({data:null,error:{message:'blockiert'}}),signOut:async()=>({error:null})},channel(){return {on(){return this},subscribe(){}}},removeChannel(){}}}`;

async function openApp(page) {
 await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({contentType: 'text/javascript', body: mock}));
 await page.route(/supabase\.co/, route => route.abort());
 await page.route(/open-meteo\.com/, route => route.abort());
 await page.goto('/');
}

test('Nexus V4.1 komprimiert den Kopf und führt die Betriebsauswahl im Spotlight', async ({page}, testInfo) => {
 await openApp(page);
 await page.evaluate(async () => {
  const {show} = await import('./js/utils.js');
  show('login', false);
  show('app', true);
 });
 await expect(page.locator('body.nexus-v41')).toHaveCount(1);
 await expect(page.locator('.facility-select-wrap #dashboard-facility')).toBeVisible();
 await expect(page.locator('#home-facility')).toHaveClass(/sr-only/);
 if (testInfo.project.name === 'smartphone') {
  await expect(page.locator('.nexus-command-head')).toBeHidden();
  await expect(page.locator('.nexus-kicker')).toBeHidden();
 } else {
  await expect(page.locator('.nexus-command-head')).toBeVisible();
 }
 const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
 expect(overflow).toBeLessThanOrEqual(1);
});

test('Neon-Kacheln behalten Raster und SVG-Icons', async ({page}, testInfo) => {
 await openApp(page);
 await page.evaluate(async () => {
  const {show} = await import('./js/utils.js');
  show('login', false);
  show('app', true);
  show('view-more', true);
  show('operations-card', true);
 });
 await expect(page.locator('#operations-tabs .neon-tile')).toHaveCount(8);
 await expect(page.locator('[data-operation="water"] .module-icon svg')).toHaveCount(1);
 if (testInfo.project.name === 'smartphone') {
  const columns = await page.locator('#operations-tabs').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length);
  expect(columns).toBe(2);
 }
});
