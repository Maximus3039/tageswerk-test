import {expect, test} from '@playwright/test';

function supabaseMock(role) {
 const membership = role === 'employee'
  ? {user_id: 'user-1', organization_id: 'org', facility_id: 'fac', role: 'employee', is_active: true}
  : {user_id: 'user-1', organization_id: 'org', facility_id: null, role: 'company_admin', is_active: true};
 return `const tables = {
 organizations: [{id: 'org', name: 'Freizeitpark'}],
 facilities: [{id: 'fac', name: 'Prignitzer', organization_id: 'org'}],
 memberships: [${JSON.stringify(membership)}],
 profiles: [{id: 'user-1', full_name: 'Maximilian'}],
 temperature_points: [{
  id: 'point-1', organization_id: 'org', facility_id: 'fac', name: 'Kühlschrank', location: 'Küche',
  minimum_celsius: '2', maximum_celsius: '8', interval_unit: 'day', interval_count: 1, active: true,
  created_by: 'user-1', created_at: '2026-11-01T08:00:00Z'
 }]
};
function query() {
 const result = Promise.resolve({data: tables[arguments[0]] || [], error: null});
 const chain = {
  select() {return chain},
  eq() {return chain},
  order() {return chain},
  limit() {return chain},
  maybeSingle() {return Promise.resolve({data: null, error: null})},
  insert() {return chain},
  update() {return chain},
  then(ok, bad) {return result.then(ok, bad)}
 };
 return chain;
}
export function createClient() {
 return {
  from: query,
  rpc(name) {
   if (name === 'accept_staff_invitation') return Promise.resolve({data: {success: false}, error: null});
   return Promise.resolve({data: [], error: null});
  },
  auth: {
   getUser: async () => ({data: {user: {id: 'user-1', email: 'leitung@example.invalid'}}, error: null}),
   getSession: async () => ({data: {session: {user: {id: 'user-1'}}}, error: null}),
   onAuthStateChange() {return {data: {subscription: {unsubscribe() {}}}}},
   signInWithPassword: async () => ({data: null, error: null}),
   signOut: async () => ({error: null}),
   updateUser: async () => ({data: null, error: null})
  },
  channel() {return {on() {return this}, subscribe(callback) {if (callback) callback('SUBSCRIBED'); return this}}},
  removeChannel() {}
 };
}`;
}

async function openTemperature(page, role) {
 await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
  contentType: 'text/javascript',
  body: supabaseMock(role)
 }));
 await page.route(/supabase\.co/, route => route.abort());
 await page.goto('/');
 await page.locator('[data-view="more"]:visible').first().click();
 await page.locator('#open-operations').click();
 await page.locator('[data-operation="temperature"]').click();
 await expect(page.locator('#operations-panel')).toBeVisible();
}

test('Die Temperatureinstellungen bleiben geschlossen und die Messung bleibt erreichbar', async ({page}) => {
 await openTemperature(page, 'manager');
 const toggle = page.locator('#operations-panel').getByRole('button', {name: 'Einstellungen'});
 const settings = page.locator('#temperature-settings');
 await expect(toggle).toBeVisible();
 await expect(toggle).toHaveAttribute('aria-expanded', 'false');
 await expect(toggle).toHaveAttribute('aria-controls', 'temperature-settings');
 await expect(settings).toBeHidden();
 await expect(page.getByRole('button', {name: 'Messung speichern'})).toBeVisible();
 await expect(page.getByLabel('Gemessener Wert °C')).toBeVisible();
 const box = await toggle.boundingBox();
 const viewport = page.viewportSize();
 expect(box.height).toBeGreaterThanOrEqual(viewport.width <= 850 ? 48 : 40);
 expect(box.x).toBeGreaterThanOrEqual(0);
 expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
 await page.getByRole('button', {name: 'Messung speichern'}).click();
 await expect(page.locator('#operations-message')).toHaveText('Bitte den gemessenen Temperaturwert eintragen.');
 await expect(toggle).toHaveAttribute('aria-expanded', 'false');
 await expect(settings).toBeHidden();
 await toggle.click();
 await expect(toggle).toHaveAttribute('aria-expanded', 'true');
 await expect(settings).toBeVisible();
 await expect(page.getByRole('button', {name: 'Messstelle speichern'})).toBeVisible();
 await expect(settings.getByRole('button', {name: 'Deaktivieren'})).toBeVisible();
 await expect(settings.getByRole('button', {name: 'Bearbeiten'})).toBeVisible();
 await page.locator('[data-operation="water"]').click();
 await page.locator('[data-operation="temperature"]').click();
 await expect(toggle).toHaveAttribute('aria-expanded', 'false');
 await expect(settings).toBeHidden();
 await toggle.click();
 await toggle.click();
 await expect(toggle).toHaveAttribute('aria-expanded', 'false');
 await expect(settings).toBeHidden();
 await expect(page.getByRole('button', {name: 'Messung speichern'})).toBeVisible();
});

test('Mitarbeiter sehen die Temperatureinstellungen nicht', async ({page}) => {
 await openTemperature(page, 'employee');
 await expect(page.locator('#operations-panel').getByRole('button', {name: 'Einstellungen'})).toHaveCount(0);
 await expect(page.locator('#temperature-settings')).toHaveCount(0);
 await expect(page.getByRole('button', {name: 'Messung speichern'})).toBeVisible();
 await expect(page.getByRole('button', {name: 'Messstelle speichern'})).toHaveCount(0);
 await expect(page.getByRole('button', {name: 'Deaktivieren'})).toHaveCount(0);
});
