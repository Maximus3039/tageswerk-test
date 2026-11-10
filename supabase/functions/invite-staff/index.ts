// Tageswerk 3.4, Einladung von Mitarbeitern und Technikern.
// Diese Datei ist vorbereitet und nicht bereitgestellt.
// Sie ersetzt die produktive Edge Function invite-staff nicht.
// Vor einer späteren Freigabe muss die Live-Fassung mit dieser Datei verglichen werden.
// Die Betriebszuordnung und die Rolle prüft handler.js. Eine fehlende Rolle bleibt Mitarbeiter,
// damit bestehende Aufrufe ohne Rollenfeld unverändert Mitarbeiter einladen.
// Die Annahme bleibt public.accept_staff_invitation. Sie darf keine Rolle vom Eingeladenen annehmen.

import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {inviteStaff} from './handler.js';

const openStatuses = new Set(['pending', 'sent']);

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
 const memberships = user ? (await admin.from('memberships').select('organization_id,facility_id,role,is_active').eq('user_id', user.id)).data || [] : [];
 const result = await inviteStaff({
  method: request.method,
  caller: user ? {userId: user.id, email: user.email, memberships} : null,
  body,
  now: new Date().toISOString(),
  database: {
   async facility(id: string) {
    const {data} = await admin.from('facilities').select('id,organization_id').eq('id', id).maybeSingle();
    return data;
   },
   async openInvitation(row: {email: string, facility_id: string}) {
    const {data} = await admin.from('staff_invitations').select('id,status').eq('facility_id', row.facility_id).eq('email', row.email);
    return (data || []).find(item => openStatuses.has(item.status)) || null;
   },
   async insert(row: Record<string, unknown>) {
    const {data, error} = await admin.from('staff_invitations').insert(row).select('id,email,first_name,last_name,facility_id,role,status,invited_at').single();
    if (error) throw error;
    return data;
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
    if (error && !/already been registered|already registered/i.test(error.message || '')) throw error;
   }
  }
 });
 return Response.json(result.body, {status: result.status});
});
