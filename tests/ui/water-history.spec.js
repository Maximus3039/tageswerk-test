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

function supabaseMock() {
 const today = berlinDay();
 const yesterday = addCalendarDays(today, -1);
 const weekOld = addCalendarDays(today, -3);
 const monthOld = addCalendarDays(today, -20);
 const outside = addCalendarDays(today, -40);
 const oldAlertDay = addCalendarDays(today, -45);
 const todayMorning = berlinIso(today, '08:00');
 const todayLater = berlinIso(today, '09:00');
 const yesterdayIso = berlinIso(yesterday, '08:00');
 const weekIso = berlinIso(weekOld, '08:00');
 const monthIso = berlinIso(monthOld, '08:00');
 const outsideIso = berlinIso(outside, '08:00');
 const oldAlertIso = berlinIso(oldAlertDay, '08:00');
 const ackAt = berlinIso(today, '08:05');
 return `const tables = {
 organizations: [{id: 'org', name: 'Freizeitpark'}],
 facilities: [{id: 'fac', name: 'Prignitzer', organization_id: 'org'}],
 memberships: [{user_id: 'user-1', organization_id: 'org', facility_id: null, role: 'company_admin', is_active: true}],
 profiles: [{id: 'user-1', full_name: 'Maximilian'}],
 water_pools: [
  {id: 'pool-kinder', organization_id: 'org', facility_id: 'fac', name: 'Kinderbecken', active: true, schedule_mode: 'daily', interval_count: 1, scheduled_times: [], weekdays: [1, 2, 3, 4, 5, 6, 7], created_by: 'user-1', created_at: '2026-11-01T08:00:00Z'},
  {id: 'pool-schwimmer', organization_id: 'org', facility_id: 'fac', name: 'Schwimmerbecken', active: true, schedule_mode: 'daily', interval_count: 1, scheduled_times: [], weekdays: [1, 2, 3, 4, 5, 6, 7], created_by: 'user-1', created_at: '2026-11-01T08:00:00Z'}
 ],
 water_checks: [
  {
   id: 'check-kinder', organization_id: 'org', facility_id: 'fac', pool_id: 'pool-kinder',
   measured_at: '${todayMorning}', recorded_by: 'user-1', note: '',
   readings: [
    {parameter_code: 'ph', value: '8.20', unit: '', min_limit: '6.50', max_limit: '7.60'},
    {parameter_code: 'free_chlorine', value: '0.10', unit: 'mg/l', min_limit: '0.30', max_limit: '0.60'},
    {parameter_code: 'temperature', value: '28.0', unit: '°C', min_limit: '26', max_limit: '32'}
   ]
  },
  {
   id: 'check-schwimmer', organization_id: 'org', facility_id: 'fac', pool_id: 'pool-schwimmer',
   measured_at: '${todayLater}', recorded_by: 'user-1', note: '',
   readings: [
    {parameter_code: 'ph', value: '7.20', unit: '', min_limit: '6.50', max_limit: '7.60'},
    {parameter_code: 'free_chlorine', value: '0.40', unit: 'mg/l', min_limit: '0.30', max_limit: '0.60'},
    {parameter_code: 'temperature', value: '40.0', unit: '°C', min_limit: null, max_limit: null}
   ]
  },
  {
   id: 'check-week', organization_id: 'org', facility_id: 'fac', pool_id: 'pool-kinder',
   measured_at: '${weekIso}', recorded_by: 'user-1', note: '',
   readings: [{parameter_code: 'ph', value: '7.10', unit: '', min_limit: '6.50', max_limit: '7.60'}]
  },
  {
   id: 'check-month', organization_id: 'org', facility_id: 'fac', pool_id: 'pool-schwimmer',
   measured_at: '${monthIso}', recorded_by: 'user-1', note: '',
   readings: [{parameter_code: 'ph', value: '7.00', unit: '', min_limit: '6.50', max_limit: '7.60'}]
  },
  {
   id: 'check-outside', organization_id: 'org', facility_id: 'fac', pool_id: 'pool-kinder',
   measured_at: '${outsideIso}', recorded_by: 'user-1', note: '',
   readings: [{parameter_code: 'ph', value: '6.90', unit: '', min_limit: '6.50', max_limit: '7.60'}]
  },
  {
   id: 'check-follow', organization_id: 'org', facility_id: 'fac', pool_id: 'pool-kinder',
   measured_at: '${yesterdayIso}', recorded_by: 'user-1', note: 'Nachkontrolle', follow_up_alert_id: 'alert-chlor',
   readings: [{parameter_code: 'free_chlorine', value: '0.35', unit: 'mg/l', min_limit: '0.30', max_limit: '0.60'}]
  },
  {
   id: 'check-old-alert', organization_id: 'org', facility_id: 'fac', pool_id: 'pool-schwimmer',
   measured_at: '${oldAlertIso}', recorded_by: 'user-1', note: '',
   readings: [{parameter_code: 'ph', value: '8.50', unit: '', min_limit: '6.50', max_limit: '7.60'}]
  }
 ],
 water_alerts: [
  {
   id: 'alert-ph', check_id: 'check-kinder', pool_id: 'pool-kinder', organization_id: 'org', facility_id: 'fac',
   parameter_code: 'ph', value_amount: '8.20', min_value: '6.50', max_value: '7.60', unit: '',
   measured_at: '${todayMorning}', recorded_by: 'user-1', status: 'acknowledged',
   acknowledged_by: 'user-1', acknowledged_at: '${ackAt}', acknowledgement_note: 'Zur Kenntnis genommen'
  },
  {
   id: 'alert-chlor', check_id: 'check-kinder', pool_id: 'pool-kinder', organization_id: 'org', facility_id: 'fac',
   parameter_code: 'free_chlorine', value_amount: '0.10', min_value: '0.30', max_value: '0.60', unit: 'mg/l',
   measured_at: '${todayMorning}', recorded_by: 'user-1', status: 'open',
   acknowledged_by: null, acknowledged_at: null, acknowledgement_note: ''
  },
  {
   id: 'alert-old', check_id: 'check-old-alert', pool_id: 'pool-schwimmer', organization_id: 'org', facility_id: 'fac',
   parameter_code: 'ph', value_amount: '8.50', min_value: '6.50', max_value: '7.60', unit: '',
   measured_at: '${oldAlertIso}', recorded_by: 'user-1', status: 'open',
   acknowledged_by: null, acknowledged_at: null, acknowledgement_note: ''
  }
 ],
 water_alert_measures: [
  {
   id: 'measure-1', alert_id: 'alert-chlor', organization_id: 'org', facility_id: 'fac',
   measure_text: 'Frischwasser nachgefüllt', recorded_by: 'user-1', recorded_at: '${ackAt}'
  },
  {
   id: 'measure-2', alert_id: 'alert-chlor', organization_id: 'org', facility_id: 'fac',
   measure_text: 'Dosierung geprüft', recorded_by: 'user-1', recorded_at: '${todayLater}'
  }
 ]
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

async function openWater(page) {
 await page.addInitScript(() => localStorage.removeItem('tageswerk-water-history-view'));
 await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
  contentType: 'text/javascript',
  body: supabaseMock()
 }));
 await page.route(/supabase\.co/, route => route.abort());
 await page.goto('/');
 await page.locator('[data-view="more"]:visible').first().click();
 await page.locator('#open-operations').click();
 await page.locator('[data-operation="water"]').click();
 await expect(page.locator('#water-history')).toBeVisible();
}

test('Messwerte wechseln zwischen Becken und Uhrzeit und markieren nur gespeicherte Abweichungen', async ({page}) => {
 await openWater(page);
 const history = page.locator('#water-history');
 const today = berlinDay();
 const poolButton = history.getByRole('button', {name: 'Nach Becken'});
 const timeButton = history.getByRole('button', {name: 'Nach Uhrzeit'});
 await expect(history.getByRole('button', {name: 'Heute'})).toHaveAttribute('aria-pressed', 'true');
 await expect(history.locator('#water-history-from')).toHaveValue(today);
 await expect(history.locator('#water-history-to')).toHaveValue(today);
 await expect(poolButton).toHaveAttribute('aria-pressed', 'true');
 await expect(timeButton).toHaveAttribute('aria-pressed', 'false');
 await expect(history.locator('h4')).toHaveText(['Kinderbecken', 'Schwimmerbecken']);
 const kinder = history.locator('h4', {hasText: 'Kinderbecken'}).locator('xpath=following-sibling::table[1]');
 const schwimmer = history.locator('h4', {hasText: 'Schwimmerbecken'}).locator('xpath=following-sibling::table[1]');
 await expect(kinder.locator('td.is-breach')).toHaveCount(2);
 await expect(kinder.locator('td.is-breach').nth(0)).toContainText('⚠');
 await expect(kinder).toContainText('8.20');
 await expect(kinder).toContainText('0.10');
 await expect(schwimmer.locator('td.is-breach')).toHaveCount(0);
 await expect(schwimmer).toContainText('7.20');
 await expect(schwimmer).toContainText('40.0');
 const marked = await kinder.locator('td.is-breach').first().evaluate(node => {
  const style = getComputedStyle(node);
  return {background: style.backgroundColor, color: style.color};
 });
 expect(marked.background).toBe('rgb(224, 122, 31)');
 expect(marked.color).toBe('rgb(26, 18, 8)');

 const alerts = page.locator('#water-alerts');
 await expect(alerts.locator('.water-alert.is-open')).toHaveCount(2);
 await expect(alerts.locator('[data-alert-id="alert-chlor"]')).toContainText('Offene Warnung: Freies Chlor 0.10 mg/l');
 await expect(alerts.locator('[data-alert-id="alert-chlor"]')).toContainText('Quittierung ist keine Behebung');
 await expect(alerts.locator('[data-alert-id="alert-old"]')).toContainText('Offene Warnung: pH-Wert 8.50');
 await expect(alerts.locator('[data-alert-id="alert-old"]')).toContainText('Schwimmerbecken');
 await expect(alerts.locator('.water-alert.is-acknowledged')).toContainText(/Die Abweichung gilt damit nicht als behoben/);
 await expect(history).not.toContainText('8.50');
 await expect(alerts.getByText('Maßnahme (freiwillig)').first()).toBeVisible();
 await expect(alerts.getByText('Quittierung (freiwillig)').first()).toBeVisible();
 await expect(alerts.getByText('Die Messung ist gespeichert. Die Warnung bleibt sichtbar. Maßnahme und Quittierung sind freiwillig und heben die Abweichung nicht auf.')).toBeVisible();
 await expect(alerts.locator('[data-alert-id="alert-chlor"]')).toContainText('Frischwasser nachgefüllt');
 await expect(alerts.locator('[data-alert-id="alert-chlor"]')).toContainText('Dosierung geprüft');
 await expect(alerts.locator('[data-alert-id="alert-chlor"]')).toContainText('Wiederholungsmessungen (1)');
 await expect(alerts.locator('[data-alert-id="alert-chlor"]')).toContainText('0.35');

 const viewport = page.viewportSize();
 for (const button of [poolButton, timeButton, history.getByRole('button', {name: 'Heute'}), history.getByRole('button', {name: 'Letzte 7 Tage'})]) {
  const box = await button.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(viewport.width <= 850 ? 44 : 40);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
 }

 await page.getByRole('button', {name: 'Maßnahme speichern'}).first().click();
 await expect(page.locator('#operations-message')).toHaveText('Eine Maßnahme wird freiwillig erst ab 3 Zeichen gespeichert. Die Messung und die offene Warnung bleiben unverändert.');
 await expect(alerts.locator('[data-alert-id="alert-chlor"]')).toContainText('Offene Warnung: Freies Chlor 0.10 mg/l');
 await expect(alerts.locator('[data-alert-id="alert-old"]')).toBeVisible();
 await expect(kinder.locator('td.is-breach')).toHaveCount(2);

 await history.getByRole('button', {name: 'Letzte 7 Tage'}).click();
 await expect(history.getByRole('button', {name: 'Letzte 7 Tage'})).toHaveAttribute('aria-pressed', 'true');
 await expect(history.locator('h4')).toHaveText(['Kinderbecken', 'Schwimmerbecken']);
 await expect(history).toContainText('7.10');
 await history.getByRole('button', {name: 'Letzte 30 Tage'}).click();
 await expect(history).toContainText('7.00');
 await expect(history).not.toContainText('6.90');
 await history.locator('#water-history-pool').selectOption('pool-kinder');
 await expect(history.getByRole('button', {name: 'Letzte 30 Tage'})).toHaveAttribute('aria-pressed', 'true');
 await expect(history.locator('h4')).toHaveText(['Kinderbecken']);
 await expect(history).not.toContainText('7.00');
 const customFrom = addCalendarDays(today, -40);
 await history.locator('#water-history-from').fill(customFrom);
 await expect(history.getByRole('button', {name: 'Benutzerdefiniert'})).toHaveAttribute('aria-pressed', 'true');
 await expect(history).toContainText('6.90');
 await history.getByRole('button', {name: 'Heute'}).click();
 await expect(history.locator('#water-history-pool')).toHaveValue('pool-kinder');
 await expect(history.locator('h4')).toHaveText(['Kinderbecken']);

 await timeButton.click();
 await expect(timeButton).toHaveAttribute('aria-pressed', 'true');
 await expect(poolButton).toHaveAttribute('aria-pressed', 'false');
 await expect(history.locator('h4')).toHaveCount(0);
 await expect(history.locator('table')).toHaveCount(1);
 await expect(history.locator('td.is-breach')).toHaveCount(2);
 const stored = await page.evaluate(() => localStorage.getItem('tageswerk-water-history-view'));
 expect(stored).toBe('time');
 await page.locator('[data-operation="temperature"]').click();
 await page.locator('[data-operation="water"]').click();
 await expect(page.locator('#water-history').getByRole('button', {name: 'Nach Uhrzeit'})).toHaveAttribute('aria-pressed', 'true');
 await expect(page.locator('#water-history').getByRole('button', {name: 'Heute'})).toHaveAttribute('aria-pressed', 'true');
 await expect(page.locator('#water-history h4')).toHaveCount(0);
 await page.locator('#water-history').getByRole('button', {name: 'Nach Becken'}).click();
 await expect(page.locator('#water-history h4')).toHaveText(['Kinderbecken', 'Schwimmerbecken']);
});
