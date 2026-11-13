import {supabase} from './supabase.js';
import {roleNames,invitationStatus} from './labels.js';
import {el,status} from './utils.js';
import {state} from './state.js';
import {isManager,mayAppointManager} from './permissions.js';

let staffRefresh=async()=>{};
let staffReloadPermissions=async()=>{};
export function setStaffActions(actions){
 if(actions.refresh)staffRefresh=actions.refresh;
 if(actions.reloadPermissions)staffReloadPermissions=actions.reloadPermissions;
}

export function inviteFacilityOptions(){const sel=el('invite-facility');const prev=sel.value;sel.replaceChildren();for(const f of state.accessibleFacilities.filter(isManager)){const opt=document.createElement('option');opt.value=f.id;opt.textContent=f.name;sel.append(opt)}if([...sel.options].some(o=>o.value===prev))sel.value=prev;el('invite-card').classList.toggle('hidden',!sel.options.length);el('invite-submit').disabled=!sel.options.length;}
export async function loadInvitations(){const box=el('invite-list');box.textContent='Wird geladen …';const invitationColumns='id,email,first_name,last_name,facility_id,status,invited_at';let {data,error}=await supabase.from('staff_invitations').select(invitationColumns+',role').order('invited_at',{ascending:false}).limit(100);if(error&&(error.code==='PGRST204'||/column staff_invitations\.role/.test(error.message||''))){({data,error}=await supabase.from('staff_invitations').select(invitationColumns).order('invited_at',{ascending:false}).limit(100))}box.replaceChildren();if(error){box.textContent='Einladungen nicht verfügbar: '+error.message;return}const managed=new Set(state.accessibleFacilities.filter(isManager).map(f=>f.id));const rows=(data||[]).filter(r=>managed.has(r.facility_id));if(!rows.length){box.textContent='Noch keine Einladungen.';return}for(const r of rows){const div=document.createElement('div');div.className='item';const strong=document.createElement('strong');strong.textContent=r.first_name+' '+r.last_name;const sub=document.createElement('p');sub.className='help';sub.textContent=r.email+' · '+(state.accessibleFacilities.find(f=>f.id===r.facility_id)?.name||'Betrieb')+' · '+(r.role?(roleNames[r.role]||r.role)+' · ':'')+(invitationStatus[r.status]||r.status)+' · '+new Date(r.invited_at).toLocaleString('de-DE');div.append(strong,sub);if(['pending','sent'].includes(r.status)){const b=document.createElement('button');b.className='secondary';b.textContent='Einladung widerrufen';b.onclick=async()=>{if(!confirm('Einladung für '+r.email+' widerrufen?'))return;b.disabled=true;const {error}=await supabase.rpc('revoke_staff_invitation',{p_invitation_id:r.id});if(error){alert('Widerruf fehlgeschlagen: '+error.message);b.disabled=false}else await loadInvitations()};div.append(b)}box.append(div)}}
el('invite-form')?.addEventListener('submit',async e=>{e.preventDefault();const msg=el('invite-message');const b=el('invite-submit');const facility_id=el('invite-facility').value;const inviteRole=el('invite-role').value;if(!state.accessibleFacilities.some(f=>f.id===facility_id&&isManager(f))){msg.className='error';msg.textContent='Keine Berechtigung für den Betrieb.';return}if(inviteRole!=='employee'&&inviteRole!=='technician'){msg.className='error';msg.textContent='Bitte Mitarbeiter oder Techniker auswählen.';return}b.disabled=true;msg.className='help';msg.textContent='Einladung wird versendet …';try{const {data,error}=await supabase.functions.invoke('invite-staff',{body:{facility_id,role:inviteRole,email:el('invite-email').value.trim(),first_name:el('invite-first').value.trim(),last_name:el('invite-last').value.trim()}});if(error)throw new Error(data?.error||error.message);if(!data?.ok)throw new Error(data?.error||'Versand nicht bestätigt');msg.className='ok';msg.textContent=data.existing_account?'✓ Das Konto besteht bereits. Eine vorhandene Zuordnung bleibt unverändert.':'✓ Einladung versendet. Der Zugang kann über den E-Mail-Link eingerichtet werden.';el('invite-form').reset();await loadInvitations()}catch(err){msg.className='error';msg.textContent='Einladung fehlgeschlagen: '+err.message}finally{b.disabled=false}});
el('refresh-invites')?.addEventListener('click',loadInvitations);
export function staffFacilityOptions(){const select=el('staff-facility');const old=select.value;select.replaceChildren();for(const f of state.accessibleFacilities.filter(isManager)){const o=document.createElement('option');o.value=f.id;o.textContent=f.name;select.append(o)}if([...select.options].some(o=>o.value===old))select.value=old;const enabled=select.options.length>0;el('staff-save').disabled=!enabled;el('staff-card').classList.toggle('hidden',!enabled);renderStaff()}
function renderStaff(){
 const box=el('staff-list');box.replaceChildren();
 const allowed=state.accessibleFacilities.filter(isManager);
 const rows=state.staff.filter(m=>m.email&&m.role!=='company_admin'&&allowed.some(f=>f.id===m.facility_id));
 if(!rows.length){const p=document.createElement('p');p.className='muted';p.textContent='Keine sichtbaren Teamzuordnungen.';box.append(p);return}
 for(const m of rows){
  const row=document.createElement('div');row.className='item';
  const name=document.createElement('strong');name.textContent=m.name;
  const meta=document.createElement('div');meta.className='help';
  const facility=state.accessibleFacilities.find(f=>f.id===m.facility_id);
  meta.textContent=[m.email||'E-Mail nicht verfügbar',facility?.name||'Betrieb',roleNames[m.role]||m.role].join(' · ');
  const activeMembership=m.is_active===true;const badge=document.createElement('span');badge.className='badge '+(activeMembership?'active':'inactive');badge.textContent=activeMembership?'● Aktiv':'● Deaktiviert';
  row.append(name,meta,badge);
  const actions=document.createElement('div');actions.className='staff-actions';
  const canChange=m.user_id!==state.currentUser?.id && !!m.email && (m.role==='employee'||m.role==='technician'||mayAppointManager(m.organization_id,state.myMemberships));
  const edit=document.createElement('button');edit.type='button';edit.className='secondary';edit.textContent='✎ Namen bearbeiten';
  const form=document.createElement('form');form.className='employee-edit hidden';
  const label=document.createElement('label');label.textContent='Vollständiger Name';
  const input=document.createElement('input');input.type='text';input.value=m.name;input.maxLength=100;input.minLength=2;input.required=true;label.append(input);
  const save=document.createElement('button');save.type='submit';save.textContent='Namen speichern';
  const cancel=document.createElement('button');cancel.type='button';cancel.className='secondary';cancel.textContent='Abbrechen';cancel.style.marginLeft='8px';
  const message=document.createElement('p');message.className='help';
  cancel.onclick=()=>{form.classList.add('hidden');edit.disabled=false;input.value=m.name;message.textContent=''};
  edit.onclick=()=>{form.classList.remove('hidden');edit.disabled=true;input.focus()};
  form.onsubmit=async e=>{e.preventDefault();const fullName=input.value.trim();if(fullName.length<2){message.className='error';message.textContent='Bitte mindestens zwei Zeichen eingeben.';return}save.disabled=true;cancel.disabled=true;message.className='help';message.textContent='Wird gespeichert …';try{const {error}=await supabase.rpc('update_employee_name',{p_user_id:m.user_id,p_full_name:fullName});if(error)throw error;await staffRefresh();status('✓ Mitarbeitername aktualisiert.')}catch(err){message.className='error';message.textContent='Namensänderung fehlgeschlagen: '+err.message;save.disabled=false;cancel.disabled=false}};
  form.append(label,save,cancel,message);
  if(canChange){
   actions.append(edit);
   const toggle=document.createElement('button');toggle.type='button';toggle.className=activeMembership?'danger':'secondary';toggle.textContent=activeMembership?'⛔ Deaktivieren':'✓ Reaktivieren';
   toggle.onclick=async()=>{
    const deactivate=activeMembership;
    if(!confirm((deactivate?'Mitarbeiter deaktivieren':'Mitarbeiter reaktivieren')+'?\n'+m.name+' · '+(facility?.name||'Betrieb')+'\n\n'+(deactivate?'Der Zugriff auf diesen Betrieb wird gesperrt. Vorhandene Vorgänge bleiben erhalten.':'Der Zugriff auf diesen Betrieb wird wieder freigegeben.')))return;
    toggle.disabled=true;
    try{const {data,error}=await supabase.rpc('manage_facility_membership',{p_email:m.email,p_facility_id:m.facility_id,p_role:m.role,p_remove:deactivate});if(error)throw error;await staffRefresh();status('✓ '+(data||'Mitarbeiterstatus geändert.'))}catch(e){status('Statusänderung fehlgeschlagen: '+e.message,true);toggle.disabled=false}
   };
   actions.append(toggle);
  }
  row.append(actions,form);box.append(row);
 }
}
async function manageStaff(remove){const facility=state.accessibleFacilities.find(f=>f.id===el('staff-facility').value);const email=el('staff-email').value.trim();const role=el('staff-role').value;const msg=el('staff-message');if(!facility||!email){msg.className='error';msg.textContent='Bitte Betrieb und E-Mail eingeben.';return}if(!isManager(facility)){msg.className='error';msg.textContent='Keine Berechtigung für den Betrieb.';return}if(role==='facility_manager'&&!mayAppointManager(facility.organization_id,state.myMemberships)){msg.className='error';msg.textContent='Nur die Geschäftsführung kann Betriebsleitungen ernennen.';return}el('staff-save').disabled=true;msg.className='help';msg.textContent='Wird gespeichert …';try{const {data,error}=await supabase.rpc('manage_facility_membership',{p_email:email,p_facility_id:facility.id,p_role:role,p_remove:remove});if(error)throw error;msg.className='ok';msg.textContent='✓ '+data;await staffRefresh()}catch(e){msg.className='error';msg.textContent='Fehler: '+e.message}finally{el('staff-save').disabled=false}}
el('staff-form')?.addEventListener('submit',e=>{e.preventDefault();manageStaff(false)});

el('refresh-staff')?.addEventListener('click',async()=>{try{await staffReloadPermissions();status('✓ Mitarbeiterliste aktualisiert.')}catch(e){status(e.message,true)}});

