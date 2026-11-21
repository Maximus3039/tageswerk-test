import assert from 'node:assert/strict';
import test from 'node:test';
import {
 confirmInviteRecipient,
 invitationDeliveryText,
 invitationDisplayStatus,
 inviteEmailsMatch,
 invitePreviewText
} from '../../js/invite-recipient.js';
import {inviteStaff} from '../../supabase/functions/invite-staff/handler.js';

test('Empfängeradresse muss bestätigt werden und darf nicht still ersetzt werden', () => {
 assert.equal(inviteEmailsMatch('Max@Example.test', 'max@example.test'), true);
 assert.equal(inviteEmailsMatch('a@b.de', 'c@b.de'), false);
 assert.equal(confirmInviteRecipient('a@b.de', '').ok, false);
 assert.equal(confirmInviteRecipient('a@b.de', 'a@b.de').email, 'a@b.de');
 assert.match(invitePreviewText('person@betrieb.de'), /person@betrieb.de/);
 assert.match(invitationDeliveryText({ok: true, email: 'a@b.de'}), /nicht nachgewiesen/);
 assert.equal(invitationDisplayStatus({status: 'sent', invited_at: '2000-01-01T00:00:00.000Z'}, Date.parse('2026-11-21')), 'expired');
});

test('Erneuter Versand nutzt die bestehende Einladung und legt keine zweite an', async () => {
 const requested = [];
 const mail = [];
 const result = await inviteStaff({
  method: 'POST',
  authorization: 'Bearer x',
  env: {SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'a', SUPABASE_SERVICE_ROLE_KEY: 's'},
  body: {
   facility_id: '11111111-1111-4111-8111-111111111111',
   invitation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   email: 'ziel@example.test',
   confirm_email: 'ziel@example.test',
   first_name: 'A',
   last_name: 'B',
   role: 'employee'
  },
  getUser: async () => ({user: {id: 'u'}, error: null}),
  requestInvitation: async input => { requested.push(input); return {ok: true, id: 'new'}; },
  resumeInvitation: async input => ({ok: true, id: input.id, invitation: {id: input.id, email: input.email}}),
  updateInvitation: async () => ({updated: {id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}}),
  inviteByEmail: async input => { mail.push(input.email); return {error: null}; }
 });
 assert.equal(result.status, 200);
 assert.equal(result.body.id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
 assert.equal(result.body.email, 'ziel@example.test');
 assert.equal(requested.length, 0);
 assert.deepEqual(mail, ['ziel@example.test']);
});

test('Handler sendet nur die bestätigte Adresse', async () => {
 const mail = [];
 const result = await inviteStaff({
  method: 'POST',
  authorization: 'Bearer x',
  env: {SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'a', SUPABASE_SERVICE_ROLE_KEY: 's'},
  body: {facility_id: '11111111-1111-4111-8111-111111111111', email: 'ziel@example.test', confirm_email: 'andere@example.test', first_name: 'A', last_name: 'B', role: 'employee'},
  getUser: async () => ({user: {id: 'u'}, error: null}),
  requestInvitation: async () => ({ok: true, id: 'i1'}),
  updateInvitation: async () => ({updated: {id: 'i1'}}),
  inviteByEmail: async input => { mail.push(input.email); return {error: null}; }
 });
 assert.equal(result.status, 400);
 assert.equal(mail.length, 0);
});
