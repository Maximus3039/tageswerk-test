import {expect, test} from '@playwright/test';

const mock = `function query(){const promise=Promise.resolve({data:[],error:{code:'PGRST205',message:'missing'}});const chain={select(){return chain},eq(){return chain},order(){return chain},limit(){return chain},then(ok,bad){return promise.then(ok,bad)}};return chain}export function createClient(){return {from:query,rpc(){return Promise.resolve({data:null,error:null})},auth:{getUser:async()=>({data:{user:null},error:null}),getSession:async()=>({data:{session:null},error:null}),onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}},signInWithPassword:async()=>({data:null,error:{message:'blockiert'}}),signOut:async()=>({error:null})},channel(){return {on(){return this},subscribe(){}}},removeChannel(){}}}`;

async function openApp(page) {
 await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({contentType: 'text/javascript', body: mock}));
 await page.route(/supabase\.co/, route => route.abort());
 await page.goto('/');
 await page.evaluate(async () => {
  const {show} = await import('./js/utils.js');
  show('login', false);
  show('app', true);
 });
}

test('Mobile UX verkürzt Navigation und hält Erfassen erreichbar', async ({page}, testInfo) => {
 await openApp(page);
 const mobile = testInfo.project.name === 'smartphone';
 if (!mobile) {
  await expect(page.locator('.side-nav')).toBeVisible();
  return;
 }
 await expect(page.locator('.bottom-nav button')).toHaveCount(4);
 await expect(page.locator('#mobile-capture-fab')).toBeVisible();
 const fab = await page.locator('#mobile-capture-fab').boundingBox();
 const viewport = page.viewportSize();
 expect(fab.y + fab.height).toBeLessThanOrEqual(viewport.height + 1);
 await page.locator('[data-view="more"]:visible').click();
 await expect(page.locator('#more-hub')).toBeVisible();
 await expect(page.locator('#more-hub')).toContainText('Tagesgeschäft');
 const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
 expect(overflow).toBeLessThanOrEqual(1);
 await page.locator('[data-view="defects"]:visible').click();
 await expect(page.locator('#cases-tabs')).toBeVisible();
 await expect(page.locator('#defect-filter-toggle')).toBeVisible();
 await page.locator('#defect-filter-toggle').click();
 await expect(page.locator('#mobile-sheet')).toBeVisible();
 await page.locator('#mobile-sheet-close').click();
 await expect(page.locator('#mobile-sheet')).toBeHidden();
});

test('Wichtige Tagesaktionen bleiben in den Kernbreiten erreichbar', async ({page}, testInfo) => {
 if (testInfo.project.name !== 'smartphone') return;
 await openApp(page);
 for (const width of [320, 360, 375, 390, 430, 768]) {
  await page.setViewportSize({width, height: 720});
  await expect(page.locator('.bottom-nav button')).toHaveCount(4);
  const fab = page.locator('#mobile-capture-fab');
  await expect(fab).toBeVisible();
  const box = await fab.boundingBox();
  expect(box.y).toBeLessThan(640);
  const lastBtn = page.locator('#home-quick button').last();
  if (await lastBtn.count()) {
   await lastBtn.evaluate(node => node.scrollIntoView({block: 'center', inline: 'nearest'}));
   const last = await lastBtn.boundingBox();
   const fabBox = await fab.boundingBox();
   expect(last.y + last.height, `${width}px FAB überdeckt Schnellaktion`).toBeLessThanOrEqual(fabBox.y + 2);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${width}px overflow`).toBeLessThanOrEqual(2);
 }
});

test('Hinweis bleibt sichtbar und Management kehrt zu Mehr zurück', async ({page}, testInfo) => {
 if (testInfo.project.name !== 'smartphone') return;
 const managerMock = `const tables={organizations:[{id:'org',name:'Freizeitpark'}],facilities:[{id:'fac',name:'Prignitzer',organization_id:'org'}],memberships:[{user_id:'user-1',organization_id:'org',facility_id:null,role:'company_admin',is_active:true}],profiles:[{id:'user-1',full_name:'Maximilian'}],staff_invitations:[],defects:[]};
function query(name){const result=Promise.resolve({data:tables[name]||[],error:null});const chain={select(){return chain},eq(){return chain},in(){return chain},order(){return chain},limit(){return chain},range(){return chain},maybeSingle(){return Promise.resolve({data:null,error:null})},insert(){return chain},update(){return chain},upsert(){return Promise.resolve({error:null})},then(ok,bad){return result.then(ok,bad)}};return chain}
export function createClient(){return{from:query,rpc(){return Promise.resolve({data:[],error:null})},auth:{getUser:async()=>({data:{user:{id:'user-1',email:'leitung@example.invalid'}},error:null}),getSession:async()=>({data:{session:{user:{id:'user-1'}}},error:null}),onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}}},signInWithPassword:async()=>({data:null,error:null}),signOut:async()=>({error:null})},channel(){return{on(){return this},subscribe(cb){cb&&cb('SUBSCRIBED');return this}}},removeChannel(){}}}`;
 await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({contentType: 'text/javascript', body: managerMock}));
 await page.route(/supabase\.co/, route => route.abort());
 await page.goto('/');
 await page.evaluate(async () => {
  const {show} = await import('./js/utils.js');
  show('login', false);
  show('app', true);
 });
 const notice = page.locator('main > .notice');
 await expect(notice).toContainText('Mandantentrennung aktiv');
 await expect(notice).toContainText('Kernregeln für Mängel');
 await notice.locator('summary').click();
 await expect(notice.locator('.notice-full')).toBeVisible();
 await page.locator('[data-view="more"]:visible').click();
 await page.locator('#more-hub').getByRole('button', {name: 'Management-Dashboard'}).click();
 await expect(page.locator('#mgmt-back-more')).toBeVisible();
 await page.locator('#mgmt-back-more').click();
 await expect(page.locator('#more-hub')).toBeVisible();
 await expect(page.locator('#management-board-card')).toBeHidden();
});
