import {test, expect} from '@playwright/test';

test('Anmeldung und Importkarte laden ohne Datenbankschreibung', async ({page}) => {
 const writes = [];
 await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
  contentType: 'text/javascript',
  body: `function query(){
   const promise=Promise.resolve({data:[],error:null,count:0});
   const chain={select(){return chain},eq(){return chain},is(){return chain},in(){return chain},order(){return chain},limit(){return chain},then(ok,bad){return promise.then(ok,bad)}};
   return chain;
  }
  export function createClient(){
   return {from:query,rpc(){return Promise.resolve({data:null,error:{message:'Test'}})},auth:{getUser:async()=>({data:{user:null},error:null}),getSession:async()=>({data:{session:null},error:null}),onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}},signInWithPassword:async()=>({data:null,error:{message:'blockiert'}}),signOut:async()=>({error:null})},channel(){return {on(){return this},subscribe(){}}},removeChannel(){}};
  }`
 }));
 await page.route(/supabase\.co/, route => {
  writes.push(route.request().method() + ' ' + route.request().url());
  return route.abort();
 });

 await page.goto('/');
 await expect(page).toHaveTitle(/Tageswerk/);
 await expect(page.locator('#email')).toBeVisible();
 await expect(page.locator('#password')).toBeVisible();
 const email = await page.locator('#email').boundingBox();
 const viewport = page.viewportSize();
 expect(email.x).toBeGreaterThanOrEqual(0);
 expect(email.x + email.width).toBeLessThanOrEqual(viewport.width + 1);
 await expect(page.locator('#meter-import-card')).toHaveCount(1);
 await expect(page.locator('#import-preview-start')).toHaveCount(1);
 expect(writes).toEqual([]);
});
