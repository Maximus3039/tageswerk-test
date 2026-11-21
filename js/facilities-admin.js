import {supabase} from './supabase.js';
import {el} from './utils.js';
import {state} from './state.js';
import {mayAppointManager} from './permissions.js';

function adminOrganizations() {
 const ids = new Set((state.myMemberships || []).filter(membership =>
  membership.is_active === true && membership.role === 'company_admin' && membership.facility_id == null
 ).map(membership => membership.organization_id));
 return (state.organizations || []).filter(org => ids.has(org.id));
}

export function syncFacilityAdmin() {
 const card = el('facility-admin-card');
 if (!card) return;
 const orgs = adminOrganizations();
 card.classList.toggle('hidden', !orgs.length);
 const select = el('facility-admin-org');
 if (!select) return;
 select.replaceChildren();
 for (const org of orgs) {
  const option = document.createElement('option');
  option.value = org.id;
  option.textContent = org.name;
  select.append(option);
 }
}

export async function createManagedFacility(organizationId, name) {
 const org = adminOrganizations().find(item => item.id === organizationId);
 const label = String(name || '').trim();
 if (!org) return {ok: false, error: 'Nur die Geschäftsführung legt neue Betriebe an.'};
 if (!mayAppointManager(org.id, state.myMemberships)) return {ok: false, error: 'Keine Berechtigung für diesen Mandanten.'};
 if (label.length < 2 || label.length > 120) return {ok: false, error: 'Bitte einen Betriebsnamen zwischen 2 und 120 Zeichen angeben.'};
 const result = await supabase.rpc('tageswerk_create_facility', {
  p_organization_id: org.id,
  p_name: label
 });
 if (result.error) {
  if (/schema cache|PGRST202|does not exist|42883/i.test(result.error.message || '')) {
   return {ok: false, error: 'Das Anlegen von Betrieben ist vorbereitet, die SQL-Funktion ist in dieser Datenbank noch nicht installiert. Es wurde nichts gespeichert.'};
  }
  return {ok: false, error: result.error.message};
 }
 return {ok: true, facility: result.data};
}

function bind() {
 const form = el('facility-admin-form');
 if (!form || form.dataset.bound === '1') return;
 form.dataset.bound = '1';
 form.addEventListener('submit', async event => {
  event.preventDefault();
  const message = el('facility-admin-message');
  const submit = el('facility-admin-submit');
  if (submit) submit.disabled = true;
  if (message) {
   message.className = 'help';
   message.textContent = 'Betrieb wird angelegt …';
  }
  const result = await createManagedFacility(el('facility-admin-org')?.value, el('facility-admin-name')?.value);
  if (message) {
   message.className = result.ok ? 'ok' : 'error';
   message.textContent = result.ok ? 'Betrieb angelegt. Bitte Daten neu laden.' : result.error;
  }
  if (result.ok && el('facility-admin-name')) el('facility-admin-name').value = '';
  if (submit) submit.disabled = false;
 });
}

export function mountFacilityAdmin() {
 bind();
 syncFacilityAdmin();
}
