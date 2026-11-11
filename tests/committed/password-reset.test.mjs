import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {
 EMAIL_INVALID_MESSAGE,
 PASSWORD_MIN_LENGTH,
 PASSWORD_MISMATCH_MESSAGE,
 PASSWORD_RESET_REDIRECT,
 PASSWORD_SAVED_MESSAGE,
 PASSWORD_SHORT_MESSAGE,
 RECOVERY_EXPIRED_MESSAGE,
 RECOVERY_INVALID_MESSAGE,
 RESET_FAILED_MESSAGE,
 RESET_RATE_MESSAGE,
 RESET_SENT_MESSAGE,
 callbackNotice,
 inviteCallbackMessage,
 linkProblem,
 passwordChoice,
 passwordResetEmail,
 readAuthCallback,
 recoveryAllowsSave,
 recoveryFailure,
 resetRequestOutcome,
 screenForAuth
} from '../../js/password-reset.js';

const user = {id: 'user-1', email: 'person@example.com'};

function screen(callback, options = {}) {
 return screenForAuth({
  callback,
  user: options.user || null,
  recoveryFlow: Boolean(options.recoveryFlow),
  recoveryDone: Boolean(options.recoveryDone),
  passwordRequestOpen: Boolean(options.passwordRequestOpen)
 });
}

test('Die Zurücksetzung nutzt die veröffentlichte Adresse und keine eigenen Tokens', () => {
 const source = readFileSync(new URL('../../js/password-reset.js', import.meta.url), 'utf8');
 const auth = readFileSync(new URL('../../js/auth.js', import.meta.url), 'utf8');
 const app = readFileSync(new URL('../../js/app.js', import.meta.url), 'utf8');
 const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
 assert.equal(PASSWORD_RESET_REDIRECT, 'https://maximus3039.github.io/tageswerk-test/?vorgang=passwort');
 assert.equal(PASSWORD_MIN_LENGTH, 12);
 assert.match(auth, /resetPasswordForEmail\(email,\{redirectTo\}\)/);
 assert.match(app, /resetPasswordForEmail\(email,PASSWORD_RESET_REDIRECT\)/);
 assert.match(app, /updateUser\(\{password:choice\.password\}\)/);
 assert.match(app, /let invitationFlow=initialCallback\.type==='invite';/);
 assert.match(html, /Passwort vergessen\?/);
 assert.match(html, /Link zum Zurücksetzen senden/);
 assert.match(html, /Zurück zur Anmeldung/);
 assert.match(html, /Neues Passwort/);
 assert.match(html, /Passwort bestätigen/);
 assert.match(html, /Passwort speichern</);
 assert.match(html, /Passwort speichern und Einladung annehmen/);
 assert.match(app, /if\(resetPending\)return/);
 assert.match(app, /if\(recoveryPending\)return/);
 assert.doesNotMatch(source + auth + app, /console\.(log|debug|info|warn|error)/);
 assert.doesNotMatch(source, /insert\(|from\('|\.from\(/);
});

test('Die E-Mail-Prüfung verlangt eine Adresse und verrät kein Konto', () => {
 assert.equal(passwordResetEmail(''), '');
 assert.equal(passwordResetEmail('ohne-domain'), '');
 assert.equal(passwordResetEmail('name@'), '');
 assert.equal(passwordResetEmail(' person@example.com '), 'person@example.com');
 assert.equal(passwordResetEmail('a'.repeat(321)), '');
 const known = resetRequestOutcome(null);
 const unknown = resetRequestOutcome({message: 'User not found'});
 assert.equal(known.ok, true);
 assert.equal(unknown.ok, true);
 assert.equal(known.message, RESET_SENT_MESSAGE);
 assert.equal(unknown.message, known.message);
 assert.equal(known.message.includes('@'), false);
 const limited = resetRequestOutcome({message: 'Too many requests', code: 'over_request_rate_limit'});
 assert.equal(limited.ok, false);
 assert.equal(limited.message, RESET_RATE_MESSAGE);
 assert.equal(limited.message.includes('person@example.com'), false);
 assert.equal(resetRequestOutcome({message: 'Network down'}).message, RESET_FAILED_MESSAGE);
 assert.equal(EMAIL_INVALID_MESSAGE.includes('@'), false);
});

test('Ungültige und abgelaufene Wiederherstellungslinks bleiben außerhalb der Anwendung', () => {
 const expired = readAuthCallback({hash: '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&type=recovery', search: ''});
 const expiredReturn = readAuthCallback({hash: '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired', search: '?vorgang=passwort'});
 const invalid = readAuthCallback({hash: '#error=access_denied&error_code=otp_disabled&error_description=Invalid+reset+link&type=recovery', search: ''});
 assert.equal(linkProblem(expired), 'expired');
 assert.equal(linkProblem(expiredReturn), 'expired');
 assert.equal(linkProblem(invalid), 'invalid');
 assert.equal(screen(expired, {user}), 'recovery-expired');
 assert.equal(screen(expiredReturn), 'recovery-expired');
 assert.equal(screen(invalid), 'recovery-invalid');
 assert.equal(screen(readAuthCallback({hash: '#type=recovery', search: ''})), 'recovery-invalid');
 assert.equal(callbackNotice(expired, 'recovery-expired'), RECOVERY_EXPIRED_MESSAGE);
 assert.equal(callbackNotice(invalid, 'recovery-invalid'), RECOVERY_INVALID_MESSAGE);
 assert.equal(RECOVERY_EXPIRED_MESSAGE.includes('@'), false);
 assert.equal(RECOVERY_INVALID_MESSAGE.includes('access_token'), false);
});

test('Passwortänderung und bestehende Anmeldung oder Einladung bleiben getrennt', () => {
 assert.deepEqual(passwordChoice('kurz', 'kurz'), {ok: false, message: PASSWORD_SHORT_MESSAGE});
 assert.deepEqual(passwordChoice('correct-horse', 'correct-house'), {ok: false, message: PASSWORD_MISMATCH_MESSAGE});
 assert.deepEqual(passwordChoice('correct-horse', 'correct-horse'), {ok: true, password: 'correct-horse'});
 assert.equal(recoveryAllowsSave(null, true), false);
 assert.equal(recoveryAllowsSave(user, false), false);
 assert.equal(recoveryAllowsSave(user, true), true);
 const rejected = recoveryFailure({message: 'Password secret-value is too common'});
 assert.equal(rejected.includes('secret-value'), false);
 assert.equal(recoveryFailure({message: 'Auth session missing!'}), RECOVERY_INVALID_MESSAGE);
 const recovery = readAuthCallback({hash: '#access_token=token&type=recovery', search: '?vorgang=passwort'});
 const invite = readAuthCallback({hash: '#access_token=token&type=invite', search: ''});
 const inviteError = readAuthCallback({hash: '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&type=invite', search: ''});
 assert.equal(screen(recovery, {user, recoveryFlow: true}), 'recovery');
 assert.equal(screen(invite, {user}), 'invite');
 assert.equal(screen(readAuthCallback({hash: '', search: ''}), {user}), 'app');
 assert.equal(screen(readAuthCallback({hash: '', search: ''})), 'login');
 assert.equal(screen(readAuthCallback({hash: '', search: ''}), {passwordRequestOpen: true}), 'password-request');
 assert.equal(screen(inviteError), 'login');
 assert.match(inviteCallbackMessage(inviteError), /^Einladungslink ungültig oder abgelaufen:/);
 assert.equal(inviteCallbackMessage(recovery), '');
 assert.equal(screen(readAuthCallback({hash: '', search: ''}), {recoveryDone: true}), 'recovery-done');
 assert.equal(PASSWORD_SAVED_MESSAGE.includes('correct-horse'), false);
});
