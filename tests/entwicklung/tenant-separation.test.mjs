import assert from 'node:assert/strict';
import test from 'node:test';
import {state} from '../../js/state.js';
import {isManager} from '../../js/permissions.js';
import {membershipAllowsMeterAdmin, membershipAllowsMeterReading} from '../../js/meters.js';
import {mappingPermission} from '../../js/meter-import.js';

const userId = 'user-1';
const orgA = 'org-a';
const orgB = 'org-b';
const facilityA = {id: 'fac-a', organization_id: orgA};
const facilityB = {id: 'fac-b', organization_id: orgA};
const foreign = {id: 'fac-c', organization_id: orgB};

function membership(role, facility, active = true) {
 return {
  user_id: userId,
  organization_id: facility.organization_id,
  facility_id: role === 'company_admin' ? null : facility.id,
  role,
  is_active: active
 };
}

function meterRole(memberships, facility) {
 const rank = {company_admin: 1, facility_manager: 2, employee: 3};
 const matches = (memberships || [])
  .filter(item => item.user_id === userId && item.is_active === true && item.organization_id === facility.organization_id && (
   (item.role === 'company_admin' && item.facility_id == null)
   || (item.role === 'facility_manager' && item.facility_id === facility.id)
   || (item.role === 'employee' && item.facility_id === facility.id)
  ))
  .sort((left, right) => rank[left.role] - rank[right.role]);
 return matches[0]?.role || null;
}

function restore() {
 state.currentUser = null;
 state.myMemberships = [];
}

test('Die Datenbankrolle gilt nur für die eigene Organisation und den eigenen Betrieb', () => {
 const manager = [membership('facility_manager', facilityA)];
 assert.equal(meterRole(manager, facilityA), 'facility_manager');
 assert.equal(meterRole(manager, facilityB), null);
 assert.equal(meterRole(manager, foreign), null);

 const employee = [membership('employee', facilityA)];
 assert.equal(meterRole(employee, facilityA), 'employee');
 assert.equal(meterRole(employee, facilityB), null);
 assert.equal(meterRole(employee, foreign), null);

 const admin = [membership('company_admin', facilityA)];
 assert.equal(meterRole(admin, facilityA), 'company_admin');
 assert.equal(meterRole(admin, facilityB), 'company_admin');
 assert.equal(meterRole(admin, foreign), null);
});

test('Eine inaktive oder an einen Betrieb gebundene Geschäftsführung erhält keine Zählerrolle', () => {
 assert.equal(meterRole([membership('facility_manager', facilityA, false)], facilityA), null);
 assert.equal(meterRole([{...membership('company_admin', facilityA), is_active: null}], facilityA), null);
 assert.equal(meterRole([{...membership('company_admin', facilityA), facility_id: facilityA.id}], facilityA), null);
 assert.equal(meterRole([membership('employee', facilityA), membership('company_admin', facilityA)], facilityA), 'company_admin');
});

test('Zählerrechte folgen der Datenbankrolle und nicht der weiteren Leitungsprüfung', () => {
 const admin = [membership('company_admin', facilityA)];
 const employee = [membership('employee', facilityA)];
 assert.equal(membershipAllowsMeterAdmin(facilityA, admin, userId), true);
 assert.equal(membershipAllowsMeterAdmin(foreign, admin, userId), false);
 assert.equal(membershipAllowsMeterAdmin(facilityA, employee, userId), false);
 assert.equal(membershipAllowsMeterReading(facilityA, employee, userId), true);
 assert.equal(membershipAllowsMeterReading(facilityB, employee, userId), false);
 assert.equal(membershipAllowsMeterReading(foreign, employee, userId), false);
 assert.equal(membershipAllowsMeterAdmin(facilityA, [membership('facility_manager', facilityA, false)], userId), false);
 assert.equal(membershipAllowsMeterAdmin(facilityA, [{...membership('company_admin', facilityA), facility_id: facilityA.id}], userId), false);
});

test('Die Oberfläche folgt der Zählerrolle', () => {
 const denied = 'Historische Importe darf die Betriebsleitung oder Geschäftsführung.';
 state.currentUser = {id: userId};
 state.myMemberships = [{...membership('facility_manager', facilityA), is_active: null}];
 assert.equal(isManager(facilityA), false);
 assert.equal(mappingPermission(facilityA), denied);

 state.myMemberships = [{...membership('company_admin', facilityA), facility_id: facilityA.id}];
 assert.equal(isManager(facilityA), false);
 assert.equal(isManager(facilityB), false);
 assert.equal(meterRole(state.myMemberships, facilityB), null);
 assert.equal(mappingPermission(facilityB), denied);

 state.myMemberships = [membership('company_admin', facilityA)];
 assert.equal(isManager(facilityA), true);
 assert.equal(isManager(facilityB), true);
 assert.equal(isManager(foreign), false);
 assert.equal(mappingPermission(facilityB), '');

 state.myMemberships = [membership('employee', facilityA)];
 assert.equal(isManager(facilityA), false);
 assert.equal(mappingPermission(facilityA), denied);
 assert.equal(mappingPermission(foreign), denied);
 restore();
});

test('Die Geschäftsführung verwaltet alle Betriebe ihrer Organisation', () => {
 state.myMemberships = [membership('company_admin', facilityA)];
 assert.equal(isManager(facilityA), true);
 assert.equal(isManager(facilityB), true);
 assert.equal(isManager(foreign), false);
 state.myMemberships = [membership('company_admin', facilityA, false)];
 assert.equal(isManager(facilityA), false);
 state.myMemberships = [{...membership('company_admin', facilityA), is_active: null}];
 assert.equal(isManager(facilityA), false);
 state.myMemberships = [{...membership('company_admin', facilityA), facility_id: facilityA.id}];
 assert.equal(isManager(facilityB), false);
 state.myMemberships = [membership('facility_manager', facilityA)];
 assert.equal(isManager(facilityA), true);
 assert.equal(isManager(facilityB), false);
 state.myMemberships = [membership('facility_manager', facilityA, false)];
 assert.equal(isManager(facilityA), false);
 state.myMemberships = [membership('employee', facilityA)];
 assert.equal(isManager(facilityA), false);
 restore();
});

test('Mitarbeiter bleiben beim eigenen Betrieb und ohne Leitungshandlung', () => {
 const employee = [membership('employee', facilityA)];
 assert.equal(meterRole(employee, facilityA), 'employee');
 assert.equal(membershipAllowsMeterReading(facilityA, employee, userId), true);
 assert.equal(membershipAllowsMeterAdmin(facilityA, employee, userId), false);
 assert.equal(membershipAllowsMeterReading(facilityB, employee, userId), false);
 assert.equal(meterRole(employee, foreign), null);
 state.currentUser = {id: userId};
 state.myMemberships = employee;
 assert.equal(isManager(facilityA), false);
 assert.equal(mappingPermission(facilityA), 'Historische Importe darf die Betriebsleitung oder Geschäftsführung.');
 restore();
});
