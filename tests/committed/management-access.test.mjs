import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const guardSql = readFileSync(new URL('../../tageswerk_3_4_management_guard.sql', import.meta.url), 'utf8');
const controlSql = readFileSync(new URL('../integration/installationskontrolle.sql', import.meta.url), 'utf8');

const organization = 'org-a';
const facility = {id: 'fac-a', organization_id: organization, name: 'Prignitz'};
const otherFacility = {id: 'fac-b', organization_id: organization, name: 'Friedensteich'};

function membership(userId, role, target = facility, active = true) {
 return {
  user_id: userId,
  organization_id: target.organization_id,
  facility_id: role === 'company_admin' ? null : target.id,
  role,
  is_active: active,
  full_name: userId,
  email: `${userId}@example.test`,
  facility_name: target.name
 };
}

function activeManager(memberships, userId, organizationId, facilityId) {
 return memberships.some(item => item.user_id === userId
  && item.is_active === true
  && item.organization_id === organizationId
  && (item.role === 'company_admin' || (item.role === 'facility_manager' && item.facility_id === facilityId)));
}

function listEmployees(callerId, memberships) {
 if (!callerId) return [];
 return memberships.filter(item => activeManager(memberships, callerId, item.organization_id, item.facility_id));
}

function requestInvitation({callerId, memberships, facilityId, email, firstName, lastName, existing}) {
 if (!callerId) return {error: 'Anmeldung erforderlich'};
 const target = facilityId === facility.id ? facility : otherFacility;
 if (!activeManager(memberships, callerId, target.organization_id, target.id)) return {error: 'Keine Berechtigung fuer diesen Betrieb'};
 if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return {error: 'Ungueltige E-Mail-Adresse'};
 if (firstName.trim().length < 1 || lastName.trim().length < 1) return {error: 'Vor- und Nachname erforderlich'};
 if (existing) return {error: 'Dieser Mitarbeiter besitzt bereits Zugang zu diesem Betrieb.'};
 return {ok: true};
}

function revokeInvitation({callerId, memberships, invitation}) {
 if (!invitation || !['pending', 'sent'].includes(invitation.status)) return {error: 'Keine offene Einladung gefunden'};
 if (!activeManager(memberships, callerId, invitation.organization_id, invitation.facility_id)) return {error: 'Keine Berechtigung'};
 return {ok: true, status: 'revoked'};
}

function updateName({callerId, memberships, userId, fullName}) {
 if (!callerId) return {error: 'Nicht angemeldet'};
 const allowed = memberships.some(employee => employee.user_id === userId && activeManager(memberships, callerId, employee.organization_id, employee.facility_id));
 if (!allowed) return {error: 'Keine Berechtigung zur Namensänderung'};
 if (fullName == null || fullName.trim().length < 2) return {error: 'Bitte einen gültigen Namen eingeben'};
 return {ok: true, fullName: fullName.trim()};
}

function knownList(body) {
 const text = body.replace(/\s+/g, ' ');
 const markers = text.includes('SECURITY DEFINER')
  && text.includes('auth.uid() IS NOT NULL')
  && text.includes('manager.user_id = auth.uid()')
  && text.includes('manager.organization_id = m.organization_id')
  && text.includes("manager.role = 'company_admin'")
  && text.includes("manager.role = 'facility_manager'")
  && text.includes('manager.facility_id = m.facility_id')
  && text.includes('ORDER BY f.name, p.full_name')
  && !text.includes('UPDATE ')
  && !text.includes('DELETE ');
 if (!markers) return 'stoppen';
 if (text.includes('manager.is_active = true') || text.includes('manager.is_active IS TRUE')) return 'gesichert';
 if (!text.includes('is_active')) return 'produktiv';
 return 'stoppen';
}

test('Produktive und abgesicherte Verwaltungsfunktionen bleiben unterscheidbar', () => {
 const productiveList = `
  SECURITY DEFINER
  WHERE auth.uid() IS NOT NULL
  AND manager.user_id = auth.uid()
  AND manager.organization_id = m.organization_id
  AND manager.role = 'company_admin'
  AND manager.role = 'facility_manager'
  AND manager.facility_id = m.facility_id
  ORDER BY f.name, p.full_name
 `;
 assert.equal(knownList(productiveList), 'produktiv');
 assert.equal(knownList(productiveList.replace('manager.user_id = auth.uid()', 'manager.user_id = auth.uid() AND manager.is_active = true')), 'gesichert');
 assert.equal(knownList(productiveList.replace('ORDER BY f.name, p.full_name', 'ORDER BY m.user_id')), 'stoppen');
 assert.equal(knownList(`${productiveList} AND m.is_active = true`), 'stoppen');
 assert.match(guardSql, /list_facility_employees entspricht nicht der geprüften Fassung und wurde nicht ersetzt/);
 assert.match(guardSql, /request_staff_invitation entspricht nicht der geprüften Fassung und wurde nicht ersetzt/);
 assert.match(guardSql, /revoke_staff_invitation entspricht nicht der geprüften Fassung und wurde nicht ersetzt/);
 assert.match(guardSql, /update_employee_name entspricht nicht der geprüften Fassung und wurde nicht ersetzt/);
 assert.match(guardSql, /private\.can_manage_facility\(/);
 assert.match(guardSql, /manager\.is_active = true/);
 assert.match(readFileSync(new URL('../../tageswerk_3_4_technician_role.sql', import.meta.url), 'utf8'), /private\.can_manage_facility\(/);
 assert.match(readFileSync(new URL('../../tageswerk_3_4_invitation_role.sql', import.meta.url), 'utf8'), /private\.can_access_facility\(/);
 assert.match(guardSql, /m\.is_active = true/);
 assert.match(controlSql, /list_facility_employees bleibt die geprüfte Mitarbeiterliste/);
 assert.match(controlSql, /Bekannte produktive Fassung\. Die Migration ergänzt die aktive Verwaltungsberechtigung/);
 assert.match(controlSql, /Der Funktionskörper ist unbekannt/);
});

test('Nur aktive Leitungen lesen Mitarbeiterdaten und verwalten Einladungen und Namen', () => {
 const manager = membership('manager', 'facility_manager');
 const admin = membership('admin', 'company_admin');
 const employee = membership('employee', 'employee');
 const technician = membership('technician', 'technician', otherFacility);
 const foreignAdmin = membership('foreign', 'company_admin', {id: 'fac-c', organization_id: 'org-b', name: 'Fremd'});
 const rows = [manager, admin, employee, technician, membership('other-lead', 'facility_manager', otherFacility)];

 assert.deepEqual(listEmployees('manager', rows).map(item => item.user_id), ['manager', 'employee']);
 assert.equal(listEmployees('admin', rows).some(item => item.user_id === 'technician'), true);
 assert.equal(listEmployees('foreign', [...rows, foreignAdmin]).every(item => item.organization_id === 'org-b'), true);
 assert.deepEqual(listEmployees('employee', rows), []);
 assert.deepEqual(listEmployees('technician', rows), []);
 assert.deepEqual(listEmployees('manager', rows.map(item => item.user_id === 'manager' ? {...item, is_active: false} : item)), []);
 assert.deepEqual(listEmployees('admin', rows.map(item => item.user_id === 'admin' ? {...item, is_active: false} : item)), []);

 const activeRows = rows;
 assert.equal(requestInvitation({callerId: 'manager', memberships: activeRows, facilityId: facility.id, email: 'mia@example.test', firstName: 'Mia', lastName: 'Muster'}).ok, true);
 assert.equal(requestInvitation({callerId: 'admin', memberships: activeRows, facilityId: otherFacility.id, email: 'mia@example.test', firstName: 'Mia', lastName: 'Muster'}).ok, true);
 assert.equal(requestInvitation({callerId: 'manager', memberships: activeRows, facilityId: otherFacility.id, email: 'mia@example.test', firstName: 'Mia', lastName: 'Muster'}).error, 'Keine Berechtigung fuer diesen Betrieb');
 assert.equal(requestInvitation({callerId: 'manager', memberships: [{...manager, is_active: false}], facilityId: facility.id, email: 'mia@example.test', firstName: 'Mia', lastName: 'Muster'}).error, 'Keine Berechtigung fuer diesen Betrieb');
 assert.equal(requestInvitation({callerId: 'employee', memberships: activeRows, facilityId: facility.id, email: 'mia@example.test', firstName: 'Mia', lastName: 'Muster'}).error, 'Keine Berechtigung fuer diesen Betrieb');
 assert.equal(requestInvitation({callerId: 'technician', memberships: activeRows, facilityId: otherFacility.id, email: 'mia@example.test', firstName: 'Mia', lastName: 'Muster'}).error, 'Keine Berechtigung fuer diesen Betrieb');
 assert.equal(requestInvitation({callerId: 'manager', memberships: activeRows, facilityId: facility.id, email: 'mia@example.test', firstName: 'Mia', lastName: 'Muster', existing: true}).error, 'Dieser Mitarbeiter besitzt bereits Zugang zu diesem Betrieb.');

 const invitation = {organization_id: organization, facility_id: facility.id, status: 'sent'};
 assert.equal(revokeInvitation({callerId: 'manager', memberships: activeRows, invitation}).status, 'revoked');
 assert.equal(revokeInvitation({callerId: 'admin', memberships: activeRows, invitation}).ok, true);
 assert.equal(revokeInvitation({callerId: 'manager', memberships: [{...manager, is_active: false}], invitation}).error, 'Keine Berechtigung');
 assert.equal(revokeInvitation({callerId: 'employee', memberships: activeRows, invitation}).error, 'Keine Berechtigung');
 assert.equal(revokeInvitation({callerId: 'technician', memberships: activeRows, invitation}).error, 'Keine Berechtigung');
 assert.equal(revokeInvitation({callerId: 'manager', memberships: activeRows, invitation: {...invitation, status: 'accepted'}}).error, 'Keine offene Einladung gefunden');

 assert.equal(updateName({callerId: 'manager', memberships: activeRows, userId: 'employee', fullName: 'Mia Muster'}).fullName, 'Mia Muster');
 assert.equal(updateName({callerId: 'admin', memberships: activeRows, userId: 'technician', fullName: 'Timo Techniker'}).ok, true);
 assert.equal(updateName({callerId: 'manager', memberships: activeRows.map(item => item.user_id === 'employee' ? {...item, is_active: false} : item), userId: 'employee', fullName: 'Mia Muster'}).ok, true);
 assert.equal(updateName({callerId: 'manager', memberships: [{...manager, is_active: false}, employee], userId: 'employee', fullName: 'Mia Muster'}).error, 'Keine Berechtigung zur Namensänderung');
 assert.equal(updateName({callerId: 'employee', memberships: activeRows, userId: 'manager', fullName: 'Neue Leitung'}).error, 'Keine Berechtigung zur Namensänderung');
 assert.equal(updateName({callerId: 'technician', memberships: activeRows, userId: 'employee', fullName: 'Mia Muster'}).error, 'Keine Berechtigung zur Namensänderung');
 assert.equal(updateName({callerId: 'manager', memberships: activeRows, userId: 'technician', fullName: 'Timo Techniker'}).error, 'Keine Berechtigung zur Namensänderung');
 assert.equal(updateName({callerId: null, memberships: activeRows, userId: 'employee', fullName: 'Mia Muster'}).error, 'Nicht angemeldet');
 assert.equal(updateName({callerId: 'manager', memberships: activeRows, userId: 'employee', fullName: 'M'}).error, 'Bitte einen gültigen Namen eingeben');
});

function canManage(memberships, userId, target) {
 return memberships.some(item => item.user_id === userId && item.is_active === true && item.organization_id === target.organization_id && (item.role === 'company_admin' || (item.role === 'facility_manager' && item.facility_id === target.id)));
}

function canAccess(memberships, userId, target) {
 return memberships.some(item => item.user_id === userId && item.is_active === true && item.organization_id === target.organization_id && (item.role === 'company_admin' || item.facility_id === target.id));
}

test('Geschäftsführung gilt für alle Betriebe, deaktivierte Leitungen verwalten nicht', () => {
 const admin = membership('admin', 'company_admin');
 const manager = membership('manager', 'facility_manager');
 const technician = membership('technician', 'technician');
 const employee = membership('employee', 'employee', otherFacility);
 const rows = [admin, manager, technician, employee];
 assert.equal(canManage(rows, 'admin', facility), true);
 assert.equal(canManage(rows, 'admin', otherFacility), true);
 assert.equal(canManage([{...admin, is_active: false}], 'admin', facility), false);
 assert.equal(canManage(rows, 'manager', facility), true);
 assert.equal(canManage(rows, 'manager', otherFacility), false);
 assert.equal(canManage([{...manager, is_active: false}, technician], 'manager', facility), false);
 assert.equal(canManage(rows, 'technician', facility), false);
 assert.equal(canAccess(rows, 'technician', facility), true);
 assert.equal(canAccess([{...technician, is_active: false}], 'technician', facility), false);
 assert.equal(canAccess(rows, 'technician', otherFacility), false);
 assert.equal(canAccess(rows, 'admin', otherFacility), true);
 assert.equal(updateName({callerId: 'manager', memberships: [manager, technician], userId: 'technician', fullName: 'Timo Techniker'}).ok, true);
 assert.equal(updateName({callerId: 'manager', memberships: [{...manager, is_active: false}, technician], userId: 'technician', fullName: 'Timo Techniker'}).error, 'Keine Berechtigung zur Namensänderung');
});
