const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeInviteEmail(value) {
 return String(value ?? '').trim().toLowerCase();
}

export function inviteEmailsMatch(email, confirmation) {
 const left = normalizeInviteEmail(email);
 const right = normalizeInviteEmail(confirmation);
 return EMAIL.test(left) && left === right;
}

export function inviteRecipientError(email, confirmation) {
 const left = normalizeInviteEmail(email);
 const right = normalizeInviteEmail(confirmation);
 if (!EMAIL.test(left) || left.length > 200) return 'Bitte eine gültige Empfängeradresse eingeben.';
 if (!right) return 'Bitte die Empfängeradresse zur Kontrolle wiederholen.';
 if (left !== right) return 'Die beiden E-Mail-Adressen stimmen nicht überein.';
 return '';
}

export function invitePreviewText(email) {
 const value = normalizeInviteEmail(email);
 if (!EMAIL.test(value)) return 'Empfängeradresse noch nicht eindeutig.';
 return `Einladung geht ausschließlich an ${value}.`;
}

export function confirmInviteRecipient(email, confirmation) {
 const error = inviteRecipientError(email, confirmation);
 if (error) return {ok: false, error};
 const recipient = normalizeInviteEmail(email);
 return {ok: true, email: recipient};
}

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function invitationExpiresAt(row, now = Date.now()) {
 void now;
 if (row?.expires_at) return new Date(row.expires_at);
 if (!row?.invited_at) return null;
 return new Date(new Date(row.invited_at).getTime() + INVITE_TTL_MS);
}

export function invitationDisplayStatus(row, now = Date.now()) {
 const status = String(row?.status || '');
 if (status === 'accepted') return 'accepted';
 if (status === 'revoked') return 'revoked';
 if (status === 'failed') return 'failed';
 const expires = invitationExpiresAt(row, now);
 if ((status === 'sent' || status === 'pending') && expires && expires.getTime() <= now) return 'expired';
 if (status === 'pending') return 'pending';
 if (status === 'sent') return 'sent';
 return status || 'unknown';
}

export const invitationListStatus = {
 pending: 'Wird versendet',
 sent: 'Ausstehend · Versand angenommen',
 accepted: 'Angenommen',
 expired: 'Abgelaufen',
 revoked: 'Widerrufen',
 failed: 'Fehlgeschlagen'
};

export function invitationDeliveryText(result) {
 if (result?.existing_account) {
  return `✓ Konto besteht bereits. Die Einladung für ${result.email || 'die angegebene Adresse'} ist hinterlegt. Eine neue Einladungsmail wurde nicht erzeugt. Die Person nimmt sie bei der nächsten Anmeldung an.`;
 }
 if (result?.ok) {
  return `✓ Einladung für ${result.email || 'die bestätigte Adresse'} angelegt. Der E-Mail-Dienst hat den Versand angenommen. Eine Zustellung ins Postfach ist damit nicht nachgewiesen.`;
 }
 return '';
}

export function alreadyRegisteredInviteError(error) {
 const message = String(error?.message || '').toLowerCase();
 const status = Number(error?.status);
 return status === 422 || /already been registered|already registered|user already exists/.test(message);
}
