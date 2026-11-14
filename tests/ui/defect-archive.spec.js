import {expect, test} from '@playwright/test';

const supabaseMock = `const tables = {
 organizations: [{id: 'org', name: 'Freizeitpark'}],
 facilities: [{id: 'fac', name: 'Prignitzer', organization_id: 'org'}],
 memberships: [{user_id: 'user-1', organization_id: 'org', facility_id: null, role: 'company_admin', is_active: true}],
 profiles: [{id: 'user-1', full_name: 'Maximilian'}],
 defects: [
  {id: 'open-1', title: 'Hahn tropft', description: 'Dusche', priority: 'normal', status: 'open', facility_id: 'fac', organization_id: 'org', assigned_to: null, created_at: '2026-11-10T08:00:00Z', resolution_due_at: null, resolved_at: null, archived_at: null, archived_by: null},
  {id: 'done-1', title: 'Leiter locker', description: 'Becken', priority: 'normal', status: 'resolved', facility_id: 'fac', organization_id: 'org', assigned_to: null, created_at: '2026-11-09T08:00:00Z', resolution_due_at: null, resolved_at: '2026-11-11T08:00:00Z', archived_at: null, archived_by: null},
  {id: 'archive-1', title: 'Fliese gelöst', description: 'Umkleide', priority: 'normal', status: 'resolved', facility_id: 'fac', organization_id: 'org', assigned_to: null, created_at: '2026-11-01T08:00:00Z', resolution_due_at: null, resolved_at: '2026-11-02T08:00:00Z', archived_at: '2026-11-03T08:00:00Z', archived_by: 'user-1'},
  {id: 'archive-2', title: 'Pumpe archiviert', description: 'Technik', priority: 'normal', status: 'resolved', facility_id: 'fac', organization_id: 'org', assigned_to: null, created_at: '2026-10-01T08:00:00Z', resolution_due_at: null, resolved_at: '2026-10-02T08:00:00Z', archived_at: '2026-10-03T08:00:00Z', archived_by: 'user-1'}
 ],
 defect_events: []
};
function query(table) {
 const result = Promise.resolve({data: tables[table] || [], error: null});
 const chain = {
  select() {return chain},
  eq() {return chain},
  order() {return chain},
  limit() {return chain},
  range() {return chain},
  insert() {return Promise.resolve({data: null, error: null})},
  update() {return chain},
  then(ok, bad) {return result.then(ok, bad)}
 };
 return chain;
}
export function createClient() {
 return {
  from: query,
  rpc(name, args) {
   const defect = tables.defects.find(item => item.id === args?.p_defect_id);
   if (name === 'tageswerk_archive_defect' && defect) {
    defect.archived_at = '2026-11-13T12:00:00Z';
    defect.archived_by = 'user-1';
   }
   if (name === 'tageswerk_restore_archived_defect' && defect) {
    defect.archived_at = null;
    defect.archived_by = null;
   }
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

test('Das Mängelarchiv bleibt eingeklappt, bis die Überschrift geöffnet wird', async ({page}) => {
 await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
  contentType: 'text/javascript',
  body: supabaseMock
 }));
 await page.route(/supabase\.co/, route => route.abort());
 await page.goto('/');
 await page.locator('[data-view="defects"]:visible').first().click();
 const toggle = page.locator('#defect-archive-toggle');
 await expect(toggle).toBeVisible();
 await expect(toggle).toHaveAttribute('aria-expanded', 'false');
 await expect(toggle).toHaveText('▶ Archiv (2)');
 await expect(page.locator('#archive-search')).toHaveCount(0);
 await expect(page.locator('#defect-archive-panel')).toHaveCount(0);
 const box = await toggle.boundingBox();
 const viewport = page.viewportSize();
 expect(box.height).toBeGreaterThanOrEqual(48);
 expect(box.x).toBeGreaterThanOrEqual(0);
 expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
 await page.getByRole('button', {name: 'Gesehen & archivieren'}).click();
 await expect(toggle).toHaveText('▶ Archiv (3)');
 await expect(toggle).toHaveAttribute('aria-expanded', 'false');
 await expect(page.locator('#archive-search')).toHaveCount(0);
 await toggle.click();
 await expect(toggle).toBeFocused();
 await expect(toggle).toHaveAttribute('aria-expanded', 'true');
 await expect(toggle).toHaveText('▼ Archiv (3)');
 await expect(page.locator('#archive-search')).toBeVisible();
 await expect(page.getByText('Sortiert nach Abschlussdatum, neueste zuerst.')).toBeVisible();
 await expect(page.locator('#defect-archive-panel .defect')).toHaveCount(3);
 await page.locator('#archive-search').fill('Fliese');
 await expect(toggle).toHaveText('▼ Archiv (3)');
 await expect(page.locator('#defect-archive-panel .defect')).toHaveCount(1);
 await page.locator('#archive-search').fill('');
 await page.locator('#defect-archive-panel .defect').filter({hasText: 'Fliese gelöst'}).getByRole('button', {name: 'Aus Archiv zurückholen'}).click();
 await expect(toggle).toHaveText('▼ Archiv (2)');
 await expect(toggle).toHaveAttribute('aria-expanded', 'true');
 await toggle.click();
 await expect(toggle).toHaveText('▶ Archiv (2)');
 await expect(toggle).toHaveAttribute('aria-expanded', 'false');
 await expect(page.locator('#archive-search')).toHaveCount(0);
 await expect(page.locator('#defect-archive-panel')).toHaveCount(0);
});
