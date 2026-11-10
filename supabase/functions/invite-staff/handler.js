import {normalizeInvitationRole} from './rules.js';

export async function inviteStaff({method = 'POST', caller, body, database, mailer, log = () => {}}) {
 if (method !== 'POST') return {status: 405, body: {ok: false, error: 'Die Einladung erwartet eine Übermittlung.'}};
 if (!caller?.userId) return {status: 401, body: {ok: false, error: 'Bitte erneut anmelden.'}};
 const role = normalizeInvitationRole(body?.role);
 if (!role) return {status: 400, body: {ok: false, error: 'Eine Einladung kann nur Mitarbeiter oder Techniker vorsehen.'}};
 const requested = await database.requestInvitation({
  caller,
  facilityId: body?.facility_id,
  email: body?.email,
  firstName: body?.first_name,
  lastName: body?.last_name,
  role
 });
 if (!requested.ok) return {status: requested.status || 400, body: {ok: false, error: requested.error || 'Die Einladung wurde abgelehnt.'}};
 try {
  const delivery = await mailer.send(requested.invitation);
  if (delivery?.existingAccount) {
   await database.mark(requested.invitation.id, 'sent');
   log('Bestehendes Konto. Die Einladung ändert keine Mitgliedschaft.');
   return {status: 200, body: {ok: true, existing_account: true}};
  }
 } catch (error) {
  await database.mark(requested.invitation.id, 'failed');
  log(error?.message || 'Einladungsversand fehlgeschlagen');
  return {status: 502, body: {ok: false, error: 'Die Einladung konnte nicht versendet werden.'}};
 }
 await database.mark(requested.invitation.id, 'sent');
 return {status: 200, body: {ok: true}};
}
