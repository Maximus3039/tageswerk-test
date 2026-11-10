import assert from 'node:assert/strict';
import test from 'node:test';
import {facilityVisibleToMember, mayAppointManager} from '../../js/permissions.js';

const organization = 'org-a';
const facility = {id: 'fac-a', organization_id: organization};
const otherFacility = {id: 'fac-b', organization_id: organization};
const foreignFacility = {id: 'fac-c', organization_id: 'org-b'};

function membership(role, target = facility, active = true) {
 return {
  organization_id: target.organization_id,
  facility_id: role === 'company_admin' ? null : target.id,
  role,
  is_active: active
 };
}

test('Die Oberfläche zeigt einer Mitgliedschaft nur die eigenen Betriebe', () => {
 const admin = [membership('company_admin')];
 assert.equal(facilityVisibleToMember(facility, admin), true);
 assert.equal(facilityVisibleToMember(otherFacility, admin), true);
 assert.equal(facilityVisibleToMember(foreignFacility, admin), false);

 const manager = [membership('facility_manager')];
 assert.equal(facilityVisibleToMember(facility, manager), true);
 assert.equal(facilityVisibleToMember(otherFacility, manager), false);

 const employee = [membership('employee')];
 assert.equal(facilityVisibleToMember(facility, employee), true);
 assert.equal(facilityVisibleToMember(otherFacility, employee), false);
 assert.equal(facilityVisibleToMember(foreignFacility, employee), false);

 const technician = [membership('technician')];
 assert.equal(facilityVisibleToMember(facility, technician), true);
 assert.equal(facilityVisibleToMember(otherFacility, technician), false);
 assert.equal(facilityVisibleToMember(foreignFacility, technician), false);

 const mixed = [membership('technician'), membership('employee', otherFacility)];
 assert.equal(facilityVisibleToMember(facility, mixed), true);
 assert.equal(facilityVisibleToMember(otherFacility, mixed), true);
 assert.equal(facilityVisibleToMember(foreignFacility, mixed), false);
 assert.equal(mayAppointManager(organization, technician), false);
 assert.equal(mayAppointManager(organization, mixed), false);
});

test('Deaktivierte und unklare Mitgliedschaften sehen keinen Betrieb', () => {
 assert.equal(facilityVisibleToMember(facility, [membership('company_admin', facility, false)]), false);
 assert.equal(facilityVisibleToMember(facility, [membership('employee', facility, false)]), false);
 assert.equal(facilityVisibleToMember(facility, [{...membership('facility_manager'), is_active: null}]), false);
 assert.equal(facilityVisibleToMember(facility, [{...membership('company_admin'), facility_id: facility.id}]), false);
});

test('Nur die aktive Geschäftsführung ernennt eine Betriebsleitung', () => {
 assert.equal(mayAppointManager(organization, [membership('company_admin')]), true);
 assert.equal(mayAppointManager(organization, [membership('company_admin', facility, false)]), false);
 assert.equal(mayAppointManager(organization, [{...membership('company_admin'), is_active: null}]), false);
 assert.equal(mayAppointManager(organization, [{...membership('company_admin'), facility_id: facility.id}]), false);
 assert.equal(mayAppointManager(organization, [membership('facility_manager')]), false);
 assert.equal(mayAppointManager(organization, [membership('employee')]), false);
 assert.equal(mayAppointManager('org-b', [membership('company_admin')]), false);
});
