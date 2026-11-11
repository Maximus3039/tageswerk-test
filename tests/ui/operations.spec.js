import {test, expect} from '@playwright/test';

test('Die Betriebsmodule bleiben auf dem Smartphone in der Breite', async ({page}) => {
 await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
  contentType: 'text/javascript',
  body: `function query(){const promise=Promise.resolve({data:[],error:{code:'PGRST205',message:'missing'}});const chain={select(){return chain},eq(){return chain},order(){return chain},limit(){return chain},then(ok,bad){return promise.then(ok,bad)}};return chain}export function createClient(){return {from:query,rpc(){return Promise.resolve({data:null,error:null})},auth:{getUser:async()=>({data:{user:null},error:null}),getSession:async()=>({data:{session:null},error:null}),onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}},signInWithPassword:async()=>({data:null,error:{message:'blockiert'}}),signOut:async()=>({error:null})},channel(){return {on(){return this},subscribe(){}}},removeChannel(){}}}`
 }));
 await page.route(/supabase\.co/, route => route.abort());
 await page.goto('/');
 await expect(page.locator('#operations-card')).toHaveCount(1);
 await expect(page.locator('#operations-tabs button')).toHaveCount(8);
 await expect(page.locator('#metric-temperature')).toHaveCount(1);
 await expect(page.locator('#metric-water')).toHaveCount(1);
 await expect(page.locator('#metric-water-missing')).toHaveCount(1);
 await expect(page.locator('#staff-role option[value="technician"]')).toHaveText('Techniker');
 await expect(page.locator('#invite-role option[value="employee"]')).toHaveText('Mitarbeiter');
 await expect(page.locator('#invite-role option[value="technician"]')).toHaveText('Techniker');
 await expect(page.locator('#dash-notices')).toHaveCount(1);
 await page.evaluate(() => {
  document.querySelector('#app').classList.remove('hidden');
  document.querySelector('#view-more').classList.remove('hidden');
  document.querySelector('#operations-card').classList.remove('hidden');
 });
 const tabs = await page.locator('#operations-tabs').boundingBox();
 const viewport = page.viewportSize();
 expect(tabs.x).toBeGreaterThanOrEqual(0);
 expect(tabs.x + tabs.width).toBeLessThanOrEqual(viewport.width + 1);
 await page.locator('[data-operation="temperature"]').click();
 await expect(page.locator('[data-operation="temperature"]')).toHaveClass(/active/);
 await page.locator('[data-operation="water"]').click();
 await expect(page.locator('[data-operation="water"]')).toHaveClass(/active/);
 await page.locator('[data-operation="procurement"]').click();
 await expect(page.locator('[data-operation="procurement"]')).toHaveClass(/active/);
 await page.evaluate(async () => {
  const {configureTemperatureInput} = await import('./js/operations-controls.js');
  const probe = document.createElement('input');
  probe.id = 'temperature-probe';
  probe.style.position = 'fixed';
  probe.style.top = '8px';
  probe.style.left = '8px';
  probe.style.zIndex = '10000';
  probe.style.width = '160px';
  configureTemperatureInput(probe);
  document.body.append(probe);
 });
 const probe = page.locator('#temperature-probe');
 await probe.click();
 await probe.pressSequentially('-18,5');
 await expect(probe).toHaveValue('-18,5');
 await expect(probe).toHaveJSProperty('min', '-50');
 await expect(probe).toHaveJSProperty('max', '200');
 await expect(probe).toHaveJSProperty('step', '0.1');
 await expect(probe).toHaveJSProperty('type', 'text');
 await expect(probe).toHaveJSProperty('inputMode', 'text');
});
