// Tageswerk 3.4, Einladung von Mitarbeitern und Technikern.
// Diese Datei ist vorbereitet und nicht bereitgestellt.
// Sie ersetzt die produktive Edge Function invite-staff nicht.
// Die produktive Fassung bleibt die Grundlage:
// JWT über auth.getUser(), request_staff_invitation, inviteUserByEmail,
// Status pending, sent und failed, Protokoll bei einem Versandfehler.
// Die Rolle setzt nur die fünfstellige Datenbankfunktion.
// Der Dienstschlüssel ändert ausschließlich den Versandstatus.
// Eine fehlende Rolle bleibt Mitarbeiter.
// Die Annahme bleibt public.accept_staff_invitation.

import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {inviteStaff} from './handler.js';

function rejectionStatus(message: string) {
 if (message.includes('Anmeldung erforderlich')) return 401;
 if (message.includes('nicht gefunden')) return 404;
 if (message.includes('bereits')) return 409;
 if (message.includes('Berechtigung') || message.includes('nur Mitarbeiter oder Techniker')) return 403;
 return 400;
}

Deno.serve(async request => {
 const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
 const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
 const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
 const authorization = request.headers.get('Authorization') || '';
 if (!supabaseUrl || !anonKey || !serviceKey || !authorization) {
  return Response.json({ok: false, error: 'Die Einladung ist nicht eingerichtet.'}, {status: 500});
 }
 const userClient = createClient(supabaseUrl, anonKey, {global: {headers: {Authorization: authorization}}});
 const admin = createClient(supabaseUrl, serviceKey, {auth: {persistSession: false}});
 const {data: userData} = await userClient.auth.getUser();
 const user = userData?.user;
 let body: Record<string, unknown> = {};
 try {
  body = await request.json();
 } catch {
  body = {};
 }
 const result = await inviteStaff({
  method: request.method,
  caller: user ? {userId: user.id, email: user.email} : null,
  body,
  log: (...parts: unknown[]) => console.error(...parts),
  database: {
   async requestInvitation(input: {facilityId?: unknown, email?: unknown, firstName?: unknown, lastName?: unknown, role: string}) {
    const {data, error} = await userClient.rpc('request_staff_invitation', {
     p_facility_id: input.facilityId,
     p_email: input.email,
     p_first_name: input.firstName,
     p_last_name: input.lastName,
     p_role: input.role
    });
    if (error) {
     const message = error.message || 'Die Einladung wurde abgelehnt.';
     return {ok: false, status: rejectionStatus(message), error: message};
    }
    return {
     ok: true,
     invitation: {
      id: data,
      email: String(input.email ?? '').trim().toLowerCase(),
      role: input.role
     }
    };
   },
   async mark(id: string, status: string) {
    const {error} = await admin.from('staff_invitations').update({status}).eq('id', id);
    if (error) throw error;
   }
  },
  mailer: {
   async send(invitation: {email: string}) {
    const redirectTo = Deno.env.get('INVITE_REDIRECT_URL') || undefined;
    const {error} = await admin.auth.admin.inviteUserByEmail(invitation.email, redirectTo ? {redirectTo} : undefined);
    if (!error) return {existingAccount: false};
    if (/already been registered|already registered/i.test(error.message || '')) return {existingAccount: true};
    throw error;
   }
  }
 });
 return Response.json(result.body, {status: result.status});
});
