import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {inviteStaff} from '../../supabase/functions/invite-staff/handler.js';
import {canInviteFacility, claimInvitations, planInvitation} from '../../supabase/functions/invite-staff/rules.js';

const now = '2026-11-10T09:00:00.000Z';
const organization = 'org-a';
const facility = {id: 'fac-a', organization_id: organization, name: 'Bad'};
const second = {id: 'fac-b', organization_id: organization, name: 'Strand'};
const foreign = {id: 'fac-c', organization_id: 'org-b', name: 'Fremd'};

function membership(role, target = facility, active = true) {
 return {organization_id: target.organization_id, facility_id: role === 'company_admin' ? null : target.id, role, is_active: active};
}

function database(rows = []) {
 const state = {rows: rows.map(item => ({...item})), sent: []};
 return {
  state,
  async facility(id) {
   return [facility, second, foreign].find(item => item.id === id) || null;
  },
  async openInvitation(row) {
   return state.rows.find(item => item.email === row.email && item.facility_id === row.facility_id && ['pending', 'sent'].includes(item.status)) || null;
  },
  async insert(row) {
   const stored = {...row, id: `invite-${state.rows.length + 1}`};
   state.rows.push(stored);
   return stored;
  },
  async mark(id, status) {
   const row = state.rows.find(item => item.id === id);
   row.status = status;
  }
 };
}

function mailer() {
 const sent = [];
 return {sent, async send(invitation) {sent.push(invitation);}};
}

const manager = {userId: 'manager-1', email: 'leitung@example.test', memberships: [membership('facility_manager')]};
const admin = {userId: 'admin-1', email: 'gf@example.test', memberships: [membership('company_admin')]};
const employee = {userId: 'employee-1', email: 'mia@example.test', memberships: [membership('employee')]};
const technician = {userId: 'technician-1', email: 'timo@example.test', memberships: [membership('technician')]};

test('Eine Einladung speichert Techniker nur für den erlaubten Betrieb', async () => {
 const store = database();
 const post = mailer();
 const result = await inviteStaff({
  caller: manager,
  body: {facility_id: facility.id, role: 'technician', email: 'Neu@Example.Test', first_name: 'Nils', last_name: 'Techniker'},
  database: store,
  mailer: post,
  now
 });
 assert.equal(result.status, 200);
 assert.equal(result.body.ok, true);
 assert.equal(store.state.rows[0].role, 'technician');
 assert.equal(store.state.rows[0].facility_id, facility.id);
 assert.equal(store.state.rows[0].email, 'neu@example.test');
 assert.equal(store.state.rows[0].status, 'sent');
 assert.equal(post.sent[0].role, 'technician');
 assert.equal(post.sent.length, 1);

 const missingRole = database();
 const legacy = await inviteStaff({
  caller: admin,
  body: {facility_id: second.id, email: 'alt@example.test', first_name: 'Alt', last_name: 'Bestand'},
  database: missingRole,
  mailer: mailer(),
  now
 });
 assert.equal(legacy.status, 200);
 assert.equal(missingRole.state.rows[0].role, 'employee');
 assert.equal(missingRole.state.rows[0].facility_id, second.id);
});

test('Einladung verweigert höhere Rollen, fremde Betriebe und Selbstaufwertung', async () => {
 const store = database([{id: 'open-1', email: 'neu@example.test', facility_id: facility.id, role: 'employee', status: 'sent'}]);
 const post = mailer();
 const blocked = [
  inviteStaff({caller: employee, body: {facility_id: facility.id, role: 'technician', email: 'a@example.test', first_name: 'A', last_name: 'A'}, database: store, mailer: post, now}),
  inviteStaff({caller: technician, body: {facility_id: facility.id, role: 'facility_manager', email: 'b@example.test', first_name: 'B', last_name: 'B'}, database: store, mailer: post, now}),
  inviteStaff({caller: manager, body: {facility_id: second.id, role: 'technician', email: 'c@example.test', first_name: 'C', last_name: 'C'}, database: store, mailer: post, now}),
  inviteStaff({caller: manager, body: {facility_id: facility.id, role: 'facility_manager', email: 'd@example.test', first_name: 'D', last_name: 'D'}, database: store, mailer: post, now}),
  inviteStaff({caller: admin, body: {facility_id: foreign.id, role: 'technician', email: 'e@example.test', first_name: 'E', last_name: 'E'}, database: store, mailer: post, now}),
  inviteStaff({caller: {userId: 'bound-admin', memberships: [{...membership('company_admin'), facility_id: facility.id}]}, body: {facility_id: facility.id, role: 'technician', email: 'f@example.test', first_name: 'F', last_name: 'F'}, database: store, mailer: post, now}),
  inviteStaff({caller: manager, body: {facility_id: facility.id, role: 'technician', email: 'neu@example.test', first_name: 'Nils', last_name: 'Techniker'}, database: store, mailer: post, now})
 ];
 const results = await Promise.all(blocked);
 assert.deepEqual(results.map(item => item.status), [403, 403, 403, 400, 403, 403, 409]);
 assert.equal(store.state.rows.length, 1);
 assert.equal(store.state.rows[0].role, 'employee');
 assert.equal(store.state.rows[0].status, 'sent');
 assert.equal(post.sent.length, 0);
 assert.equal(canInviteFacility(facility, employee.memberships), false);
 assert.equal(planInvitation({caller: manager, facility, body: {role: 'company_admin', email: 'a@example.test', first_name: 'A', last_name: 'A'}}).ok, false);
});

test('Ein fehlender Versand lässt die Einladung fehlgeschlagen und versendet sie nicht erneut als gesendet', async () => {
 const store = database();
 const result = await inviteStaff({
  caller: manager,
  body: {facility_id: facility.id, role: 'technician', email: 'fehler@example.test', first_name: 'Eva', last_name: 'Fehler'},
  database: store,
  mailer: {async send() {throw new Error('Versand fehlgeschlagen');}},
  now
 });
 assert.equal(result.status, 502);
 assert.equal(store.state.rows[0].status, 'failed');
 assert.equal(store.state.rows[0].role, 'technician');
});

test('Die Annahme übernimmt gespeicherte Rollen je Betrieb und ignoriert eine selbst gewählte Rolle', () => {
 const user = {id: 'user-1', email: 'Mia@Example.Test'};
 const invitations = [
  {id: 'a', email: 'mia@example.test', facility_id: facility.id, role: 'technician', status: 'sent'},
  {id: 'b', email: 'mia@example.test', facility_id: second.id, role: null, status: 'sent'},
  {id: 'c', email: 'mia@example.test', facility_id: facility.id, role: 'employee', status: 'pending'},
  {id: 'd', email: 'andere@example.test', facility_id: facility.id, role: 'technician', status: 'sent'}
 ];
 const memberships = [
  {user_id: user.id, organization_id: organization, facility_id: 'fac-keep', role: 'employee', is_active: true},
  {user_id: user.id, organization_id: organization, facility_id: facility.id, role: 'facility_manager', is_active: true}
 ];
 const claimed = claimInvitations({user, invitations, facilities: [facility, second], memberships, requestedRole: 'facility_manager'});
 assert.equal(claimed.success, true);
 const kept = claimed.memberships.find(item => item.facility_id === 'fac-keep');
 const own = claimed.memberships.find(item => item.facility_id === facility.id);
 const strand = claimed.memberships.find(item => item.facility_id === second.id);
 assert.equal(kept.role, 'employee');
 assert.equal(own.role, 'facility_manager');
 assert.equal(strand.role, 'employee');
 assert.equal(claimed.invitations.find(item => item.id === 'b').status, 'accepted');
 assert.equal(claimed.invitations.find(item => item.id === 'c').status, 'pending');
 assert.equal(claimed.invitations.find(item => item.id === 'd').status, 'sent');

 const fresh = claimInvitations({
  user,
  invitations: [{id: 'a', email: 'mia@example.test', facility_id: facility.id, role: 'technician', status: 'sent'}],
  facilities: [facility],
  memberships: [],
  requestedRole: 'company_admin'
 });
 assert.equal(fresh.memberships[0].role, 'technician');
 assert.equal(fresh.memberships[0].facility_id, facility.id);
 const keptEmployee = claimInvitations({
  user,
  invitations: [{id: 'up', email: 'mia@example.test', facility_id: facility.id, role: 'technician', status: 'sent'}],
  facilities: [facility],
  memberships: [{user_id: user.id, organization_id: organization, facility_id: facility.id, role: 'employee', is_active: true}],
  requestedRole: 'company_admin'
 });
 assert.equal(keptEmployee.memberships[0].role, 'employee');
 assert.equal(keptEmployee.memberships[0].is_active, true);
 assert.equal(keptEmployee.invitations[0].status, 'accepted');
 const keptTechnician = claimInvitations({
  user,
  invitations: [{id: 'down', email: 'mia@example.test', facility_id: second.id, role: 'employee', status: 'sent'}],
  facilities: [second],
  memberships: [{user_id: user.id, organization_id: organization, facility_id: second.id, role: 'technician', is_active: true}]
 });
 assert.equal(keptTechnician.memberships[0].role, 'technician');

 const illegal = claimInvitations({
  user,
  invitations: [{id: 'x', email: 'mia@example.test', facility_id: facility.id, role: 'facility_manager', status: 'sent'}],
  facilities: [facility],
  memberships: [],
  requestedRole: 'technician'
 });
 assert.equal(illegal.ok, false);
 assert.equal(illegal.memberships.length, 0);
});

test('Die vorbereitete Funktion bleibt lokal und ersetzt nur die geprüfte Annahme', () => {
 const sql = readFileSync(new URL('../../tageswerk_3_4_invitation_role.sql', import.meta.url), 'utf8');
 const roleSql = readFileSync(new URL('../../tageswerk_3_4_technician_role.sql', import.meta.url), 'utf8');
 const app = readFileSync(new URL('../../js/app.js', import.meta.url), 'utf8');
 const prepared = readFileSync(new URL('../../supabase/functions/invite-staff/index.ts', import.meta.url), 'utf8');
 assert.match(sql, /tageswerk_guard_invitation_role/);
 assert.match(sql, /accept_staff_invitation entspricht nicht der geprüften Fassung und wurde nicht ersetzt/);
 assert.match(sql, /CREATE OR REPLACE FUNCTION public\.accept_staff_invitation\(\)/);
 assert.doesNotMatch(sql, /accept_staff_invitation\(\s*p_/);
 assert.match(sql, /v_role := coalesce\(v_invitation\.role, 'employee'\)/);
 assert.match(sql, /coalesce\(role, 'employee'\) IN \('employee', 'technician'\)/);
 assert.doesNotMatch(sql, /UPDATE public\.memberships SET role/);
 assert.match(sql, /claim_staff_invitations entspricht nicht der geprüften Fassung und wurde nicht ersetzt/);
 assert.match(sql, /memberships\.role erlaubt technician noch nicht/);
 assert.match(roleSql, /manage_facility_membership entspricht nicht der geprüften Fassung und wurde nicht ersetzt/);
 assert.match(roleSql, /p_role NOT IN \(''employee'',''technician'',''facility_manager''\)/);
 assert.match(roleSql, /m\.role NOT IN \(''employee'',''technician''\)/);
 assert.match(roleSql, /Geschaeftsfuehrungsrechte werden hier nicht veraendert/);
 assert.match(roleSql, /Nur Geschaeftsfuehrung darf Betriebsleitungen ernennen/);
 assert.match(roleSql, /Reaktivierung nur ueber gesonderte Freigabe/);
 assert.match(roleSql, /Eine deaktivierte Zuordnung wird nur mit derselben Rolle wieder freigegeben/);
 assert.match(roleSql, /SET is_active = true/);
 assert.doesNotMatch(roleSql, /UPDATE public\.memberships SET role = 'technician'/);
 assert.match(roleSql, /actor_role IN \(''employee'', ''technician''\) AND NEW\.reading_type <> ''regular''/);
 assert.match(roleSql, /Stornieren darf die Betriebsleitung oder Geschäftsführung/);
 assert.match(roleSql, /tageswerk_prepare_reading entspricht nicht der geprüften Fassung und wurde nicht ersetzt/);
 assert.doesNotMatch(roleSql, /actor_role NOT IN \(''company_admin'', ''facility_manager'', ''technician''\)/);
 assert.match(prepared, /nicht bereitgestellt/);
 assert.match(prepared, /inviteUserByEmail/);
 assert.match(prepared, /role/);
 assert.match(app, /role:inviteRole/);
 assert.match(app, /PGRST204/);
 assert.match(app, /roleNames\[r\.role\]/);
});

test('Mitarbeiter- und Technikereinladungen bleiben je Betrieb getrennt', () => {
 const user = {id: 'user-2', email: 'mia@example.test'};
 const employeeInvite = claimInvitations({
  user,
  invitations: [{id: 'emp', email: 'mia@example.test', facility_id: facility.id, role: 'employee', status: 'sent'}],
  facilities: [facility, second],
  memberships: [],
  requestedRole: 'technician'
 });
 assert.equal(employeeInvite.memberships[0].role, 'employee');
 assert.equal(employeeInvite.memberships[0].facility_id, facility.id);
 const both = claimInvitations({
  user,
  invitations: [
   {id: 'tech', email: 'mia@example.test', facility_id: facility.id, role: 'technician', status: 'sent'},
   {id: 'emp', email: 'mia@example.test', facility_id: second.id, role: 'employee', status: 'sent'}
  ],
  facilities: [facility, second],
  memberships: [{user_id: user.id, organization_id: organization, facility_id: 'fac-keep', role: 'facility_manager', is_active: true}],
  requestedRole: 'company_admin'
 });
 assert.equal(both.memberships.find(item => item.facility_id === facility.id).role, 'technician');
 assert.equal(both.memberships.find(item => item.facility_id === second.id).role, 'employee');
 assert.equal(both.memberships.find(item => item.facility_id === 'fac-keep').role, 'facility_manager');
 const inactive = claimInvitations({
  user,
  invitations: [{id: 'back', email: 'mia@example.test', facility_id: facility.id, role: 'technician', status: 'sent'}],
  facilities: [facility],
  memberships: [{user_id: user.id, organization_id: organization, facility_id: facility.id, role: 'employee', is_active: false}]
 });
 assert.equal(inactive.ok, false);
 assert.equal(inactive.memberships[0].is_active, false);
 assert.equal(inactive.memberships[0].role, 'employee');
 assert.equal(inactive.invitations[0].status, 'sent');
});

function planMembershipChange({actor, targetMemberships, facility, role, remove = false}) {
 const admin = (actor.memberships || []).some(item => item.is_active === true && item.role === 'company_admin' && item.organization_id === facility.organization_id);
 const manager = (actor.memberships || []).some(item => item.is_active === true && item.role === 'facility_manager' && item.facility_id === facility.id && item.organization_id === facility.organization_id);
 if (actor.userId && targetMemberships.some(item => item.user_id === actor.userId)) return {ok: false, error: 'Eigene Berechtigungen hier nicht veraenderbar'};
 if (!admin && !manager) return {ok: false, error: 'Keine Verwaltungsberechtigung fuer diesen Betrieb'};
 if (!['employee', 'technician', 'facility_manager'].includes(role)) return {ok: false, error: 'Ungueltige Rolle'};
 if (role === 'facility_manager' && !admin) return {ok: false, error: 'Nur Geschaeftsfuehrung darf Betriebsleitungen ernennen'};
 if (targetMemberships.some(item => item.organization_id === facility.organization_id && item.role === 'company_admin')) return {ok: false, error: 'Geschaeftsfuehrungsrechte werden hier nicht veraendert'};
 const existing = targetMemberships.find(item => item.organization_id === facility.organization_id && item.facility_id === facility.id);
 if (existing && !admin && !['employee', 'technician'].includes(existing.role)) return {ok: false, error: 'Betriebsleitung darf nur Mitarbeiter und Techniker bearbeiten'};
 if (existing && existing.is_active === false && !remove) {
  if (role !== existing.role) return {ok: false, error: 'Eine deaktivierte Zuordnung wird nur mit derselben Rolle wieder freigegeben.'};
  const restored = targetMemberships.map(item => ({...item}));
  restored.find(item => item.facility_id === facility.id).is_active = true;
  return {ok: true, memberships: restored};
 }
 const next = targetMemberships.map(item => ({...item}));
 if (!existing) {
  if (remove) return {ok: false, error: 'Keine Zuordnung vorhanden'};
  next.push({user_id: 'target-1', organization_id: facility.organization_id, facility_id: facility.id, role, is_active: true});
 } else if (remove) {
  next.find(item => item.facility_id === facility.id).is_active = false;
 } else {
  next.find(item => item.facility_id === facility.id).role = role;
 }
 return {ok: true, memberships: next};
}

test('Betriebsleitungen verwalten Mitarbeiter und Techniker und erhöhen keine Rechte', () => {
 const target = {user_id: 'target-1'};
 const employeeRow = {...target, organization_id: organization, facility_id: facility.id, role: 'employee', is_active: true};
 const technicianRow = {...target, organization_id: organization, facility_id: second.id, role: 'technician', is_active: true};
 const promoted = planMembershipChange({actor: manager, targetMemberships: [employeeRow], facility, role: 'technician'});
 assert.equal(promoted.ok, true);
 assert.equal(promoted.memberships[0].role, 'technician');
 const assigned = planMembershipChange({actor: manager, targetMemberships: [], facility: second, role: 'technician'});
 assert.equal(assigned.ok, false);
 const blocked = [
  planMembershipChange({actor: manager, targetMemberships: [employeeRow], facility, role: 'facility_manager'}),
  planMembershipChange({actor: manager, targetMemberships: [{...employeeRow, role: 'facility_manager'}], facility, role: 'employee'}),
  planMembershipChange({actor: technician, targetMemberships: [employeeRow], facility, role: 'technician'}),
  planMembershipChange({actor: manager, targetMemberships: [{...employeeRow, role: 'company_admin', facility_id: null}], facility, role: 'employee'}),
  planMembershipChange({actor: manager, targetMemberships: [{...employeeRow, is_active: false}], facility, role: 'technician'}),
  planMembershipChange({actor: {...manager, userId: 'target-1'}, targetMemberships: [employeeRow], facility, role: 'technician'})
 ];
 assert.deepEqual(blocked.map(item => item.ok), [false, false, false, false, false, false]);
 const adminChange = planMembershipChange({
  actor: admin,
  targetMemberships: [employeeRow, technicianRow],
  facility: second,
  role: 'employee'
 });
 assert.equal(adminChange.memberships.find(item => item.facility_id === second.id).role, 'employee');
 assert.equal(adminChange.memberships.find(item => item.facility_id === facility.id).role, 'employee');
 const appointed = planMembershipChange({actor: admin, targetMemberships: [employeeRow], facility, role: 'facility_manager'});
 assert.equal(appointed.memberships[0].role, 'facility_manager');
 const restored = planMembershipChange({actor: manager, targetMemberships: [{...employeeRow, is_active: false}], facility, role: 'employee'});
 assert.equal(restored.ok, true);
 assert.equal(restored.memberships[0].role, 'employee');
 assert.equal(restored.memberships[0].is_active, true);
 const restoredTechnician = planMembershipChange({actor: manager, targetMemberships: [{...technicianRow, facility_id: facility.id, is_active: false}], facility, role: 'technician'});
 assert.equal(restoredTechnician.memberships[0].role, 'technician');
 assert.equal(restoredTechnician.memberships[0].is_active, true);
 const raisedWhileInactive = planMembershipChange({actor: admin, targetMemberships: [{...employeeRow, is_active: false}], facility, role: 'facility_manager'});
 assert.equal(raisedWhileInactive.ok, false);
});
