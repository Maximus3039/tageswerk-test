// Grundlage ist die produktive invite-staff Version 8.
// Diese Fassung ist korrigiert und nicht bereitgestellt.
// verify_jwt steht produktiv auf false. Die Funktion prüft den Bearer-Token selbst mit auth.getUser().
// Eine spätere Bereitstellung darf die Gateway-Einstellung nicht nebenbei einschalten.
// Erhaltend ist nur dieser Aufruf, ausschließlich für invite-staff und ohne --prune:
// npx supabase functions deploy invite-staff --remote eqtrifscedpsngsysxvc --no-verify-jwt --use-api
// Die Rolle schreibt nur die fünfstellige request_staff_invitation.
// Der Dienstschlüssel ändert weder Rolle noch Mitgliedschaft.
// Ein Versandfehler, auch bei einem bereits registrierten Konto, bleibt failed.
// Die Anmeldung nimmt jede Einladung mit Status sent an. Diesen Weg bestätigt Version 8 nicht.

import {createClient} from 'npm:@supabase/supabase-js@2';
import {inviteStaff} from './handler.js';

Deno.serve(async request => {
 const env = {
  SUPABASE_URL: Deno.env.get('SUPABASE_URL') || '',
  SUPABASE_ANON_KEY: Deno.env.get('SUPABASE_ANON_KEY') || '',
  SUPABASE_PUBLISHABLE_KEY: Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || '',
  SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  TAGESWERK_REDIRECT_URL: Deno.env.get('TAGESWERK_REDIRECT_URL') || ''
 };
 const authorization = request.headers.get('Authorization') || '';
 const result = await inviteStaff({
  method: request.method,
  authorization,
  env,
  async readBody() {
   try {
    return await request.json();
   } catch {
    return null;
   }
  },
  async getUser() {
   const client = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY, {
    global: {headers: {Authorization: authorization}},
    auth: {persistSession: false}
   });
   const {data: {user}, error} = await client.auth.getUser();
   return {user, error};
  },
  async requestInvitation(input) {
   const client = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY, {
    global: {headers: {Authorization: authorization}},
    auth: {persistSession: false}
   });
   const {data, error} = await client.rpc('request_staff_invitation', {
    p_facility_id: input.facilityId,
    p_email: input.email,
    p_first_name: input.firstName,
    p_last_name: input.lastName,
    p_role: input.role
   });
   if (error) return {ok: false, error: error.message};
   return {ok: true, id: data};
  },
  async updateInvitation(input) {
   const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {auth: {persistSession: false}});
   const changes: {status: string, updated_at: string, error_detail?: string} = {
    status: input.changes.status,
    updated_at: input.changes.updated_at
   };
   if (input.changes.error_detail != null) changes.error_detail = input.changes.error_detail;
   const query = admin.from('staff_invitations').update(changes).eq('id', input.id).eq('status', input.onlyStatus);
   if (input.changes.status === 'sent') {
    const {data, error} = await query.select('id').maybeSingle();
    return {error, updated: data};
   }
   const {error} = await query;
   return {error};
  },
  async inviteByEmail(input) {
   const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {auth: {persistSession: false}});
   const {error} = await admin.auth.admin.inviteUserByEmail(input.email, {
    data: {full_name: input.firstName + ' ' + input.lastName},
    ...(input.redirectTo ? {redirectTo: input.redirectTo} : {})
   });
   return {error};
  },
  log: (...parts: unknown[]) => console.error(...parts)
 });
 if (result.status === 204) return new Response(null, {status: 204, headers: result.headers});
 return new Response(JSON.stringify(result.body), {status: result.status, headers: result.headers});
});
