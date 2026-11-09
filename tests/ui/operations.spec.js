import {test, expect} from '@playwright/test';

test('Die Betriebsmodule bleiben auf dem Smartphone in der Breite', async ({page}) => {
 await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
  contentType: 'text/javascript',
  body: `function query(){const promise=Promise.resolve({data:[],error:{code:'PGRST205',message:'missing'}});const chain={select(){return chain},eq(){return chain},order(){return chain},limit(){return chain},then(ok,bad){return promise.then(ok,bad)}};return chain}export function createClient(){return {from:query,rpc(){return Promise.resolve({data:null,error:null})},auth:{getUser:async()=>({data:{user:null},error:null}),getSession:async()=>({data:{session:null},error:null}),onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}},signInWithPassword:async()=>({data:null,error:{message:'blockiert'}}),signOut:async()=>({error:null})},channel(){return {on(){return this},subscribe(){}}},removeChannel(){}}}`
 }));
 await page.route(/supabase\.co/, route => route.abort());
 await page.goto('/');
 await expect(page.locator('#operations-card')).toHaveCount(1);
 await expect(page.locator('#operations-tabs button')).toHaveCount(4);
 await page.evaluate(() => {
  document.querySelector('#app').classList.remove('hidden');
  document.querySelector('#view-more').classList.remove('hidden');
  document.querySelector('#operations-card').classList.remove('hidden');
 });
 const tabs = await page.locator('#operations-tabs').boundingBox();
 const viewport = page.viewportSize();
 expect(tabs.x).toBeGreaterThanOrEqual(0);
 expect(tabs.x + tabs.width).toBeLessThanOrEqual(viewport.width + 1);
 await page.locator('[data-operation="procurement"]').click();
 await expect(page.locator('[data-operation="procurement"]')).toHaveClass(/active/);
});
