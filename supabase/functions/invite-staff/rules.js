const invitationRoles = new Set(['employee', 'technician']);
const rank = {employee: 1, technician: 2, facility_manager: 3, company_admin: 4};

export function normalizeInvitationRole(role) {
 if (role == null || String(role).trim() === '') return 'employee';
 const value = String(role).trim();
 return invitationRoles.has(value) ? value : null;
}

export function canInviteFacility(facility, memberships) {
 return (memberships || []).some(membership => membership?.is_active === true && membership.organization_id === facility?.organization_id && ((membership.role === 'company_admin' && membership.facility_id == null) || (membership.role === 'facility_manager' && membership.facility_id === facility.id)));
}

function cleanName(value) {
 const name = String(value ?? '').trim();
 if (name.length < 1 || name.length > 80) return '';
 return name;
}

export function planInvitation({caller, facility, body}) {
 if (!caller?.userId) return {ok: false, status: 401, error: 'Bitte erneut anmelden.'};
 if (!facility?.id || !facility.organization_id) return {ok: false, status: 404, error: 'Der Betrieb wurde nicht gefunden.'};
 if (!canInviteFacility(facility, caller.memberships)) return {ok: false, status: 403, error: 'Keine Berechtigung für diesen Betrieb.'};
 const role = normalizeInvitationRole(body?.role);
 if (!role) return {ok: false, status: 400, error: 'Eine Einladung kann nur Mitarbeiter oder Techniker vorsehen.'};
 const email = String(body?.email ?? '').trim().toLowerCase();
 if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return {ok: false, status: 400, error: 'Bitte eine gültige E-Mail-Adresse eingeben.'};
 const firstName = cleanName(body?.first_name);
 const lastName = cleanName(body?.last_name);
 if (!firstName || !lastName) return {ok: false, status: 400, error: 'Bitte Vor- und Nachname eintragen.'};
 return {
  ok: true,
  row: {
   email,
   first_name: firstName,
   last_name: lastName,
   facility_id: facility.id,
   role,
   status: 'pending'
  }
 };
}

export function claimInvitations({user, invitations, facilities, memberships, requestedRole}) {
 void requestedRole;
 const email = String(user?.email ?? '').trim().toLowerCase();
 if (!user?.id || !email) return {ok: false, success: false, error: 'Keine versendete Einladung gefunden.', memberships: memberships || [], invitations: invitations || []};
 const nextInvitations = (invitations || []).map(item => ({...item}));
 const nextMemberships = (memberships || []).map(item => ({...item}));
 const applicable = [];
 for (const invitation of nextInvitations) {
  if (String(invitation.email ?? '').trim().toLowerCase() !== email || invitation.status !== 'sent') continue;
  const facility = (facilities || []).find(item => item.id === invitation.facility_id);
  if (!facility?.organization_id) return {ok: false, success: false, error: 'Der Betrieb der Einladung wurde nicht gefunden.', memberships, invitations};
  const role = normalizeInvitationRole(invitation.role);
  if (!role || (invitation.role != null && String(invitation.role).trim() !== '' && !invitationRoles.has(String(invitation.role).trim()))) {
   return {ok: false, success: false, error: 'Die Einladung enthält eine unzulässige Berechtigung.', memberships, invitations};
  }
  applicable.push({invitation, facility, role});
 }
 for (const item of applicable) {
  const existing = nextMemberships.find(membership => membership.user_id === user.id && membership.facility_id === item.facility.id && membership.organization_id === item.facility.organization_id);
  if (!existing) {
   nextMemberships.push({user_id: user.id, organization_id: item.facility.organization_id, facility_id: item.facility.id, role: item.role, is_active: true});
  } else if ((existing.role === 'employee' || existing.role === 'technician') && (rank[existing.role] || 0) < rank[item.role]) {
   existing.role = item.role;
  }
  item.invitation.status = 'accepted';
 }
 return {ok: true, success: applicable.length > 0, memberships: nextMemberships, invitations: nextInvitations, message: applicable.length ? '' : 'Keine versendete Einladung gefunden.'};
}
