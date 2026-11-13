import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {inviteStaff} from '../../supabase/functions/invite-staff/handler.js';
import {canInviteFacility, claimInvitations, planInvitation} from '../../supabase/functions/invite-staff/rules.js';

const now = '2026-11-10T09:00:00.000Z';
const organization = 'org-a';
const facility = {id: '11111111-1111-4111-8111-111111111111', organization_id: organization, name: 'Bad'};
const second = {id: '22222222-2222-4222-8222-222222222222', organization_id: organization, name: 'Strand'};
const foreign = {id: '33333333-3333-4333-8333-333333333333', organization_id: 'org-b', name: 'Fremd'};
const env = {
 SUPABASE_URL: 'https://example.test',
 SUPABASE_ANON_KEY: 'anon-test',
 SUPABASE_SERVICE_ROLE_KEY: 'service-test',
 TAGESWERK_REDIRECT_URL: 'https://tageswerk.example/einladung'
};

function membership(role, target = facility, active = true) {
 return {organization_id: target.organization_id, facility_id: role === 'company_admin' ? null : target.id, role, is_active: active};
}

function database(rows = [], members = []) {
 const state = {rows: rows.map(item => ({...item})), members: members.map(item => ({...item}))};
 return {
  state,
  async requestInvitation(input) {
   const target = [facility, second, foreign].find(item => item.id === input.facilityId);
   if (!target) return {ok: false, status: 404, error: 'Betrieb nicht gefunden'};
   const allowed = (input.caller?.memberships || []).some(item => item.is_active === true && item.organization_id === target.organization_id && (item.role === 'company_admin' || (item.role === 'facility_manager' && item.facility_id === target.id)));
   if (!allowed) return {ok: false, status: 403, error: 'Keine aktive Verwaltungsberechtigung fuer diesen Betrieb'};
   if (!['employee', 'technician'].includes(input.role)) return {ok: false, status: 400, error: 'Eine Einladung kann nur Mitarbeiter oder Techniker vorsehen.'};
   const email = String(input.email ?? '').trim().toLowerCase();
   if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return {ok: false, status: 400, error: 'Ungueltige E-Mail-Adresse'};
   const firstName = String(input.firstName ?? '').trim();
   const lastName = String(input.lastName ?? '').trim();
   if (!firstName || !lastName) return {ok: false, status: 400, error: 'Vor- und Nachname erforderlich'};
   if (state.members.some(item => item.email === email && item.organization_id === target.organization_id && (item.facility_id === target.id || item.role === 'company_admin'))) {
    return {ok: false, status: 409, error: 'Dieser Benutzer ist bereits zugeordnet. Bitte bei Bedarf reaktivieren.'};
   }
   const open = state.rows.find(item => item.email === email && item.facility_id === target.id && ['pending', 'sent', 'failed'].includes(item.status));
   if (open?.status === 'pending') return {ok: false, status: 409, error: 'Fuer diese E-Mail-Adresse wird bereits eine Einladung verarbeitet.'};
   if (open?.status === 'sent') return {ok: false, status: 409, error: 'An diese E-Mail-Adresse wurde bereits eine Einladung versendet.'};
   if (open?.status === 'failed') return {ok: false, status: 409, error: 'Eine fruehere Einladung ist fehlgeschlagen. Bitte zuerst den Versandstatus pruefen.'};
   const stored = {id: `invite-${state.rows.length + 1}`, email, first_name: firstName, last_name: lastName, facility_id: target.id, role: input.role, status: 'pending'};
   state.rows.push(stored);
   return {ok: true, invitation: stored};
  },
  async mark(id, status) {
   const row = state.rows.find(item => item.id === id);
   if (!row) throw new Error('Einladung nicht gefunden');
   row.status = status;
  }
 };
}

async function runInvite({caller, body, store, method = 'POST', authorization = 'Bearer session', userError = null, inviteError = null, log = () => {}, beforeUpdate = null, readBody = null}) {
 const trace = {mail: [], updates: []};
 const result = await inviteStaff({
  method,
  authorization,
  env,
  body,
  readBody,
  log,
  now: () => now,
  async getUser() {
   if (userError) return {user: null, error: userError};
   return {user: {id: caller?.userId || 'user-1'}, error: null};
  },
  async requestInvitation(input) {
   return store.requestInvitation({...input, caller});
  },
  async updateInvitation(input) {
   trace.updates.push(input);
   if (input.onlyStatus !== 'pending' || Object.hasOwn(input.changes, 'role')) return {error: {message: 'Statusgrenze verletzt'}, updated: null};
   const row = store.state.rows.find(item => item.id === input.id);
   if (beforeUpdate) beforeUpdate(row);
   if (!row || row.status !== 'pending') return {updated: null};
   row.status = input.changes.status;
   if (input.changes.error_detail) row.error_detail = input.changes.error_detail;
   row.updated_at = input.changes.updated_at;
   return {updated: {id: row.id}};
  },
  async inviteByEmail(input) {
   trace.mail.push(input);
   if (inviteError) return {error: inviteError};
   return {error: null};
  }
 });
 return {result, trace};
}

const manager = {userId: 'manager-1', email: 'leitung@example.test', memberships: [membership('facility_manager')]};
const admin = {userId: 'admin-1', email: 'gf@example.test', memberships: [membership('company_admin')]};
const employee = {userId: 'employee-1', email: 'mia@example.test', memberships: [membership('employee')]};
const technician = {userId: 'technician-1', email: 'timo@example.test', memberships: [membership('technician')]};

test('Eine Einladung speichert Techniker nur für den erlaubten Betrieb', async () => {
 const store = database();
 const sent = await runInvite({
  caller: manager,
  store,
  body: {facility_id: facility.id, role: 'technician', email: 'Neu@Example.Test', first_name: 'Nils', last_name: 'Techniker'}
 });
 assert.equal(sent.result.status, 200);
 assert.equal(sent.result.body.ok, true);
 assert.equal(sent.result.headers['Access-Control-Allow-Origin'], '*');
 assert.equal(store.state.rows[0].role, 'technician');
 assert.equal(store.state.rows[0].facility_id, facility.id);
 assert.equal(store.state.rows[0].email, 'neu@example.test');
 assert.equal(store.state.rows[0].status, 'sent');
 assert.equal(sent.trace.mail[0].redirectTo, env.TAGESWERK_REDIRECT_URL);
 assert.equal(sent.trace.updates[0].onlyStatus, 'pending');
 assert.equal(sent.trace.updates[0].changes.status, 'sent');
 assert.equal(Object.hasOwn(sent.trace.updates[0].changes, 'role'), false);

 const missingRole = database();
 const legacy = await runInvite({
  caller: admin,
  store: missingRole,
  body: {facility_id: second.id, email: 'alt@example.test', first_name: 'Alt', last_name: 'Bestand'}
 });
 assert.equal(legacy.result.status, 200);
 assert.equal(missingRole.state.rows[0].role, 'employee');
 assert.equal(missingRole.state.rows[0].facility_id, second.id);
});

test('Einladung verweigert höhere Rollen, fremde Betriebe und Selbstaufwertung', async () => {
 const store = database([{id: 'open-1', email: 'neu@example.test', facility_id: facility.id, role: 'employee', status: 'sent'}]);
 const blocked = await Promise.all([
  runInvite({caller: employee, store, body: {facility_id: facility.id, role: 'technician', email: 'a@example.test', first_name: 'A', last_name: 'A'}}),
  runInvite({caller: technician, store, body: {facility_id: facility.id, role: 'facility_manager', email: 'b@example.test', first_name: 'B', last_name: 'B'}}),
  runInvite({caller: manager, store, body: {facility_id: second.id, role: 'technician', email: 'c@example.test', first_name: 'C', last_name: 'C'}}),
  runInvite({caller: manager, store, body: {facility_id: facility.id, role: 'facility_manager', email: 'd@example.test', first_name: 'D', last_name: 'D'}}),
  runInvite({caller: admin, store, body: {facility_id: foreign.id, role: 'technician', email: 'e@example.test', first_name: 'E', last_name: 'E'}}),
  runInvite({caller: {...manager, memberships: [{...membership('facility_manager'), is_active: false}]}, store, body: {facility_id: facility.id, role: 'employee', email: 'g@example.test', first_name: 'G', last_name: 'G'}}),
  runInvite({caller: manager, store, body: {facility_id: facility.id, role: 'technician', email: 'neu@example.test', first_name: 'Nils', last_name: 'Techniker'}})
 ]);
 assert.deepEqual(blocked.map(item => item.result.status), [403, 400, 403, 400, 403, 403, 403]);
 assert.equal(store.state.rows.length, 1);
 assert.equal(store.state.rows[0].role, 'employee');
 assert.equal(store.state.rows[0].status, 'sent');
 assert.equal(blocked.reduce((sum, item) => sum + item.trace.mail.length, 0), 0);
 assert.equal(canInviteFacility(facility, employee.memberships), false);
 assert.equal(planInvitation({caller: manager, facility, body: {role: 'company_admin', email: 'a@example.test', first_name: 'A', last_name: 'A'}}).ok, false);
});

test('Ein fehlender Versand lässt die Einladung fehlgeschlagen und versendet sie nicht erneut als gesendet', async () => {
 const store = database();
 const notes = [];
 const failed = await runInvite({
  caller: manager,
  store,
  body: {facility_id: facility.id, role: 'technician', email: 'fehler@example.test', first_name: 'Eva', last_name: 'Fehler'},
  inviteError: {message: 'Versand fehlgeschlagen', status: 500},
  log: (...parts) => notes.push(parts)
 });
 assert.equal(failed.result.status, 409);
 assert.equal(store.state.rows[0].status, 'failed');
 assert.equal(store.state.rows[0].role, 'technician');
 assert.equal(store.state.rows[0].error_detail, 'Versand fehlgeschlagen');
 assert.equal(failed.trace.updates[0].onlyStatus, 'pending');
 assert.equal(notes[0][0], 'TAGESWERK_INVITATION_SEND_ERROR');

 const raced = database();
 const lost = await runInvite({
  caller: manager,
  store: raced,
  body: {facility_id: facility.id, role: 'employee', email: 'rennen@example.test', first_name: 'Ron', last_name: 'Rennen'},
  beforeUpdate(row) { row.status = 'accepted'; }
 });
 assert.equal(lost.result.status, 500);
 assert.equal(raced.state.rows[0].status, 'accepted');
 assert.equal(raced.state.rows[0].role, 'employee');
});

test('Einladung unterscheidet neue Konten, bestehende Konten und deaktivierte Zuordnungen', async () => {
 const employeeInvite = database();
 const employeeResult = await runInvite({
  caller: admin,
  store: employeeInvite,
  body: {facility_id: facility.id, role: 'employee', email: 'mia@example.test', first_name: 'Mia', last_name: 'Muster'}
 });
 assert.equal(employeeResult.result.status, 200);
 assert.equal(employeeInvite.state.rows[0].role, 'employee');
 assert.equal(employeeInvite.state.members.length, 0);

 const existingMembers = [{email: 'bestand@example.test', organization_id: organization, facility_id: facility.id, role: 'employee', is_active: false}];
 const existing = database([], existingMembers);
 const existingResult = await runInvite({
  caller: manager,
  store: existing,
  body: {facility_id: facility.id, role: 'technician', email: 'Bestand@Example.Test', first_name: 'Bea', last_name: 'Bestand'}
 });
 assert.equal(existingResult.result.status, 403);
 assert.equal(existing.state.rows.length, 0);
 assert.equal(existing.state.members[0].role, 'employee');
 assert.equal(existing.state.members[0].is_active, false);
 assert.equal(existingResult.trace.mail.length, 0);

 const registered = database();
 const registeredResult = await runInvite({
  caller: admin,
  store: registered,
  body: {facility_id: second.id, email: 'konto@example.test', first_name: 'Kim', last_name: 'Konto'},
  inviteError: {message: 'A user with this email address has already been registered', status: 422}
 });
 assert.equal(registeredResult.result.status, 409);
 assert.equal(registeredResult.result.body.ok, undefined);
 assert.equal(registered.state.rows[0].role, 'employee');
 assert.equal(registered.state.rows[0].status, 'failed');
 assert.match(registered.state.rows[0].error_detail, /already been registered/);
 assert.equal(registered.state.members.length, 0);
});

test('CORS, fehlender Bearer-Token und eine ungültige Anmeldung bleiben geschlossen', async () => {
 const store = database();
 const options = await runInvite({caller: manager, store, method: 'OPTIONS', body: {}});
 assert.equal(options.result.status, 204);
 assert.equal(options.result.headers['Access-Control-Allow-Methods'], 'POST, OPTIONS');
 assert.equal(store.state.rows.length, 0);
 const missing = await runInvite({caller: manager, store, authorization: '', body: {facility_id: facility.id, email: 'a@example.test', first_name: 'A', last_name: 'A'}});
 assert.equal(missing.result.status, 401);
 assert.equal(missing.result.body.error, 'Anmeldung erforderlich');
 const invalid = await runInvite({
  caller: manager,
  store,
  userError: {message: 'jwt expired'},
  body: {facility_id: facility.id, email: 'a@example.test', first_name: 'A', last_name: 'A'}
 });
 assert.equal(invalid.result.status, 401);
 assert.equal(invalid.result.body.error, 'Ungueltige Anmeldung');
 const broken = await runInvite({caller: manager, store, readBody: async () => null});
 assert.equal(broken.result.status, 400);
 assert.equal(store.state.rows.length, 0);
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
 const staffUi = readFileSync(new URL('../../js/staff-ui.js', import.meta.url), 'utf8');
 const prepared = readFileSync(new URL('../../supabase/functions/invite-staff/index.ts', import.meta.url), 'utf8');
 const roleSqlFile = readFileSync(new URL('../../tageswerk_3_4_invitation_role_parameter.sql', import.meta.url), 'utf8');
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
 const handler = readFileSync(new URL('../../supabase/functions/invite-staff/handler.js', import.meta.url), 'utf8');
 assert.match(prepared, /nicht bereitgestellt/);
 assert.match(prepared, /verify_jwt steht produktiv auf false/);
 assert.match(prepared, /--no-verify-jwt/);
 assert.match(prepared, /--remote eqtrifscedpsngsysxvc/);
 assert.match(prepared, /auth\.getUser\(\)/);
 assert.match(prepared, /client\.rpc\('request_staff_invitation'/);
 assert.match(prepared, /p_role: input\.role/);
 assert.match(prepared, /inviteUserByEmail/);
 assert.match(prepared, /TAGESWERK_REDIRECT_URL/);
 assert.match(prepared, /changes\.error_detail = input\.changes\.error_detail/);
 assert.match(prepared, /\.eq\('status', input\.onlyStatus\)/);
 assert.match(prepared, /console\.error/);
 assert.doesNotMatch(prepared, /INVITE_REDIRECT_URL/);
 assert.doesNotMatch(prepared, /staff_invitations'\)\.insert/);
 assert.doesNotMatch(prepared, /from\('memberships'\)/);
 assert.match(handler, /Access-Control-Allow-Origin/);
 assert.match(handler, /method === 'OPTIONS'/);
 assert.match(handler, /Bearer /);
 assert.match(handler, /onlyStatus: 'pending'/);
 assert.doesNotMatch(handler, /existing_account/);
 assert.match(roleSqlFile, /private\.can_manage_facility\(p_facility_id\)/);
 assert.match(roleSqlFile, /v_role NOT IN \('employee', 'technician'\)/);
 assert.match(roleSqlFile, /v_email IS NULL OR v_email !~ /);
 assert.match(roleSqlFile, /Dieser Benutzer ist bereits zugeordnet\. Bitte bei Bedarf reaktivieren\./);
 assert.match(roleSqlFile, /staff_invitations_open_email_facility_key/);
 assert.match(roleSqlFile, /^BEGIN;/m);
 assert.match(roleSqlFile, /^COMMIT;$/m);
 assert.match(roleSqlFile, /REVOKE ALL ON FUNCTION public\.request_staff_invitation\(uuid, text, text, text, text\) FROM PUBLIC, anon/);
 assert.match(roleSqlFile, /GRANT EXECUTE ON FUNCTION public\.request_staff_invitation\(uuid, text, text, text, text\) TO authenticated/);
 assert.doesNotMatch(roleSqlFile, /UPDATE public\.memberships/);
 for (const name of ['tageswerk_3_4_invitation_role_parameter_voraussetzungen.sql', 'tageswerk_3_4_invitation_role_parameter_kontrolle.sql']) {
  const query = readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8');
  assert.match(query, /SELECT pruefung, status, details/);
  assert.doesNotMatch(query, /^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|NOTIFY|DO)\b/im);
 }
 assert.match(prepared, /role/);
 assert.match(staffUi, /role:inviteRole/);
 assert.match(staffUi, /PGRST204/);
 assert.match(staffUi, /roleNames\[r\.role\]/);
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
