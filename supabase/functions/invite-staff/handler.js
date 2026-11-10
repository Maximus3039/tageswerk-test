import {normalizeInvitationRole} from './rules.js';

export const invitationCors = {
 'Access-Control-Allow-Origin': '*',
 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
 'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(data, status = 200) {
 return {
  status,
  body: data,
  headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...invitationCors}
 };
}

export async function inviteStaff({method = 'POST', authorization = '', env = {}, body = undefined, readBody = null, getUser, requestInvitation, updateInvitation, inviteByEmail, log = () => {}, now = () => new Date().toISOString()}) {
 if (method === 'OPTIONS') return {status: 204, body: null, headers: invitationCors};
 if (method !== 'POST') return json({error: 'POST erforderlich'}, 405);
 if (!String(authorization).startsWith('Bearer ')) return json({error: 'Anmeldung erforderlich'}, 401);
 const base = env.SUPABASE_URL || '';
 const pub = env.SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY || '';
 const secret = env.SUPABASE_SERVICE_ROLE_KEY || '';
 if (!base || !pub || !secret) return json({error: 'Serverkonfiguration unvollstaendig'}, 500);
 const userResult = await getUser();
 if (userResult?.error || !userResult?.user) return json({error: 'Ungueltige Anmeldung'}, 401);
 const payload = readBody ? await readBody() : body;
 if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) return json({error: 'Ungueltiges JSON'}, 400);
 const facilityId = String(payload.facility_id || '');
 const email = String(payload.email || '').trim().toLowerCase();
 const firstName = String(payload.first_name || '').trim();
 const lastName = String(payload.last_name || '').trim();
 if (!/^[0-9a-f-]{36}$/i.test(facilityId) || !/^\S+@\S+\.\S+$/.test(email) || !firstName || !lastName || firstName.length > 100 || lastName.length > 100) {
  return json({error: 'Bitte gueltige Daten eingeben'}, 400);
 }
 const role = normalizeInvitationRole(payload.role);
 if (!role) return json({error: 'Eine Einladung kann nur Mitarbeiter oder Techniker vorsehen.'}, 400);
 const prepared = await requestInvitation({facilityId, email, firstName, lastName, role});
 if (!prepared?.ok) return json({error: prepared?.error || 'Die Einladung wurde abgelehnt.'}, 403);
 const invitationId = prepared.id || prepared.invitation?.id;
 const redirectTo = env.TAGESWERK_REDIRECT_URL || '';
 const delivery = await inviteByEmail({email, firstName, lastName, redirectTo: redirectTo || undefined});
 if (delivery?.error) {
  log('TAGESWERK_INVITATION_SEND_ERROR', {
   invitation_id: invitationId,
   error_message: delivery.error.message,
   error_status: delivery.error.status
  });
  const saved = await updateInvitation({
   id: invitationId,
   changes: {status: 'failed', error_detail: delivery.error.message, updated_at: now()},
   onlyStatus: 'pending'
  });
  if (saved?.error) {
   log('TAGESWERK_INVITATION_SAVE_ERROR', {invitation_id: invitationId, database_error: saved.error.message});
  }
  return json({error: 'Die Einladung konnte nicht versendet werden. Bitte prüfe die Einladungsübersicht oder kontaktiere die Administration.'}, 409);
 }
 const marked = await updateInvitation({
  id: invitationId,
  changes: {status: 'sent', updated_at: now()},
  onlyStatus: 'pending'
 });
 if (marked?.error || !marked?.updated) {
  log('TAGESWERK_INVITATION_STATUS_ERROR', {
   invitation_id: invitationId,
   database_error: marked?.error?.message ?? null,
   database_code: marked?.error?.code ?? null,
   no_updated_row: !marked?.updated
  });
  return json({error: 'E-Mail versendet, aber Einladungsstatus konnte nicht bestaetigt werden. Bitte Administration kontaktieren.'}, 500);
 }
 return json({ok: true, id: invitationId});
}
