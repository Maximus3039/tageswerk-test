import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {
 figureWeekday,
 compareCalendarDay,
 createDailyReport,
 dayFigureAccess,
 dayFigureEditable,
 dayFigureEntryError,
 dayFigureOverview,
 dayFigurePayload,
 dayFigurePeriods,
 emptyOperations,
 figurePercent,
 historicalFigureError,
 historicalFigurePayload,
 parseVisitors
} from '../../js/operations.js';
import {figureRpcArgs, figuresMissing, figuresStorageMessage, saveDayFigures} from '../../js/operations-store.js';

const facility = {id: 'fac-a', organization_id: 'org-a', name: 'Bad'};
const otherFacility = {id: 'fac-b', organization_id: 'org-a', name: 'Zweites Bad'};
const foreignFacility = {id: 'fac-x', organization_id: 'org-x', name: 'Fremd'};
const membership = (role, target = facility) => ({
 organization_id: target.organization_id,
 facility_id: role === 'company_admin' ? null : target.id,
 role,
 is_active: true
});
const employee = {userId: 'employee-1', name: 'Mia', memberships: [membership('employee')]};
const manager = {userId: 'manager-1', name: 'Lea', memberships: [membership('facility_manager')]};
const admin = {userId: 'admin-1', name: 'Kim', memberships: [membership('company_admin')]};
const technician = {userId: 'tech-1', name: 'Tim', memberships: [membership('technician')]};
const sql = readFileSync(new URL('../../tageswerk_3_5_4_day_figures.sql', import.meta.url), 'utf8');
const hotfix = readFileSync(new URL('../../tageswerk_3_5_4_day_figures_hotfix.sql', import.meta.url), 'utf8');
const schemaReload = readFileSync(new URL('../../tageswerk_3_5_4_day_figures_schema_reload.sql', import.meta.url), 'utf8');

test('Tageskennzahlen rechnen Vergleich, Prozent und getrennte Zeiträume', () => {
 assert.equal(compareCalendarDay('2026-11-14'), '2025-11-15');
 assert.equal(figureWeekday('2026-11-14').weekend, 'saturday');
 assert.equal(figureWeekday('2026-11-15').weekend, 'sunday');
 assert.equal(figureWeekday('2026-11-13').weekend, '');
 assert.equal(figurePercent(610, 541).label, '+12,8 %');
 assert.equal(figurePercent(520500, 485000).label, '+7,3 %');
 assert.equal(figurePercent(10, 10).label, '0,0 %');
 assert.equal(figurePercent(4, 5).tone, 'down');
 assert.equal(figurePercent(8, null).label, 'Keine Vergleichsdaten');
 assert.equal(figurePercent(8, 0).label, 'Nicht berechenbar');
 assert.equal(figurePercent(81, 80).label, '+1,3 %');
 assert.equal(figurePercent(79, 80).label, '-1,3 %');
 assert.equal(figurePercent(9, 8).label, '+12,5 %');
 assert.equal(figurePercent(7, 8).label, '-12,5 %');
 assert.equal(figurePercent(10124, 10000).label, '+1,2 %');
 assert.equal(figurePercent(9876, 10000).label, '-1,2 %');
 assert.equal(figurePercent(10126, 10000).label, '+1,3 %');
 assert.equal(figurePercent(9874, 10000).label, '-1,3 %');
 assert.equal(figurePercent(2001, 2000).label, '+0,1 %');
 assert.equal(figurePercent(1999, 2000).label, '-0,1 %');
 assert.equal(figurePercent(2501, 2500).label, '0,0 %');
 assert.equal(figurePercent(2499, 2500).label, '0,0 %');
 assert.equal(figurePercent(2501, 2500).tone, 'flat');
 assert.equal(figurePercent(2499, 2500).tone, 'flat');
 assert.equal(parseVisitors('-1').ok, false);
 assert.equal(parseVisitors('1,5').ok, false);
 const records = [
  {day: '2026-11-01', visitors: 10, totalCents: 1000, gateCents: null, bistroCents: null},
  {day: '2026-11-02', visitors: 20, totalCents: 2000, gateCents: null, bistroCents: null},
  {day: '2025-11-01', visitors: 10, totalCents: 500, gateCents: null, bistroCents: null},
  {day: '2025-11-02', visitors: 10, totalCents: 500, gateCents: null, bistroCents: null}
 ];
 const periods = dayFigurePeriods(records, '2026-11-02', 'manager');
 assert.equal(periods.month.visitors.state, 'complete');
 assert.equal(periods.month.visitors.change.label, '+50,0 %');
 assert.equal(periods.month.total.state, 'complete');
 assert.equal(periods.month.total.change.label, '+200,0 %');
 assert.equal(periods.month.gate.state, 'incomplete');
 assert.equal(periods.month.gate.missing, 4);
 assert.equal(periods.year.visitors.state, 'incomplete');
 const employeePeriods = dayFigurePeriods(records, '2026-11-02', 'employee');
 assert.equal(employeePeriods.month.visitors.current, undefined);
 assert.equal(employeePeriods.month.total.prior, undefined);
 assert.equal(employeePeriods.month.gate, undefined);
 assert.equal(employeePeriods.month.visitors.change.label, '+50,0 %');
 const overview = dayFigureOverview(records, {access: 'employee', today: '2026-11-02'});
 assert.equal(overview.rows.length, 7);
 assert.equal(Object.hasOwn(overview.rows[0], 'totalCents'), false);
 assert.equal(Object.hasOwn(overview.rows[0], 'priorVisitors'), false);
 assert.equal(Object.hasOwn(overview.rows[0], 'gateCents'), false);
 assert.equal(Object.hasOwn(overview.rows[0], 'priorTotalCents'), false);
 const managerRows = dayFigureOverview(records, {access: 'manager', today: '2026-11-02', from: '2026-11-01', to: '2026-11-02', weekday: 'all'});
 assert.equal(managerRows.rows[0].day, '2026-11-02');
 assert.equal(managerRows.rows[0].totalCents, 2000);
 const saturday = dayFigureOverview([{day: '2026-11-14', visitors: 3, totalCents: 100}], {access: 'manager', today: '2026-11-15', from: '2026-11-14', to: '2026-11-15', weekday: 'saturday'});
 assert.deepEqual(saturday.rows.map(row => row.day), ['2026-11-14']);
});

test('Mitarbeiter, Techniker und Leitung bleiben bei den Kennzahlen getrennt', () => {
 assert.equal(dayFigureAccess(facility, employee.memberships), 'employee');
 assert.equal(dayFigureAccess(facility, manager.memberships), 'manager');
 assert.equal(dayFigureAccess(facility, admin.memberships), 'manager');
 assert.equal(dayFigureAccess(facility, technician.memberships), 'none');
 assert.equal(dayFigureAccess(facility, [...technician.memberships, ...employee.memberships]), 'employee');
 assert.equal(dayFigureAccess(otherFacility, employee.memberships), 'none');
 assert.equal(dayFigureAccess(foreignFacility, manager.memberships), 'none');
 assert.equal(dayFigureAccess(foreignFacility, admin.memberships), 'none');
 assert.equal(dayFigureAccess(otherFacility, manager.memberships), 'none');
 assert.equal(dayFigureAccess(otherFacility, admin.memberships), 'manager');
 assert.equal(dayFigureEditable('employee', '2026-11-08', '2026-11-14'), true);
 assert.equal(dayFigureEditable('employee', '2026-11-07', '2026-11-14'), false);
 assert.equal(dayFigureEditable('manager', '2024-01-01', '2026-11-14'), true);
 assert.equal(dayFigureEditable('none', '2026-11-14', '2026-11-14'), false);
 assert.match(dayFigureEntryError({day: '2026-11-14', visitors: '-2', gate: '1,00', bistro: '1,00'}, 'employee', '2026-11-14'), /ganze Zahl/);
 assert.match(dayFigureEntryError({day: '2026-11-14', visitors: '2', gate: '-1,00', bistro: '1,00'}, 'employee', '2026-11-14'), /0,00/);
 assert.match(dayFigureEntryError({day: '2026-11-07', visitors: '2', gate: '1,00', bistro: '1,00'}, 'employee', '2026-11-14'), /sieben Tage/);
 assert.match(dayFigureEntryError({day: '2026-11-14', visitors: '2', gate: '1,00', bistro: '1,00'}, 'none', '2026-11-14'), /Keine Berechtigung/);
 const saved = dayFigurePayload({day: '2026-11-14', visitors: '610', gate: '40,00', bistro: '12,05'}, 'employee', '2026-11-14');
 assert.equal(saved.ok, true);
 assert.equal(saved.totalCents, 5205);
 assert.match(historicalFigureError({day: '2024-05-01', visitors: '10', total: '8,00'}, 'employee', '2026-11-14'), /Geschäftsführung/);
 const historic = historicalFigurePayload({day: '2024-05-01', visitors: '10', total: '8,00', gate: '', bistro: ''}, 'manager', '2026-11-14');
 assert.equal(historic.ok, true);
 assert.equal(historic.gateCents, null);
 assert.equal(historic.totalCents, 800);
 assert.match(historicalFigureError({day: '2024-05-01', visitors: '10', gate: '1,00', bistro: '', total: ''}, 'manager', '2026-11-14'), /nicht ergänzt/);
 const narrative = createDailyReport(emptyOperations(), {facility, reportDate: '2026-11-14', incidents: 'Ruhiger Tag', handover: ''}, employee, '2026-11-14T10:00:00.000Z');
 assert.equal(narrative.ok, true);
 assert.equal(narrative.report.incidents, 'Ruhiger Tag');
 const technicianNarrative = createDailyReport(emptyOperations(), {facility, reportDate: '2026-11-14', incidents: 'Technikprüfung', handover: ''}, technician, '2026-11-14T10:00:00.000Z');
 assert.equal(technicianNarrative.ok, true);
});

test('Die Speicherung prüft lokal und ruft die Kennzahlenfunktion auf', async () => {
 const calls = [];
 const db = {rpc(name, args) {
  calls.push([name, args]);
  return Promise.resolve({data: {id: 'figure-1', service_day: args.p_service_day, total_cents: args.p_total_cents}, error: null});
 }};
 const denied = await saveDayFigures(db, {facility, access: 'none', day: '2026-11-14', visitors: '1', gate: '1,00', bistro: '1,00', source: 'erfassung'}, technician, '2026-11-14');
 assert.equal(denied.ok, false);
 assert.equal(calls.length, 0);
 const saved = await saveDayFigures(db, {facility, access: 'employee', day: '2026-11-14', visitors: '4', gate: '2,50', bistro: '1,25', source: 'erfassung'}, employee, '2026-11-14');
 assert.equal(saved.ok, true, saved.error);
 assert.equal(calls[0][0], 'tageswerk_save_day_figures');
 assert.equal(calls[0][1].p_facility_id, facility.id);
 assert.equal(calls[0][1].p_service_day, '2026-11-14');
 assert.equal(calls[0][1].p_visitors, 4);
 assert.equal(calls[0][1].p_gate_cents, '250');
 assert.equal(calls[0][1].p_bistro_cents, '125');
 assert.equal(calls[0][1].p_total_cents, '375');
 assert.equal(typeof calls[0][1].p_gate_cents, 'string');
 assert.equal(typeof calls[0][1].p_bistro_cents, 'string');
 assert.equal(typeof calls[0][1].p_total_cents, 'string');
 assert.equal(calls[0][1].p_source, 'erfassung');
 assert.deepEqual(figureRpcArgs({facility, day: '2026-11-14', changeNote: ''}, {
  visitors: 4,
  gateCents: 250,
  bistroCents: 125,
  totalCents: 375,
  source: 'erfassung'
 }), calls[0][1]);
 const missingFacility = await saveDayFigures(db, {facility: {name: 'Ohne Id'}, access: 'manager', day: '2026-11-14', visitors: '4', gate: '2,50', bistro: '1,25', source: 'erfassung'}, manager, '2026-11-14');
 assert.equal(missingFacility.ok, false);
 assert.match(missingFacility.error, /Betrieb auswählen/);
 assert.equal(calls.length, 1);
});

test('Kennzahlen-RPC-Argumente bleiben als Text-Cents stabil', () => {
 const args = figureRpcArgs({facility, day: '2026-11-14', changeNote: 'Korrektur'}, {
  visitors: 9,
  gateCents: 0,
  bistroCents: null,
  totalCents: 100,
  source: 'import'
 });
 assert.equal(args.p_gate_cents, '0');
 assert.equal(args.p_bistro_cents, null);
 assert.equal(args.p_total_cents, '100');
 assert.equal(args.p_change_note, 'Korrektur');
 assert.equal(args.p_source, 'import');
 assert.notEqual(typeof args.p_gate_cents, 'number');
 assert.notEqual(typeof args.p_total_cents, 'number');
});

test('Speicherfehler unterscheiden fehlende Migration, Schema-Cache und Berechtigung', async () => {
 const cacheError = {
  code: 'PGRST202',
  message: 'Could not find the function public.tageswerk_save_day_figures(p_facility_id, p_service_day, p_visitors, p_gate_cents, p_bistro_cents, p_total_cents, p_change_note, p_source) in the schema cache',
  details: 'Searched for the function public.tageswerk_save_day_figures with parameter p_facility_id or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.',
  hint: null
 };
 assert.equal(figuresMissing(cacheError), false);
 assert.match(figuresStorageMessage(cacheError), /Schema-Cache|API noch nicht freigeschaltet/);
 assert.doesNotMatch(figuresStorageMessage(cacheError), /noch nicht in der Datenbank installiert/);

 const missingError = {code: '42883', message: 'function public.tageswerk_save_day_figures(uuid, date, integer, bigint, bigint, bigint, text, text) does not exist'};
 assert.equal(figuresMissing(missingError), true);
 assert.match(figuresStorageMessage(missingError), /noch nicht in der Datenbank installiert/);

 const permissionError = {code: 'P0001', message: 'Keine Berechtigung für die Tageskennzahlen.'};
 assert.equal(figuresMissing(permissionError), false);
 assert.match(figuresStorageMessage(permissionError), /Keine Berechtigung für die Tageskennzahlen/);

 const cache = await saveDayFigures({rpc() {
  return Promise.resolve({data: null, error: cacheError});
 }}, {facility, access: 'manager', day: '2026-11-14', visitors: '4', gate: '2,50', bistro: '1,25', source: 'erfassung'}, manager, '2026-11-14');
 assert.equal(cache.ok, false);
 assert.match(cache.error, /Schema-Cache|API noch nicht freigeschaltet/);
 assert.doesNotMatch(cache.error, /noch nicht in der Datenbank installiert/);

 const missing = await saveDayFigures({rpc() {
  return Promise.resolve({data: null, error: missingError});
 }}, {facility, access: 'manager', day: '2026-11-14', visitors: '4', gate: '2,50', bistro: '1,25', source: 'erfassung'}, manager, '2026-11-14');
 assert.match(missing.error, /noch nicht in der Datenbank/);

 const denied = await saveDayFigures({rpc() {
  return Promise.resolve({data: null, error: permissionError});
 }}, {facility, access: 'manager', day: '2026-11-14', visitors: '4', gate: '2,50', bistro: '1,25', source: 'erfassung'}, manager, '2026-11-14');
 assert.match(denied.error, /Keine Berechtigung/);
});

test('Die Migration schützt Beträge und lässt die Textberichte stehen', () => {
 assert.match(sql, /Nicht ohne ausdrückliche Freigabe ausführen/);
 assert.match(sql, /UNIQUE \(facility_id, service_day\)/);
 assert.match(sql, /gate_cents \+ bistro_cents/);
 assert.match(sql, /FOREIGN KEY \(facility_id, organization_id\)\s+REFERENCES public\.facilities \(id, organization_id\)/);
 assert.match(sql, /tageswerk_meter_role\(organization_id, facility_id\) IN \('facility_manager', 'company_admin'\)/);
 assert.match(sql, /role IN \('employee', 'facility_manager', 'company_admin'\)/);
 assert.doesNotMatch(sql, /role IN \('employee', 'technician'/);
 assert.doesNotMatch(sql, /WHEN 'technician'/);
 assert.match(sql, /Eine reine Technikermitgliedschaft bleibt hier ohne Rolle/);
 assert.match(sql, /berlin - 6/);
 assert.match(sql, /day - 364/);
 assert.match(sql, /priorVisitors/);
 assert.match(sql, /visitors := visitors - 'current' - 'prior'/);
 assert.match(sql, /total := total - 'current' - 'prior'/);
 assert.doesNotMatch(sql, /ALTER TABLE public\.daily_reports/);
 assert.match(sql, /Bitte den Grund der Änderung mit mindestens 3 Zeichen eintragen/);
 assert.match(sql, /Dieselbe Rundung wie figurePercent/);
 assert.match(sql, /remainder \* 2 >= denominator/);
 assert.doesNotMatch(sql, /pg_catalog\.round\(/);
 assert.match(sql, /pg_catalog\.date_part\('isodow', day\)/);
 assert.match(sql, /pg_catalog\.date_part\('month', prior_anchor\)/);
 assert.match(sql, /pg_catalog\.date_part\('day', prior_anchor\)/);
 assert.doesNotMatch(sql, /pg_catalog\.extract\(/);
 assert.doesNotMatch(sql, /ISODOW FROM/);
 assert.match(sql, /CREATE SCHEMA IF NOT EXISTS tageswerk_private/);
 assert.match(sql, /REVOKE ALL ON SCHEMA tageswerk_private FROM PUBLIC, anon, authenticated/);
 assert.match(sql, /FUNCTION tageswerk_private\.figure_measure/);
 assert.match(sql, /tageswerk_private\.figure_measure\(/);
 assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.tageswerk_figure_measure/);
 assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION tageswerk_private\.figure_measure/);
 assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\.tageswerk_figure_measure/);
 assert.doesNotMatch(sql, /pg_catalog\.coalesce\s*\(/);
 assert.doesNotMatch(sql, /pg_catalog\.least\s*\(/);
 assert.doesNotMatch(sql, /pg_catalog\.greatest\s*\(/);
 assert.match(sql, /COALESCE\(pg_catalog\.current_setting\('tageswerk\.figure_note', true\), ''\)/);
 assert.match(sql, /COALESCE\(p_source, 'erfassung'\)/);
 assert.match(sql, /COALESCE\(p_change_note, ''\)/);
 assert.match(sql, /LEAST\(COALESCE\(p_to, berlin\), berlin\)/);
 assert.match(sql, /GREATEST\(COALESCE\(p_from, last_day - 30\), last_day - 399\)/);
 assert.match(sql, /COALESCE\(p_weekday, 'all'\)/);
});

test('Der COALESCE-Hotfix ersetzt nur die betroffenen Kennzahlenfunktionen', () => {
 assert.match(hotfix, /Nicht ohne ausdr\u00fcckliche Freigabe ausf\u00fchren/);
 assert.match(hotfix, /^BEGIN;/m);
 assert.match(hotfix, /^COMMIT;/m);
 assert.match(hotfix, /CREATE OR REPLACE FUNCTION public\.tageswerk_audit_day_figure\(\)/);
 assert.match(hotfix, /CREATE OR REPLACE FUNCTION public\.tageswerk_save_day_figures\(/);
 assert.match(hotfix, /CREATE OR REPLACE FUNCTION public\.tageswerk_day_figure_overview\(/);
 assert.doesNotMatch(hotfix, /CREATE TABLE/);
 assert.doesNotMatch(hotfix, /ALTER TABLE/);
 assert.doesNotMatch(hotfix, /CREATE POLICY/);
 assert.doesNotMatch(hotfix, /DROP /);
 assert.doesNotMatch(hotfix, /GRANT /);
 assert.doesNotMatch(hotfix, /pg_catalog\.coalesce\s*\(/);
 assert.doesNotMatch(hotfix, /pg_catalog\.least\s*\(/);
 assert.doesNotMatch(hotfix, /pg_catalog\.greatest\s*\(/);
 assert.match(hotfix, /COALESCE\(p_source, 'erfassung'\)/);
 assert.match(hotfix, /LEAST\(COALESCE\(p_to, berlin\), berlin\)/);
 assert.match(schemaReload, /NOTIFY pgrst, 'reload schema'/);
 assert.match(schemaReload, /Nicht ohne ausdr\u00fcckliche Freigabe ausf\u00fchren/);
});

test('Die Migration sperrt Zuordnung, Herkunft und Revisionsmanipulation', () => {
 assert.match(sql, /FORCE ROW LEVEL SECURITY/);
 assert.match(sql, /GRANT UPDATE \(visitors, gate_cents, bistro_cents, total_cents\) ON TABLE public\.facility_day_figures TO authenticated/);
 assert.doesNotMatch(sql, /GRANT UPDATE ON TABLE public\.facility_day_figures TO authenticated/);
 assert.match(sql, /REVOKE ALL ON TABLE public\.facility_day_figures FROM PUBLIC, anon, authenticated/);
 assert.match(sql, /REVOKE ALL ON TABLE public\.facility_day_figure_revisions FROM PUBLIC, anon, authenticated/);
 assert.match(sql, /GRANT SELECT ON TABLE public\.facility_day_figure_revisions TO authenticated/);
 assert.doesNotMatch(sql, /GRANT INSERT ON TABLE public\.facility_day_figure_revisions/);
 assert.doesNotMatch(sql, /GRANT UPDATE ON TABLE public\.facility_day_figure_revisions/);
 assert.doesNotMatch(sql, /GRANT DELETE ON TABLE public\.facility_day_figure_revisions/);
 assert.doesNotMatch(sql, /CREATE POLICY facility_day_figure_revisions_insert/);
 assert.doesNotMatch(sql, /CREATE POLICY facility_day_figure_revisions_update/);
 assert.doesNotMatch(sql, /CREATE POLICY facility_day_figure_revisions_delete/);
 assert.match(sql, /CREATE OR REPLACE FUNCTION public\.tageswerk_guard_day_figure/);
 assert.match(sql, /Betrieb, Organisation und Herkunft eines Kennzahlentages bleiben unveränderlich/);
 assert.match(sql, /NEW\.facility_id IS DISTINCT FROM OLD\.facility_id/);
 assert.match(sql, /NEW\.organization_id IS DISTINCT FROM OLD\.organization_id/);
 assert.match(sql, /NEW\.created_by IS DISTINCT FROM OLD\.created_by/);
 assert.match(sql, /NEW\.source IS DISTINCT FROM OLD\.source/);
 assert.match(sql, /NEW\.imported_at IS DISTINCT FROM OLD\.imported_at/);
 assert.match(sql, /NEW\.imported_by IS DISTINCT FROM OLD\.imported_by/);
 assert.match(sql, /NEW\.service_day IS DISTINCT FROM OLD\.service_day/);
 assert.match(sql, /CREATE TRIGGER facility_day_figures_guard/);
 assert.match(sql, /m\.facility_id = p_facility_id/);
 assert.match(sql, /m\.organization_id = organization/);
 assert.match(sql, /company_admin' AND m\.facility_id IS NULL/);
 assert.match(sql, /WHERE facility_id = p_facility_id AND service_day = day/);
 assert.match(sql, /UPDATE public\.facility_day_figures\s+SET visitors = next_visitors,\s+gate_cents = next_gate,\s+bistro_cents = next_bistro,\s+total_cents = next_total\s+WHERE id = existing\.id/s);
 assert.doesNotMatch(sql, /UPDATE public\.facility_day_figures\s+SET[^(]*\b(facility_id|organization_id|created_by|source)\s*=/);
 assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\.tageswerk_audit_day_figure/);
 assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\.tageswerk_guard_day_figure/);
 assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\.tageswerk_figure_role/);
});
