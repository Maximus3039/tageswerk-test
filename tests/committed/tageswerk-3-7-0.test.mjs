import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {tariffRegisterFromLabel} from '../../js/meters-domain.js';
import {facilityTileConfig, moveFacilityId} from '../../js/dashboard-layouts.js';
import {chartSvg, statisticsRange, statisticsSummary, weekBounds} from '../../js/statistics.js';
import {importChunks, mapImportRows, VISITOR_IMPORT_LIMIT} from '../../js/visitor-import.js';
import {acknowledgeNotice, readNoticeAcks, sortNotices, writeNoticeAcks} from '../../js/notifications.js';
import {createManagedFacility} from '../../js/facilities-admin.js';
import {matchesDefectQuery, openStatuses} from '../../js/defects.js';
import {analyticsWindow} from '../../js/consumption-analytics.js';
import {state} from '../../js/state.js';

const vorpruefung = readFileSync(new URL('../../tageswerk_3_7_0_vorpruefung.sql', import.meta.url), 'utf8');
const createFacility = readFileSync(new URL('../../tageswerk_3_7_0_create_facility.sql', import.meta.url), 'utf8');
const notices = readFileSync(new URL('../../tageswerk_3_7_0_notice_acks.sql', import.meta.url), 'utf8');
const photos = readFileSync(new URL('../../tageswerk_3_7_0_defect_photos.sql', import.meta.url), 'utf8');
const indexHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const mgmt = readFileSync(new URL('../../js/management-dashboard.js', import.meta.url), 'utf8');
const figures = readFileSync(new URL('../../js/operations-ui-figures.js', import.meta.url), 'utf8');

test('3.7.0-Vorprüfung bleibt lesend', () => {
 assert.match(vorpruefung, /lesende Vorprüfung/);
 assert.doesNotMatch(vorpruefung, /^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|NOTIFY|DO)\b/im);
});

test('Neue Betriebe bleiben der Geschäftsführung vorbehalten', () => {
 assert.match(createFacility, /SET search_path = ''/);
 assert.match(createFacility, /role = 'company_admin'/);
 assert.match(createFacility, /facility_id IS NULL/);
 assert.doesNotMatch(createFacility, /GRANT INSERT ON TABLE public\.facilities/);
});

test('Hinweisquittungen und Fotometadaten bleiben mandantensicher', () => {
 assert.match(notices, /FORCE ROW LEVEL SECURITY/);
 assert.match(notices, /user_id = auth\.uid\(\)/);
 assert.doesNotMatch(notices, /FOR ALL TO authenticated/);
 assert.match(photos, /defect_photos\.facility_id/);
 assert.doesNotMatch(photos, /INSERT INTO storage\.buckets/);
});

test('Management-Kacheln nutzen Presets für Verbrauch und Status', () => {
 assert.equal(facilityTileConfig({preset: 'technique'}, 'a').showConsumption, true);
 assert.equal(facilityTileConfig({preset: 'visitors'}, 'a').showStatus, false);
 assert.deepEqual(moveFacilityId(['a', 'b', 'c'], 'b', -1), ['b', 'a', 'c']);
 assert.match(mgmt, /showConsumption/);
 assert.match(mgmt, /Betriebsstatus/);
 assert.match(indexHtml, /mgmt-show-consumption/);
});

test('Statistik kennt Woche und zählt fehlende Tage nicht als null', () => {
 const week = weekBounds('2026-11-21');
 assert.equal(week.from, '2026-11-16');
 assert.equal(statisticsRange('week', '2026-11-21').label, 'Woche');
 const summary = statisticsSummary([
  {day: '2026-11-16', visitors: 10, priorVisitors: 8, totalCents: 100, priorTotalCents: 80},
  {day: '2026-11-18', visitors: 12, priorVisitors: 9, totalCents: 120, priorTotalCents: 90}
 ], '2026-11-16', '2026-11-18');
 assert.equal(summary.visitors.state, 'incomplete');
 assert.match(chartSvg([{value: 1}, {value: 3}]), /polyline/);
});

test('Import teilt große Dateien in 800er-Blöcke', () => {
 const rows = Array.from({length: VISITOR_IMPORT_LIMIT + 2}, (_item, index) => ({Datum: '01.01.2025', Besucher: String(index + 1)}));
 const mapped = mapImportRows({headers: ['Datum', 'Besucher'], rows}, {day: 'Datum', visitors: 'Besucher', revenue: ''}, new Set(), {maxRows: Number.MAX_SAFE_INTEGER});
 assert.equal(mapped.ok, true);
 assert.equal(importChunks(mapped.rows).length, 2);
 assert.match(figures, /importDayFiguresBatch/);
 assert.match(figures, /Importhistorie/);
});

test('Stromtarife 1.8.1 und 1.8.2 bleiben HT und NT', () => {
 assert.equal(tariffRegisterFromLabel('Zähler 1.8.1'), 'HT');
 assert.equal(tariffRegisterFromLabel('Zähler 1.8.2'), 'NT');
 assert.equal(analyticsWindow('week', {y: 2026, m: 11, d: 21}).grain, 'day');
});

test('Mängelstatus bleibt open/in_progress/pending_review, nicht new/closed', () => {
 assert.deepEqual(openStatuses(), ['open', 'in_progress', 'pending_review']);
 assert.equal(matchesDefectQuery({title: 'Pumpe defekt', description: '', status: 'open'}, 'pumpe'), true);
 assert.match(indexHtml, /defect-due/);
});

test('In-App-Hinweise sind quittierbar und ohne E-Mail', () => {
 writeNoticeAcks('user-a', []);
 acknowledgeNotice('user-a', 'stock-low:1');
 assert.deepEqual(readNoticeAcks('user-a'), ['stock-low:1']);
 const sorted = sortNotices([{id: 'a', kind: 'defect-new', title: 'B'}, {id: 'b', kind: 'defect-overdue', title: 'A', warn: true}]);
 assert.equal(sorted[0].kind, 'defect-overdue');
});

test('facility-admin legt ohne company_admin nichts an', async () => {
 state.myMemberships = [{role: 'employee', is_active: true, organization_id: 'org', facility_id: 'f'}];
 state.organizations = [{id: 'org', name: 'Org'}];
 const denied = await createManagedFacility('org', 'Nord');
 assert.equal(denied.ok, false);
});
