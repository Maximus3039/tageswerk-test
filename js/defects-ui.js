import {priorityNames,statusNames} from './labels.js';
import {el,status} from './utils.js';
import {state} from './state.js';
import {isManager} from './permissions.js';
import {
 archiveConfirmation,
 archiveHeading,
 closedInFacility,
 completionText,
 DEFECT_FACILITY_ALL,
 defectFacilityOptions,
 filterDefectsByFacility,
 matchesArchiveQuery,
 myActiveDefects,
 resolveDefectFacilityFilter,
 scopeDefects,
 sectionCounts,
 sectionDefects,
 sortByCompletion
} from './defects.js';
import {
 archiveClosedDefectsForFacility,
 archiveDefectById,
 employeeUpdateAssignedDefect,
 fetchDefectEvents,
 fetchDefectRows,
 insertDefectRow,
 restoreArchivedDefect,
 updateDefectRow
} from './defects-store.js';
import {getCurrentUser} from './auth.js';
import {loadCriticalAcks,renderDashboard} from './dashboard.js';

let archiveQuery='';
let archiveFacilityId='';
let archiveOpen=false;
let defectPaint=0;
const defectEvents=new Map();

function allowedFacilityIds(){
 return new Set(state.accessibleFacilities.map(facility=>facility.id));
}

function facilityScopedCache(){
 return filterDefectsByFacility(
  state.cachedDefects,
  resolveDefectFacilityFilter(state.defectFacilityFilter,state.accessibleFacilities)
 );
}

function chosenArchiveFacility(){
 const managed=state.accessibleFacilities.filter(isManager);
 return managed.find(facility=>facility.id===archiveFacilityId)||managed.find(facility=>facility.id===el('dashboard-facility')?.value)||managed[0]||null;
}

export function populateDefectFacilityFilter(){
 const select=el('defect-facility-filter');
 if(!select)return;
 const facilities=defectFacilityOptions(state.accessibleFacilities);
 const next=resolveDefectFacilityFilter(state.defectFacilityFilter,facilities);
 state.defectFacilityFilter=next;
 select.replaceChildren();
 const all=document.createElement('option');
 all.value=DEFECT_FACILITY_ALL;
 all.textContent='Alle meine Betriebe';
 select.append(all);
 for(const facility of facilities){
  const option=document.createElement('option');
  option.value=facility.id;
  option.textContent=facility.name;
  select.append(option);
 }
 select.value=next;
}

export async function loadDefects(){
 const box=el('defect-list');box.replaceChildren();const info=document.createElement('p');info.className='muted';info.textContent='Mängel werden geladen …';box.append(info);
 populateDefectFacilityFilter();
 const {data,error}=await fetchDefectRows();
 if(error){info.className='error';info.textContent='Mängel konnten nicht geladen werden: '+error.message;return}
 const allowed=allowedFacilityIds();
 const rank={critical:0,high:1,normal:2,low:3};
 state.cachedDefects=(data||[]).filter(defect=>allowed.has(defect.facility_id)).sort((left,right)=>(rank[left.priority]??2)-(rank[right.priority]??2)||new Date(right.created_at)-new Date(left.created_at));
 defectEvents.clear();
 renderDashboard();
 el('mine-count').textContent=String(myActiveDefects(facilityScopedCache(),state.currentUser?.id).length);
 await paintDefects();
}

async function paintDefects(){
 const token=++defectPaint;
 const box=el('defect-list');
 const mode=el('defect-filter')?.value||'all';
 const facilityFilter=resolveDefectFacilityFilter(state.defectFacilityFilter,state.accessibleFacilities);
 state.defectFacilityFilter=facilityFilter;
 const scoped=facilityScopedCache();
 const visible=scopeDefects(state.cachedDefects,{facilityFilter,mode,userId:state.currentUser?.id});
 box.replaceChildren();
 el('defect-count').textContent=String(mode==='all'?scoped.length:visible.length);
 el('mine-count').textContent=String(myActiveDefects(scoped,state.currentUser?.id).length);
 if(mode==='all'){await paintDefectSections(box,token,scoped);return}
 if(token!==defectPaint)return;
 if(!visible.length){const info=document.createElement('p');info.className='muted';info.textContent='Keine Mängel in dieser Ansicht.';box.append(info);return}
 for(const defect of visible){if(token!==defectPaint)return;box.append(await defectCard(defect))}
}

async function paintDefectSections(box,token,scoped){
 const counts=sectionCounts(scoped);
 const sections=[['open','Offen',counts.open],['done','Abgeschlossen',counts.done],['archive','Archiv',counts.archive]];
 for(const [key,label,count] of sections){
  if(token!==defectPaint)return;
  const section=document.createElement('section');section.className='defect-section';
  if(key==='archive'){
   section.append(archiveToggle(count));
   box.append(section);
   if(!archiveOpen)continue;
   const panel=document.createElement('div');panel.id='defect-archive-panel';section.append(panel);
   panel.append(archiveSearchControl());
   const rows=sortByCompletion(sectionDefects(scoped,'archive').filter(defect=>matchesArchiveQuery(defect,archiveQuery)));
   if(!rows.length){const empty=document.createElement('p');empty.className='muted';empty.textContent=archiveQuery.trim()?'Kein Archivtreffer.':'Keine Einträge unter Archiv.';panel.append(empty);continue}
   for(const defect of rows){if(token!==defectPaint)return;panel.append(await defectCard(defect))}
   continue;
  }
  const heading=document.createElement('h3');heading.textContent=`${label} (${count})`;section.append(heading);
  if(key==='done'){const tools=archiveAllControl();if(tools)section.append(tools)}
  const rows=sectionDefects(scoped,key);
  if(!rows.length){const empty=document.createElement('p');empty.className='muted';empty.textContent=`Keine Einträge unter ${label}.`;section.append(empty)}
  box.append(section);
  for(const defect of rows){if(token!==defectPaint)return;section.append(await defectCard(defect))}
 }
}

function archiveAllControl(){
 const managed=state.accessibleFacilities.filter(isManager);
 if(!managed.length)return null;
 const wrap=document.createElement('div');wrap.className='archive-tools';
 const label=document.createElement('label');label.htmlFor='archive-facility';label.textContent='Betrieb für die Sammelarchivierung';
 const select=document.createElement('select');select.id='archive-facility';
 for(const facility of managed){const option=document.createElement('option');option.value=facility.id;option.textContent=facility.name;select.append(option)}
 const chosen=chosenArchiveFacility();if(chosen)select.value=chosen.id;
 archiveFacilityId=select.value;
 select.addEventListener('change',()=>{archiveFacilityId=select.value});
 const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Alle abgeschlossenen Mängel archivieren';
 button.onclick=()=>archiveClosedDefects(select.value,button);
 wrap.append(label,select,button);return wrap;
}

function archiveToggle(count){
 const heading=document.createElement('h3');
 const button=document.createElement('button');
 button.id='defect-archive-toggle';
 button.type='button';
 button.className='archive-toggle';
 button.setAttribute('aria-expanded',archiveOpen?'true':'false');
 button.setAttribute('aria-controls','defect-archive-panel');
 button.textContent=archiveHeading(count,archiveOpen);
 button.addEventListener('click',()=>{const open=!archiveOpen;archiveOpen=open;paintDefects().then(()=>{const next=el('defect-archive-toggle');if(next&&next.getAttribute('aria-expanded')===(open?'true':'false'))next.focus()})});
 heading.append(button);
 return heading;
}

function archiveSearchControl(){
 const wrap=document.createElement('div');wrap.className='archive-tools';
 const label=document.createElement('label');label.htmlFor='archive-search';label.textContent='Suche in Titel und Beschreibung';
 const input=document.createElement('input');input.id='archive-search';input.type='search';input.value=archiveQuery;input.placeholder='Titel oder Beschreibung';
 const sort=document.createElement('p');sort.className='help';sort.textContent='Sortiert nach Abschlussdatum, neueste zuerst.';
 input.addEventListener('input',()=>{const caret=input.selectionStart;archiveQuery=input.value;paintDefects().then(()=>{const next=el('archive-search');if(!next)return;next.focus();try{next.setSelectionRange(caret,caret)}catch(e){}})});
 wrap.append(label,input,sort);return wrap;
}

async function archiveClosedDefects(facilityId,button){
 const facility=state.accessibleFacilities.find(item=>item.id===facilityId);
 if(!facility||!isManager(facility)){status('Nur Betriebsleitung und Geschäftsführung dürfen archivieren.',true);return}
 const count=closedInFacility(state.cachedDefects,facility.id).length;
 if(!count){status('In diesem Betrieb gibt es keine abgeschlossenen Mängel.');return}
 if(!window.confirm(archiveConfirmation(count,facility.name)))return;
 button.disabled=true;
 try{
  const {data,error}=await archiveClosedDefectsForFacility(facility.id);
  if(error)throw error;
  const archived=Number(data)||0;
  status(archived===1?'✓ 1 Mangel archiviert.':`✓ ${archived} Mängel archiviert.`);
  await loadDefects();
 }catch(e){status('Archivieren fehlgeschlagen: '+e.message,true);button.disabled=false}
}

async function archiveOneDefect(defect,button,msg){
 button.disabled=true;msg.className='help';msg.textContent='Wird archiviert …';
 try{
  const {error}=await archiveDefectById(defect.id);
  if(error)throw error;
  status('✓ Mangel archiviert.');
  await loadDefects();
 }catch(e){msg.className='error';msg.textContent='Archivieren fehlgeschlagen: '+e.message;button.disabled=false}
}

async function restoreDefect(defect,button,msg){
 button.disabled=true;msg.className='help';msg.textContent='Wird zurückgeholt …';
 try{
  const {error}=await restoreArchivedDefect(defect.id);
  if(error)throw error;
  status('✓ Mangel aus dem Archiv zurückgeholt.');
  await loadDefects();
 }catch(e){msg.className='error';msg.textContent='Zurückholen fehlgeschlagen: '+e.message;button.disabled=false}
}

async function defectCard(defect){
 const card=document.createElement('div');card.className='defect';
 const facility=state.accessibleFacilities.find(item=>item.id===defect.facility_id);
 const facilityLine=document.createElement('div');facilityLine.className='help';facilityLine.textContent=facility?.name||'Betrieb';
 const title=document.createElement('strong');title.textContent=defect.title;
 const badges=document.createElement('div');badges.className='help';
 const when=defect.status==='resolved'?completionText(defect):(defect.created_at?new Date(defect.created_at).toLocaleString('de-DE'):'');
 badges.textContent=[priorityNames[defect.priority]||defect.priority,statusNames[defect.status]||defect.status||'open',when].filter(Boolean).join(' · ');
 card.append(facilityLine,title,badges);
 if(defect.description){const description=document.createElement('p');description.textContent=defect.description;card.append(description)}
 if(defect.assigned_to){const assigned=document.createElement('p');assigned.className='help';assigned.textContent='Zugewiesen an: '+(state.staff.find(item=>item.user_id===defect.assigned_to)?.name||defect.assigned_to.slice(0,8));card.append(assigned)}
 if(facility&&isManager(facility)&&!defect.archived_at){
  const manage=document.createElement('div');manage.className='manage';
  const statusLabel=document.createElement('label');statusLabel.textContent='Bearbeitungsstatus';
  const statusSelect=document.createElement('select');
  for(const [value,label] of Object.entries(statusNames)){const option=document.createElement('option');option.value=value;option.textContent=label;statusSelect.append(option)}statusSelect.value=defect.status||'open';
  const assignLabel=document.createElement('label');assignLabel.textContent='Zuweisen an';
  const assign=document.createElement('select');const none=document.createElement('option');none.value='';none.textContent='Nicht zugewiesen';assign.append(none);
  const eligible=[...new Map(state.staff.filter(member=>member.is_active===true&&member.organization_id===facility.organization_id&&(member.role==='company_admin'||member.facility_id===facility.id)).map(member=>[member.user_id,member])).values()];
  for(const member of eligible){const option=document.createElement('option');option.value=member.user_id;option.textContent=member.name;assign.append(option)}assign.value=defect.assigned_to||'';
  const noteLabel=document.createElement('label');noteLabel.textContent='Bearbeitungsvermerk';
  const note=document.createElement('textarea');note.placeholder='Was wurde veranlasst oder erledigt?';note.maxLength=2000;note.style.minHeight='70px';
  const button=document.createElement('button');button.className='secondary';button.textContent='Änderung speichern';
  const msg=document.createElement('p');msg.className='help';
  button.onclick=async()=>{if(defect.status==='pending_review'&&!note.value.trim()){msg.className='error';msg.textContent='Bitte einen Prüfvermerk zur Freigabe oder Rückgabe eintragen.';return}button.disabled=true;msg.textContent='Wird gespeichert …';try{
   const {error}=await updateDefectRow(defect.id,{status:statusSelect.value,assigned_to:assign.value||null,change_note:note.value.trim()||null});
   if(error)throw error;msg.className='ok';msg.textContent='✓ Änderung gespeichert';status('✓ Mangeländerung gespeichert.');await loadDefects();
  }catch(e){msg.className='error';msg.textContent='Speichern fehlgeschlagen: '+e.message}finally{button.disabled=false}};
  manage.append(statusLabel,statusSelect,assignLabel,assign,noteLabel,note,button,msg);if(defect.status==='pending_review'){const review=document.createElement('div');review.className='review';review.textContent='Erledigung wurde gemeldet. Bitte Arbeit prüfen und danach den Status auf „Abgeschlossen“ setzen oder zur Nacharbeit auf „In Bearbeitung“ zurückstellen. Einen Prüfvermerk eintragen.';manage.prepend(review)}
  if(defect.status==='resolved'){const archive=document.createElement('button');archive.type='button';archive.className='secondary';archive.textContent='Gesehen & archivieren';archive.onclick=()=>archiveOneDefect(defect,archive,msg);manage.append(archive)}
  card.append(manage);
 }
 if(facility&&isManager(facility)&&defect.archived_at){
  const manage=document.createElement('div');manage.className='archive-tools';
  const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Aus Archiv zurückholen';
  const msg=document.createElement('p');msg.className='help';
  button.onclick=()=>restoreDefect(defect,button,msg);
  manage.append(button,msg);card.append(manage);
 }
 if(facility && !isManager(facility) && defect.assigned_to===state.currentUser?.id&&!defect.archived_at){
  const own=document.createElement('div');own.className='manage';
  const heading=document.createElement('strong');heading.textContent='Meine Bearbeitung';
  const label=document.createElement('label');label.textContent='Bearbeitungsstatus';
  const statusSelect=document.createElement('select');
  for(const [value,name] of [['in_progress','In Bearbeitung'],['pending_review','Erledigung melden (Freigabe nötig)']]){const option=document.createElement('option');option.value=value;option.textContent=name;statusSelect.append(option)}
  if(defect.status==='resolved'||defect.status==='pending_review')statusSelect.disabled=true;
  const noteLabel=document.createElement('label');noteLabel.textContent='Arbeitsvermerk (Pflicht)';
  const note=document.createElement('textarea');note.maxLength=2000;note.placeholder='Was wurde geprüft, repariert oder veranlasst?';note.style.minHeight='75px';
  const button=document.createElement('button');button.className='secondary';button.textContent='Meine Bearbeitung speichern';button.disabled=defect.status==='resolved'||defect.status==='pending_review';
  const msg=document.createElement('p');msg.className='help';
  button.onclick=async()=>{const comment=note.value.trim();if(!comment){msg.className='error';msg.textContent='Bitte einen Arbeitsvermerk eintragen.';return}button.disabled=true;msg.textContent='Wird gespeichert …';try{
   const {error}=await employeeUpdateAssignedDefect(defect.id,statusSelect.value,comment);
   if(error)throw error;status('✓ Bearbeitung gespeichert.');await loadDefects();
  }catch(e){msg.className='error';msg.textContent='Speichern fehlgeschlagen: '+e.message;button.disabled=false}};
  if(defect.status==='pending_review'){const wait=document.createElement('p');wait.className='review';wait.textContent='Deine Erledigung ist gemeldet. Die Betriebsleitung prüft den Vorgang. Bis zur Freigabe oder Rückgabe ist keine weitere Bearbeitung möglich.';own.append(wait)}
  own.append(heading,label,statusSelect,noteLabel,note,button,msg);card.append(own);
 }
 const history=document.createElement('div');history.className='history';history.textContent='Verlauf wird geladen …';card.append(history);
 if(!defectEvents.has(defect.id)){
  const {data:events,error:historyError}=await fetchDefectEvents(defect.id);
  defectEvents.set(defect.id,{events,historyError});
 }
 const stored=defectEvents.get(defect.id);
 if(stored.historyError)history.textContent='Verlauf nicht verfügbar: '+stored.historyError.message;
 else if(!stored.events?.length)history.textContent='Noch keine Bearbeitungsänderungen.';
 else{history.replaceChildren();for(const event of stored.events){const line=document.createElement('div');const person=state.staff.find(member=>member.user_id===event.actor_id)?.name||'Benutzer';line.textContent=new Date(event.created_at).toLocaleString('de-DE')+' · '+person+' · '+event.action+(event.note?' · '+event.note:'');history.append(line)}}
 return card;
}

el('defect-form')?.addEventListener('submit',async event=>{event.preventDefault();if(state.busy)return;const facility=state.accessibleFacilities.find(f=>f.id===el('defect-facility').value);const title=el('defect-title').value.trim();if(!facility||!title){el('defect-message').className='error';el('defect-message').textContent='Bitte Betrieb und Titel auswählen.';return}state.busy=true;document.body.dataset.saving='1';el('save-defect').disabled=true;el('defect-message').className='help';el('defect-message').textContent='Mangel wird gespeichert …';try{const {data:{user},error:authError}=await getCurrentUser();if(authError||!user)throw authError||new Error('Bitte erneut anmelden.');const payload={organization_id:facility.organization_id,facility_id:facility.id,title,description:el('defect-desc').value.trim()||null,priority:el('defect-priority').value,created_by:user.id};const {error}=await insertDefectRow(payload);if(error)throw error;el('defect-title').value='';el('defect-desc').value='';el('defect-priority').value='normal';el('defect-message').className='ok';el('defect-message').textContent='✓ Mangel in Supabase gespeichert.';await loadDefects();await loadCriticalAcks()}catch(e){el('defect-message').className='error';el('defect-message').textContent='Speichern fehlgeschlagen: '+e.message}finally{state.busy=false;delete document.body.dataset.saving;el('save-defect').disabled=!state.accessibleFacilities.length}});
el('refresh-defects')?.addEventListener('click',loadDefects);
el('defect-filter')?.addEventListener('change',()=>{el('nav-mine').classList.toggle('active',el('defect-filter').value==='mine');el('nav-all').classList.toggle('active',el('defect-filter').value!=='mine');paintDefects()});
el('defect-facility-filter')?.addEventListener('change',()=>{state.defectFacilityFilter=resolveDefectFacilityFilter(el('defect-facility-filter').value,state.accessibleFacilities);el('defect-facility-filter').value=state.defectFacilityFilter;paintDefects()});
for(const [id,mode] of [['nav-mine','mine'],['nav-all','all']])el(id)?.addEventListener('click',()=>{el('defect-filter').value=mode;el('defect-filter').dispatchEvent(new Event('change'));el('defect-list').scrollIntoView({behavior:'smooth',block:'start'})});
