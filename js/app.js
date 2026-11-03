
import {supabase} from './supabase.js';
import {priorityNames,roleNames,invitationStatus,statusNames} from './labels.js';
import {el,show,status} from './utils.js';
import {state} from './state.js';
import {isManager,loadPermissionData} from './permissions.js';
import {getCurrentUser,signInWithPassword,signOut,updateUser,acceptInvitation} from './auth.js';
import './meter-import.js';
// Invitation URLs from Supabase Auth contain type=invite and tokens in the URL fragment.
const initialHash=new URLSearchParams(location.hash.replace(/^#/,''));
const initialQuery=new URLSearchParams(location.search);
let invitationFlow=initialHash.get('type')==='invite'||initialQuery.get('type')==='invite'||initialHash.get('type')==='recovery';
const callbackError=initialHash.get('error_description')||initialQuery.get('error_description');
function draw(id,rows,empty){const node=el(id);node.replaceChildren();if(!rows.length){const p=document.createElement('p');p.className='muted';p.textContent=empty;node.append(p);return}for(const r of rows){const div=document.createElement('div');div.className='item';const b=document.createElement('strong');b.textContent=r.name;div.append(b);if(r.organization_id){const s=document.createElement('div');s.className='badge';s.textContent='Unternehmens-ID: '+r.organization_id.slice(0,8)+'…';div.append(s)}node.append(div)}}
async function load(){try{status('Berechtigte Betriebsdaten werden geladen …');const [o,f]=await Promise.all([supabase.from('organizations').select('id,name').order('name'),supabase.from('facilities').select('id,name,organization_id').order('name')]);if(o.error)throw o.error;if(f.error)throw f.error;draw('orgs',o.data||[],'Keine sichtbaren Unternehmen.');draw('facilities',f.data||[],'Keine sichtbaren Betriebe.');state.accessibleFacilities=f.data||[];const select=el('defect-facility');const previous=select.value;select.replaceChildren();for(const facility of state.accessibleFacilities){const option=document.createElement('option');option.value=facility.id;option.textContent=facility.name;select.append(option)}if(state.accessibleFacilities.some(x=>x.id===previous))select.value=previous;el('save-defect').disabled=!state.accessibleFacilities.length;el('summary').textContent=`Verbindung erfolgreich. ${o.data.length} Unternehmen und ${f.data.length} Betriebe geladen.`;status('✓ Anmeldung und Datenbankabfrage erfolgreich.');await loadPermissions();await loadDefects();await loadCriticalAcks();await loadSettings();renderDashboard();startRealtime()}catch(e){status('Datenbankabfrage fehlgeschlagen: '+e.message,true)}}
function inviteFacilityOptions(){const sel=el('invite-facility');const prev=sel.value;sel.replaceChildren();for(const f of state.accessibleFacilities.filter(isManager)){const opt=document.createElement('option');opt.value=f.id;opt.textContent=f.name;sel.append(opt)}if([...sel.options].some(o=>o.value===prev))sel.value=prev;el('invite-card').classList.toggle('hidden',!sel.options.length);el('invite-submit').disabled=!sel.options.length;}
async function loadInvitations(){const box=el('invite-list');box.textContent='Wird geladen …';const {data,error}=await supabase.from('staff_invitations').select('id,email,first_name,last_name,facility_id,status,invited_at').order('invited_at',{ascending:false}).limit(100);box.replaceChildren();if(error){box.textContent='Einladungen nicht verfügbar: '+error.message;return}if(!data?.length){box.textContent='Noch keine Einladungen.';return}for(const r of data){const div=document.createElement('div');div.className='item';const strong=document.createElement('strong');strong.textContent=r.first_name+' '+r.last_name;const sub=document.createElement('p');sub.className='help';sub.textContent=r.email+' · '+(state.accessibleFacilities.find(f=>f.id===r.facility_id)?.name||'Betrieb')+' · '+(invitationStatus[r.status]||r.status)+' · '+new Date(r.invited_at).toLocaleString('de-DE');div.append(strong,sub);if(['pending','sent'].includes(r.status)){const b=document.createElement('button');b.className='secondary';b.textContent='Einladung widerrufen';b.onclick=async()=>{if(!confirm('Einladung für '+r.email+' widerrufen?'))return;b.disabled=true;const {error}=await supabase.rpc('revoke_staff_invitation',{p_invitation_id:r.id});if(error){alert('Widerruf fehlgeschlagen: '+error.message);b.disabled=false}else await loadInvitations()};div.append(b)}box.append(div)}}
el('invite-form').addEventListener('submit',async e=>{e.preventDefault();const msg=el('invite-message');const b=el('invite-submit');const facility_id=el('invite-facility').value;if(!state.accessibleFacilities.some(f=>f.id===facility_id&&isManager(f))){msg.className='error';msg.textContent='Keine Berechtigung für den Betrieb.';return}b.disabled=true;msg.className='help';msg.textContent='Einladung wird versendet …';try{const {data,error}=await supabase.functions.invoke('invite-staff',{body:{facility_id,email:el('invite-email').value.trim(),first_name:el('invite-first').value.trim(),last_name:el('invite-last').value.trim()}});if(error)throw new Error(data?.error||error.message);if(!data?.ok)throw new Error(data?.error||'Versand nicht bestätigt');msg.className='ok';msg.textContent='✓ Einladung versendet. Der Mitarbeiter kann den Zugang über den E-Mail-Link einrichten.';el('invite-form').reset();await loadInvitations()}catch(err){msg.className='error';msg.textContent='Einladung fehlgeschlagen: '+err.message}finally{b.disabled=false}});
el('refresh-invites').addEventListener('click',loadInvitations);
function staffFacilityOptions(){const select=el('staff-facility');const old=select.value;select.replaceChildren();for(const f of state.accessibleFacilities.filter(isManager)){const o=document.createElement('option');o.value=f.id;o.textContent=f.name;select.append(o)}if([...select.options].some(o=>o.value===old))select.value=old;const enabled=select.options.length>0;el('staff-save').disabled=!enabled;el('staff-card').classList.toggle('hidden',!enabled);renderStaff()}
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
  const badge=document.createElement('span');badge.className='badge '+(m.is_active===false?'inactive':'active');badge.textContent=m.is_active===false?'● Deaktiviert':'● Aktiv';
  row.append(name,meta,badge);
  const actions=document.createElement('div');actions.className='staff-actions';
  const canChange=m.user_id!==state.currentUser?.id && !!m.email && (m.role==='employee'||state.myMemberships.some(x=>x.is_active!==false&&x.role==='company_admin'&&x.organization_id===m.organization_id));
  const edit=document.createElement('button');edit.type='button';edit.className='secondary';edit.textContent='✎ Namen bearbeiten';
  const form=document.createElement('form');form.className='employee-edit hidden';
  const label=document.createElement('label');label.textContent='Vollständiger Name';
  const input=document.createElement('input');input.type='text';input.value=m.name;input.maxLength=100;input.minLength=2;input.required=true;label.append(input);
  const save=document.createElement('button');save.type='submit';save.textContent='Namen speichern';
  const cancel=document.createElement('button');cancel.type='button';cancel.className='secondary';cancel.textContent='Abbrechen';cancel.style.marginLeft='8px';
  const message=document.createElement('p');message.className='help';
  cancel.onclick=()=>{form.classList.add('hidden');edit.disabled=false;input.value=m.name;message.textContent=''};
  edit.onclick=()=>{form.classList.remove('hidden');edit.disabled=true;input.focus()};
  form.onsubmit=async e=>{e.preventDefault();const fullName=input.value.trim();if(fullName.length<2){message.className='error';message.textContent='Bitte mindestens zwei Zeichen eingeben.';return}save.disabled=true;cancel.disabled=true;message.className='help';message.textContent='Wird gespeichert …';try{const {error}=await supabase.rpc('update_employee_name',{p_user_id:m.user_id,p_full_name:fullName});if(error)throw error;await loadPermissions();await loadDefects();status('✓ Mitarbeitername aktualisiert.')}catch(err){message.className='error';message.textContent='Namensänderung fehlgeschlagen: '+err.message;save.disabled=false;cancel.disabled=false}};
  form.append(label,save,cancel,message);
  if(canChange){
   actions.append(edit);
   const toggle=document.createElement('button');toggle.type='button';toggle.className=m.is_active===false?'secondary':'danger';toggle.textContent=m.is_active===false?'✓ Reaktivieren':'⛔ Deaktivieren';
   toggle.onclick=async()=>{
    const deactivate=m.is_active!==false;
    if(!confirm((deactivate?'Mitarbeiter deaktivieren':'Mitarbeiter reaktivieren')+'?\n'+m.name+' · '+(facility?.name||'Betrieb')+'\n\n'+(deactivate?'Der Zugriff auf diesen Betrieb wird gesperrt. Vorhandene Vorgänge bleiben erhalten.':'Der Zugriff auf diesen Betrieb wird wieder freigegeben.')))return;
    toggle.disabled=true;
    try{const {data,error}=await supabase.rpc('manage_facility_membership',{p_email:m.email,p_facility_id:m.facility_id,p_role:m.role,p_remove:deactivate});if(error)throw error;await loadPermissions();await loadDefects();status('✓ '+(data||'Mitarbeiterstatus geändert.'))}catch(e){status('Statusänderung fehlgeschlagen: '+e.message,true);toggle.disabled=false}
   };
   actions.append(toggle);
  }
  row.append(actions,form);box.append(row);
 }
}
async function manageStaff(remove){const facility=state.accessibleFacilities.find(f=>f.id===el('staff-facility').value);const email=el('staff-email').value.trim();const role=el('staff-role').value;const msg=el('staff-message');if(!facility||!email){msg.className='error';msg.textContent='Bitte Betrieb und E-Mail eingeben.';return}if(role==='facility_manager'&&!state.myMemberships.some(m=>m.organization_id===facility.organization_id&&m.role==='company_admin')){msg.className='error';msg.textContent='Nur die Geschäftsführung kann Betriebsleitungen ernennen.';return}el('staff-save').disabled=true;msg.className='help';msg.textContent='Wird gespeichert …';try{const {data,error}=await supabase.rpc('manage_facility_membership',{p_email:email,p_facility_id:facility.id,p_role:role,p_remove:remove});if(error)throw error;msg.className='ok';msg.textContent='✓ '+data;await loadPermissions();await loadDefects()}catch(e){msg.className='error';msg.textContent='Fehler: '+e.message}finally{el('staff-save').disabled=false}}
el('staff-form').addEventListener('submit',e=>{e.preventDefault();manageStaff(false)});

el('refresh-staff').addEventListener('click',async()=>{try{await loadPermissions();status('✓ Mitarbeiterliste aktualisiert.')}catch(e){status(e.message,true)}});
async function loadPermissions(){
 const managerFacilities=await loadPermissionData();
 staffFacilityOptions();inviteFacilityOptions();if(managerFacilities.length)await loadInvitations();populateDashboardFilters();
}
async function loadDefects(){
 const box=el('defect-list');box.replaceChildren();const info=document.createElement('p');info.className='muted';info.textContent='Mängel werden geladen …';box.append(info);
 const {data,error}=await supabase.from('defects').select('id,title,description,priority,status,facility_id,assigned_to,created_at').order('created_at',{ascending:false}).limit(1000);
 if(error){info.className='error';info.textContent='Mängel konnten nicht geladen werden: '+error.message;return}
 state.cachedDefects=(data||[]).sort((a,b)=>( {critical:0,high:1,normal:2,low:3}[a.priority]??2)-({critical:0,high:1,normal:2,low:3}[b.priority]??2)||new Date(b.created_at)-new Date(a.created_at));renderDashboard();el('mine-count').textContent=String(state.cachedDefects.filter(d=>d.assigned_to===state.currentUser?.id&&d.status!=='resolved').length);const mode=el('defect-filter').value;const visible=state.cachedDefects.filter(d=>mode==='mine'?d.assigned_to===state.currentUser?.id:mode==='open'?d.status!=='resolved':mode==='review'?d.status==='pending_review':true);box.replaceChildren();el('defect-count').textContent=String(visible.length);
 if(!visible.length){info.textContent='Keine Mängel in dieser Ansicht.';box.append(info);return}
 for(const defect of visible){
  const card=document.createElement('div');card.className='defect';
  const title=document.createElement('strong');title.textContent=defect.title;
  const badges=document.createElement('div');badges.className='help';
  const facility=state.accessibleFacilities.find(f=>f.id===defect.facility_id);
  const when=defect.created_at?new Date(defect.created_at).toLocaleString('de-DE'):'';
  badges.textContent=[facility?.name||'Betrieb',priorityNames[defect.priority]||defect.priority,statusNames[defect.status]||defect.status||'open',when].join(' · ');
  card.append(title,badges);
  if(defect.description){const p=document.createElement('p');p.textContent=defect.description;card.append(p)}
  if(defect.assigned_to){const p=document.createElement('p');p.className='help';p.textContent='Zugewiesen an: '+(state.staff.find(x=>x.user_id===defect.assigned_to)?.name||defect.assigned_to.slice(0,8));card.append(p)}
  if(facility&&isManager(facility)){
   const manage=document.createElement('div');manage.className='manage';
   const statusLabel=document.createElement('label');statusLabel.textContent='Bearbeitungsstatus';
   const statusSelect=document.createElement('select');
   for(const [value,label] of Object.entries(statusNames)){const o=document.createElement('option');o.value=value;o.textContent=label;statusSelect.append(o)}statusSelect.value=defect.status||'open';
   const assignLabel=document.createElement('label');assignLabel.textContent='Zuweisen an';
   const assign=document.createElement('select');const none=document.createElement('option');none.value='';none.textContent='Nicht zugewiesen';assign.append(none);
   const eligible=[...new Map(state.staff.filter(m=>m.is_active!==false&&m.organization_id===facility.organization_id&&(m.role==='company_admin'||m.facility_id===facility.id)).map(m=>[m.user_id,m])).values()];
   for(const member of eligible){const o=document.createElement('option');o.value=member.user_id;o.textContent=member.name;assign.append(o)}assign.value=defect.assigned_to||'';
   const noteLabel=document.createElement('label');noteLabel.textContent='Bearbeitungsvermerk';
   const note=document.createElement('textarea');note.placeholder='Was wurde veranlasst oder erledigt?';note.maxLength=2000;note.style.minHeight='70px';
   const button=document.createElement('button');button.className='secondary';button.textContent='Änderung speichern';
   const msg=document.createElement('p');msg.className='help';
   button.onclick=async()=>{if(defect.status==='pending_review'&&!note.value.trim()){msg.className='error';msg.textContent='Bitte einen Prüfvermerk zur Freigabe oder Rückgabe eintragen.';return}button.disabled=true;msg.textContent='Wird gespeichert …';try{
    const {error}=await supabase.from('defects').update({status:statusSelect.value,assigned_to:assign.value||null,change_note:note.value.trim()||null}).eq('id',defect.id);
    if(error)throw error;msg.className='ok';msg.textContent='✓ Änderung gespeichert';await loadDefects();
   }catch(e){msg.className='error';msg.textContent='Speichern fehlgeschlagen: '+e.message}finally{button.disabled=false}};
   manage.append(statusLabel,statusSelect,assignLabel,assign,noteLabel,note,button,msg);if(defect.status==='pending_review'){const review=document.createElement('div');review.className='review';review.textContent='Erledigung wurde gemeldet. Bitte Arbeit prüfen und danach den Status auf „Abgeschlossen“ setzen oder zur Nacharbeit auf „In Bearbeitung“ zurückstellen. Einen Prüfvermerk eintragen.';manage.prepend(review)}card.append(manage);
  }
  if(facility && !isManager(facility) && defect.assigned_to===state.currentUser?.id){
   const own=document.createElement('div');own.className='manage';
   const h=document.createElement('strong');h.textContent='Meine Bearbeitung';
   const label=document.createElement('label');label.textContent='Bearbeitungsstatus';
   const st=document.createElement('select');
   for(const [value,name] of [['in_progress','In Bearbeitung'],['pending_review','Erledigung melden (Freigabe nötig)']]){const o=document.createElement('option');o.value=value;o.textContent=name;st.append(o)}
   if(defect.status==='resolved'||defect.status==='pending_review'){st.disabled=true}
   const nl=document.createElement('label');nl.textContent='Arbeitsvermerk (Pflicht)';
   const note=document.createElement('textarea');note.maxLength=2000;note.placeholder='Was wurde geprüft, repariert oder veranlasst?';note.style.minHeight='75px';
   const btn=document.createElement('button');btn.className='secondary';btn.textContent='Meine Bearbeitung speichern';btn.disabled=defect.status==='resolved'||defect.status==='pending_review';
   const msg=document.createElement('p');msg.className='help';
   btn.onclick=async()=>{const comment=note.value.trim();if(!comment){msg.className='error';msg.textContent='Bitte einen Arbeitsvermerk eintragen.';return}btn.disabled=true;msg.textContent='Wird gespeichert …';try{
     const {error}=await supabase.rpc('employee_update_assigned_defect',{p_defect_id:defect.id,p_status:st.value,p_note:comment});
     if(error)throw error;await loadDefects();
   }catch(e){msg.className='error';msg.textContent='Speichern fehlgeschlagen: '+e.message;btn.disabled=false}};
   if(defect.status==='pending_review'){const wait=document.createElement('p');wait.className='review';wait.textContent='Deine Erledigung ist gemeldet. Die Betriebsleitung prüft den Vorgang. Bis zur Freigabe oder Rückgabe ist keine weitere Bearbeitung möglich.';own.append(wait)}own.append(h,label,st,nl,note,btn,msg);card.append(own);
  }
  const history=document.createElement('div');history.className='history';history.textContent='Verlauf wird geladen …';card.append(history);
  const {data:events,error:historyError}=await supabase.from('defect_events').select('created_at,action,note,actor_id').eq('defect_id',defect.id).order('created_at',{ascending:false}).limit(8);
  if(historyError){history.textContent='Verlauf nicht verfügbar: '+historyError.message}
  else if(!events.length){history.textContent='Noch keine Bearbeitungsänderungen.'}
  else{history.replaceChildren();for(const event of events){const line=document.createElement('div');const person=state.staff.find(m=>m.user_id===event.actor_id)?.name||'Benutzer';line.textContent=new Date(event.created_at).toLocaleString('de-DE')+' · '+person+' · '+event.action+(event.note?' · '+event.note:'');history.append(line)}}
  box.append(card);
 }
}
el('defect-form').addEventListener('submit',async event=>{event.preventDefault();if(state.busy)return;const facility=state.accessibleFacilities.find(f=>f.id===el('defect-facility').value);const title=el('defect-title').value.trim();if(!facility||!title){el('defect-message').textContent='Bitte Betrieb und Titel auswählen.';return}state.busy=true;el('save-defect').disabled=true;el('defect-message').className='help';el('defect-message').textContent='Mangel wird gespeichert …';try{const {data:{user},error:authError}=await getCurrentUser();if(authError||!user)throw authError||new Error('Bitte erneut anmelden.');const payload={organization_id:facility.organization_id,facility_id:facility.id,title,description:el('defect-desc').value.trim()||null,priority:el('defect-priority').value,created_by:user.id};const {error}=await supabase.from('defects').insert(payload);if(error)throw error;el('defect-title').value='';el('defect-desc').value='';el('defect-priority').value='normal';el('defect-message').className='ok';el('defect-message').textContent='✓ Mangel in Supabase gespeichert.';await loadDefects();await loadCriticalAcks()}catch(e){el('defect-message').className='error';el('defect-message').textContent='Speichern fehlgeschlagen: '+e.message}finally{state.busy=false;el('save-defect').disabled=!state.accessibleFacilities.length}});
el('refresh-defects').addEventListener('click',loadDefects);
el('defect-filter').addEventListener('change',()=>{el('nav-mine').classList.toggle('active',el('defect-filter').value==='mine');el('nav-all').classList.toggle('active',el('defect-filter').value!=='mine');loadDefects()});
for(const [id,mode] of [['nav-mine','mine'],['nav-all','all']])el(id).addEventListener('click',()=>{el('defect-filter').value=mode;el('defect-filter').dispatchEvent(new Event('change'));el('defect-list').scrollIntoView({behavior:'smooth',block:'start'})});
async function update(){
 if(state.updateInProgress)return;
 state.updateInProgress=true;
 try{
  const {data:{user},error}=await getCurrentUser();
  if(error && !['Auth session missing!','Auth session missing'].includes(error.message))throw error;
  state.currentUser=user||null;
  el('account').replaceChildren();
  if(user){
   const label=document.createElement('span');label.textContent=user.email+' ';
   const b=document.createElement('button');b.className='secondary';b.textContent='Abmelden';
   b.onclick=async()=>{const {error}=await signOut();if(error){status(error.message,true);return}invitationFlow=false;if(state.realtimeChannel){await supabase.removeChannel(state.realtimeChannel);state.realtimeChannel=null}state.cachedDefects=[];state.ackRows=[];await update()};
   el('account').append(label,b);
  }
  if(user && invitationFlow){
   show('login',false);show('app',false);show('invitation-setup',true);
   status('Einladungslink erkannt. Bitte persönliches Passwort festlegen.');
   return;
  }
  show('invitation-setup',false);show('login',!user);show('app',!!user);
  if(user){
   // On normal sign-in, also claim an existing sent invitation (e.g. previously registered user).
   try{const result=await acceptInvitation();if(result?.success)status('✓ Einladung angenommen.');}
   catch(e){status('Einladungsannahme nicht möglich: '+e.message,true)}
   await load();
  }else status(callbackError?'Einladungslink ungültig oder abgelaufen: '+callbackError:'Bitte mit deinem Tageswerk-Testkonto anmelden.',!!callbackError);
 }catch(e){status('Verbindung/Anmeldung fehlgeschlagen: '+e.message,true);show('login',true);show('app',false)}
 finally{state.updateInProgress=false}
}
el('setup-form').addEventListener('submit',async e=>{
 e.preventDefault();const msg=el('setup-message'),btn=el('setup-submit');
 const password=el('setup-password').value;
 if(password.length<12||password!==el('setup-confirm').value){msg.className='error';msg.textContent='Bitte ein Passwort mit mindestens 12 Zeichen eingeben und identisch wiederholen.';return}
 btn.disabled=true;msg.className='help';msg.textContent='Zugang wird eingerichtet …';
 try{
  const {data:{user},error:authError}=await getCurrentUser();
  if(authError||!user)throw new Error('Der Einladungslink ist abgelaufen. Bitte um eine neue Einladung bitten.');
  const {error:pwError}=await updateUser({password});
  if(pwError)throw pwError;
  const result=await acceptInvitation();
  if(!result?.success){msg.className='error';msg.textContent='Passwort gespeichert, aber die Betriebszuordnung ist noch offen: '+(result?.message||'Keine versendete Einladung gefunden.')+' Bitte Betriebsleitung kontaktieren.';return}
  msg.className='ok';msg.textContent='✓ Passwort gespeichert und Einladung angenommen.';
  el('setup-form').reset();invitationFlow=false;
  await update();
 }catch(err){msg.className='error';msg.textContent='Einrichtung fehlgeschlagen: '+err.message}
 finally{btn.disabled=false}
});
el('form').addEventListener('submit',async e=>{e.preventDefault();el('submit').disabled=true;status('Anmeldung wird geprüft …');try{const {error}=await signInWithPassword({email:el('email').value.trim(),password:el('password').value});if(error)throw error;el('password').value='';await update()}catch(err){status('Anmeldung fehlgeschlagen: '+err.message,true)}finally{el('submit').disabled=false}});

// Tageswerk 2.9: navigation and dashboard. RLS on Supabase remains authoritative.
function navigate(view){state.currentView=view;for(const v of ['dashboard','defects','more'])show('view-'+v,view==='dashboard'?v==='dashboard':view==='more'?v==='more':v==='defects');
 el('report-panel').classList.toggle('hidden',view==='tasks');el('defects-panel').classList.toggle('hidden',view==='report');
 if(view==='tasks'){el('defect-filter').value='mine';loadDefects()}else if(view==='defects'){el('defect-filter').value='all';loadDefects()}
 for(const b of document.querySelectorAll('[data-view]'))b.classList.toggle('active',b.dataset.view===view);
 window.scrollTo({top:0,behavior:'smooth'});
}
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.view)));
function populateDashboardFilters(){const sel=el('dashboard-facility');const old=sel.value;sel.replaceChildren();const all=document.createElement('option');all.value='all';all.textContent='Alle berechtigten Betriebe';sel.append(all);for(const f of state.accessibleFacilities){const opt=document.createElement('option');opt.value=f.id;opt.textContent=f.name;sel.append(opt)}sel.value=state.accessibleFacilities.some(f=>f.id===old)?old:'all';
 const settings=el('settings-facility');const previous=settings.value;settings.replaceChildren();for(const f of state.accessibleFacilities.filter(isManager)){const o=document.createElement('option');o.value=f.id;o.textContent=f.name;settings.append(o)}if([...settings.options].some(o=>o.value===previous))settings.value=previous;el('settings-card').classList.toggle('hidden',!settings.options.length)}
function dashRows(target,rows,empty){const box=el(target);box.replaceChildren();if(!rows.length){const p=document.createElement('p');p.className='muted';p.textContent=empty;box.append(p);return}for(const d of rows.slice(0,8)){const item=document.createElement('div');item.className='dash-row';item.tabIndex=0;item.setAttribute('role','button');const title=document.createElement('strong');title.textContent=d.title;title.className='priority-'+(d.priority||'normal');const detail=document.createElement('small');detail.textContent=(state.accessibleFacilities.find(f=>f.id===d.facility_id)?.name||'Betrieb')+' · '+(priorityNames[d.priority]||'Normal')+' · '+(statusNames[d.status]||d.status);item.append(title,detail);const go=()=>{navigate('defects');el('defect-filter').value='all';loadDefects()};item.onclick=go;item.onkeydown=e=>{if(e.key==='Enter')go()};box.append(item)}}
function renderDashboard(){if(!el('metric-open'))return;const selected=el('dashboard-facility').value;const data=state.cachedDefects.filter(d=>selected==='all'||d.facility_id===selected);const count=(pred)=>data.filter(pred).length;
 for(const [id,n] of [['open',count(d=>d.status==='open')],['progress',count(d=>d.status==='in_progress')],['resolved',count(d=>d.status==='resolved')],['review',count(d=>d.status==='pending_review')],['mine',count(d=>d.assigned_to===state.currentUser?.id&&d.status!=='resolved')],['critical',count(d=>d.priority==='critical'&&d.status!=='resolved')]])el('metric-'+id).textContent=n;
 dashRows('dash-mine',data.filter(d=>d.assigned_to===state.currentUser?.id&&d.status!=='resolved'),'Keine offenen persönlichen Aufgaben.');dashRows('dash-recent',[...data].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)),'Noch keine Mängel.');
 const facilities=el('dash-facilities');facilities.replaceChildren();for(const f of state.accessibleFacilities.filter(f=>selected==='all'||f.id===selected)){const row=document.createElement('div');row.className='item';row.textContent=f.name+' · '+data.filter(d=>d.facility_id===f.id&&d.status!=='resolved').length+' nicht abgeschlossene Mängel';facilities.append(row)}if(!facilities.childNodes.length)facilities.textContent='Keine berechtigten Betriebe.';renderCriticalAlerts(data)}
el('dashboard-facility').addEventListener('change',renderDashboard);
async function loadCriticalAcks(){if(!state.currentUser)return;const {data,error}=await supabase.from('critical_defect_acknowledgements').select('defect_id,acknowledged_by,acknowledged_at');if(error){state.notificationSupport=false;state.ackRows=[];return}state.notificationSupport=true;state.ackRows=data||[];renderDashboard()}
function renderCriticalAlerts(data){const box=el('dashboard-alerts');box.replaceChildren();const critical=data.filter(d=>d.priority==='critical'&&d.status!=='resolved');if(!critical.length)return;const heading=document.createElement('div');heading.className='alert-box';const h=document.createElement('strong');h.textContent='🚨 '+critical.length+' kritische Mängel';heading.append(h);const p=document.createElement('p');p.className='help';p.textContent='Bei akuter Gefahr sofort die betrieblichen Sicherheits- und Meldewege nutzen. Die App ersetzt keine Notfallalarmierung.';heading.append(p);if(!state.notificationSupport){const note=document.createElement('p');note.className='help';note.textContent='Kenntnisnahme noch nicht eingerichtet. Bitte die SQL-Migration ausführen.';heading.append(note)}
 for(const d of critical){const f=state.accessibleFacilities.find(x=>x.id===d.facility_id);if(!f)continue;const row=document.createElement('div');row.className='item';const acknowledged=state.ackRows.filter(a=>a.defect_id===d.id);const title=document.createElement('strong');title.textContent=d.title+' · '+f.name;row.append(title);const sub=document.createElement('p');sub.className='help';sub.textContent=acknowledged.length?'Kenntnisnahme dokumentiert: '+new Date(acknowledged[0].acknowledged_at).toLocaleString('de-DE'):'Noch keine Kenntnisnahme dokumentiert';row.append(sub);
 if(isManager(f)&&state.notificationSupport&&!acknowledged.some(a=>a.acknowledged_by===state.currentUser?.id)){const btn=document.createElement('button');btn.className='secondary compact-button';btn.textContent='Zur Kenntnis genommen';btn.onclick=async()=>{btn.disabled=true;const {error}=await supabase.from('critical_defect_acknowledgements').insert({defect_id:d.id,acknowledged_by:state.currentUser.id});if(error){alert('Bestätigung fehlgeschlagen: '+error.message);btn.disabled=false}else await loadCriticalAcks()};row.append(btn)}heading.append(row)}box.append(heading)}
async function loadSettings(){const {data,error}=await supabase.from('facility_escalation_settings').select('facility_id,reminder_minutes,escalation_minutes,after_hours_mode,business_hours');if(error){state.settingsRows=[];el('settings-message').textContent='Einstellungen noch nicht verfügbar. Bitte SQL-Migration einspielen.';return}state.settingsRows=data||[];displaySettings()}
function displaySettings(){const f=el('settings-facility').value;const s=state.settingsRows.find(x=>x.facility_id===f);el('setting-reminder').value=s?.reminder_minutes??15;el('setting-escalation').value=s?.escalation_minutes??30;el('setting-mode').value=s?.after_hours_mode??'always';el('setting-hours').value=s?.business_hours?JSON.stringify(s.business_hours,null,2):''}
el('settings-facility').addEventListener('change',displaySettings);el('settings-expert').addEventListener('change',()=>show('expert-fields',el('settings-expert').checked));
el('save-settings').addEventListener('click',async()=>{const f=el('settings-facility').value;const msg=el('settings-message');if(!f||!state.accessibleFacilities.some(x=>x.id===f&&isManager(x))){msg.textContent='Keine Berechtigung für diesen Betrieb.';return}const reminder=Number(el('setting-reminder').value),escalation=Number(el('setting-escalation').value);if(!Number.isInteger(reminder)||!Number.isInteger(escalation)||reminder<1||escalation<=reminder){msg.textContent='Die Eskalation muss später als die erste Erinnerung erfolgen.';return}let hours={};try{hours=el('setting-hours').value.trim()?JSON.parse(el('setting-hours').value):{}}catch(e){msg.textContent='Betriebszeiten: ungültiges JSON.';return}const {error}=await supabase.from('facility_escalation_settings').upsert({facility_id:f,reminder_minutes:reminder,escalation_minutes:escalation,after_hours_mode:el('setting-mode').value,business_hours:hours},{onConflict:'facility_id'});msg.textContent=error?'Speichern fehlgeschlagen: '+error.message:'✓ Einstellungen gespeichert.';if(!error)await loadSettings()});
function startRealtime(){if(state.realtimeChannel){supabase.removeChannel(state.realtimeChannel);state.realtimeChannel=null}if(!state.currentUser)return;state.realtimeChannel=supabase.channel('tageswerk29-updates').on('postgres_changes',{event:'*',schema:'public',table:'defects'},()=>scheduleRefresh()).on('postgres_changes',{event:'*',schema:'public',table:'critical_defect_acknowledgements'},()=>scheduleRefresh()).subscribe((channelState)=>{el('live-indicator').textContent=channelState==='SUBSCRIBED'?'● Live verbunden':channelState==='CHANNEL_ERROR'?'⚠ Live-Verbindung gestört':'Synchronisierung: '+channelState});}
function scheduleRefresh(){clearTimeout(state.refreshTimer);state.refreshTimer=setTimeout(async()=>{await loadDefects();await loadCriticalAcks();renderDashboard()},550)}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.currentUser)scheduleRefresh()});

el('reload').addEventListener('click',load);await update();
