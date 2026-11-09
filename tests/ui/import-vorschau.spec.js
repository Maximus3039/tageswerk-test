import {test, expect} from '@playwright/test';

test('Die serverseitige Importvorschau ist in der lokalen Entwicklung vorhanden', async ({page}) => {
 const writes = [];
 await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
  contentType: 'text/javascript',
  body: `export function createClient(){return {from(){return {select(){return this},then(ok){return Promise.resolve({data:[],error:null}).then(ok)}}},auth:{getUser:async()=>({data:{user:null},error:null}),getSession:async()=>({data:{session:null},error:null}),onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}}},channel(){return {on(){return this},subscribe(){}}},removeChannel(){}}}`
 }));
 await page.route(/supabase\.co/, route => {
  writes.push(route.request().method());
  return route.abort();
 });
 await page.goto('/');
 await expect(page.locator('#import-preview-start')).toHaveCount(1);
 expect(writes).toEqual([]);
});
