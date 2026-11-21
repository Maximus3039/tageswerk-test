import assert from 'node:assert/strict';
import test from 'node:test';
import {state} from '../../js/state.js';
import {isManager,mergedStaffActive} from '../../js/permissions.js';

const organization = 'org-a';
const facility = {id: 'fac-a', organization_id: organization};
const otherFacility = {id: 'fac-b', organization_id: organization};
const foreignFacility = {id: 'fac-c', organization_id: 'org-b'};

test('Betriebsleitung und Geschäftsführung bleiben auf ihre Organisation begrenzt', () => {
 state.myMemberships = [
  {organization_id: organization, facility_id: facility.id, role: 'facility_manager', is_active: true}
 ];
 assert.equal(isManager(facility), true);
 assert.equal(isManager(otherFacility), false);
 assert.equal(isManager(foreignFacility), false);

 state.myMemberships = [
  {organization_id: organization, facility_id: null, role: 'company_admin', is_active: true}
 ];
 assert.equal(isManager(facility), true);
 assert.equal(isManager(otherFacility), true);
 assert.equal(isManager(foreignFacility), false);
});

test('Standortbearbeitung bleibt Mitarbeiterinnen und Mitarbeitern verwehrt', () => {
 state.myMemberships = [
  {organization_id: organization, facility_id: facility.id, role: 'employee', is_active: true}
 ];
 assert.equal(isManager(facility), false);
 state.myMemberships = [
  {organization_id: organization, facility_id: facility.id, role: 'facility_manager', is_active: true}
 ];
 assert.equal(isManager(facility), true);
});

test('Mitarbeiter und deaktivierte Leitungen verwalten den Betrieb nicht', () => {
 state.myMemberships = [
  {organization_id: organization, facility_id: facility.id, role: 'employee', is_active: true}
 ];
 assert.equal(isManager(facility), false);

 state.myMemberships = [
  {organization_id: organization, facility_id: facility.id, role: 'technician', is_active: true}
 ];
 assert.equal(isManager(facility), false);
 assert.equal(isManager(otherFacility), false);

 state.myMemberships = [
  {organization_id: organization, facility_id: facility.id, role: 'facility_manager', is_active: false}
 ];
 assert.equal(isManager(facility), false);

 state.myMemberships = [
  {organization_id: organization, facility_id: null, role: 'company_admin', is_active: false}
 ];
 assert.equal(isManager(facility), false);
 assert.equal(isManager(otherFacility), false);
});

test('Nur eine ausdrückliche Aktivmitgliedschaft berechtigt zur Verwaltung', () => {
 state.myMemberships = [
  {organization_id: organization, facility_id: facility.id, role: 'facility_manager', is_active: null}
 ];
 assert.equal(isManager(facility), false);

 state.myMemberships = [
  {organization_id: organization, facility_id: null, role: 'company_admin', is_active: null}
 ];
 assert.equal(isManager(facility), false);

 state.myMemberships = [
  {organization_id: organization, facility_id: facility.id, role: 'company_admin', is_active: true}
 ];
 assert.equal(isManager(facility), false);
 assert.equal(isManager(otherFacility), false);
 assert.equal(isManager(foreignFacility), false);
});

test('RPC-Merge behält is_active und organization_id ohne RPC-Boolean (F-01/F-02)', () => {
 assert.equal(mergedStaffActive(undefined, true), true);
 assert.equal(mergedStaffActive(null, true), true);
 assert.equal(mergedStaffActive(undefined, undefined), true);
 assert.equal(mergedStaffActive(false, true), false);
 assert.equal(mergedStaffActive(true, false), true);
 assert.equal(mergedStaffActive(undefined, false), false);

 // Simulierter Merge wie in loadPermissionData: RPC ohne is_active / ohne Org-Map-Treffer
 const previous = {
  user_id: 'emp-a1',
  organization_id: organization,
  facility_id: facility.id,
  role: 'employee',
  is_active: true
 };
 const rpcRow = {
  user_id: 'emp-a1',
  facility_id: facility.id,
  role: 'employee',
  full_name: 'emp-a1',
  email: 'emp-a1@test.tageswerk.local'
 };
 const orgByFacility = new Map([[facility.id, organization]]);
 const record = {
  user_id: rpcRow.user_id,
  organization_id: orgByFacility.get(rpcRow.facility_id) ?? previous.organization_id,
  facility_id: rpcRow.facility_id,
  role: rpcRow.role,
  email: rpcRow.email,
  is_active: mergedStaffActive(rpcRow.is_active, previous.is_active)
 };
 assert.equal(record.is_active, true);
 assert.equal(record.organization_id, organization);
 assert.equal(record.role, 'employee');

 const adminPrevious = {
  user_id: 'admin-a',
  organization_id: organization,
  facility_id: null,
  role: 'company_admin',
  is_active: true
 };
 const adminRpc = {user_id: 'admin-a', facility_id: null, role: 'company_admin', email: 'admin-a@test.tageswerk.local'};
 const adminRecord = {
  organization_id: orgByFacility.get(adminRpc.facility_id) ?? adminPrevious.organization_id,
  is_active: mergedStaffActive(adminRpc.is_active, adminPrevious.is_active)
 };
 assert.equal(adminRecord.is_active, true);
 assert.equal(adminRecord.organization_id, organization);
});
