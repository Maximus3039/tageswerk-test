import {test, expect} from '@playwright/test';

const mock = `function query(){const promise=Promise.resolve({data:[],error:{code:'PGRST205',message:'missing'}});const chain={select(){return chain},eq(){return chain},order(){return chain},limit(){return chain},then(ok,bad){return promise.then(ok,bad)}};return chain}export function createClient(){return {from:query,rpc(){return Promise.resolve({data:null,error:null})},auth:{getUser:async()=>({data:{user:null},error:null}),getSession:async()=>({data:{session:null},error:null}),onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}},signInWithPassword:async()=>({data:null,error:{message:'blockiert'}}),signOut:async()=>({error:null})},channel(){return {on(){return this},subscribe(){}}},removeChannel(){}}}`;

async function openApp(page) {
 await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({contentType: 'text/javascript', body: mock}));
 await page.route(/supabase\.co/, route => route.abort());
 await page.route(/open-meteo\.com/, route => route.abort());
 await page.goto('/');
}

test('Nexus V4.2 hat kompakte Dashboard-Struktur und Module zuerst', async ({page}, testInfo) => {
 await openApp(page);
 await page.evaluate(() => {
  document.querySelector('#app')?.classList.remove('hidden');
  document.querySelector('#login')?.classList.add('hidden');
 });
 await expect(page.locator('body.nexus-v42')).toHaveCount(1);
 await expect(page.locator('#facility-spotlight #dashboard-facility')).toBeVisible();
 await expect(page.locator('#facility-spotlight')).toBeVisible();
 const order = await page.evaluate(() => {
  const greeting = document.querySelector('#home-greeting');
  const spot = document.querySelector('#facility-spotlight');
  const kpi = document.querySelector('.kpi-strip.nexus-kpi');
  const today = document.querySelector('#home-today');
  const pos = node => node.getBoundingClientRect().top;
  return {
   greeting: pos(greeting),
   spot: pos(spot),
   kpi: pos(kpi),
   today: pos(today),
   selectInSpot: Boolean(document.querySelector('#facility-spotlight #dashboard-facility'))
  };
 });
 expect(order.selectInSpot).toBe(true);
 expect(order.greeting).toBeLessThan(order.spot);
 expect(order.spot).toBeLessThan(order.kpi);
 expect(order.kpi).toBeLessThan(order.today);
 if (testInfo.project.name === 'smartphone') {
  await expect(page.locator('header h1 small')).toBeHidden();
  await expect(page.locator('.nexus-brand-row')).toBeHidden();
 }
 const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
 expect(overflow).toBeLessThanOrEqual(1);
});

test('Betriebsführung steht vor Weitere Module', async ({page}, testInfo) => {
 await openApp(page);
 await page.evaluate(() => {
  document.querySelector('#app')?.classList.remove('hidden');
  document.querySelector('#view-more')?.classList.remove('hidden');
 });
 const order = await page.evaluate(() => {
  const ops = document.querySelector('#operations-card');
  const more = document.querySelector('#more-modules-card');
  return {
   ops: ops.getBoundingClientRect().top,
   more: more.getBoundingClientRect().top,
   opsHidden: ops.classList.contains('hidden')
  };
 });
 if (testInfo.project.name === 'smartphone') {
  expect(order.opsHidden).toBe(true);
  await expect(page.locator('#more-hub')).toBeVisible();
 } else {
  expect(order.opsHidden).toBe(false);
  expect(order.ops).toBeLessThan(order.more);
 }
 await expect(page.locator('#operations-tabs .neon-tile')).toHaveCount(8);
});
