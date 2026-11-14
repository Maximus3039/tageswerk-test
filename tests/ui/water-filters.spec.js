import {expect, test} from '@playwright/test';

function berlinDay(value = new Date()) {
 return new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/Berlin'}).format(new Date(value));
}

function addCalendarDays(day, count) {
 const [year, month, date] = day.split('-').map(Number);
 return new Date(Date.UTC(year, month - 1, date + count)).toISOString().slice(0, 10);
}

function berlinIso(day, time = '08:00') {
 for (const offset of ['+01:00', '+02:00']) {
  const iso = `${day}T${time}:00${offset}`;
  if (berlinDay(iso) === day) return new Date(iso).toISOString();
 }
 return `${day}T07:00:00.000Z`;
}

function membership(role) {
 if (role === 'company_admin') {
  return {user_id: 'user-1', organization_id: 'org', facility_id: null, role: 'company_admin', is_active: true};
 }
 return {user_id: 'user-1', organization_id: 'org', facility_id: 'fac', role, is_active: true};
}

function supabaseMock(role = 'facility_manager') {
 const today = berlinDay();
 const yesterday = addCalendarDays(today, -1);
 const todayIso = berlinIso(today, '08:00');
 const yesterdayIso = berlinIso(yesterday, '09:00');
 return `const tables = {
 organizations: [{id: 'org', name: 'Freizeitpark'}],
 facilities: [{id: 'fac', name: 'Prignitzer', organization_id: 'org'}],
 memberships: [
  ${JSON.stringify(membership(role))},
  {user_id: 'user-2', organization_id: 'org', facility_id: 'fac', role: 'employee', is_active: true}
 ],
 profiles: [{id: 'user-1', full_name: 'Maximilian'}, {id: 'user-2', full_name: 'Mia'}],
 water_pools: [
  {id: 'pool-kinder', organization_id: 'org', facility_id: 'fac', name: 'Kinderbecken', active: true, schedule_mode: 'daily', interval_count: 1, scheduled_times: [], weekdays: [1, 2, 3, 4, 5, 6, 7], created_by: 'user-1', created_at: '2026-11-01T08:00:00Z'},
  {id: 'pool-schwimmer', organization_id: 'org', facility_id: 'fac', name: 'Schwimmerbecken', active: true, schedule_mode: 'daily', interval_count: 1, scheduled_times: [], weekdays: [1, 2, 3, 4, 5, 6, 7], created_by: 'user-1', created_at: '2026-11-01T08:00:00Z'}
 ],
 water_checks: [],
 water_alerts: [],
 water_alert_measures: [],
 water_filters: [
  {id: 'filter-a', organization_id: 'org', facility_id: 'fac', pool_id: 'pool-kinder', name: 'Sandfilter Kinder', active: true, created_by: 'user-1', created_at: '2026-11-01T08:00:00Z', last_flushed_at: '${todayIso}', last_flushed_by: 'user-2'},
  {id: 'filter-b', organization_id: 'org', facility_id: 'fac', pool_id: 'pool-schwimmer', name: 'Sandfilter Schwimmer', active: true, created_by: 'user-1', created_at: '2026-11-01T08:00:00Z', last_flushed_at: null, last_flushed_by: null},
  {id: 'filter-off', organization_id: 'org', facility_id: 'fac', pool_id: 'pool-kinder', name: 'Altes Filter', active: false, created_by: 'user-1', created_at: '2026-11-01T08:00:00Z', last_flushed_at: '${yesterdayIso}', last_flushed_by: 'user-1'}
 ],
 water_filter_flushes: [
  {id: 'flush-1', organization_id: 'org', facility_id: 'fac', pool_id: 'pool-kinder', filter_id: 'filter-a', flushed_at: '${todayIso}', recorded_at: '${todayIso}', recorded_by: 'user-2', note: 'Routine'},
  {id: 'flush-2', organization_id: 'org', facility_id: 'fac', pool_id: 'pool-schwimmer', filter_id: 'filter-b', flushed_at: '${yesterdayIso}', recorded_at: '${yesterdayIso}', recorded_by: 'user-1', note: 'Nachkontrolle'}
 ],
 water_filter_flush_corrections: [
  {
   id: 'corr-1', flush_id: 'flush-2', organization_id: 'org', facility_id: 'fac',
   corrected_at: '${todayIso}', corrected_by: 'user-1', reason: 'Falsche Uhrzeit',
   previous_filter_id: 'filter-b', previous_pool_id: 'pool-schwimmer', previous_flushed_at: '${yesterdayIso}', previous_note: 'Nachkontrolle',
   filter_id: 'filter-b', pool_id: 'pool-schwimmer', flushed_at: '${yesterdayIso}', note: 'Nachkontrolle korrigiert'
  }
 ],
 water_filter_status_events: [
  {
   id: 'status-1', filter_id: 'filter-off', organization_id: 'org', facility_id: 'fac',
   changed_at: '${yesterdayIso}', changed_by: 'user-1', reason: 'Defekt', old_active: true, new_active: false
  }
 ]
};
function query(table) {
 const result = Promise.resolve({data: tables[table] || [], error: null});
 const chain = {
  select() {return chain},
  eq() {return chain},
  order() {return chain},
  limit() {return chain},
  insert() {return chain},
  update() {return chain},
  maybeSingle() {return Promise.resolve({data: null, error: null})},
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

async function openWaterFilters(page, role) {
 await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
  contentType: 'text/javascript',
  body: supabaseMock(role)
 }));
 await page.route(/supabase\.co/, route => route.abort());
 await page.goto('/');
 await page.locator('[data-view="more"]:visible').first().click();
 await page.locator('#open-operations').click();
 await page.locator('[data-operation="water"]').click();
 await expect(page.locator('.water-filters')).toBeVisible();
}

test('Leitung sieht Filterübersicht, Verwaltung, Historie, Korrektur und Statushistorie', async ({page}) => {
 await openWaterFilters(page, 'facility_manager');
 const section = page.locator('.water-filters');
 await expect(section.getByRole('heading', {name: 'Filterspülungen'})).toBeVisible();
 await expect(section.locator('.water-filter-card strong', {hasText: 'Sandfilter Kinder'})).toBeVisible();
 await expect(section.locator('.water-filter-card strong', {hasText: 'Sandfilter Schwimmer'})).toBeVisible();
 await expect(section.locator('.water-filter-card strong', {hasText: 'Altes Filter'})).toBeVisible();
 await expect(section.locator('.water-filter-card.is-active .badge.active')).toHaveCount(2);
 await expect(section.locator('.water-filter-card.is-inactive .badge.inactive')).toHaveText('Außer Betrieb');
 await expect(section.locator('.water-filter-card', {hasText: 'Sandfilter Kinder'})).toContainText('Verantwortlich: Mia');
 await expect(section.locator('.water-filter-card', {hasText: 'Sandfilter Schwimmer'})).toContainText('Noch keine Spülung');
 await expect(section.getByRole('button', {name: 'Filter anlegen'})).toBeVisible();
 await expect(section.getByRole('button', {name: 'Außer Betrieb'}).first()).toBeVisible();
 await expect(section.getByRole('button', {name: 'Wieder in Betrieb'})).toBeVisible();
 await expect(section.getByRole('heading', {name: 'Spülung dokumentieren'})).toBeVisible();
 await expect(section.getByRole('heading', {name: 'Spülhistorie'})).toBeVisible();
 await expect(section.locator('.water-filter-history')).toContainText('Routine');
 await expect(section.locator('.water-filter-history')).toContainText('Mia');
 await expect(section.locator('.water-filter-history tr.is-corrected')).toContainText('Korrigiert');
 await expect(section.getByRole('heading', {name: 'Statushistorie'})).toBeVisible();
 await expect(section.locator('.water-filter-status-card')).toContainText('Defekt');
 await expect(section.locator('.water-filter-status-card')).toContainText('In Betrieb → Außer Betrieb');

 const capture = section.locator('.water-filter-capture');
 await capture.locator('label', {hasText: 'Becken'}).locator('select').selectOption('pool-kinder');
 const options = await capture.locator('label', {hasText: 'Aktiver Filter'}).locator('option').allTextContents();
 expect(options.join('|')).toContain('Sandfilter Kinder');
 expect(options.join('|')).not.toContain('Altes Filter');
 await expect(capture.locator('input[type="datetime-local"]')).not.toHaveValue('');

 await section.getByRole('button', {name: 'Spülung speichern'}).click();
 await expect(page.locator('#operations-message')).toHaveText('Bitte einen Filter wählen.');

 await section.locator('.water-filter-history').getByRole('button', {name: 'Heute'}).click();
 await expect(section.locator('.water-filter-history')).toContainText('Routine');
 await expect(section.locator('.water-filter-history')).not.toContainText('Nachkontrolle korrigiert');

 const viewport = page.viewportSize();
 const save = section.getByRole('button', {name: 'Spülung speichern'});
 const box = await save.boundingBox();
 expect(box.height).toBeGreaterThanOrEqual(viewport.width <= 850 ? 48 : 40);
 expect(box.x).toBeGreaterThanOrEqual(0);
 expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
});

test('Mitarbeiter erfassen Spülungen ohne Historie und ohne Verwaltung', async ({page}) => {
 await openWaterFilters(page, 'employee');
 const section = page.locator('.water-filters');
 await expect(section.getByRole('heading', {name: 'Spülung dokumentieren'})).toBeVisible();
 await expect(section.locator('.water-filter-card strong', {hasText: 'Sandfilter Kinder'})).toBeVisible();
 await expect(section.locator('.water-filter-card strong', {hasText: 'Altes Filter'})).toHaveCount(0);
 await expect(section.getByRole('button', {name: 'Filter anlegen'})).toHaveCount(0);
 await expect(section.getByRole('heading', {name: 'Spülhistorie'})).toHaveCount(0);
 await expect(section.getByRole('heading', {name: 'Statushistorie'})).toHaveCount(0);
 await expect(section.getByRole('heading', {name: 'Spülung korrigieren'})).toHaveCount(0);
 await expect(section.getByRole('button', {name: 'Außer Betrieb'})).toHaveCount(0);
});

test('Techniker sehen Historie, aber weder Korrektur noch Statusverwaltung', async ({page}) => {
 await openWaterFilters(page, 'technician');
 const section = page.locator('.water-filters');
 await expect(section.getByRole('heading', {name: 'Spülung dokumentieren'})).toBeVisible();
 await expect(section.getByRole('heading', {name: 'Spülhistorie'})).toBeVisible();
 await expect(section.locator('.water-filter-history')).toContainText('Korrigiert');
 await expect(section.locator('.water-filter-card strong', {hasText: 'Altes Filter'})).toBeVisible();
 await expect(section.getByRole('button', {name: 'Filter anlegen'})).toHaveCount(0);
 await expect(section.getByRole('heading', {name: 'Statushistorie'})).toHaveCount(0);
 await expect(section.getByRole('button', {name: 'Korrektur speichern'})).toHaveCount(0);
});

test('Administrator kann Korrektur öffnen', async ({page}) => {
 await openWaterFilters(page, 'company_admin');
 const section = page.locator('.water-filters');
 await expect(section.getByRole('heading', {name: 'Statushistorie'})).toBeVisible();
 await section.locator('.water-filter-history tr.is-selectable').first().click();
 await expect(section.getByRole('heading', {name: 'Spülung korrigieren'})).toBeVisible();
 await expect(section.getByText(/Originaleintrag bleibt unverändert/)).toBeVisible();
 await section.getByRole('button', {name: 'Korrektur speichern'}).click();
 await expect(page.locator('#operations-message')).toHaveText(/Begründung|keine Änderung|Bitte/);
});
