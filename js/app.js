import {supabase} from './supabase.js';
import {el,show,status} from './utils.js';
import {state} from './state.js';
import {loadPermissionData} from './permissions.js';
import {getCurrentUser,signInWithPassword,signOut,updateUser,acceptInvitation,resetPasswordForEmail} from './auth.js';
import {PASSWORD_RESET_REDIRECT,PASSWORD_SAVED_MESSAGE,EMAIL_INVALID_MESSAGE,callbackNotice,passwordChoice,passwordResetEmail,readAuthCallback,recoveryAllowsSave,recoveryFailure,resetRequestOutcome,screenForAuth} from './password-reset.js';
import {loadFacilityMeters} from './meters.js';
import {syncMeterImportAccess} from './meter-import.js';
import {onCapture, onOpenNotice, onOpenTask, toggleCapture} from './mobile.js';
import {focusNotice, mountOperations, showOperationSection} from './operations-ui.js';
import {clearLocalWaterDrafts} from './operations-controls.js';
import {inviteFacilityOptions,loadInvitations,setStaffActions,staffFacilityOptions} from './staff-ui.js';
import {loadDefects} from './defects-ui.js';
import {loadCriticalAcks,loadSettings,populateConsumptionFacility,populateDashboardFilters,renderDashboard,resetConsumptionPanel,setDashboardActions,touchConsumptionFacility} from './dashboard.js';

// Invitation URLs contain type=invite. Recovery URLs contain type=recovery or vorgang=passwort.
const initialCallback=readAuthCallback({hash:location.hash,search:location.search});
let invitationFlow=initialCallback.type==='invite';
let recoveryFlow=initialCallback.type==='recovery'||(initialCallback.recoveryMarked&&initialCallback.hasCredential&&!initialCallback.error&&!initialCallback.errorCode&&!initialCallback.errorDescription);
let passwordRequestOpen=false;
let recoveryDone='';
let callbackConsumed=false;
let authRefreshQueued=false;
let resetPending=false;
let recoveryPending=false;
function activeCallback(){
 if(callbackConsumed)return {type:'',error:'',errorCode:'',errorDescription:'',recoveryMarked:false,hasCredential:false};
 const live=readAuthCallback({hash:location.hash,search:location.search});
 return {
  type:live.type||initialCallback.type,
  error:live.error||initialCallback.error,
  errorCode:live.errorCode||initialCallback.errorCode,
  errorDescription:live.errorDescription||initialCallback.errorDescription,
  recoveryMarked:live.recoveryMarked||initialCallback.recoveryMarked,
  hasCredential:live.hasCredential||initialCallback.hasCredential
 };
}
function clearAuthUrl(){
 callbackConsumed=true;
 if(location.search||location.hash)history.replaceState(null,'',location.pathname);
}
function screenForSession(callback,user){
 return screenForAuth({callback,user,recoveryFlow,recoveryDone:Boolean(recoveryDone),passwordRequestOpen});
}
supabase.auth.onAuthStateChange(event=>{
 if(event!=='PASSWORD_RECOVERY')return;
 recoveryFlow=true;
 invitationFlow=false;
 passwordRequestOpen=false;
 if(state.updateInProgress){authRefreshQueued=true;return}
 update();
});
function draw(id,rows,empty){const node=el(id);node.replaceChildren();if(!rows.length){const p=document.createElement('p');p.className='muted';p.textContent=empty;node.append(p);return}for(const r of rows){const div=document.createElement('div');div.className='item';const b=document.createElement('strong');b.textContent=r.name;div.append(b);if(r.organization_id){const s=document.createElement('div');s.className='badge';s.textContent='Unternehmens-ID: '+r.organization_id.slice(0,8)+'…';div.append(s)}node.append(div)}}
async function load(){try{status('Berechtigte Betriebsdaten werden geladen …');const [o,f]=await Promise.all([supabase.from('organizations').select('id,name').order('name'),supabase.from('facilities').select('id,name,organization_id').order('name')]);if(o.error)throw o.error;if(f.error)throw f.error;state.organizations=o.data||[];state.accessibleFacilities=f.data||[];status('✓ Anmeldung und Datenbankabfrage erfolgreich.');await loadPermissions();await loadDefects();await loadCriticalAcks();await loadSettings();renderDashboard();startRealtime()}catch(e){status('Datenbankabfrage fehlgeschlagen: '+e.message,true)}}
function refreshScopeCards(){const orgIds=new Set(state.accessibleFacilities.map(f=>f.organization_id));draw('orgs',(state.organizations||[]).filter(o=>orgIds.has(o.id)),'Keine sichtbaren Unternehmen.');draw('facilities',state.accessibleFacilities,'Keine sichtbaren Betriebe.');const select=el('defect-facility');const previous=select.value;select.replaceChildren();for(const facility of state.accessibleFacilities){const option=document.createElement('option');option.value=facility.id;option.textContent=facility.name;select.append(option)}if(state.accessibleFacilities.some(x=>x.id===previous))select.value=previous;el('save-defect').disabled=!state.accessibleFacilities.length;el('summary').textContent=`Sichtbar: ${orgIds.size} Unternehmen und ${state.accessibleFacilities.length} Betriebe.`;}
async function loadPermissions(){
 const managerFacilities=await loadPermissionData();
 refreshScopeCards();
 staffFacilityOptions();inviteFacilityOptions();if(managerFacilities.length)await loadInvitations();populateDashboardFilters();populateConsumptionFacility();syncMeterImportAccess();await loadFacilityMeters(el('consumption-facility').value);
}
setStaffActions({
 refresh:async()=>{await loadPermissions();await loadDefects()},
 reloadPermissions:async()=>{await loadPermissions()}
});
setDashboardActions({
 openDefects:()=>{navigate('defects');el('defect-filter').value='all';loadDefects()}
});
async function update(){
 if(state.updateInProgress)return;
 state.updateInProgress=true;
 try{
  const {data:{user},error}=await getCurrentUser();
  if(error && !['Auth session missing!','Auth session missing'].includes(error.message))throw error;
  state.currentUser=user||null;
  if(!user) clearLocalWaterDrafts();
  el('account').replaceChildren();
  if(user){
   const label=document.createElement('span');label.textContent=user.email+' ';
   const b=document.createElement('button');b.className='secondary';b.textContent='Abmelden';
   b.onclick=async()=>{const {error}=await signOut();if(error){status(error.message,true);return}clearLocalWaterDrafts();invitationFlow=false;recoveryFlow=false;passwordRequestOpen=false;recoveryDone='';callbackConsumed=true;if(state.realtimeChannel){await supabase.removeChannel(state.realtimeChannel);state.realtimeChannel=null}state.cachedDefects=[];state.ackRows=[];await update()};
   el('account').append(label,b);
  }
  if(user && invitationFlow){
   show('login',false);show('app',false);show('password-request',false);show('password-recovery',false);show('invitation-setup',true);
   status('Einladungslink erkannt. Bitte persönliches Passwort festlegen.');
   return;
  }
  const callback=activeCallback();
  const screen=screenForSession(callback,user);
  if(screen==='recovery'||screen==='recovery-expired'||screen==='recovery-invalid'||screen==='recovery-done'){
   show('login',false);show('app',false);show('invitation-setup',false);show('password-request',false);show('password-recovery',true);
   const showForm=screen==='recovery';
   el('recovery-form').classList.toggle('hidden',!showForm);
   el('recovery-intro').classList.toggle('hidden',!showForm);
   el('recovery-login').classList.toggle('hidden',showForm);
   if(screen==='recovery-done'){el('recovery-message').className='ok';el('recovery-message').textContent=recoveryDone;status(recoveryDone);}
   else if(screen!=='recovery'){const notice=callbackNotice(callback,screen);el('recovery-message').className='error';el('recovery-message').textContent=notice;status(notice,true);}
   else status('Bitte ein neues Passwort festlegen.');
   return;
  }
  if(screen==='password-request'){
   show('login',false);show('app',false);show('invitation-setup',false);show('password-recovery',false);show('password-request',true);
   return;
  }
  show('invitation-setup',false);show('password-request',false);show('password-recovery',false);show('login',!user);show('app',!!user);
  if(user){
   // On normal sign-in, also claim an existing sent invitation (e.g. previously registered user).
   try{const result=await acceptInvitation();if(result?.success)status('✓ Einladung angenommen.');}
   catch(e){status('Einladungsannahme nicht möglich: '+e.message,true)}
   await load();
  }else{resetConsumptionPanel();syncMeterImportAccess();const notice=callbackNotice(callback,'login');status(notice||'Bitte mit deinem Tageswerk-Testkonto anmelden.',!!notice);}
 }catch(e){status('Verbindung/Anmeldung fehlgeschlagen: '+e.message,true);if(!recoveryFlow){show('login',true);show('app',false)}}
 finally{state.updateInProgress=false;if(authRefreshQueued){authRefreshQueued=false;await update();}}
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
el('forgot-password').addEventListener('click',()=>{passwordRequestOpen=true;el('reset-request-message').textContent='';el('reset-request-message').className='help';update()});
el('reset-request-back').addEventListener('click',()=>{passwordRequestOpen=false;el('reset-request-form').reset();el('reset-request-message').textContent='';update()});
el('reset-request-form').addEventListener('submit',async e=>{
 e.preventDefault();
 if(resetPending)return;
 const message=el('reset-request-message');
 const email=passwordResetEmail(el('reset-email').value);
 if(!email){message.className='error';message.textContent=EMAIL_INVALID_MESSAGE;return}
 resetPending=true;el('reset-request-submit').disabled=true;message.className='help';message.textContent='Der Link wird vorbereitet …';
 try{
  const {error}=await resetPasswordForEmail(email,PASSWORD_RESET_REDIRECT);
  const outcome=resetRequestOutcome(error);
  message.className=outcome.ok?'ok':'error';
  message.textContent=outcome.message;
 }finally{resetPending=false;el('reset-request-submit').disabled=false}
});
el('recovery-form').addEventListener('submit',async e=>{
 e.preventDefault();
 if(recoveryPending)return;
 const message=el('recovery-message');
 const choice=passwordChoice(el('recovery-password').value,el('recovery-confirm').value);
 if(!choice.ok){message.className='error';message.textContent=choice.message;return}
 recoveryPending=true;el('recovery-submit').disabled=true;message.className='help';message.textContent='Das Passwort wird gespeichert …';
 try{
  const {data:{user},error:authError}=await getCurrentUser();
  const callback=activeCallback();
  const recoveryActive=recoveryAllowsSave(user,recoveryFlow||callback.type==='recovery'||(callback.recoveryMarked&&callback.hasCredential));
  if(authError||!recoveryActive)throw new Error('Der Wiederherstellungslink ist ungültig oder abgelaufen.');
  const {error}=await updateUser({password:choice.password});
  if(error)throw error;
  el('recovery-password').value='';el('recovery-confirm').value='';
  const {error:signOutError}=await signOut();
  recoveryFlow=false;invitationFlow=false;passwordRequestOpen=false;
  recoveryDone=PASSWORD_SAVED_MESSAGE;
  clearAuthUrl();
  if(signOutError)recoveryDone='Das Passwort wurde gespeichert. Bitte das Fenster schließen und dich neu anmelden.';
  await update();
 }catch(err){message.className='error';message.textContent=recoveryFailure(err)}
 finally{recoveryPending=false;if(!recoveryDone)el('recovery-submit').disabled=false}
});
el('recovery-login').addEventListener('click',async()=>{
 const returnToApp=Boolean(state.currentUser)&&!recoveryDone;
 recoveryDone='';recoveryFlow=false;passwordRequestOpen=false;clearAuthUrl();
 if(!returnToApp)await signOut();
 await update();
});
el('form').addEventListener('submit',async e=>{e.preventDefault();el('submit').disabled=true;status('Anmeldung wird geprüft …');try{const {error}=await signInWithPassword({email:el('email').value.trim(),password:el('password').value});if(error)throw error;el('password').value='';await update()}catch(err){status('Anmeldung fehlgeschlagen: '+err.message,true)}finally{el('submit').disabled=false}});

// Tageswerk 2.9: navigation and dashboard. RLS on Supabase remains authoritative.
function navigate(view){if(view==='capture'){toggleCapture();return}toggleCapture(false);state.currentView=view;const defects=view==='defects'||view==='tasks'||view==='report';const names=['dashboard','agenda','notices','defects','more'];for(const name of names)show('view-'+name,name==='defects'?defects:name===view);
 el('report-panel').classList.toggle('hidden',view==='tasks');el('defects-panel').classList.toggle('hidden',view==='report');
 if(view==='tasks'){el('defect-filter').value='mine';loadDefects()}else if(view==='defects'){el('defect-filter').value='all';loadDefects()}
 for(const b of document.querySelectorAll('[data-view]'))b.classList.toggle('active',b.dataset.view===view);
 window.scrollTo({top:0,behavior:'smooth'});
}
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.view)));
function selectedFacility(){const value=el('dashboard-facility')?.value;return value&&value!=='all'?value:'';}
async function openCaptureAction(action){const facilityId=selectedFacility();if(action==='defect'){navigate('report');if(facilityId&&[...el('defect-facility').options].some(option=>option.value===facilityId))el('defect-facility').value=facilityId;el('defect-title')?.focus();return}if(action==='reading'){navigate('more');const card=el('consumption-card');if(card.classList.contains('hidden'))el('open-consumption').click();if(facilityId){el('consumption-facility').value=facilityId;touchConsumptionFacility();await loadFacilityMeters(facilityId)}card.scrollIntoView({behavior:'smooth',block:'start'});return}const section=action==='temperature'?'temperature':action==='water'?'water':action==='procurement'?'procurement':'reports';navigate('more');await showOperationSection(section,facilityId)}
onCapture(openCaptureAction);
onOpenTask(async task=>{navigate('more');const section=task.kind==='maintenance'?'maintenance':task.kind==='temperature'?'temperature':task.kind==='water'?'water':'inspections';await showOperationSection(section,task.facilityId)});
onOpenNotice(notice=>{if(String(notice.kind).startsWith('defect')){focusNotice(notice);return}navigate('more');focusNotice(notice)});
el('capture-close')?.addEventListener('click',()=>toggleCapture(false));
mountOperations();
function startRealtime(){if(state.realtimeChannel){supabase.removeChannel(state.realtimeChannel);state.realtimeChannel=null}if(!state.currentUser)return;state.realtimeChannel=supabase.channel('tageswerk29-updates').on('postgres_changes',{event:'*',schema:'public',table:'defects'},()=>scheduleRefresh()).on('postgres_changes',{event:'*',schema:'public',table:'critical_defect_acknowledgements'},()=>scheduleRefresh()).subscribe((channelState)=>{el('live-indicator').textContent=channelState==='SUBSCRIBED'?'● Live verbunden':channelState==='CHANNEL_ERROR'?'⚠ Live-Verbindung gestört':'Synchronisierung: '+channelState});}
function scheduleRefresh(){clearTimeout(state.refreshTimer);state.refreshTimer=setTimeout(async()=>{await loadDefects();await loadCriticalAcks();renderDashboard()},550)}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.currentUser)scheduleRefresh()});

el('reload').addEventListener('click',load);await update();
