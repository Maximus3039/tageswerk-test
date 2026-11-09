import assert from 'node:assert/strict';
import test from 'node:test';
import {state} from '../../js/state.js';
import {isManager} from '../../js/permissions.js';

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

test('Mitarbeiter und deaktivierte Leitungen verwalten den Betrieb nicht', () => {
 state.myMemberships = [
  {organization_id: organization, facility_id: facility.id, role: 'employee', is_active: true}
 ];
 assert.equal(isManager(facility), false);

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
