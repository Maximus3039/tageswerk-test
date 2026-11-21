import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {inviteStaff} from '../../supabase/functions/invite-staff/handler.js';
import {
 isAllowedTestInviteRedirect,
 isForbiddenTestInviteRedirect,
 TAGESWERK_PROD_APP_URL,
 TAGESWERK_TEST_APP_URL
} from '../../scripts/tageswerk-test-invite-origin.mjs';

const pagesProd = TAGESWERK_PROD_APP_URL;
const serveScript = readFileSync(new URL('../../scripts/serve-abnahme-test.ps1', import.meta.url), 'utf8');
const prodRef = 'eqtrifscedpsngsysxvc';
const testRef = 'gamvnzggcrrlnyoknllu';
const handler = readFileSync(new URL('../../supabase/functions/invite-staff/handler.js', import.meta.url), 'utf8');
const indexTs = readFileSync(new URL('../../supabase/functions/invite-staff/index.ts', import.meta.url), 'utf8');
const supabaseJs = readFileSync(new URL('../../js/supabase.js', import.meta.url), 'utf8');
const passwordReset = readFileSync(new URL('../../js/password-reset.js', import.meta.url), 'utf8');
const appJs = readFileSync(new URL('../../js/app.js', import.meta.url), 'utf8');
const staticServer = readFileSync(new URL('../../scripts/serve-abnahme-static.mjs', import.meta.url), 'utf8');

test('invite-staff setzt den Redirect nur aus TAGESWERK_REDIRECT_URL', () => {
 assert.match(indexTs, /TAGESWERK_REDIRECT_URL: Deno\.env\.get\('TAGESWERK_REDIRECT_URL'\)/);
 assert.match(handler, /const redirectTo = env\.TAGESWERK_REDIRECT_URL \|\| ''/);
 assert.match(handler, /redirectTo: redirectTo \|\| undefined/);
 assert.doesNotMatch(handler, /maximus3039\.github\.io/);
 assert.doesNotMatch(handler, /eqtrifscedpsngsysxvc/);
 assert.doesNotMatch(handler, /gamvnzggcrrlnyoknllu/);
 assert.doesNotMatch(handler, /PASSWORD_RESET_REDIRECT/);
});

test('Ohne Secret fällt invite-staff nicht auf GitHub Pages zurück', async () => {
 const mail = [];
 const facilityId = '11111111-1111-4111-8111-111111111111';
 const result = await inviteStaff({
  method: 'POST',
  authorization: 'Bearer session',
  env: {
   SUPABASE_URL: 'https://example.test',
   SUPABASE_ANON_KEY: 'anon-test',
   SUPABASE_SERVICE_ROLE_KEY: 'service-test',
   TAGESWERK_REDIRECT_URL: ''
  },
  body: {
   facility_id: facilityId,
   email: 'neu@example.test',
   confirm_email: 'neu@example.test',
   first_name: 'Nils',
   last_name: 'Test'
  },
  now: () => '2026-11-21T09:00:00.000Z',
  async getUser() {
   return {user: {id: 'manager-1'}, error: null};
  },
  async requestInvitation() {
   return {ok: true, invitation: {id: 'invite-1', email: 'neu@example.test', facility_id: facilityId, status: 'pending'}};
  },
  async updateInvitation() {
   return {updated: {id: 'invite-1'}};
  },
  async inviteByEmail(input) {
   mail.push(input);
   return {error: null};
  }
 });
 assert.equal(result.status, 200);
 assert.equal(mail.length, 1);
 assert.equal(mail[0].redirectTo, undefined);
 assert.notEqual(mail[0].redirectTo, pagesProd);
});

test('Öffentliche App-URL und Datenbank-URLs bleiben getrennt', () => {
 assert.match(passwordReset, /maximus3039\.github\.io\/tageswerk-test\//);
 assert.match(supabaseJs, new RegExp(prodRef));
 assert.doesNotMatch(supabaseJs, new RegExp(testRef));
 assert.doesNotMatch(indexTs, /TAGESWERK_REDIRECT_URL:.+github\.io/);
});

test('TEST-Einladungsziel ist fest 127.0.0.1:5173 und nicht GitHub Pages', () => {
 assert.equal(TAGESWERK_TEST_APP_URL, 'http://127.0.0.1:5173/');
 assert.equal(isAllowedTestInviteRedirect(TAGESWERK_TEST_APP_URL), true);
 assert.equal(isAllowedTestInviteRedirect('http://127.0.0.1:5173'), true);
 assert.equal(isForbiddenTestInviteRedirect(pagesProd), true);
 assert.equal(isForbiddenTestInviteRedirect('http://localhost:5173/'), true);
 assert.equal(isForbiddenTestInviteRedirect(`https://${prodRef}.supabase.co/`), true);
 assert.equal(isForbiddenTestInviteRedirect(''), true);
 assert.match(serveScript, /\$testAppUrl = 'http:\/\/127\.0\.0\.1:5173\/'/);
 assert.match(serveScript, /\$canonicalPort = 5173/);
 assert.match(serveScript, /Einladungs-TEST-URL ist fest/);
 assert.match(serveScript, /detectSessionInUrl:true/);
 assert.match(serveScript, /\$prodPagesUrl = 'https:\/\/maximus3039\.github\.io\/tageswerk-test\/'/);
 assert.match(serveScript, /darf nicht die Produktivoberflaeche sein/);
 assert.match(staticServer, /server\.listen\(port, '127\.0\.0\.1'/);
});

test('Einladungsannahme bleibt auf der aktuellen Origin und geht nicht zu Pages', () => {
 assert.match(appJs, /invitationFlow=initialCallback\.type==='invite'/);
 assert.match(appJs, /show\('invitation-setup',true\)/);
 assert.match(appJs, /await acceptInvitation\(\)/);
 assert.match(appJs, /history\.replaceState\(null,'',location\.pathname\)/);
 assert.doesNotMatch(appJs, /github\.io/);
 assert.doesNotMatch(appJs, /eqtrifscedpsngsysxvc/);
});

test('Einladung mit gesetztem TEST-Redirect bleibt von Pages getrennt', async () => {
 const mail = [];
 const facilityId = '11111111-1111-4111-8111-111111111111';
 const result = await inviteStaff({
  method: 'POST',
  authorization: 'Bearer session',
  env: {
   SUPABASE_URL: `https://${testRef}.supabase.co`,
   SUPABASE_ANON_KEY: 'anon-test',
   SUPABASE_SERVICE_ROLE_KEY: 'service-test',
   TAGESWERK_REDIRECT_URL: TAGESWERK_TEST_APP_URL
  },
  body: {
   facility_id: facilityId,
   email: 'neu@example.test',
   confirm_email: 'neu@example.test',
   first_name: 'Nils',
   last_name: 'Test'
  },
  now: () => '2026-11-21T09:00:00.000Z',
  async getUser() {
   return {user: {id: 'manager-1'}, error: null};
  },
  async requestInvitation() {
   return {ok: true, invitation: {id: 'invite-1', email: 'neu@example.test', facility_id: facilityId, status: 'pending'}};
  },
  async updateInvitation() {
   return {updated: {id: 'invite-1'}};
  },
  async inviteByEmail(input) {
   mail.push(input);
   return {error: null};
  }
 });
 assert.equal(result.status, 200);
 assert.equal(mail[0].redirectTo, TAGESWERK_TEST_APP_URL);
 assert.notEqual(mail[0].redirectTo, pagesProd);
 assert.equal(isForbiddenTestInviteRedirect(mail[0].redirectTo), false);
});
