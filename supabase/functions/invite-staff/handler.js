import {planInvitation} from './rules.js';

export async function inviteStaff({method = 'POST', caller, body, database, mailer, now}) {
 if (method !== 'POST') return {status: 405, body: {ok: false, error: 'Die Einladung erwartet eine Übermittlung.'}};
 const facility = body?.facility_id ? await database.facility(body.facility_id) : null;
 const plan = planInvitation({caller, facility, body});
 if (!plan.ok) return {status: plan.status, body: {ok: false, error: plan.error}};
 const open = await database.openInvitation(plan.row);
 if (open) return {status: 409, body: {ok: false, error: 'Für diese E-Mail liegt in diesem Betrieb bereits eine offene Einladung.'}};
 const stored = await database.insert({...plan.row, invited_at: now});
 try {
  await mailer.send(stored);
 } catch {
  await database.mark(stored.id, 'failed');
  return {status: 502, body: {ok: false, error: 'Die Einladung konnte nicht versendet werden.'}};
 }
 await database.mark(stored.id, 'sent');
 return {status: 200, body: {ok: true}};
}
