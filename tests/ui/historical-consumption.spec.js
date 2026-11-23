import {test, expect} from '@playwright/test';

test('Historische Erfassung liegt im Zählermodul und bleibt ohne Datenbankschreibung', async ({page}) => {
 const writes = [];
 await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
  contentType: 'text/javascript',
  body: `export function createClient(){return {from(){return {select(){return this},eq(){return this},order(){return this},insert(){return this},then(ok){return Promise.resolve({data:[],error:null}).then(ok)}}},auth:{getUser:async()=>({data:{user:null},error:null}),getSession:async()=>({data:{session:null},error:null}),onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}}},channel(){return {on(){return this},subscribe(){}}},removeChannel(){},rpc(){return Promise.resolve({data:null,error:null})}}}`
 }));
 await page.route(/supabase\.co/, route => {
  writes.push(route.request().method());
  return route.abort();
 });
 await page.goto('/');
 await expect(page.locator('#login')).toBeVisible();
 await expect(page.locator('#consumption-empty')).toBeHidden();
 await expect(page.locator('#consumption-empty')).toBeEmpty();
 await expect(page.getByText('Für dein Konto sind keine Betriebe freigegeben.')).toHaveCount(0);
 await expect(page.locator('#password-request')).toHaveAttribute('inert');
 await expect(page.locator('#invitation-setup')).toHaveAttribute('inert');
 await expect(page.locator('#capture-sheet')).toHaveAttribute('inert');
 await expect(page.locator('#historical-open')).toHaveCount(1);
 await expect(page.locator('#historical-capture')).toHaveCount(1);
 await expect(page.locator('#historical-kind')).toHaveCount(1);
 await expect(page.locator('#reading-form')).toHaveCount(1);
 await expect(page.locator('#historical-correct-form')).toHaveCount(1);
 await expect(page.locator('#historical-correct-reason')).toHaveCount(1);
 expect(writes).toEqual([]);
});
