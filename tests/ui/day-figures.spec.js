import {expect, test} from '@playwright/test';

function supabaseMock(role) {
 const membership = role === 'employee'
  ? {user_id: 'user-1', organization_id: 'org', facility_id: 'fac', role: 'employee', is_active: true}
  : role === 'technician'
   ? {user_id: 'user-1', organization_id: 'org', facility_id: 'fac', role: 'technician', is_active: true}
   : {user_id: 'user-1', organization_id: 'org', facility_id: null, role: 'company_admin', is_active: true};
 const overview = role === 'employee'
  ? {access: 'employee', rows: [{day: '2026-11-14', weekday: 'Samstag', weekend: 'saturday', compareDay: '2025-11-15', visitors: 610, visitorChange: {state: 'value', label: '+12,8 %', tone: 'up'}}]}
  : {access: 'manager', rows: [{day: '2026-11-14', weekday: 'Samstag', weekend: 'saturday', compareDay: '2025-11-15', visitors: 610, priorVisitors: 541, gateCents: 4000, bistroCents: 1205, totalCents: 5205, priorTotalCents: 4850, visitorChange: {state: 'value', label: '+12,8 %', tone: 'up'}, revenueChange: {state: 'value', label: '+7,3 %', tone: 'up'}}]};
 const period = role === 'employee'
  ? {access: 'employee', month: {visitors: {state: 'complete', change: {label: '+5,2 %', tone: 'up'}}, total: {state: 'complete', change: {label: '+6,4 %', tone: 'up'}}}, year: {visitors: {state: 'complete', change: {label: '+3,8 %', tone: 'up'}}, total: {state: 'incomplete', missing: 3, label: 'Es fehlen Daten für 3 Tage.'}}}
  : {access: 'manager', month: {visitors: {state: 'complete', current: 5510, prior: 5240, change: {label: '+5,2 %', tone: 'up'}}, gate: {state: 'complete', current: 3350000, prior: 3180000, change: {label: '+5,3 %', tone: 'up'}}, bistro: {state: 'complete', current: 1170000, prior: 1070000, change: {label: '+9,3 %', tone: 'up'}}, total: {state: 'complete', current: 4520000, prior: 4250000, change: {label: '+6,4 %', tone: 'up'}}}, year: {visitors: {state: 'complete', current: 1, prior: 1, change: {label: '0,0 %', tone: 'flat'}}, total: {state: 'complete', current: 1, prior: 1, change: {label: '0,0 %', tone: 'flat'}}, gate: {state: 'incomplete', missing: 3, label: 'Es fehlen Daten für 3 Tage.'}, bistro: {state: 'incomplete', missing: 3, label: 'Es fehlen Daten für 3 Tage.'}}};
 return `const tables = {
 organizations: [{id: 'org', name: 'Freizeitpark'}],
 facilities: [{id: 'fac', name: 'Prignitzer', organization_id: 'org'}],
 memberships: [${JSON.stringify(membership)}],
 profiles: [{id: 'user-1', full_name: 'Maximilian'}]
};
const overview = ${JSON.stringify(overview)};
const period = ${JSON.stringify(period)};
function query() {
 const result = Promise.resolve({data: tables[arguments[0]] || [], error: null});
 const chain = {select() {return chain}, eq() {return chain}, order() {return chain}, limit() {return chain}, maybeSingle() {return Promise.resolve({data: null, error: null})}, insert() {return chain}, update() {return chain}, then(ok, bad) {return result.then(ok, bad)}};
 return chain;
}
export function createClient() {
 return {
  from: query,
  rpc(name) {
   if (name === 'tageswerk_day_figure_overview') return Promise.resolve({data: overview, error: null});
   if (name === 'tageswerk_day_figure_period') return Promise.resolve({data: period, error: null});
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

async function openReports(page, role) {
 await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({contentType: 'text/javascript', body: supabaseMock(role)}));
 await page.route(/supabase\.co/, route => route.abort());
 await page.goto('/');
 await page.locator('[data-view="more"]:visible').first().click();
 await page.locator('#open-operations').click();
 await expect(page.getByText('Besondere Vorkommnisse')).toBeVisible();
}

test('Die Leitung sieht Beträge, Wochenende und historische Einstellungen', async ({page}) => {
 await openReports(page, 'manager');
 const board = page.locator('#day-figures');
 await expect(board.getByRole('columnheader', {name: 'Gesamtumsatz VJ'})).toBeVisible();
 await expect(board.locator('tr.is-saturday')).toContainText('14.11.2026');
 await expect(board.locator('tr.is-saturday')).toContainText('40,00 €');
 await expect(board.locator('.figure-up').first()).toHaveText('+12,8 %');
 await expect(board.getByRole('button', {name: 'Einstellungen'})).toBeVisible();
 await expect(board.locator('#day-figure-settings')).toBeHidden();
 const box = await board.locator('.figure-table-wrap').boundingBox();
 const viewport = page.viewportSize();
 expect(box.x).toBeGreaterThanOrEqual(0);
 expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
});

test('Mitarbeiter sehen sieben Tage ohne historische Beträge', async ({page}) => {
 await openReports(page, 'employee');
 const board = page.locator('#day-figures');
 await expect(board.getByRole('columnheader', {name: 'Besucherabweichung'})).toBeVisible();
 await expect(board.getByRole('columnheader', {name: 'Gesamtumsatz VJ'})).toHaveCount(0);
 await expect(board.locator('tr.is-saturday')).toContainText('+12,8 %');
 await expect(board.locator('.figure-table')).not.toContainText('€');
 await expect(board.getByText('+6,4 %')).toBeVisible();
 await expect(board.getByText('Es fehlen Daten für 3 Tage.')).toBeVisible();
 await expect(board.getByRole('button', {name: 'Einstellungen'})).toHaveCount(0);
});

test('Techniker behalten den Textbericht ohne Kennzahlen', async ({page}) => {
 await openReports(page, 'technician');
 await expect(page.getByText('Besondere Vorkommnisse')).toBeVisible();
 await expect(page.locator('#day-figures')).toHaveCount(0);
 await expect(page.getByRole('button', {name: 'Kennzahlen speichern'})).toHaveCount(0);
});
