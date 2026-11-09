import {test, expect} from '@playwright/test';

test('Die mobile Navigation, das Dashboard und die Erfassung bleiben in der Breite', async ({page}, testInfo) => {
 await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
  contentType: 'text/javascript',
  body: `function query(){const promise=Promise.resolve({data:[],error:{code:'PGRST205',message:'missing'}});const chain={select(){return chain},eq(){return chain},order(){return chain},limit(){return chain},then(ok,bad){return promise.then(ok,bad)}};return chain}export function createClient(){return {from:query,rpc(){return Promise.resolve({data:null,error:null})},auth:{getUser:async()=>({data:{user:null},error:null}),getSession:async()=>({data:{session:null},error:null}),onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}},signInWithPassword:async()=>({data:null,error:{message:'blockiert'}}),signOut:async()=>({error:null})},channel(){return {on(){return this},subscribe(){}}},removeChannel(){}}}`
 }));
 await page.route(/supabase\.co/, route => route.abort());
 await page.goto('/');
 await page.evaluate(() => {
  document.querySelector('#app').classList.remove('hidden');
  document.querySelector('#login').classList.add('hidden');
 });
 const mobile = testInfo.project.name === 'smartphone';
 const bottom = page.locator('.bottom-nav');
 const side = page.locator('.side-nav');
 await expect(bottom.locator('button')).toHaveCount(5);
 await expect(bottom).toContainText('Start');
 await expect(bottom).toContainText('Aufgaben');
 await expect(bottom).toContainText('Erfassen');
 await expect(bottom).toContainText('Hinweise');
 await expect(bottom).toContainText('Mehr');
 if (mobile) {
  await expect(bottom).toBeVisible();
  await expect(side).toBeHidden();
 } else {
  await expect(side).toBeVisible();
  await expect(side).toContainText('Mängel');
 }
 const visible = name => page.locator(`[data-view="${name}"]:visible`);
 await visible('capture').click();
 await expect(page.locator('#capture-sheet')).toBeVisible();
 await expect(page.locator('#capture-actions button')).toHaveCount(5);
 await page.locator('#capture-close').click();
 await expect(page.locator('#capture-sheet')).toBeHidden();
 await visible('agenda').click();
 await expect(page.locator('#view-agenda')).toBeVisible();
 await visible('notices').click();
 await expect(page.locator('#view-notices')).toBeVisible();
 await visible('dashboard').click();
 await expect(page.locator('#home-greeting')).toBeVisible();
 await expect(page.locator('#dashboard-facility')).toBeVisible();
 await expect(page.locator('#home-quick button')).toHaveCount(4);
 const box = await page.locator('#home-quick').boundingBox();
 const viewport = page.viewportSize();
 expect(box.x).toBeGreaterThanOrEqual(0);
 expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
 const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
 expect(overflow).toBeLessThanOrEqual(1);
});
