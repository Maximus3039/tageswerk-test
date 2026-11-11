import {test, expect} from '@playwright/test';

const redirect = 'https://maximus3039.github.io/tageswerk-test/?vorgang=passwort';

function installAuth(page) {
 return page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
  contentType: 'text/javascript',
  body: `function query(){
   const promise=Promise.resolve({data:[],error:null,count:0});
   const chain={select(){return chain},eq(){return chain},is(){return chain},in(){return chain},order(){return chain},limit(){return chain},then(ok,bad){return promise.then(ok,bad)}};
   return chain;
  }
  function callback(){
   const hash=new URLSearchParams(location.hash.replace(/^#/,''));
   const query=new URLSearchParams(location.search);
   return {hash,query};
  }
  export function createClient(){
   return {from:query,rpc(){window.__rpc=(window.__rpc||0)+1;return Promise.resolve({data:null,error:{message:'Test'}})},auth:{
    getUser:async()=>{
     if(window.__out)return {data:{user:null},error:{message:'Auth session missing!'}};
     const {hash,query}=callback();
     const broken=hash.get('error')||query.get('error');
     const typed=hash.get('type')||query.get('type');
     const user=!broken&&(typed==='recovery'||typed==='invite')?{id:'user-1',email:'person@example.com'}:null;
     return {data:{user},error:user?null:{message:'Auth session missing!'}};
    },
    getSession:async()=>({data:{session:null},error:null}),
    onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}},
    signInWithPassword:async()=>({data:null,error:{message:'blockiert'}}),
    resetPasswordForEmail:async(email,options)=>{
     window.__reset=[...(window.__reset||[]),{email,redirectTo:options&&options.redirectTo}];
     await new Promise(resolve=>setTimeout(resolve,40));
     if(String(email).endsWith('@missing.example'))return {data:null,error:{message:'User not found'}};
     return {data:{},error:null};
    },
    updateUser:async(attributes)=>{
     window.__updates=(window.__updates||0)+1;
     window.__passwordLength=String(attributes&&attributes.password||'').length;
     return {data:{user:{id:'user-1'}},error:null};
    },
    signOut:async()=>{window.__out=true;window.__signedOut=(window.__signedOut||0)+1;return {error:null}}
   },channel(){return {on(){return this},subscribe(){}}},removeChannel(){}};
  }`
 }));
}

test('Das Passwortformular prüft die Adresse und sendet höchstens einmal', async ({page}) => {
 await installAuth(page);
 await page.goto('/');
 const password = await page.locator('#password').boundingBox();
 const forgot = await page.locator('#forgot-password').boundingBox();
 expect(forgot.y).toBeGreaterThanOrEqual(password.y + password.height - 1);
 await page.locator('#forgot-password').click();
 await expect(page.locator('#password-request')).toBeVisible();
 await expect(page.locator('#login')).toBeHidden();
 await expect(page.locator('#app')).toBeHidden();
 await page.locator('#reset-email').fill('ohne-domain');
 await page.locator('#reset-request-submit').click();
 await expect(page.locator('#reset-request-message')).toHaveText('Bitte eine gültige E-Mail-Adresse eingeben.');
 expect(await page.evaluate(() => window.__reset || [])).toEqual([]);
 await page.locator('#reset-email').fill('person@example.com');
 await page.evaluate(() => {
  const form = document.getElementById('reset-request-form');
  form.requestSubmit();
  form.requestSubmit();
 });
 await expect(page.locator('#reset-request-message')).toHaveText('Wenn ein Konto zu dieser E-Mail-Adresse besteht, wurde ein Link zum Zurücksetzen gesendet. Bitte auch den Spam-Ordner prüfen.');
 const calls = await page.evaluate(() => window.__reset);
 expect(calls).toHaveLength(1);
 expect(calls[0]).toEqual({email: 'person@example.com', redirectTo: redirect});
 await page.locator('#reset-email').fill('person@missing.example');
 await page.locator('#reset-request-submit').click();
 await expect(page.locator('#reset-request-message')).toHaveText('Wenn ein Konto zu dieser E-Mail-Adresse besteht, wurde ein Link zum Zurücksetzen gesendet. Bitte auch den Spam-Ordner prüfen.');
 await page.locator('#reset-request-back').click();
 await expect(page.locator('#login')).toBeVisible();
 await expect(page.locator('#email')).toBeVisible();
 const viewport = page.viewportSize();
 expect(forgot.x + forgot.width).toBeLessThanOrEqual(viewport.width + 1);
});

test('Abgelaufene und ungültige Wiederherstellungslinks zeigen kein Dashboard', async ({page}) => {
 await installAuth(page);
 await page.goto('/?vorgang=passwort#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
 await expect(page.locator('#password-recovery')).toBeVisible();
 await expect(page.locator('#recovery-message')).toHaveText('Der Wiederherstellungslink ist abgelaufen. Bitte einen neuen Link anfordern.');
 await expect(page.locator('#recovery-form')).toBeHidden();
 await expect(page.locator('#app')).toBeHidden();
 await expect(page.locator('#invitation-setup')).toBeHidden();
 await page.goto('/#error=access_denied&error_code=otp_disabled&error_description=Invalid+reset+link&type=recovery');
 await expect(page.locator('#recovery-message')).toHaveText('Der Wiederherstellungslink ist ungültig. Bitte einen neuen Link anfordern.');
 await expect(page.locator('#app')).toBeHidden();
 await expect(page.locator('#view-dashboard')).toBeHidden();
});

test('Ein neues Passwort wird nur bei Übereinstimmung gespeichert und die Sitzung beendet', async ({page}) => {
 await installAuth(page);
 await page.goto('/?vorgang=passwort#access_token=test-token&type=recovery');
 await expect(page.locator('#recovery-form')).toBeVisible();
 await expect(page.locator('#app')).toBeHidden();
 await expect(page.locator('#invitation-setup')).toBeHidden();
 await page.locator('#recovery-password').fill('correct-horse');
 await page.locator('#recovery-confirm').fill('correct-house');
 await page.locator('#recovery-submit').click();
 await expect(page.locator('#recovery-message')).toHaveText('Die beiden Passwörter stimmen nicht überein.');
 expect(await page.evaluate(() => window.__updates || 0)).toBe(0);
 await page.locator('#recovery-confirm').fill('correct-horse');
 await page.locator('#recovery-submit').click();
 await expect(page.locator('#recovery-message')).toHaveText('Das Passwort wurde gespeichert. Bitte mit dem neuen Passwort anmelden.');
 expect(await page.evaluate(() => window.__passwordLength)).toBe('correct-horse'.length);
 expect(await page.evaluate(() => window.__signedOut)).toBe(1);
 expect(await page.evaluate(() => window.__rpc || 0)).toBe(0);
 await expect(page.locator('#app')).toBeHidden();
 await expect(page.locator('#recovery-password')).toHaveValue('');
 await page.locator('#recovery-login').click();
 await expect(page.locator('#login')).toBeVisible();
 await expect(page.locator('#password-recovery')).toBeHidden();
});

test('Anmeldung und Einladungslink bleiben erreichbar', async ({page}) => {
 await installAuth(page);
 await page.goto('/');
 await expect(page.locator('#login')).toBeVisible();
 await expect(page.locator('#forgot-password')).toBeVisible();
 await expect(page.locator('#invitation-setup')).toBeHidden();
 await expect(page.locator('#password-recovery')).toBeHidden();
 await expect(page.locator('#app')).toBeHidden();
 await page.goto('/?einladung=1#access_token=test-token&type=invite');
 await expect(page.locator('#invitation-setup')).toBeVisible();
 await expect(page.locator('#setup-submit')).toHaveText('Passwort speichern und Einladung annehmen');
 await expect(page.locator('#password-recovery')).toBeHidden();
 await expect(page.locator('#app')).toBeHidden();
 await expect(page.locator('#login')).toBeHidden();
});
