import {test, expect} from '@playwright/test';

const mock = `function query(){const promise=Promise.resolve({data:[],error:{code:'PGRST205',message:'missing'}});const chain={select(){return chain},eq(){return chain},order(){return chain},limit(){return chain},then(ok,bad){return promise.then(ok,bad)}};return chain}export function createClient(){return {from:query,rpc(){return Promise.resolve({data:null,error:null})},auth:{getUser:async()=>({data:{user:null},error:null}),getSession:async()=>({data:{session:null},error:null}),onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}},signInWithPassword:async()=>({data:null,error:{message:'blockiert'}}),signOut:async()=>({error:null})},channel(){return {on(){return this},subscribe(){}}},removeChannel(){}}}`;

async function openApp(page) {
 await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({contentType: 'text/javascript', body: mock}));
 await page.route(/supabase\.co/, route => route.abort());
 await page.route(/open-meteo\.com/, route => route.abort());
 await page.goto('/');
}

test('Nexus V4.3 integriert die Betriebsauswahl in das Spotlight', async ({page}) => {
 await openApp(page);
 await page.evaluate(() => {
  document.querySelector('#app')?.classList.remove('hidden');
  document.querySelector('#login')?.classList.add('hidden');
 });
 await expect(page.locator('body.nexus-v43')).toHaveCount(1);
 await expect(page.locator('#facility-spotlight .facility-select-in-spotlight #dashboard-facility')).toBeVisible();
 await expect(page.locator('#facility-spotlight-name')).toHaveClass(/sr-only/);
 await expect(page.locator('.facility-select-primary')).toHaveCount(0);
 const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
 expect(overflow).toBeLessThanOrEqual(1);
});

test('Mängel-Toolbar folgt der kompakten Nexus-Struktur', async ({page}, testInfo) => {
 await openApp(page);
 await page.evaluate(() => {
  document.querySelector('#app')?.classList.remove('hidden');
  document.querySelector('#view-dashboard')?.classList.add('hidden');
  document.querySelector('#view-defects')?.classList.remove('hidden');
 });
 await expect(page.locator('.nexus-defects-toolbar')).toBeVisible();
 await expect(page.locator('#nav-mine')).toBeVisible();
 await expect(page.locator('#nav-all')).toBeVisible();
 await expect(page.locator('#open-defect-form')).toBeVisible();
 await expect(page.locator('#defect-facility-filter')).toBeVisible();
 const layout = await page.locator('.nexus-defects-toolbar .defects-nav').evaluate(node => {
  const style = getComputedStyle(node);
  const mine = node.querySelector('#nav-mine')?.getBoundingClientRect();
  const all = node.querySelector('#nav-all')?.getBoundingClientRect();
  return {
   display: style.display,
   columns: style.gridTemplateColumns.split(' ').filter(Boolean).length,
   sideBySide: Boolean(mine && all && Math.abs(mine.top - all.top) < 8 && all.left > mine.right - 1)
  };
 });
 if (testInfo.project.name === 'smartphone') {
  expect(layout.columns).toBe(2);
  expect(layout.sideBySide).toBe(true);
 } else {
  expect(layout.sideBySide).toBe(true);
 }
});

test('Sicherheitsnotice und Mängel-Erfassung bleiben nach Design-Freeze sichtbar', async ({page}) => {
 await openApp(page);
 await page.evaluate(() => {
  document.querySelector('#app')?.classList.remove('hidden');
  document.querySelector('#login')?.classList.add('hidden');
  document.querySelector('#view-dashboard')?.classList.add('hidden');
  document.querySelector('#view-defects')?.classList.remove('hidden');
 });
 await expect(page.locator('.notice')).toContainText('Mandantentrennung aktiv');
 await expect(page.locator('.notice')).toContainText('Kernregeln für Mängel');
 await expect(page.locator('#open-defect-form')).toBeVisible();
 await expect(page.locator('#defect-facility-filter')).toBeVisible();
});
