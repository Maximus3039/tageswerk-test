import {expect, test} from '@playwright/test';

function supabaseMock(role) {
 const today = new Date().toISOString().slice(0, 10);
 const membership = role === 'employee'
  ? {user_id: 'user-1', organization_id: 'org', facility_id: 'fac', role: 'employee', is_active: true}
  : {user_id: 'user-1', organization_id: 'org', facility_id: null, role: 'company_admin', is_active: true};
 return `const tables = {
 organizations: [{id: 'org', name: 'Freizeitpark'}],
 facilities: [{id: 'fac', name: 'Prignitzer', organization_id: 'org'}],
 memberships: [${JSON.stringify(membership)}],
 profiles: [{id: 'user-1', full_name: 'Maximilian'}],
 staff_invitations: [],
 defects: [{id: 'd1', title: 'Pumpe undicht', status: 'open', facility_id: 'fac', organization_id: 'org', priority: 'high', created_at: '2026-11-20T08:00:00Z'}]
};
const overview = {access: 'manager', rows: [
 {day: '${today}', weekday: 'Samstag', weekend: 'saturday', compareDay: '2025-11-22', visitors: 100, priorVisitors: 90, totalCents: 5000, priorTotalCents: 4000}
]};
function query(name) {
 const result = Promise.resolve({data: tables[name] || [], error: null});
 const chain = {
  select() {return chain}, eq() {return chain}, order() {return chain}, limit() {return chain},
  maybeSingle() {return Promise.resolve({data: null, error: null})},
  insert() {return chain}, update() {return chain}, upsert() {return Promise.resolve({error: {message: 'relation does not exist', code: '42P01'}})},
  then(ok, bad) {return result.then(ok, bad)}
 };
 return chain;
}
export function createClient() {
 return {
  from: query,
  rpc(name) {
   if (name === 'accept_staff_invitation') return Promise.resolve({data: {success: false}, error: null});
   if (name === 'tageswerk_day_figure_overview') return Promise.resolve({data: overview, error: null});
   if (name === 'tageswerk_day_figure_period') return Promise.resolve({data: {month: {}, year: {}}, error: null});
   if (name === 'list_facility_employees') return Promise.resolve({data: [], error: null});
   return Promise.resolve({data: [], error: null});
  },
  functions: {invoke: async () => ({data: {ok: false, error: 'blockiert'}, error: null})},
  auth: {
   getUser: async () => ({data: {user: {id: 'user-1', email: 'leitung@example.invalid'}}, error: null}),
   getSession: async () => ({data: {session: {user: {id: 'user-1'}}}, error: null}),
   onAuthStateChange() {return {data: {subscription: {unsubscribe() {}}}}},
   signInWithPassword: async () => ({data: null, error: null}),
   signOut: async () => ({error: null})
  },
  channel() {return {on() {return this}, subscribe(callback) {if (callback) callback('SUBSCRIBED'); return this}}},
  removeChannel() {}
 };
}`;
}

async function openApp(page, role) {
 await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({contentType: 'text/javascript', body: supabaseMock(role)}));
 await page.route(/supabase\.co/, route => route.abort());
 await page.goto('/');
 await expect(page.locator('#app')).toBeVisible();
}

test('Geschäftsführung sieht Einladungsbestätigung und Management-Kacheln mit drei Zeiträumen', async ({page}) => {
 await openApp(page, 'manager');
 await page.locator('[data-view="more"]:visible').first().click();
 await expect(page.locator('#invite-email-confirm')).toBeVisible();
 await expect(page.locator('#invite-recipient-preview')).toContainText('Empfängeradresse');
 await page.locator('#invite-email').fill('neu@example.invalid');
 await expect(page.locator('#invite-recipient-preview')).toContainText('neu@example.invalid');
 await page.locator('#invite-first').fill('Test');
 await page.locator('#invite-last').fill('Person');
 await page.locator('#invite-email-confirm').fill('anders@example.invalid');
 await page.locator('#invite-submit').click();
 await expect(page.locator('#invite-message')).toContainText('stimmen nicht überein');
 await page.locator('#invite-email-confirm').fill('neu@example.invalid');
 await expect(page.locator('#open-management-dashboard')).toBeVisible();
 await page.locator('#open-management-dashboard').click();
 await expect(page.locator('#management-board-card')).toBeVisible();
 await expect(page.locator('#management-config')).toBeVisible();
 await expect(page.locator('#mgmt-monitor')).toBeVisible();
 await expect(page.locator('#management-board .mgmt-period')).toHaveCount(3);
 await expect(page.locator('#management-board')).toContainText('Heute');
 await expect(page.locator('#management-board')).toContainText('Monat');
 await expect(page.locator('#management-board')).toContainText('Jahr');
 await expect(page.locator('#management-board')).toContainText('Besucher');
 await expect(page.locator('#management-board')).toContainText('Umsatz');
 await page.locator('#mgmt-monitor').check();
 await page.locator('#management-config button[type="submit"]').click();
 await expect(page.locator('#management-board')).toHaveClass(/mgmt-monitor/);
 const tile = await page.locator('.mgmt-tile').boundingBox();
 const viewport = page.viewportSize();
 expect(tile.x).toBeGreaterThanOrEqual(0);
 expect(tile.x + tile.width).toBeLessThanOrEqual(viewport.width + 1);
});

test('Mitarbeiter erhalten keine Management-Ansicht', async ({page}) => {
 await openApp(page, 'employee');
 await page.locator('[data-view="more"]:visible').first().click();
 await expect(page.locator('#open-management-dashboard')).toBeHidden();
 await expect(page.locator('#invite-card')).toBeHidden();
});
