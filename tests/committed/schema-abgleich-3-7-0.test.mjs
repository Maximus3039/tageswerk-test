import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {facilityVisibleToMember, isManager, membershipCoversFacility} from '../../js/permissions.js';
import {readingInsertPayload} from '../../js/meters-domain.js';
import {moreHubItems} from '../../js/mobile-ux.js';
import {state} from '../../js/state.js';

const prepare = readFileSync(new URL('../../tageswerk_3_7_0_test_prepare_reading.sql', import.meta.url), 'utf8');
const replace = readFileSync(new URL('../../tageswerk_3_7_0_test_replace_meter.sql', import.meta.url), 'utf8');
const acks = readFileSync(new URL('../../tageswerk_3_7_0_test_critical_acks.sql', import.meta.url), 'utf8');
const mappings = readFileSync(new URL('../../tageswerk_3_7_0_test_import_mappings.sql', import.meta.url), 'utf8');
const metersJs = readFileSync(new URL('../../js/meters-store.js', import.meta.url), 'utf8');
const importJs = readFileSync(new URL('../../js/meter-import-store.js', import.meta.url), 'utf8');
const opsJs = readFileSync(new URL('../../js/operations-store.js', import.meta.url), 'utf8');
const defectsJs = readFileSync(new URL('../../js/defects-store.js', import.meta.url), 'utf8');

test('Frontend ruft die erwarteten RPC-Namen auf', () => {
  assert.match(metersJs, /tageswerk_replace_utility_meter/);
  assert.match(metersJs, /tageswerk_consumption_calendar/);
  assert.match(importJs, /tageswerk_preview_historical_import/);
  assert.match(importJs, /tageswerk_commit_historical_import/);
  assert.match(importJs, /HISTORICAL_COMMIT_ENABLED=false/);
  assert.match(opsJs, /tageswerk_create_inspection_template/);
  assert.match(opsJs, /tageswerk_set_water_filter_active/);
  assert.match(defectsJs, /employee_update_assigned_defect/);
  assert.match(defectsJs, /tageswerk_archive_defect/);
});

test('TEST-Ablesefunktion setzt Reihe, Plausibilität und Mandantenrolle', () => {
  assert.match(prepare, /tageswerk_meter_role/);
  assert.match(prepare, /NEW\.series_id/);
  assert.match(prepare, /reading_type = 'reset'/);
  assert.match(prepare, /Der Zählerstand passt nicht zwischen die benachbarten Ablesungen/);
  assert.match(prepare, /Mitarbeiter erfassen normale Zählerstände/);
  assert.doesNotMatch(prepare, /DROP TABLE/);
  assert.doesNotMatch(prepare, /DELETE FROM public\.utility_meters/);
});

test('Zählerwechsel bleibt INVOKER und den Leitungsrollen vorbehalten', () => {
  assert.match(replace, /SECURITY INVOKER/);
  assert.match(replace, /company_admin/);
  assert.match(replace, /facility_manager/);
  assert.match(replace, /GRANT EXECUTE/);
  assert.doesNotMatch(replace, /SECURITY DEFINER/);
});

test('Kenntnisnahmen und Importzuordnungen haben FORCE RLS ohne anon', () => {
  assert.match(acks, /FORCE ROW LEVEL SECURITY/);
  assert.match(acks, /REVOKE ALL ON TABLE public\.critical_defect_acknowledgements FROM PUBLIC, anon/);
  assert.match(mappings, /FORCE ROW LEVEL SECURITY/);
  assert.match(mappings, /tageswerk_prepare_import_mapping/);
  assert.doesNotMatch(mappings, /CREATE OR REPLACE FUNCTION public\.tageswerk_commit_historical_import/);
});

test('Ablese-Payload speichert den Stand, nicht den Verbrauch', () => {
  const payload = readingInsertPayload('meter-1', {reading_value: '10', reading_at: '2026-11-21T08:00'});
  assert.equal(payload.reading_type, 'regular');
  assert.equal('consumption_value' in payload, false);
});

test('Rollen trennen Betriebe und Navigation', () => {
  const org = 'org-a';
  const nord = {id: 'fac-nord', organization_id: org, name: 'Nord'};
  const sued = {id: 'fac-sued', organization_id: org, name: 'Süd'};
  const fremd = {id: 'fac-x', organization_id: 'org-b', name: 'Fremd'};
  const manager = {organization_id: org, facility_id: nord.id, role: 'facility_manager', is_active: true};
  const employee = {organization_id: org, facility_id: nord.id, role: 'employee', is_active: true};
  const admin = {organization_id: org, facility_id: null, role: 'company_admin', is_active: true};

  assert.equal(membershipCoversFacility(nord, manager, false), true);
  assert.equal(membershipCoversFacility(sued, manager, false), false);
  assert.equal(membershipCoversFacility(fremd, admin, false), false);
  assert.equal(facilityVisibleToMember(nord, [employee]), true);
  assert.equal(facilityVisibleToMember(sued, [employee]), false);

  state.myMemberships = [employee];
  assert.equal(isManager(nord), false);
  const employeeMenu = moreHubItems(state.myMemberships, [nord]);
  assert.equal(employeeMenu.some(group => group.items.some(item => item.id === 'open-management-dashboard')), false);

  state.myMemberships = [admin];
  assert.equal(isManager(nord), true);
  const adminMenu = moreHubItems(state.myMemberships, [nord]);
  assert.equal(adminMenu.some(group => group.items.some(item => item.id === 'open-management-dashboard')), true);
});
