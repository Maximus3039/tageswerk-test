import {test, expect} from '@playwright/test';

const mock = `function query(){const promise=Promise.resolve({data:[],error:{code:'PGRST205',message:'missing'}});const chain={select(){return chain},eq(){return chain},order(){return chain},limit(){return chain},then(ok,bad){return promise.then(ok,bad)}};return chain}export function createClient(){return {from:query,rpc(){return Promise.resolve({data:null,error:null})},auth:{getUser:async()=>({data:{user:null},error:null}),getSession:async()=>({data:{session:null},error:null}),onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}},signInWithPassword:async()=>({data:null,error:{message:'blockiert'}}),signOut:async()=>({error:null})},channel(){return {on(){return this},subscribe(){}}},removeChannel(){}}}`;

async function openApp(page) {
 await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({contentType: 'text/javascript', body: mock}));
 await page.route(/supabase\.co/, route => route.abort());
 await page.route(/open-meteo\.com/, route => route.abort());
 await page.goto('/');
}

test('Login zeigt Marke und hält technische Hinweise hinter Details', async ({page}) => {
 await openApp(page);
 await expect(page.locator('.login-brand')).toBeVisible();
 await expect(page.locator('.login-slogan')).toContainText('Betriebsmanagement');
 await expect(page.locator('#email')).toBeVisible();
 await expect(page.locator('#password')).toBeVisible();
 await expect(page.locator('#submit')).toBeVisible();
 await expect(page.locator('.login-tech')).toBeVisible();
 await expect(page.locator('.notice-compact')).toBeVisible();
 const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
 expect(overflow).toBeLessThanOrEqual(1);
});

test('Dashboard bleibt kompakt und ohne horizontalen Overflow', async ({page}, testInfo) => {
 await openApp(page);
 await page.evaluate(() => {
  document.querySelector('#app')?.classList.remove('hidden');
  document.querySelector('#login')?.classList.add('hidden');
 });
 await expect(page.locator('.dash-command')).toBeVisible();
 await expect(page.locator('.kpi-strip #metric-open')).toBeVisible();
 await expect(page.locator('#dash-weather-card')).toBeVisible();
 await expect(page.locator('#dash-analytics-card')).toBeVisible();
 if (testInfo.project.name === 'smartphone') {
  const kpi = page.locator('.kpi-strip').first();
  const style = await kpi.evaluate(node => getComputedStyle(node).gridTemplateColumns);
  expect(style.split(' ').length).toBe(2);
 }
 const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
 expect(overflow).toBeLessThanOrEqual(1);
});

test('Mängelformular öffnet erst auf Abruf', async ({page}, testInfo) => {
 await openApp(page);
 await page.evaluate(() => {
  document.querySelector('#app')?.classList.remove('hidden');
  document.querySelector('#login')?.classList.add('hidden');
  document.querySelector('#view-dashboard')?.classList.add('hidden');
  document.querySelector('#view-defects')?.classList.remove('hidden');
 });
 await expect(page.locator('#defect-composer')).toHaveClass(/hidden/);
 await page.locator('#open-defect-form').click();
 await expect(page.locator('#defect-composer')).not.toHaveClass(/hidden/);
 await expect(page.locator('#defect-form')).toBeVisible();
 if (testInfo.project.name === 'smartphone') {
  const sheet = page.locator('.defect-composer-sheet');
  await expect(sheet).toBeVisible();
 }
 await page.locator('#close-defect-form').click();
 await expect(page.locator('#defect-composer')).toHaveClass(/hidden/);
});

test('Betriebsmodule nutzen Modulkarten im Raster', async ({page}, testInfo) => {
 await openApp(page);
 await page.evaluate(() => {
  document.querySelector('#app')?.classList.remove('hidden');
  document.querySelector('#view-more')?.classList.remove('hidden');
  document.querySelector('#operations-card')?.classList.remove('hidden');
 });
 await expect(page.locator('#operations-tabs .module-card')).toHaveCount(8);
 await expect(page.locator('[data-operation="water"] .module-label')).toHaveText('Wasserhygiene');
 await page.locator('[data-operation="temperature"]').click();
 await expect(page.locator('[data-operation="temperature"]')).toHaveClass(/active/);
 if (testInfo.project.name === 'smartphone') {
  const columns = await page.locator('#operations-tabs').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length);
  expect(columns).toBe(2);
 }
 const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
 expect(overflow).toBeLessThanOrEqual(1);
});
