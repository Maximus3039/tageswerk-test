import {supabase} from './supabase.js';
import {el} from './utils.js';
import {state} from './state.js';
import {mediumNames,unitNames,meterStatusNames,intervalNames,readingTypeNames} from './labels.js';

const scheduleNames={current:'Aktuell',soon:'Bald fällig',overdue:'Überfällig'};
const soonWindowMs=3*24*60*60*1000;

let requestSeq=0;
let historySeq=0;
let editorSeq=0;
let formFacilityId=null;
let editingMeterId=null;
let saving=false;
let readingSeq=0;
let readingSaving=false;
let readingMeterId=null;
let readingFacilityId=null;
let correctionSeq=0;
let correctionSaving=false;
let correctionMeterId=null;
let correctionFacilityId=null;
let correctionReadingId=null;
let resetSeq=0;
let resetSaving=false;
let resetMeterId=null;
let resetFacilityId=null;
let replaceSeq=0;
let replaceSaving=false;
let replaceMeterId=null;
let replaceFacilityId=null;
let replaceLastReadingAt=null;
let reopenHistoryMeterId=null;
let listedFacilityId=null;
let listedMeters=[];

const mediumUnits={electricity:['kWh'],water:['m3'],gas:['kWh','m3'],heat:['kWh','m3']};

export function unitsForMedium(medium){return mediumUnits[medium]||[]}

export function membershipAllowsMeterAdmin(facility,memberships,userId){
 if(!facility||!userId)return false;
 return (memberships||[]).some(m=>m.user_id===userId&&m.is_active===true&&m.organization_id===facility.organization_id&&((m.role==='company_admin'&&m.facility_id===null)||(m.role==='facility_manager'&&m.facility_id===facility.id)));
}

export function meterDraftError(draft){
 const label=(draft.label||'').trim();
 if(!label)return 'Bitte eine Bezeichnung eingeben.';
 if(label.length>200)return 'Die Bezeichnung darf höchstens 200 Zeichen haben.';
 const number=(draft.meter_number||'').trim();
 if(number.length>100)return 'Die Zählernummer darf höchstens 100 Zeichen haben.';
 const location=(draft.location||'').trim();
 if(location.length>200)return 'Der Standort darf höchstens 200 Zeichen haben.';
 if(!Object.hasOwn(mediumUnits,draft.medium))return 'Bitte eine Zählerart auswählen.';
 if(!unitsForMedium(draft.medium).includes(draft.unit))return 'Diese Einheit ist für die gewählte Zählerart nicht zulässig.';
 if(!Object.hasOwn(intervalNames,draft.interval_unit))return 'Bitte ein Ableseintervall auswählen.';
 const count=String(draft.interval_count??'').trim();
 if(!/^\d+$/.test(count)||Number(count)<1||Number(count)>2147483647)return 'Bitte eine ganze Intervallanzahl ab 1 eingeben.';
 return '';
}

export function membershipAllowsMeterReading(facility,memberships,userId){
 if(!facility||!userId)return false;
 return (memberships||[]).some(m=>m.user_id===userId&&m.is_active===true&&m.organization_id===facility.organization_id&&((m.role==='company_admin'&&m.facility_id===null)||((m.role==='facility_manager'||m.role==='employee')&&m.facility_id===facility.id)));
}

export function readingDraftError(draft){
 const raw=String(draft.reading_value??'').trim();
 if(raw.includes(',')&&raw.includes('.'))return 'Bitte den Zählerstand ohne Tausendertrennzeichen eingeben.';
 const value=raw.replace(',','.');
 if(!/^\d+(\.\d{1,3})?$/.test(value))return 'Bitte einen Zählerstand ab 0 mit höchstens drei Nachkommastellen eingeben.';
 const [whole,fraction='']=value.split('.');
 const intDigits=(whole.replace(/^0+/,'')||'0').length;
 if(intDigits>11||intDigits+fraction.length>14)return 'Der Zählerstand ist zu groß.';
 if(!draft.reading_at)return 'Bitte Ablesedatum und Uhrzeit eingeben.';
 if(Number.isNaN(new Date(draft.reading_at).getTime()))return 'Bitte ein gültiges Ablesedatum eingeben.';
 return '';
}

export function readingInsertPayload(meterId,draft){
 const value=String(draft.reading_value).trim().replace(',','.');
 return {meter_id:meterId,reading_type:'regular',reading_value:value,reading_at:new Date(draft.reading_at).toISOString()};
}

export function correctionDraftError(draft){
 const valueError=readingDraftError({reading_value:draft.reading_value,reading_at:'2026-01-01T00:00'});
 if(valueError)return valueError;
 const note=(draft.note||'').trim();
 if(note.length<3)return 'Bitte einen Korrekturgrund mit mindestens 3 Zeichen eingeben.';
 if(note.length>2000)return 'Der Korrekturgrund darf höchstens 2000 Zeichen haben.';
 return '';
}

export function correctionInsertPayload(meterId,readingId,draft){
 const value=String(draft.reading_value).trim().replace(',','.');
 return {meter_id:meterId,reading_type:'correction',reading_value:value,corrects_reading_id:readingId,note:(draft.note||'').trim()};
}

export function resetDraftError(draft){
 const valueError=readingDraftError(draft);
 if(valueError)return valueError;
 const note=(draft.note||'').trim();
 if(!note)return 'Bitte einen Grund der Rücksetzung eingeben.';
 if(note.length>2000)return 'Der Grund der Rücksetzung darf höchstens 2000 Zeichen haben.';
 return '';
}

export function resetInsertPayload(meterId,draft){
 const value=String(draft.reading_value).trim().replace(',','.');
 return {meter_id:meterId,reading_type:'reset',reading_value:value,reading_at:new Date(draft.reading_at).toISOString(),note:(draft.note||'').trim()};
}

function standError(raw){
 const valueError=readingDraftError({reading_value:raw,reading_at:'2026-01-01T12:00'});
 if(!valueError||valueError.includes('Ablesedatum'))return '';
 return valueError;
}

export function replacementDraftError(draft,context){
 if(!context?.active)return 'Ein deaktivierter Zähler kann nicht gewechselt werden.';
 const closingError=standError(draft.closing_value);
 if(closingError)return closingError;
 if(!draft.removed_at)return 'Bitte den Ausbauzeitpunkt eingeben.';
 const removed=new Date(draft.removed_at).getTime();
 if(Number.isNaN(removed))return 'Bitte einen gültigen Ausbauzeitpunkt eingeben.';
 if(context.lastReadingAt){
  const latest=new Date(context.lastReadingAt).getTime();
  if(!Number.isNaN(latest)&&removed<=latest)return 'Der Ausbau muss nach der letzten Ablesung liegen.';
 }
 const label=(draft.label||'').trim();
 if(!label)return 'Bitte eine Bezeichnung für den neuen Zähler eingeben.';
 if(label.length>200)return 'Die Bezeichnung darf höchstens 200 Zeichen haben.';
 const number=(draft.meter_number||'').trim();
 if(number.length>100)return 'Die Zählernummer darf höchstens 100 Zeichen haben.';
 const location=(draft.location||'').trim();
 if(location.length>200)return 'Der Standort darf höchstens 200 Zeichen haben.';
 const openingError=standError(draft.opening_value);
 if(openingError)return openingError;
 if(!draft.installed_at)return 'Bitte den Einbauzeitpunkt eingeben.';
 const installed=new Date(draft.installed_at).getTime();
 if(Number.isNaN(installed))return 'Bitte einen gültigen Einbauzeitpunkt eingeben.';
 if(installed<removed)return 'Der Einbau darf nicht vor dem Ausbau liegen.';
 const note=(draft.note||'').trim();
 if(note.length>2000)return 'Die Bemerkung darf höchstens 2000 Zeichen haben.';
 return '';
}

export function replacementRpcArgs(meterId,draft){
 const number=(draft.meter_number||'').trim();
 const location=(draft.location||'').trim();
 const note=(draft.note||'').trim();
 return {
  p_meter_id:meterId,
  p_closing_value:String(draft.closing_value).trim().replace(',','.'),
  p_removed_at:new Date(draft.removed_at).toISOString(),
  p_new_label:(draft.label||'').trim(),
  p_new_meter_number:number||null,
  p_new_location:location||null,
  p_opening_value:String(draft.opening_value).trim().replace(',','.'),
  p_installed_at:new Date(draft.installed_at).toISOString(),
  p_note:note||null
 };
}

export function meterInsertPayload(facilityId,draft){
 const number=(draft.meter_number||'').trim();
 const location=(draft.location||'').trim();
 return {
  facility_id:facilityId,
  label:(draft.label||'').trim(),
  meter_number:number||null,
  medium:draft.medium,
  unit:draft.unit,
  location:location||null,
  interval_unit:draft.interval_unit,
  interval_count:Number(String(draft.interval_count).trim())
 };
}

export function meterUpdatePayload(draft){
 const number=(draft.meter_number||'').trim();
 const location=(draft.location||'').trim();
 return {
  label:(draft.label||'').trim(),
  meter_number:number||null,
  location:location||null,
  interval_unit:draft.interval_unit,
  interval_count:Number(String(draft.interval_count).trim())
 };
}

function setMeterMessage(className,text){
 const msg=el('meter-message');
 if(!msg)return;
 msg.className=className;
 msg.textContent=text;
}

function fillSelect(id,entries,selected){
 const sel=el(id);
 if(!sel)return;
 sel.replaceChildren();
 for(const [value,text] of entries){
  const option=document.createElement('option');
  option.value=value;
  option.textContent=text;
  sel.append(option);
 }
 if(selected)sel.value=selected;
}

function fillUnits(medium,preferred){
 const units=unitsForMedium(medium);
 const current=preferred||el('meter-unit')?.value;
 fillSelect('meter-unit',units.map(unit=>[unit,unitNames[unit]||unit]),units.includes(current)?current:units[0]);
}

function currentDraft(){
 return {
  label:el('meter-label').value,
  meter_number:el('meter-number').value,
  medium:el('meter-medium').value,
  unit:el('meter-unit').value,
  location:el('meter-location').value,
  interval_unit:el('meter-interval').value,
  interval_count:el('meter-interval-count').value
 };
}

function resetMeterFields(){
 if(!el('meter-label'))return;
 el('meter-label').value='';
 el('meter-number').value='';
 el('meter-location').value='';
 el('meter-medium').value='electricity';
 fillUnits('electricity','kWh');
 el('meter-interval').value='month';
 el('meter-interval-count').value='1';
}

function setMeterFormMode(mode){
 const editing=mode==='edit';
 const heading=el('meter-form')?.querySelector('h2');
 if(heading)heading.textContent=editing?'Zähler bearbeiten':'Zähler hinzufügen';
 const help=el('meter-form')?.querySelector('p.help');
 if(help)help.textContent=editing?'Betrieb, Zählerart und Einheit bleiben unverändert.':'Der Betrieb kommt aus der Auswahl oben und kann hier nicht geändert werden.';
 if(el('meter-save'))el('meter-save').textContent=editing?'Änderungen speichern':'Zähler speichern';
 if(el('meter-medium'))el('meter-medium').disabled=editing;
 if(el('meter-unit'))el('meter-unit').disabled=editing;
}

function closeMeterForm(){
 formFacilityId=null;
 editingMeterId=null;
 el('meter-form')?.classList.add('hidden');
 setMeterFormMode('create');
 resetMeterFields();
}

function selectedFacility(){
 const facilityId=el('consumption-facility')?.value||'';
 return state.accessibleFacilities.find(f=>f.id===facilityId)||null;
}

export function syncMeterEditor(){
 const facility=selectedFacility();
 const allowed=membershipAllowsMeterAdmin(facility,state.myMemberships,state.currentUser?.id);
 el('add-meter')?.classList.toggle('hidden',!allowed);
 if(!allowed||(formFacilityId&&formFacilityId!==facility?.id))closeMeterForm();
 if(readingFacilityId&&readingFacilityId!==facility?.id)closeReadingForm(true);
 if(correctionFacilityId&&(!allowed||correctionFacilityId!==facility?.id))closeCorrectionForm(true);
 if(resetFacilityId&&(!allowed||resetFacilityId!==facility?.id))closeResetForm(true);
 if(replaceFacilityId&&(!allowed||replaceFacilityId!==facility?.id))closeReplaceForm(true);
}

function openMeterForm(){
 if(saving||replaceSaving)return;
 if(!el('replace-form')?.classList.contains('hidden'))closeReplaceForm(true);
 const facility=selectedFacility();
 if(!membershipAllowsMeterAdmin(facility,state.myMemberships,state.currentUser?.id))return;
 const wasEditing=editingMeterId!==null;
 formFacilityId=facility.id;
 editingMeterId=null;
 if(wasEditing)resetMeterFields();
 setMeterFormMode('create');
 el('meter-facility-name').value=facility.name;
 el('meter-form').classList.remove('hidden');
 setMeterMessage('help','');
 el('meter-label').focus();
}

function openMeterEdit(meter){
 if(saving||replaceSaving)return;
 if(!el('replace-form')?.classList.contains('hidden'))closeReplaceForm(true);
 const facility=selectedFacility();
 if(!membershipAllowsMeterAdmin(facility,state.myMemberships,state.currentUser?.id))return;
 if(listedFacilityId!==facility.id||!listedMeters.some(row=>row.id===meter?.id))return;
 editingMeterId=meter.id;
 formFacilityId=facility.id;
 el('meter-facility-name').value=facility.name;
 el('meter-label').value=meter.label||'';
 el('meter-number').value=meter.meter_number||'';
 el('meter-location').value=meter.location||'';
 el('meter-medium').disabled=false;
 el('meter-medium').value=meter.medium;
 fillUnits(meter.medium,meter.unit);
 el('meter-interval').value=meter.interval_unit;
 el('meter-interval-count').value=String(meter.interval_count??'');
 setMeterFormMode('edit');
 el('meter-form').classList.remove('hidden');
 setMeterMessage('help','');
 el('meter-label').focus();
 el('meter-form').scrollIntoView({behavior:'smooth',block:'start'});
}

function setReadingMessage(className,text){
 const msg=el('reading-message');
 if(!msg)return;
 msg.className=className;
 msg.textContent=text;
}

function localDateTimeValue(date){
 const pad=n=>String(n).padStart(2,'0');
 return date.getFullYear()+'-'+pad(date.getMonth()+1)+'-'+pad(date.getDate())+'T'+pad(date.getHours())+':'+pad(date.getMinutes());
}

function closeReadingForm(clearMessage){
 readingSeq++;
 readingMeterId=null;
 readingFacilityId=null;
 el('reading-form')?.classList.add('hidden');
 if(el('reading-value'))el('reading-value').value='';
 if(el('reading-at'))el('reading-at').value='';
 if(el('reading-save'))el('reading-save').disabled=false;
 readingSaving=false;
 if(clearMessage)setReadingMessage('help','');
}

function setCorrectionMessage(className,text){
 const msg=el('correction-message');
 if(!msg)return;
 msg.className=className;
 msg.textContent=text;
}

function closeCorrectionForm(clearMessage){
 correctionSeq++;
 correctionMeterId=null;
 correctionFacilityId=null;
 correctionReadingId=null;
 el('correction-form')?.classList.add('hidden');
 if(el('correction-value'))el('correction-value').value='';
 if(el('correction-note'))el('correction-note').value='';
 if(el('correction-save'))el('correction-save').disabled=false;
 correctionSaving=false;
 if(clearMessage)setCorrectionMessage('help','');
}

function ensureCorrectionForm(){
 if(el('correction-form')||!el('reading-form'))return;
 const form=document.createElement('form');
 form.id='correction-form';
 form.className='manage hidden';
 const heading=document.createElement('h2');
 heading.textContent='Zählerstand korrigieren';
 const name=document.createElement('p');
 name.id='correction-meter-name';
 const when=document.createElement('p');
 when.id='correction-when';
 when.className='help';
 const original=document.createElement('p');
 original.id='correction-original';
 original.className='help';
 const valueLabel=document.createElement('label');
 valueLabel.id='correction-value-label';
 valueLabel.htmlFor='correction-value';
 valueLabel.textContent='Korrigierter Zählerstand (Pflichtfeld)';
 const value=document.createElement('input');
 value.id='correction-value';
 value.inputMode='decimal';
 value.autocomplete='off';
 value.required=true;
 value.placeholder='z. B. 1250,5';
 const noteLabel=document.createElement('label');
 noteLabel.htmlFor='correction-note';
 noteLabel.textContent='Grund der Korrektur (Pflichtfeld)';
 const note=document.createElement('input');
 note.id='correction-note';
 note.autocomplete='off';
 note.required=true;
 note.maxLength=2000;
 note.placeholder='Mindestens 3 Zeichen';
 const actions=document.createElement('div');
 actions.className='row';
 const save=document.createElement('button');
 save.type='submit';
 save.id='correction-save';
 save.textContent='Korrektur speichern';
 const cancel=document.createElement('button');
 cancel.type='button';
 cancel.id='correction-cancel';
 cancel.className='secondary';
 cancel.textContent='Abbrechen';
 actions.append(save,cancel);
 form.append(heading,name,when,original,valueLabel,value,noteLabel,note,actions);
 const message=document.createElement('p');
 message.id='correction-message';
 message.className='help';
 message.setAttribute('role','status');
 message.setAttribute('aria-live','polite');
 el('reading-form').insertAdjacentElement('afterend',form);
 form.insertAdjacentElement('afterend',message);
 form.addEventListener('submit',saveCorrection);
 cancel.addEventListener('click',()=>closeCorrectionForm(true));
}

function openCorrectionForm(meter,row){
 if(correctionSaving)return;
 const facility=selectedFacility();
 if(!row?.reading_id||!meter?.id)return;
 if(row.reading_type!=='regular'&&row.reading_type!=='reset')return;
 if(listedFacilityId!==facility?.id||!listedMeters.some(item=>item.id===meter.id))return;
 if(!membershipAllowsMeterAdmin(facility,state.myMemberships,state.currentUser?.id))return;
 if(!readingSaving)closeReadingForm(true);
 if(!resetSaving)closeResetForm(true);
 if(!replaceSaving)closeReplaceForm(true);
 ensureCorrectionForm();
 correctionMeterId=meter.id;
 correctionFacilityId=facility.id;
 correctionReadingId=row.reading_id;
 el('correction-meter-name').textContent=meter.label||'';
 const when=formatWhen(row.reading_at);
 el('correction-when').textContent=when?'Ursprüngliches Ablesedatum: '+when:'Ursprüngliches Ablesedatum liegt nicht vor';
 const stand=formatAmount(row.effective_value,row.unit||meter.unit);
 el('correction-original').textContent=stand?'Ursprünglicher Zählerstand: '+stand:'Ursprünglicher Zählerstand liegt nicht vor';
 const unit=unitNames[row.unit||meter.unit]||row.unit||meter.unit||'';
 el('correction-value-label').textContent='Korrigierter Zählerstand'+(unit?' in '+unit:'')+' (Pflichtfeld)';
 el('correction-value').value='';
 el('correction-note').value='';
 el('correction-form').classList.remove('hidden');
 setCorrectionMessage('help','');
 el('correction-value').focus();
 el('correction-form').scrollIntoView({behavior:'smooth',block:'start'});
}

async function saveCorrection(event){
 event.preventDefault();
 if(correctionSaving)return;
 const seq=correctionSeq;
 const meterId=correctionMeterId;
 const facilityId=correctionFacilityId;
 const readingId=correctionReadingId;
 const facility=state.accessibleFacilities.find(item=>item.id===facilityId);
 const meter=listedMeters.find(row=>row.id===meterId);
 if(!meterId||!readingId||!facilityId||el('consumption-facility').value!==facilityId||listedFacilityId!==facilityId||!meter||!membershipAllowsMeterAdmin(facility,state.myMemberships,state.currentUser?.id)){
  setCorrectionMessage('error','Der Betrieb wurde gewechselt oder die Berechtigung fehlt. Die Korrektur wurde nicht gespeichert.');
  closeCorrectionForm(false);
  return;
 }
 const draft={reading_value:el('correction-value').value,note:el('correction-note').value};
 const problem=correctionDraftError(draft);
 if(problem){setCorrectionMessage('error',problem);return}
 correctionSaving=true;
 el('correction-save').disabled=true;
 setCorrectionMessage('help','Korrektur wird gespeichert …');
 try{
  if(correctionSeq!==seq)return;
  if(el('consumption-facility').value!==facilityId){
   setCorrectionMessage('error','Der Betrieb wurde gewechselt. Die Korrektur wurde nicht gespeichert.');
   closeCorrectionForm(false);
   return;
  }
  const {error}=await supabase.from('utility_meter_readings').insert(correctionInsertPayload(meterId,readingId,draft));
  if(correctionSeq!==seq)return;
  if(error)throw error;
  closeCorrectionForm(false);
  if(el('consumption-facility').value===facilityId){
   setCorrectionMessage('ok','✓ Zählerstand korrigiert.');
   reopenHistoryMeterId=meterId;
   await loadFacilityMeters(facilityId);
  }else setCorrectionMessage('help','');
 }catch(e){
  if(correctionSeq!==seq)return;
  if(el('consumption-facility').value!==facilityId)closeCorrectionForm(false);
  else setCorrectionMessage('error','Korrektur konnte nicht gespeichert werden: '+(e.message||'Unbekannter Fehler'));
 }finally{
  if(correctionSeq===seq){correctionSaving=false;if(el('correction-save'))el('correction-save').disabled=false}
 }
}

function setResetMessage(className,text){
 const msg=el('reset-message');
 if(!msg)return;
 msg.className=className;
 msg.textContent=text;
}

function closeResetForm(clearMessage){
 resetSeq++;
 resetMeterId=null;
 resetFacilityId=null;
 el('reset-form')?.classList.add('hidden');
 if(el('reset-value'))el('reset-value').value='';
 if(el('reset-at'))el('reset-at').value='';
 if(el('reset-note'))el('reset-note').value='';
 if(el('reset-save'))el('reset-save').disabled=false;
 resetSaving=false;
 if(clearMessage)setResetMessage('help','');
}

function ensureResetForm(){
 if(el('reset-form'))return;
 ensureCorrectionForm();
 const anchor=el('correction-message')||el('reading-form');
 if(!anchor)return;
 const form=document.createElement('form');
 form.id='reset-form';
 form.className='manage hidden';
 const heading=document.createElement('h2');
 heading.textContent='Zählerrücksetzung erfassen';
 const name=document.createElement('p');
 name.id='reset-meter-name';
 const previous=document.createElement('p');
 previous.id='reset-previous';
 previous.className='help';
 const whenLabel=document.createElement('label');
 whenLabel.htmlFor='reset-at';
 whenLabel.textContent='Datum und Uhrzeit der Rücksetzung (Pflichtfeld)';
 const when=document.createElement('input');
 when.id='reset-at';
 when.type='datetime-local';
 when.required=true;
 when.step='60';
 const valueLabel=document.createElement('label');
 valueLabel.id='reset-value-label';
 valueLabel.htmlFor='reset-value';
 valueLabel.textContent='Neuer Zählerstand nach der Rücksetzung (Pflichtfeld)';
 const value=document.createElement('input');
 value.id='reset-value';
 value.inputMode='decimal';
 value.autocomplete='off';
 value.required=true;
 value.placeholder='z. B. 0';
 const noteLabel=document.createElement('label');
 noteLabel.htmlFor='reset-note';
 noteLabel.textContent='Grund der Rücksetzung (Pflichtfeld)';
 const note=document.createElement('input');
 note.id='reset-note';
 note.autocomplete='off';
 note.required=true;
 note.maxLength=2000;
 const actions=document.createElement('div');
 actions.className='row';
 const save=document.createElement('button');
 save.type='submit';
 save.id='reset-save';
 save.textContent='Rücksetzung speichern';
 const cancel=document.createElement('button');
 cancel.type='button';
 cancel.id='reset-cancel';
 cancel.className='secondary';
 cancel.textContent='Abbrechen';
 actions.append(save,cancel);
 form.append(heading,name,previous,whenLabel,when,valueLabel,value,noteLabel,note,actions);
 const message=document.createElement('p');
 message.id='reset-message';
 message.className='help';
 message.setAttribute('role','status');
 message.setAttribute('aria-live','polite');
 anchor.insertAdjacentElement('afterend',form);
 form.insertAdjacentElement('afterend',message);
 form.addEventListener('submit',saveReset);
 cancel.addEventListener('click',()=>closeResetForm(true));
}

function openResetForm(meter,latestRow){
 if(resetSaving||!meter?.is_active||latestRow?.reading_type!=='regular')return;
 const facility=selectedFacility();
 if(listedFacilityId!==facility?.id||!listedMeters.some(row=>row.id===meter.id&&row.is_active))return;
 if(!membershipAllowsMeterAdmin(facility,state.myMemberships,state.currentUser?.id))return;
 if(!readingSaving)closeReadingForm(true);
 if(!correctionSaving)closeCorrectionForm(true);
 if(!replaceSaving)closeReplaceForm(true);
 ensureResetForm();
 resetMeterId=meter.id;
 resetFacilityId=facility.id;
 el('reset-meter-name').textContent=meter.label||'';
 const stand=formatAmount(latestRow.effective_value,latestRow.unit||meter.unit);
 el('reset-previous').textContent=stand?'Letzter gültiger Zählerstand: '+stand:'Letzter gültiger Zählerstand liegt nicht vor';
 const unit=unitNames[latestRow.unit||meter.unit]||latestRow.unit||meter.unit||'';
 el('reset-value-label').textContent='Neuer Zählerstand nach der Rücksetzung'+(unit?' in '+unit:'')+' (Pflichtfeld)';
 el('reset-value').value='';
 el('reset-at').value=localDateTimeValue(new Date());
 el('reset-note').value='';
 el('reset-form').classList.remove('hidden');
 setResetMessage('help','');
 el('reset-value').focus();
 el('reset-form').scrollIntoView({behavior:'smooth',block:'start'});
}

async function saveReset(event){
 event.preventDefault();
 if(resetSaving)return;
 const seq=resetSeq;
 const meterId=resetMeterId;
 const facilityId=resetFacilityId;
 const facility=state.accessibleFacilities.find(item=>item.id===facilityId);
 const meter=listedMeters.find(row=>row.id===meterId);
 if(!meterId||!facilityId||el('consumption-facility').value!==facilityId||listedFacilityId!==facilityId||!meter?.is_active||!membershipAllowsMeterAdmin(facility,state.myMemberships,state.currentUser?.id)){
  setResetMessage('error','Der Betrieb wurde gewechselt oder die Berechtigung fehlt. Die Rücksetzung wurde nicht gespeichert.');
  closeResetForm(false);
  return;
 }
 const draft={reading_value:el('reset-value').value,reading_at:el('reset-at').value,note:el('reset-note').value};
 const problem=resetDraftError(draft);
 if(problem){setResetMessage('error',problem);return}
 resetSaving=true;
 el('reset-save').disabled=true;
 setResetMessage('help','Rücksetzung wird gespeichert …');
 try{
  if(resetSeq!==seq)return;
  if(el('consumption-facility').value!==facilityId){
   setResetMessage('error','Der Betrieb wurde gewechselt. Die Rücksetzung wurde nicht gespeichert.');
   closeResetForm(false);
   return;
  }
  const {error}=await supabase.from('utility_meter_readings').insert(resetInsertPayload(meterId,draft));
  if(resetSeq!==seq)return;
  if(error)throw error;
  closeResetForm(false);
  if(el('consumption-facility').value===facilityId){
   setResetMessage('ok','✓ Zählerrücksetzung gespeichert.');
   reopenHistoryMeterId=meterId;
   await loadFacilityMeters(facilityId);
  }else setResetMessage('help','');
 }catch(e){
  if(resetSeq!==seq)return;
  if(el('consumption-facility').value!==facilityId)closeResetForm(false);
  else setResetMessage('error','Rücksetzung konnte nicht gespeichert werden: '+(e.message||'Unbekannter Fehler'));
 }finally{
  if(resetSeq===seq){resetSaving=false;if(el('reset-save'))el('reset-save').disabled=false}
 }
}

function setReplaceMessage(className,text){
 const msg=el('replace-message');
 if(!msg)return;
 msg.className=className;
 msg.textContent=text;
}

function closeReplaceForm(clearMessage){
 replaceSeq++;
 replaceMeterId=null;
 replaceFacilityId=null;
 replaceLastReadingAt=null;
 el('replace-form')?.classList.add('hidden');
 for(const id of ['replace-closing','replace-removed-at','replace-label','replace-number','replace-location','replace-opening','replace-installed-at','replace-note']){
  if(el(id))el(id).value='';
 }
 if(el('replace-save'))el('replace-save').disabled=false;
 replaceSaving=false;
 if(clearMessage)setReplaceMessage('help','');
}

function replaceDraft(){
 return {
  closing_value:el('replace-closing').value,
  removed_at:el('replace-removed-at').value,
  label:el('replace-label').value,
  meter_number:el('replace-number').value,
  location:el('replace-location').value,
  opening_value:el('replace-opening').value,
  installed_at:el('replace-installed-at').value,
  note:el('replace-note').value
 };
}

function ensureReplaceForm(){
 if(el('replace-form'))return;
 ensureResetForm();
 const anchor=el('reset-message')||el('reading-form');
 if(!anchor)return;
 const form=document.createElement('form');
 form.id='replace-form';
 form.className='manage hidden';
 const heading=document.createElement('h2');
 heading.textContent='Zähler wechseln';
 const name=document.createElement('p');
 name.id='replace-meter-name';
 const last=document.createElement('p');
 last.id='replace-last';
 last.className='help';
 const carried=document.createElement('p');
 carried.id='replace-carried';
 carried.className='help';
 const fields=[
  ['replace-closing','Abschlussstand (Pflichtfeld)','decimal','z. B. 1250',true],
  ['replace-removed-at','Ausbauzeitpunkt (Pflichtfeld)','datetime-local','',true],
  ['replace-label','Neuer Zähler – Bezeichnung (Pflichtfeld)','text','',true],
  ['replace-number','Neuer Zähler – Zählernummer','text','',false],
  ['replace-location','Neuer Zähler – Standort','text','',false],
  ['replace-opening','Anfangsstand (Pflichtfeld)','decimal','z. B. 15',true],
  ['replace-installed-at','Einbauzeitpunkt (Pflichtfeld)','datetime-local','',true],
  ['replace-note','Bemerkung','text','',false]
 ];
 form.append(heading,name,last,carried);
 for(const [id,labelText,type,placeholder,required] of fields){
  const label=document.createElement('label');
  label.htmlFor=id;
  label.id=id+'-label';
  label.textContent=labelText;
  const input=document.createElement('input');
  input.id=id;
  input.autocomplete='off';
  input.required=required;
  if(type==='datetime-local'){input.type='datetime-local';input.step='60'}
  else if(type==='decimal'){input.inputMode='decimal';input.placeholder=placeholder}
  else{input.type='text';if(id==='replace-note')input.maxLength=2000}
  form.append(label,input);
 }
 const actions=document.createElement('div');
 actions.className='row';
 const save=document.createElement('button');
 save.type='submit';
 save.id='replace-save';
 save.textContent='Zählerwechsel speichern';
 const cancel=document.createElement('button');
 cancel.type='button';
 cancel.id='replace-cancel';
 cancel.className='secondary';
 cancel.textContent='Abbrechen';
 actions.append(save,cancel);
 form.append(actions);
 const message=document.createElement('p');
 message.id='replace-message';
 message.className='help';
 message.setAttribute('role','status');
 message.setAttribute('aria-live','polite');
 anchor.insertAdjacentElement('afterend',form);
 form.insertAdjacentElement('afterend',message);
 form.addEventListener('submit',saveReplacement);
 cancel.addEventListener('click',()=>closeReplaceForm(true));
}

function openReplaceForm(meter,latestRow){
 if(replaceSaving||saving||!meter?.is_active)return;
 const facility=selectedFacility();
 if(listedFacilityId!==facility?.id||!listedMeters.some(row=>row.id===meter.id&&row.is_active))return;
 if(!membershipAllowsMeterAdmin(facility,state.myMemberships,state.currentUser?.id))return;
 if(!readingSaving)closeReadingForm(true);
 if(!correctionSaving)closeCorrectionForm(true);
 if(!resetSaving)closeResetForm(true);
 if(!saving)closeMeterForm();
 ensureReplaceForm();
 replaceMeterId=meter.id;
 replaceFacilityId=facility.id;
 replaceLastReadingAt=latestRow?.reading_at||null;
 const number=meter.meter_number?' · Zählernummer '+meter.meter_number:'';
 el('replace-meter-name').textContent='Bisheriger Zähler: '+(meter.label||'')+number;
 const unit=latestRow?.unit||meter.unit;
 const stand=latestRow?formatAmount(latestRow.effective_value,unit):null;
 const when=latestRow?formatWhen(latestRow.reading_at):null;
 el('replace-last').textContent=stand?'Letzter Zählerstand: '+stand+(when?' · '+when:''):'Noch keine Ablesung vorhanden';
 const unitLabel=unitNames[meter.unit]||meter.unit||'';
 el('replace-closing-label').textContent='Abschlussstand'+(unitLabel?' in '+unitLabel:'')+' (Pflichtfeld)';
 el('replace-opening-label').textContent='Anfangsstand'+(unitLabel?' in '+unitLabel:'')+' (Pflichtfeld)';
 const interval=intervalNames[meter.interval_unit]||meter.interval_unit||'';
 el('replace-carried').textContent='Übernommen: '+(mediumNames[meter.medium]||meter.medium)+' · '+unitLabel+(interval?' · '+interval:'')+' · '+facility.name;
 const now=localDateTimeValue(new Date());
 el('replace-closing').value='';
 el('replace-removed-at').value=now;
 el('replace-label').value='';
 el('replace-number').value='';
 el('replace-location').value='';
 el('replace-opening').value='';
 el('replace-installed-at').value=now;
 el('replace-note').value='';
 el('replace-form').classList.remove('hidden');
 setReplaceMessage('help','');
 el('replace-closing').focus();
 el('replace-form').scrollIntoView({behavior:'smooth',block:'start'});
}

async function saveReplacement(event){
 event.preventDefault();
 if(replaceSaving)return;
 const seq=replaceSeq;
 const meterId=replaceMeterId;
 const facilityId=replaceFacilityId;
 const lastReadingAt=replaceLastReadingAt;
 const facility=state.accessibleFacilities.find(item=>item.id===facilityId);
 const meter=listedMeters.find(row=>row.id===meterId);
 if(!meterId||!facilityId||el('consumption-facility').value!==facilityId||listedFacilityId!==facilityId||!meter?.is_active||!membershipAllowsMeterAdmin(facility,state.myMemberships,state.currentUser?.id)){
  setReplaceMessage('error','Der Betrieb wurde gewechselt oder die Berechtigung fehlt. Der Zählerwechsel wurde nicht gespeichert.');
  closeReplaceForm(false);
  return;
 }
 const draft=replaceDraft();
 const problem=replacementDraftError(draft,{active:meter.is_active,lastReadingAt});
 if(problem){setReplaceMessage('error',problem);return}
 replaceSaving=true;
 el('replace-save').disabled=true;
 setReplaceMessage('help','Zählerwechsel wird gespeichert …');
 try{
  if(replaceSeq!==seq)return;
  if(el('consumption-facility').value!==facilityId){
   setReplaceMessage('error','Der Betrieb wurde gewechselt. Der Zählerwechsel wurde nicht gespeichert.');
   closeReplaceForm(false);
   return;
  }
  const {data,error}=await supabase.rpc('tageswerk_replace_utility_meter',replacementRpcArgs(meterId,draft));
  if(replaceSeq!==seq)return;
  if(error)throw error;
  if(!data)throw new Error('Der Zählerwechsel wurde nicht gespeichert.');
  closeReplaceForm(false);
  if(el('consumption-facility').value===facilityId){
   setReplaceMessage('ok','✓ Zähler gewechselt.');
   await loadFacilityMeters(facilityId);
  }else setReplaceMessage('help','');
 }catch(e){
  if(replaceSeq!==seq)return;
  if(el('consumption-facility').value!==facilityId)closeReplaceForm(false);
  else setReplaceMessage('error','Zählerwechsel konnte nicht gespeichert werden: '+(e.message||'Unbekannter Fehler'));
 }finally{
  if(replaceSeq===seq){replaceSaving=false;if(el('replace-save'))el('replace-save').disabled=false}
 }
}

function openReadingForm(meter){
 if(readingSaving)return;
 if(!correctionSaving)closeCorrectionForm(true);
 if(!resetSaving)closeResetForm(true);
 if(!replaceSaving)closeReplaceForm(true);
 const facility=selectedFacility();
 if(!meter?.is_active||listedFacilityId!==facility?.id||!listedMeters.some(row=>row.id===meter.id&&row.is_active))return;
 if(!membershipAllowsMeterReading(facility,state.myMemberships,state.currentUser?.id))return;
 readingMeterId=meter.id;
 readingFacilityId=facility.id;
 el('reading-meter-name').textContent=meter.label;
 const unit=unitNames[meter.unit]||meter.unit;
 el('reading-meter-meta').textContent=(meter.meter_number?'Zählernummer '+meter.meter_number:'Keine Zählernummer hinterlegt')+' · '+unit;
 el('reading-value-label').textContent='Zählerstand in '+unit+' (Pflichtfeld)';
 el('reading-value').value='';
 el('reading-at').value=localDateTimeValue(new Date());
 el('reading-form').classList.remove('hidden');
 setReadingMessage('help','');
 el('reading-value').focus();
 el('reading-form').scrollIntoView({behavior:'smooth',block:'start'});
}

async function saveReading(event){
 event.preventDefault();
 if(readingSaving)return;
 const seq=readingSeq;
 const meterId=readingMeterId;
 const facilityId=readingFacilityId;
 const facility=state.accessibleFacilities.find(f=>f.id===facilityId);
 const meter=listedMeters.find(row=>row.id===meterId);
 if(!meterId||!facilityId||el('consumption-facility').value!==facilityId||listedFacilityId!==facilityId||!meter?.is_active||!membershipAllowsMeterReading(facility,state.myMemberships,state.currentUser?.id)){
  setReadingMessage('error','Der Betrieb wurde gewechselt oder der Zähler ist nicht mehr aktiv. Der Zählerstand wurde nicht gespeichert.');
  closeReadingForm(false);
  return;
 }
 const draft={reading_value:el('reading-value').value,reading_at:el('reading-at').value};
 const problem=readingDraftError(draft);
 if(problem){setReadingMessage('error',problem);return}
 readingSaving=true;
 el('reading-save').disabled=true;
 setReadingMessage('help','Zählerstand wird gespeichert …');
 try{
  if(readingSeq!==seq)return;
  if(el('consumption-facility').value!==facilityId){
   setReadingMessage('error','Der Betrieb wurde gewechselt. Der Zählerstand wurde nicht gespeichert.');
   closeReadingForm(false);
   return;
  }
  const {error}=await supabase.from('utility_meter_readings').insert(readingInsertPayload(meterId,draft));
  if(readingSeq!==seq)return;
  if(error)throw error;
  closeReadingForm(false);
  if(el('consumption-facility').value===facilityId){
   setReadingMessage('ok','✓ Zählerstand gespeichert.');
   await loadFacilityMeters(facilityId);
  }
 }catch(e){
  if(readingSeq!==seq)return;
  if(el('consumption-facility').value!==facilityId)closeReadingForm(false);
  else setReadingMessage('error','Zählerstand konnte nicht gespeichert werden: '+(e.message||'Unbekannter Fehler'));
 }finally{
  if(readingSeq===seq){readingSaving=false;if(el('reading-save'))el('reading-save').disabled=false}
 }
}

export function nextReadingAt(lastReadingAt,unit,count){
 const start=new Date(lastReadingAt);
 const step=Number(count);
 if(Number.isNaN(start.getTime())||!Number.isInteger(step)||step<1)return null;
 const result=new Date(start.getTime());
 if(unit==='day'){result.setDate(result.getDate()+step);return result}
 if(unit==='week'){result.setDate(result.getDate()+step*7);return result}
 if(unit==='month'){
  const day=result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth()+step);
  const lastDay=new Date(result.getFullYear(),result.getMonth()+1,0).getDate();
  result.setDate(Math.min(day,lastDay));
  return result;
 }
 return null;
}

export function readingScheduleStatus(nextDue,now){
 const due=new Date(nextDue).getTime();
 const current=new Date(now).getTime();
 if(Number.isNaN(due)||Number.isNaN(current))return null;
 if(due<current)return 'overdue';
 if(due<=current+soonWindowMs)return 'soon';
 return 'current';
}

export function latestConsumption(rows){
 const map=new Map();
 for(const row of rows||[]){
  const time=new Date(row?.reading_at).getTime();
  if(!row?.meter_id||Number.isNaN(time))continue;
  const previous=map.get(row.meter_id);
  if(!previous||time>new Date(previous.reading_at).getTime())map.set(row.meter_id,row);
 }
 return map;
}

function formatWhen(value){
 const date=new Date(value);
 if(Number.isNaN(date.getTime()))return null;
 return date.toLocaleString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
}

function formatAmount(value,unit){
 if(value==null||value==='')return null;
 const number=Number(value);
 if(!Number.isFinite(number))return String(value);
 const text=number.toLocaleString('de-DE',{maximumFractionDigits:3});
 const label=unitNames[unit]||unit||'';
 return label?text+' '+label:text;
}

function addLine(parent,text){
 const p=document.createElement('p');
 p.className='help';
 p.textContent=text;
 parent.append(p);
}

function appendReadingSummary(item,meter,latest){
 if(!latest){
  addLine(item,'Noch keine Ablesung vorhanden');
  addLine(item,'Erste Ablesung ausstehend');
  return;
 }
 const unit=latest.unit||meter.unit;
 const stand=formatAmount(latest.effective_value,unit);
 addLine(item,stand?'Letzter Stand: '+stand:'Letzter Stand liegt nicht vor');
 const when=formatWhen(latest.reading_at);
 if(when)addLine(item,'Abgelesen: '+when);
 const consumption=formatAmount(latest.consumption_value,unit);
 addLine(item,consumption?'Verbrauch: '+consumption:'Kein Verbrauch');
 const due=nextReadingAt(latest.reading_at,meter.interval_unit,meter.interval_count);
 const dueText=due?formatWhen(due):null;
 if(!dueText){addLine(item,'Nächster Ablesetermin liegt nicht vor');return}
 addLine(item,'Nächste Ablesung: '+dueText);
 const status=readingScheduleStatus(due,new Date());
 if(!status)return;
 const badge=document.createElement('div');
 badge.className='badge '+(status==='current'?'active':status==='overdue'?'inactive':'');
 badge.textContent=scheduleNames[status];
 item.append(badge);
}

export function renderReadingHistory(host,rows,context){
 host.replaceChildren();
 const ordered=[...(rows||[])].sort((a,b)=>new Date(b.reading_at)-new Date(a.reading_at));
 if(!ordered.length){message(host,'muted','Noch keine Ablesung vorhanden');return}
 const canCorrect=!!(context?.canCorrect&&context.meter);
 for(const row of ordered){
  const line=document.createElement('div');
  line.className='history';
  const bits=[];
  const when=formatWhen(row.reading_at);
  if(when)bits.push(when);
  const stand=formatAmount(row.effective_value,row.unit);
  if(stand)bits.push(stand);
  const consumption=formatAmount(row.consumption_value,row.unit);
  bits.push(consumption?'Verbrauch '+consumption:'Kein Verbrauch');
  if(row.reading_type)bits.push(readingTypeNames[row.reading_type]||row.reading_type);
  line.textContent=bits.join(' · ');
  if(canCorrect&&row.reading_id&&(row.reading_type==='regular'||row.reading_type==='reset')){
   const button=document.createElement('button');
   button.type='button';
   button.className='secondary compact-button';
   button.textContent='Korrigieren';
   button.addEventListener('click',()=>openCorrectionForm(context.meter,row));
   const actions=document.createElement('div');
   actions.append(button);
   line.append(actions);
  }
  host.append(line);
 }
}

async function loadReadingHistory(meter,facilityId,host){
 const seq=++historySeq;
 const meterId=meter?.id;
 message(host,'muted','Historie wird geladen …');
 try{
  const {data,error}=await supabase.from('utility_meter_consumption').select('reading_id,reading_at,effective_value,consumption_value,reading_type,unit').eq('meter_id',meterId).eq('facility_id',facilityId).order('reading_at',{ascending:false});
  if(seq!==historySeq||el('consumption-facility').value!==facilityId||!host.isConnected)return;
  if(error)throw error;
  const facility=state.accessibleFacilities.find(item=>item.id===facilityId);
  const current=listedMeters.find(row=>row.id===meterId)||null;
  const canCorrect=!!current&&listedFacilityId===facilityId&&membershipAllowsMeterAdmin(facility,state.myMemberships,state.currentUser?.id);
  renderReadingHistory(host,data||[],{meter:current,canCorrect});
 }catch(e){
  if(seq!==historySeq||!host.isConnected)return;
  message(host,'error','Historie konnte nicht geladen werden: '+(e.message||'Unbekannter Fehler'));
 }
}

function closeHistoryHost(host){
 host.replaceChildren();
 const button=host.previousElementSibling;
 if(button?.tagName==='BUTTON')button.textContent='Historie anzeigen';
}

function toggleHistory(meter,button,host){
 if(host.childNodes.length){historySeq++;closeHistoryHost(host);return}
 const facilityId=el('consumption-facility').value;
 if(!facilityId||facilityId!==listedFacilityId)return;
 historySeq++;
 for(const open of el('consumption-meter-list')?.querySelectorAll('.meter-history')||[])if(open!==host)closeHistoryHost(open);
 button.textContent='Historie schließen';
 loadReadingHistory(meter,facilityId,host);
}

export function resetMeterEditor(){
 editorSeq++;
 historySeq++;
 saving=false;
 closeMeterForm();
 closeReadingForm(true);
 closeCorrectionForm(true);
 closeResetForm(true);
 closeReplaceForm(true);
 reopenHistoryMeterId=null;
 el('add-meter')?.classList.add('hidden');
 if(el('meter-save'))el('meter-save').disabled=false;
 setMeterMessage('help','');
 resetMeterFields();
}

async function saveMeter(event){
 event.preventDefault();
 if(saving)return;
 const seq=editorSeq;
 const facilityId=formFacilityId;
 const meterId=editingMeterId;
 const facility=state.accessibleFacilities.find(f=>f.id===facilityId);
 if(!facilityId||el('consumption-facility').value!==facilityId||!membershipAllowsMeterAdmin(facility,state.myMemberships,state.currentUser?.id)||(meterId&&(listedFacilityId!==facilityId||!listedMeters.some(row=>row.id===meterId)))){
  setMeterMessage('error','Der Betrieb wurde gewechselt oder die Berechtigung fehlt. Der Zähler wurde nicht gespeichert.');
  closeMeterForm();
  return;
 }
 const draft=currentDraft();
 const problem=meterDraftError(draft);
 if(problem){setMeterMessage('error',problem);return}
 saving=true;
 el('meter-save').disabled=true;
 setMeterMessage('help',meterId?'Änderungen werden gespeichert …':'Zähler wird gespeichert …');
 try{
  if(editorSeq!==seq)return;
  if(el('consumption-facility').value!==facilityId){
   setMeterMessage('error','Der Betrieb wurde gewechselt. Der Zähler wurde nicht gespeichert.');
   closeMeterForm();
   return;
  }
  if(meterId){
   const {data,error}=await supabase.from('utility_meters').update(meterUpdatePayload(draft)).eq('id',meterId).eq('facility_id',facilityId).select('id');
   if(editorSeq!==seq)return;
   if(error)throw error;
   if(!data||!data.length)throw new Error('Der Zähler wurde nicht gespeichert.');
  }else{
   const {error}=await supabase.from('utility_meters').insert(meterInsertPayload(facilityId,draft));
   if(editorSeq!==seq)return;
   if(error)throw error;
  }
  resetMeterFields();
  closeMeterForm();
  if(el('consumption-facility').value===facilityId){
   setMeterMessage('ok',meterId?'✓ Änderungen gespeichert.':'✓ Zähler gespeichert.');
   await loadFacilityMeters(facilityId);
  }else setMeterMessage('help','');
 }catch(e){
  if(editorSeq!==seq)return;
  if(el('consumption-facility').value!==facilityId)closeMeterForm();
  else setMeterMessage('error',(meterId?'Änderungen konnten nicht gespeichert werden: ':'Zähler konnte nicht gespeichert werden: ')+(e.message||'Unbekannter Fehler'));
 }finally{
  if(editorSeq===seq){saving=false;if(el('meter-save'))el('meter-save').disabled=false}
 }
}

async function setMeterActive(meter,active){
 if(saving||replaceSaving||!meter?.id)return;
 const facility=selectedFacility();
 if(listedFacilityId!==facility?.id||!membershipAllowsMeterAdmin(facility,state.myMemberships,state.currentUser?.id))return;
 if(!listedMeters.some(row=>row.id===meter.id&&row.is_active!==active))return;
 if(!active&&!window.confirm('Möchtest du diesen Zähler wirklich deaktivieren? Vorhandene Ablesungen und Verbrauchsdaten bleiben erhalten. Neue Ablesungen sind anschließend nicht mehr möglich.'))return;
 const facilityId=facility.id;
 const meterId=meter.id;
 if(el('consumption-facility').value!==facilityId||listedFacilityId!==facilityId||!listedMeters.some(row=>row.id===meterId&&row.is_active!==active)||!membershipAllowsMeterAdmin(facility,state.myMemberships,state.currentUser?.id)){
  setMeterMessage('error','Der Betrieb wurde gewechselt oder die Berechtigung fehlt. Der Zähler wurde nicht geändert.');
  return;
 }
 const seq=editorSeq;
 saving=true;
 if(el('meter-save'))el('meter-save').disabled=true;
 setMeterMessage('help',active?'Zähler wird reaktiviert …':'Zähler wird deaktiviert …');
 try{
  if(editorSeq!==seq)return;
  if(el('consumption-facility').value!==facilityId){
   setMeterMessage('error','Der Betrieb wurde gewechselt. Der Zähler wurde nicht geändert.');
   return;
  }
  const {data,error}=await supabase.from('utility_meters').update({is_active:active}).eq('id',meterId).eq('facility_id',facilityId).eq('is_active',!active).select('id');
  if(editorSeq!==seq)return;
  if(error)throw error;
  if(!data||!data.length)throw new Error('Der Zähler wurde nicht geändert.');
  if(el('consumption-facility').value===facilityId){
   setMeterMessage('ok',active?'✓ Zähler reaktiviert.':'✓ Zähler deaktiviert.');
   await loadFacilityMeters(facilityId);
  }else setMeterMessage('help','');
 }catch(e){
  if(editorSeq!==seq)return;
  if(el('consumption-facility').value!==facilityId)return;
  setMeterMessage('error',(active?'Zähler konnte nicht reaktiviert werden: ':'Zähler konnte nicht deaktiviert werden: ')+(e.message||'Unbekannter Fehler'));
 }finally{
  if(editorSeq===seq){saving=false;if(el('meter-save'))el('meter-save').disabled=false}
 }
}

function message(box,className,text){
 const p=document.createElement('p');
 p.className=className;
 p.textContent=text;
 box.replaceChildren(p);
}

export function clearFacilityMeters(){
 requestSeq++;
 historySeq++;
 reopenHistoryMeterId=null;
 listedFacilityId=null;
 listedMeters=[];
 const box=el('consumption-meter-list');
 if(box)box.replaceChildren();
}

export function renderFacilityMeters(rows,facilityId=el('consumption-facility')?.value||null,consumptionRows=[]){
 const box=el('consumption-meter-list');
 if(!box)return;
 const latest=latestConsumption(consumptionRows);
 listedMeters=rows||[];
 listedFacilityId=facilityId;
 if(!listedMeters.length){
  message(box,'muted','Für diesen Betrieb sind noch keine Zähler angelegt.');
  if(readingMeterId)closeReadingForm(true);
  if(editingMeterId)closeMeterForm();
  if(correctionMeterId)closeCorrectionForm(true);
  if(resetMeterId)closeResetForm(true);
  if(replaceMeterId)closeReplaceForm(true);
  reopenHistoryMeterId=null;
  return;
 }
 box.replaceChildren();
 for(const meter of rows){
  const item=document.createElement('div');
  item.className='item';
  const title=document.createElement('strong');
  title.textContent=meter.label;
  const detail=document.createElement('p');
  detail.className='help';
  const parts=[];
  if(meter.meter_number)parts.push('Zählernummer '+meter.meter_number);
  parts.push(mediumNames[meter.medium]||meter.medium);
  parts.push(unitNames[meter.unit]||meter.unit);
  if(meter.location)parts.push(meter.location);
  detail.textContent=parts.join(' · ');
  const badge=document.createElement('div');
  badge.className='badge '+(meter.is_active?'active':'inactive');
  badge.textContent=meter.is_active?meterStatusNames.active:meterStatusNames.inactive;
  item.append(title,detail,badge);
  appendReadingSummary(item,meter,latest.get(meter.id));
  const facility=selectedFacility();
  const canAdmin=facility&&listedFacilityId===facility.id&&membershipAllowsMeterAdmin(facility,state.myMemberships,state.currentUser?.id);
  const hasSuccessor=rows.some(row=>row.replaces_meter_id===meter.id);
  if(canAdmin){
   const editButton=document.createElement('button');
   editButton.type='button';
   editButton.className='secondary compact-button';
   editButton.textContent='Bearbeiten';
   editButton.addEventListener('click',()=>openMeterEdit(meter));
   item.append(editButton);
   if(meter.is_active||!hasSuccessor){
    const activeButton=document.createElement('button');
    activeButton.type='button';
    activeButton.className='secondary compact-button';
    activeButton.textContent=meter.is_active?'Deaktivieren':'Reaktivieren';
    activeButton.addEventListener('click',()=>setMeterActive(meter,!meter.is_active));
    item.append(activeButton);
   }
  }
  const historyHost=document.createElement('div');
  historyHost.className='meter-history';
  const historyButton=document.createElement('button');
  historyButton.type='button';
  historyButton.className='secondary compact-button';
  historyButton.textContent='Historie anzeigen';
  historyButton.addEventListener('click',()=>toggleHistory(meter,historyButton,historyHost));
  item.append(historyButton,historyHost);
  if(reopenHistoryMeterId===meter.id&&listedFacilityId){
   reopenHistoryMeterId=null;
   historyButton.textContent='Historie schließen';
   loadReadingHistory(meter,listedFacilityId,historyHost);
  }
  if(meter.is_active&&facility&&listedFacilityId===facility.id&&membershipAllowsMeterReading(facility,state.myMemberships,state.currentUser?.id)){
   const button=document.createElement('button');
   button.type='button';
   button.className='secondary compact-button';
   button.textContent='Zählerstand erfassen';
   button.addEventListener('click',()=>openReadingForm(meter));
   item.append(button);
  }
  const latestRow=latest.get(meter.id);
  if(canAdmin&&meter.is_active){
   const replaceButton=document.createElement('button');
   replaceButton.type='button';
   replaceButton.className='secondary compact-button';
   replaceButton.textContent='Zähler wechseln';
   replaceButton.addEventListener('click',()=>openReplaceForm(meter,latestRow));
   item.append(replaceButton);
  }
  if(canAdmin&&meter.is_active&&latestRow?.reading_type==='regular'){
   const resetButton=document.createElement('button');
   resetButton.type='button';
   resetButton.className='secondary compact-button';
   resetButton.textContent='Zählerrücksetzung erfassen';
   resetButton.addEventListener('click',()=>openResetForm(meter,latestRow));
   item.append(resetButton);
  }
  box.append(item);
 }
 if(readingMeterId&&!rows.some(row=>row.id===readingMeterId&&row.is_active))closeReadingForm(true);
 if(editingMeterId&&!rows.some(row=>row.id===editingMeterId))closeMeterForm();
 if(correctionMeterId&&!rows.some(row=>row.id===correctionMeterId))closeCorrectionForm(true);
 const resetMeter=rows.find(row=>row.id===resetMeterId);
 if(resetMeterId&&(!resetMeter?.is_active||latest.get(resetMeterId)?.reading_type!=='regular'))closeResetForm(true);
 const replaceMeter=rows.find(row=>row.id===replaceMeterId);
 if(replaceMeterId&&!replaceMeter?.is_active)closeReplaceForm(true);
 if(reopenHistoryMeterId&&!rows.some(row=>row.id===reopenHistoryMeterId))reopenHistoryMeterId=null;
}

export async function fetchFacilityMeters(facilityId){
 if(!facilityId)return [];
 const {data,error}=await supabase.from('utility_meters').select('id,label,meter_number,medium,unit,location,is_active,interval_unit,interval_count,replaces_meter_id').eq('facility_id',facilityId).order('label');
 if(error)throw error;
 return data||[];
}

export async function loadFacilityMeters(facilityId){
 const box=el('consumption-meter-list');
 if(!box)return;
 syncMeterEditor();
 const seq=++requestSeq;
 historySeq++;
 box.replaceChildren();
 if(!facilityId)return;
 message(box,'muted','Zähler werden geladen …');
 try{
  const [metersResult,consumptionResult]=await Promise.all([
   fetchFacilityMeters(facilityId).then(data=>({data,error:null})).catch(error=>({data:null,error})),
   supabase.from('utility_meter_consumption').select('meter_id,reading_at,effective_value,consumption_value,reading_type,unit').eq('facility_id',facilityId)
  ]);
  if(seq!==requestSeq||el('consumption-facility').value!==facilityId)return;
  if(metersResult.error)throw metersResult.error;
  if(consumptionResult.error)throw consumptionResult.error;
  renderFacilityMeters(metersResult.data||[],facilityId,consumptionResult.data||[]);
 }catch(e){
  if(seq!==requestSeq)return;
  message(box,'error','Zähler konnten nicht geladen werden: '+(e.message||'Unbekannter Fehler'));
 }
}

fillSelect('meter-medium',Object.entries(mediumNames),'electricity');
fillSelect('meter-interval',Object.entries(intervalNames),'month');
fillUnits('electricity','kWh');
el('add-meter')?.addEventListener('click',openMeterForm);
el('meter-cancel')?.addEventListener('click',()=>{closeMeterForm();setMeterMessage('help','')});
el('meter-form')?.addEventListener('submit',saveMeter);
el('meter-medium')?.addEventListener('change',()=>fillUnits(el('meter-medium').value));
el('consumption-facility')?.addEventListener('change',syncMeterEditor);
el('reading-cancel')?.addEventListener('click',()=>closeReadingForm(true));
el('reading-form')?.addEventListener('submit',saveReading);
ensureCorrectionForm();
ensureResetForm();
ensureReplaceForm();

const periodPageSize=40;
let periodMode='manage';
let periodSeq=0;
let periodRows=[];
let periodOffset=0;
let periodHasMore=false;
let periodLoading=false;
let periodFacilityId=null;
let periodChartMeter=null;
let periodChartFocus=false;

function thousandths(value){
 const raw=String(value??'').trim().replace(',','.');
 if(!/^\d+(\.\d{1,3})?$/.test(raw))return null;
 const [whole,fraction='']=raw.split('.');
 return BigInt(whole)*1000n+BigInt((fraction+'000').slice(0,3));
}

function thousandthsText(total){
 const whole=total/1000n;
 const fraction=(total%1000n).toString().padStart(3,'0').replace(/0+$/,'');
 return fraction?whole.toString()+'.'+fraction:whole.toString();
}

function countsInFacilityTotal(row){
 return row.is_main_meter===true&&row.counts_in_facility_total===true&&(row.parent_meter_id==null||row.parent_meter_id==='');
}

function periodType(row){
 if(row.is_main_meter===true&&(row.parent_meter_id==null||row.parent_meter_id===''))return 'Hauptzähler';
 if(row.is_main_meter===false||row.parent_meter_id)return 'Unterzähler';
 return 'Zuordnung unklar';
}

function measuredSummary(rows){
 const counted=rows.filter(countsInFacilityTotal);
 if(!counted.length)return {kind:'none',counted:0};
 const units=[...new Set(counted.map(row=>row.unit).filter(Boolean))];
 if(units.length!==1||counted.some(row=>!row.unit))return {kind:'mixed',counted:counted.length};
 let total=0n;
 for(const row of counted){
  const part=thousandths(row.consumption_value);
  if(part==null)return {kind:'invalid',counted:counted.length};
  total+=part;
 }
 return {kind:'value',counted:counted.length,unit:units[0],total};
}

function acceptPeriod(row,facilityId,medium,meterId){
 return !!row&&row.facility_id===facilityId&&row.medium===medium&&(!meterId||row.meter_id===meterId);
}

function setPeriodMessage(className,text){
 const message=el('period-message');
 if(!message)return;
 message.className=className;
 message.textContent=text;
}

function clearPeriodDisplay(text){
 periodSeq++;
 periodRows=[];
 periodOffset=0;
 periodHasMore=false;
 periodLoading=false;
 periodFacilityId=null;
 setPeriodMessage('muted',text);
 el('period-summary')?.replaceChildren();
 el('period-chart')?.replaceChildren();
 el('period-table')?.replaceChildren();
 el('period-more')?.classList.add('hidden');
 periodChartMeter=null;
 clearTrend(text);
 const note=el('period-meter-note');
 if(note)note.textContent='';
}

function renderPeriodSummary(facility){
 const summary=el('period-summary');
 if(!summary)return;
 summary.replaceChildren();
 const heading=document.createElement('h2');
 heading.textContent='Summe der angezeigten gemessenen Abschnitte';
 const scope=document.createElement('p');
 scope.className='help';
 scope.textContent=(facility?.name||'Betrieb')+' · '+(mediumNames[el('period-medium')?.value]||'Verbrauchsart');
 summary.append(heading,scope);
 const result=measuredSummary(periodRows);
 const value=document.createElement('p');
 if(result.kind==='value'){
  value.append(document.createTextNode(formatAmount(thousandthsText(result.total),result.unit)||''));
 }else if(result.kind==='mixed'){
  value.className='help';
  value.textContent='Die Summe wird nicht angezeigt, weil die Abschnitte der Betriebssumme unterschiedliche Einheiten haben.';
 }else if(result.kind==='invalid'){
  value.className='help';
  value.textContent='Die Summe wird nicht angezeigt, weil ein Verbrauchswert nicht eindeutig gelesen werden konnte.';
 }else{
  value.className='help';
  value.textContent='Unter den angezeigten Abschnitten zählt keiner zur Betriebssumme.';
 }
 summary.append(value);
 const detail=document.createElement('p');
 detail.className='help';
 const parts=[];
 parts.push(result.counted+' von '+periodRows.length+' angezeigten Abschnitten zählen zur Betriebssumme.');
 parts.push('Unterzähler bleiben in der Tabelle und werden nicht addiert.');
 parts.push('Das ist keine Monats- oder Jahresauswertung.');
 if(periodHasMore)parts.push('Noch nicht geladene Abschnitte sind nicht enthalten.');
 detail.textContent=parts.join(' ');
 summary.append(detail);
}

function renderPeriodTable(){
 const table=el('period-table');
 if(!table)return;
 table.replaceChildren();
 const head=document.createElement('thead');
 const headRow=document.createElement('tr');
 for(const label of ['Zähler','Von','Bis','Verbrauch','Typ']){
  const cell=document.createElement('th');
  cell.scope='col';
  cell.textContent=label;
  headRow.append(cell);
 }
 head.append(headRow);
 const body=document.createElement('tbody');
 const ordered=[...periodRows].sort((a,b)=>{
  const left=new Date(b.period_end).getTime();
  const right=new Date(a.period_end).getTime();
  const leftTime=Number.isNaN(left)?Number.NEGATIVE_INFINITY:left;
  const rightTime=Number.isNaN(right)?Number.NEGATIVE_INFINITY:right;
  if(leftTime!==rightTime)return leftTime>rightTime?1:-1;
  return String(b.reading_id||'').localeCompare(String(a.reading_id||''));
 });
 for(const row of ordered){
  const tr=document.createElement('tr');
  const cells=[
   ['Zähler',row.meter_label||'Zähler'],
   ['Von',formatWhen(row.period_start)||'Beginn unklar'],
   ['Bis',formatWhen(row.period_end)||'Ende unklar'],
   ['Verbrauch',formatAmount(row.consumption_value,row.unit)||'Kein gemessener Verbrauch'],
   ['Typ',periodType(row)]
  ];
  for(const [label,text] of cells){
   const td=document.createElement('td');
   td.dataset.label=label;
   td.textContent=text;
   tr.append(td);
  }
  body.append(tr);
 }
 table.append(head,body);
}

function barColor(type){
 if(type==='Hauptzähler')return '#e1bf48';
 if(type==='Unterzähler')return '#8ea4b8';
 return '#405b73';
}

function meterChartType(periods){
 const types=new Set(periods.map(periodType));
 if(types.size===1)return [...types][0];
 return 'Zuordnung unklar';
}

function unitRank(unit){
 if(unit==='kWh')return 0;
 if(unit==='m3')return 1;
 return 2;
}

function chartMeters(rows){
 const byUnit=new Map();
 for(const row of rows||[]){
  const unit=row.unit||'';
  if(!byUnit.has(unit))byUnit.set(unit,new Map());
  const meters=byUnit.get(unit);
  const key=row.meter_id||'';
  if(!meters.has(key))meters.set(key,{meterId:key,label:row.meter_label||'Zähler',unit,periods:[],total:0n,invalid:false});
  const meter=meters.get(key);
  if(row.meter_label)meter.label=row.meter_label;
  meter.periods.push(row);
  const part=thousandths(row.consumption_value);
  if(part==null)meter.invalid=true;
  else meter.total+=part;
 }
 const units=[...byUnit.keys()].sort((a,b)=>unitRank(a)-unitRank(b)||a.localeCompare(b,'de'));
 return units.map(unit=>{
  const meters=[...byUnit.get(unit).values()];
  for(const meter of meters){
   meter.type=meterChartType(meter.periods);
   meter.periods.sort((a,b)=>{
    const left=new Date(b.period_end).getTime();
    const right=new Date(a.period_end).getTime();
    const leftTime=Number.isNaN(left)?Number.NEGATIVE_INFINITY:left;
    const rightTime=Number.isNaN(right)?Number.NEGATIVE_INFINITY:right;
    if(leftTime!==rightTime)return leftTime>rightTime?1:-1;
    return String(b.reading_id||'').localeCompare(String(a.reading_id||''));
   });
  }
  meters.sort((a,b)=>{
   if(a.invalid!==b.invalid)return a.invalid?1:-1;
   if(a.total!==b.total)return a.total>b.total?-1:1;
   return a.label.localeCompare(b.label,'de');
  });
  return {unit,meters};
 });
}

function svgBar(percent,color){
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
 svg.setAttribute('viewBox','0 0 100 16');
 svg.setAttribute('preserveAspectRatio','none');
 svg.setAttribute('aria-hidden','true');
 const track=document.createElementNS('http://www.w3.org/2000/svg','rect');
 track.setAttribute('x','0');
 track.setAttribute('y','0');
 track.setAttribute('width','100');
 track.setAttribute('height','16');
 track.setAttribute('fill','#0e1b29');
 const value=document.createElementNS('http://www.w3.org/2000/svg','rect');
 value.setAttribute('x','0');
 value.setAttribute('y','0');
 value.setAttribute('width',String(Math.max(percent,percent>0?1.5:0)));
 value.setAttribute('height','16');
 value.setAttribute('fill',color);
 svg.append(track,value);
 return svg;
}

function renderChartDetail(groups){
 const detail=el('period-chart-detail');
 if(!detail)return;
 detail.replaceChildren();
 const selected=periodChartMeter?groups.flatMap(group=>group.meters).find(meter=>meter.meterId===periodChartMeter.meterId&&meter.unit===periodChartMeter.unit):null;
 if(!selected){
  const hint=document.createElement('p');
  hint.className='help';
  hint.textContent='Ein Balken zeigt den Zählernamen, den zusammengefassten Verbrauch der geladenen Abschnitte und die zugehörigen Messzeiträume.';
  detail.append(hint);
  return;
 }
 const title=document.createElement('strong');
 title.textContent=selected.label;
 const type=document.createElement('p');
 type.className='help';
 type.textContent=selected.type;
 const amount=document.createElement('p');
 if(selected.invalid){
  amount.className='help';
  amount.textContent='Der zusammengefasste Verbrauch wird nicht angezeigt, weil ein Abschnitt nicht eindeutig gelesen werden konnte.';
 }else{
  amount.textContent=formatAmount(thousandthsText(selected.total),selected.unit)||'';
 }
 detail.append(title,type,amount);
 const count=document.createElement('p');
 count.className='help';
 count.textContent=selected.periods.length+(selected.periods.length===1?' geladener Messabschnitt':' geladene Messabschnitte');
 detail.append(count);
 for(const period of selected.periods){
  const line=document.createElement('p');
  line.className='help';
  const start=formatWhen(period.period_start)||'Beginn unklar';
  const end=formatWhen(period.period_end)||'Ende unklar';
  const value=formatAmount(period.consumption_value,period.unit)||'Kein gemessener Verbrauch';
  line.textContent=start+' – '+end+' · '+value;
  detail.append(line);
 }
}

function renderPeriodChart(){
 const chart=el('period-chart');
 if(!chart)return;
 const previousScroll=[...chart.querySelectorAll('.period-chart-list')].map(node=>node.scrollTop);
 chart.replaceChildren();
 const heading=document.createElement('h2');
 heading.textContent='Verbrauch je Zähler';
 chart.append(heading);
 if(!periodRows.length){
  periodChartMeter=null;
  const text=document.createElement('p');
  text.className='help';
  text.textContent='Kein Diagramm, weil keine gemessenen Abschnitte geladen sind.';
  chart.append(text);
  return;
 }
 const note=document.createElement('p');
 note.className='help';
 const noteParts=['Jeder Balken fasst nur die bereits geladenen gemessenen Abschnitte eines Zählers zusammen.'];
 noteParts.push('Zählerwechsel erzeugen keinen zusätzlichen Abschnitt.');
 if(periodHasMore)noteParts.push('Noch nicht geladene Abschnitte fehlen.');
 note.textContent=noteParts.join(' ');
 chart.append(note);
 const legend=document.createElement('div');
 legend.className='period-chart-legend';
 for(const [label,color] of [['Hauptzähler','#e1bf48'],['Unterzähler','#8ea4b8']]){
  const item=document.createElement('span');
  const swatch=document.createElement('i');
  swatch.className='period-swatch';
  swatch.style.background=color;
  item.append(swatch,document.createTextNode(label));
  legend.append(item);
 }
 chart.append(legend);
 const groups=chartMeters(periodRows);
 if(periodChartMeter&&!groups.some(group=>group.unit===periodChartMeter.unit&&group.meters.some(meter=>meter.meterId===periodChartMeter.meterId)))periodChartMeter=null;
 if(groups.length>1){
  const split=document.createElement('p');
  split.className='help';
  split.textContent='Unterschiedliche Einheiten stehen in getrennten Diagrammen.';
  chart.append(split);
 }
 for(const group of groups){
  const title=document.createElement('h3');
  title.textContent=unitNames[group.unit]||group.unit||'ohne Einheit';
  const list=document.createElement('div');
  list.className='period-chart-list';
  const max=group.meters.reduce((highest,meter)=>!meter.invalid&&meter.total>highest?meter.total:highest,0n);
  for(const meter of group.meters){
   const button=document.createElement('button');
   button.type='button';
   button.className='period-bar';
   button.dataset.unit=group.unit;
   button.dataset.meter=meter.meterId;
   const selected=periodChartMeter&&periodChartMeter.meterId===meter.meterId&&periodChartMeter.unit===group.unit;
   if(selected)button.classList.add('is-selected');
   button.setAttribute('aria-pressed',selected?'true':'false');
   const amountText=meter.invalid?'Verbrauch unklar':(formatAmount(thousandthsText(meter.total),meter.unit)||'');
   button.setAttribute('aria-label',meter.label+', '+meter.type+', '+amountText);
   const label=document.createElement('span');
   label.className='period-bar-label';
   const name=document.createElement('strong');
   name.textContent=meter.label;
   const kind=document.createElement('small');
   kind.textContent=meter.type;
   label.append(name,kind);
   const percent=!meter.invalid&&max>0n?Number(meter.total*1000n/max)/10:0;
   const amount=document.createElement('span');
   amount.className='period-bar-amount';
   amount.textContent=amountText;
   button.append(label,svgBar(percent,barColor(meter.type)),amount);
   button.addEventListener('click',()=>{
    periodChartMeter={meterId:meter.meterId,unit:group.unit};
    periodChartFocus=true;
    renderPeriodChart();
   });
   list.append(button);
  }
  chart.append(title,list);
 }
 const detail=document.createElement('div');
 detail.id='period-chart-detail';
 chart.append(detail);
 const lists=chart.querySelectorAll('.period-chart-list');
 lists.forEach((node,index)=>{node.scrollTop=previousScroll[index]||0});
 renderChartDetail(groups);
 if(periodChartFocus){
  periodChartFocus=false;
  chart.querySelector('button.period-bar.is-selected')?.focus();
 }
}

function renderPeriods(facility){
 if(!periodRows.length){
  const summary=el('period-summary');
  if(summary){
   summary.replaceChildren();
   const heading=document.createElement('h2');
   heading.textContent='Summe der angezeigten gemessenen Abschnitte';
   const text=document.createElement('p');
   text.className='help';
   text.textContent='Für diese Auswahl gibt es noch keine gemessenen Verbrauchsabschnitte. Deshalb wird keine Summe angezeigt.';
   summary.append(heading,text);
  }
  el('period-table')?.replaceChildren();
  el('period-more')?.classList.add('hidden');
  periodChartMeter=null;
  renderPeriodChart();
  setPeriodMessage('muted','Für diese Auswahl gibt es noch keine gemessenen Verbrauchsabschnitte.');
  return;
 }
 renderPeriodSummary(facility);
 renderPeriodChart();
 renderPeriodTable();
 const more=el('period-more');
 if(more){
  more.classList.toggle('hidden',!periodHasMore);
  more.disabled=false;
  more.textContent='Weitere Abschnitte laden';
 }
 if(!periodRows.length)setPeriodMessage('muted','Für diese Auswahl gibt es noch keine gemessenen Verbrauchsabschnitte.');
 else setPeriodMessage('help',periodRows.length+(periodHasMore?' Abschnitte angezeigt. Weitere sind vorhanden.':' Abschnitte angezeigt.'));
}

async function loadPeriodMeters(facilityId,medium,seq){
 const seen=new Map();
 const page=400;
 for(let index=0;index<15;index++){
  const from=index*page;
  const {data,error}=await supabase.from('utility_meter_consumption_periods').select('meter_id,meter_label,facility_id,medium').eq('facility_id',facilityId).eq('medium',medium).order('meter_label',{ascending:true}).order('meter_id',{ascending:true}).range(from,from+page-1);
  if(seq!==periodSeq)return null;
  if(error)throw error;
  for(const row of data||[])if(row.meter_id&&row.facility_id===facilityId&&row.medium===medium)seen.set(row.meter_id,row.meter_label||'Zähler');
  if(!data||data.length<page)return {meters:seen,complete:true};
 }
 return {meters:seen,complete:false};
}

function fillPeriodMeters(options){
 const sel=el('period-meter');
 if(!sel||!options)return;
 const current=sel.value;
 sel.replaceChildren();
 const all=document.createElement('option');
 all.value='';
 all.textContent='Alle Zähler';
 sel.append(all);
 const meters=[...options.meters.entries()].sort((a,b)=>String(a[1]).localeCompare(String(b[1]),'de'));
 for(const [id,label] of meters){
  const option=document.createElement('option');
  option.value=id;
  option.textContent=label;
  sel.append(option);
 }
 sel.value=[...sel.options].some(option=>option.value===current)?current:'';
 const note=el('period-meter-note');
 if(note)note.textContent=options.complete?'':'Die Zählerauswahl enthält nur einen Teil der vorhandenen Abschnitte.';
}

async function loadPeriodPage(facilityId,medium,meterId,offset){
 let request=supabase.from('utility_meter_consumption_periods').select('reading_id,meter_id,meter_label,facility_id,medium,unit,period_start,period_end,consumption_value,parent_meter_id,counts_in_facility_total,is_main_meter').eq('facility_id',facilityId).eq('medium',medium).order('period_end',{ascending:false}).order('reading_id',{ascending:false}).range(offset,offset+periodPageSize-1);
 if(meterId)request=request.eq('meter_id',meterId);
 const {data,error}=await request;
 if(error)throw error;
 const received=(data||[]).length;
 const rows=(data||[]).filter(row=>acceptPeriod(row,facilityId,medium,meterId));
 return {rows,received,hasMore:received===periodPageSize};
}

async function loadPeriods({append,refreshMeters}){
 if(periodMode!=='evaluation')return;
 const facility=selectedFacility();
 if(!facility){
  clearPeriodDisplay('Für dein Konto sind keine Betriebe freigegeben.');
  return;
 }
 const medium=el('period-medium')?.value;
 if(!Object.hasOwn(mediumNames,medium)){
  setPeriodMessage('error','Bitte eine Verbrauchsart auswählen.');
  return;
 }
 const meterId=el('period-meter')?.value||'';
 const seq=++periodSeq;
 periodLoading=true;
 periodFacilityId=facility.id;
 if(!append){
  periodRows=[];
  periodOffset=0;
  periodHasMore=false;
  el('period-summary')?.replaceChildren();
  el('period-chart')?.replaceChildren();
  el('period-table')?.replaceChildren();
  el('period-more')?.classList.add('hidden');
  periodChartMeter=null;
  setPeriodMessage('muted','Abschnitte werden geladen …');
  void loadTrend();
 }else{
  const more=el('period-more');
  if(more){more.disabled=true;more.textContent='Weitere Abschnitte werden geladen …'}
 }
 try{
  const meterPromise=refreshMeters?loadPeriodMeters(facility.id,medium,seq):null;
  const page=await loadPeriodPage(facility.id,medium,meterId,append?periodOffset:0);
  if(seq!==periodSeq)return;
  if(el('consumption-facility')?.value!==facility.id){periodLoading=false;return}
  if(meterPromise){
   const options=await meterPromise;
   if(seq!==periodSeq||!options)return;
   fillPeriodMeters(options);
   if((el('period-meter')?.value||'')!==meterId){
    periodLoading=false;
    await loadPeriods({append:false,refreshMeters:false});
    return;
   }
  }
  if(seq!==periodSeq)return;
  const known=new Set(periodRows.map(row=>row.reading_id));
  for(const row of page.rows)if(!known.has(row.reading_id))periodRows.push(row);
  periodOffset=(append?periodOffset:0)+page.received;
  periodHasMore=page.hasMore;
  periodLoading=false;
  renderPeriods(facility);
 }catch(e){
  if(seq!==periodSeq)return;
  periodLoading=false;
  const text='Die Verbrauchsabschnitte konnten nicht geladen werden: '+(e.message||'Unbekannter Fehler');
  if(append&&periodRows.length){
   setPeriodMessage('error',text);
   const more=el('period-more');
   if(more){more.disabled=false;more.textContent='Weitere Abschnitte laden';more.classList.toggle('hidden',!periodHasMore)}
  }else{
   periodRows=[];
   periodOffset=0;
   periodHasMore=false;
   el('period-summary')?.replaceChildren();
   el('period-chart')?.replaceChildren();
   el('period-table')?.replaceChildren();
   el('period-more')?.classList.add('hidden');
   periodChartMeter=null;
   setPeriodMessage('error',text);
  }
 }
}

let trendSeq=0;
let trendRows=[];
let trendFocus=null;
let trendView=null;
let trendWidth=0;
let trendResizeBound=false;

function berlinToday(){
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
 const read=type=>Number(parts.find(part=>part.type===type)?.value);
 return {y:read('year'),m:read('month'),d:read('day')};
}

function dateKey(date){
 return String(date.y).padStart(4,'0')+'-'+String(date.m).padStart(2,'0')+'-'+String(date.d).padStart(2,'0');
}

function parseDateKey(value){
 const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value||''));
 if(!match)return null;
 const date={y:Number(match[1]),m:Number(match[2]),d:Number(match[3])};
 const check=new Date(Date.UTC(date.y,date.m-1,date.d));
 if(check.getUTCFullYear()!==date.y||check.getUTCMonth()!==date.m-1||check.getUTCDate()!==date.d)return null;
 return date;
}

function compareDates(left,right){
 if(left.y!==right.y)return left.y<right.y?-1:1;
 if(left.m!==right.m)return left.m<right.m?-1:1;
 if(left.d!==right.d)return left.d<right.d?-1:1;
 return 0;
}

function addDays(date,days){
 const next=new Date(Date.UTC(date.y,date.m-1,date.d+days));
 return {y:next.getUTCFullYear(),m:next.getUTCMonth()+1,d:next.getUTCDate()};
}

function addMonths(date,months){
 const index=date.m-1+months;
 const year=date.y+Math.floor(index/12);
 const month=((index%12)+12)%12;
 const last=new Date(Date.UTC(year,month+1,0)).getUTCDate();
 return {y:year,m:month+1,d:Math.min(date.d,last)};
}

function trendRange(){
 const preset=el('trend-preset')?.value||'30';
 const today=berlinToday();
 if(preset==='7')return {from:addDays(today,-6),to:today};
 if(preset==='12')return {from:addMonths({y:today.y,m:today.m,d:1},-11),to:today};
 if(preset!=='custom')return {from:addDays(today,-29),to:today};
 const from=parseDateKey(el('trend-from')?.value);
 const to=parseDateKey(el('trend-to')?.value);
 if(!from||!to)return {error:'Bitte Anfang und Ende des Zeitraums wählen.'};
 if(compareDates(to,from)<0)return {error:'Das Ende des Zeitraums liegt vor dem Anfang.'};
 if(compareDates(to,addMonths(from,60))>=0)return {error:'Der Zeitraum darf höchstens fünf Jahre umfassen.'};
 return {from,to};
}

function syncTrendCustom(fill){
 const custom=el('trend-preset')?.value==='custom';
 el('trend-from-label')?.classList.toggle('hidden',!custom);
 el('trend-to-label')?.classList.toggle('hidden',!custom);
 if(!custom||!fill)return;
 const today=berlinToday();
 if(el('trend-from')&&!el('trend-from').value)el('trend-from').value=dateKey(addDays(today,-29));
 if(el('trend-to')&&!el('trend-to').value)el('trend-to').value=dateKey(today);
}

function trendSlots(from,to,grain){
 const slots=[];
 let cursor=grain==='month'?{y:from.y,m:from.m,d:1}:grain==='year'?{y:from.y,m:1,d:1}:{y:from.y,m:from.m,d:from.d};
 const limit=grain==='month'?{y:to.y,m:to.m,d:1}:grain==='year'?{y:to.y,m:1,d:1}:to;
 let guard=0;
 while(compareDates(cursor,limit)<=0&&guard<2000){
  slots.push(dateKey(cursor));
  const next=grain==='day'?addDays(cursor,1):addMonths(cursor,grain==='year'?12:1);
  if(compareDates(next,cursor)<=0)break;
  cursor=next;
  guard++;
 }
 return slots;
}

function formatTrendBucket(bucket,grain){
 const [y,m,d]=bucket.split('-').map(Number);
 const date=new Date(Date.UTC(y,(m||1)-1,d||1));
 if(grain==='year')return String(y);
 if(grain==='month')return new Intl.DateTimeFormat('de-DE',{month:'long',year:'numeric',timeZone:'UTC'}).format(date);
 return new Intl.DateTimeFormat('de-DE',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'UTC'}).format(date);
}

function formatTrendAxis(bucket,grain){
 const [y,m,d]=bucket.split('-').map(Number);
 const date=new Date(Date.UTC(y,(m||1)-1,d||1));
 if(grain==='year')return String(y);
 if(grain==='month')return new Intl.DateTimeFormat('de-DE',{month:'short',timeZone:'UTC'}).format(date);
 return new Intl.DateTimeFormat('de-DE',{day:'2-digit',month:'2-digit',timeZone:'UTC'}).format(date);
}

function trendQuality(point){
 if(point.invalid)return 'Verbrauch unklar';
 if(point.measured!=null&&point.estimated!=null)return 'Gemischt, zeitanteilig geschätzt';
 if(point.estimated!=null)return 'Geschätzt';
 return 'Gemessen';
}

function countsForTrend(row){
 return (row.parent_meter_id==null||row.parent_meter_id==='')&&row.counts_in_facility_total===true;
}

function aggregateTrend(rows,meterSelected){
 const groups=new Map();
 let hiddenSubmeters=false;
 for(const row of rows){
  if(!meterSelected&&!countsForTrend(row)){
   hiddenSubmeters=true;
   continue;
  }
  const unit=row.unit||'';
  const bucket=String(row.bucket_start||'').slice(0,10);
  if(!bucket)continue;
  if(!groups.has(unit))groups.set(unit,new Map());
  const cells=groups.get(unit);
  if(!cells.has(bucket))cells.set(bucket,{measured:null,estimated:null,invalid:false});
  const cell=cells.get(bucket);
  const read=value=>{
   if(value==null||value==='')return null;
   const part=thousandths(value);
   if(part==null)cell.invalid=true;
   return part;
  };
  const measured=read(row.measured_value);
  const estimated=read(row.estimated_value);
  if(measured!=null)cell.measured=(cell.measured??0n)+measured;
  if(estimated!=null)cell.estimated=(cell.estimated??0n)+estimated;
 }
 const order=['kWh','m3'];
 const result=[...groups.entries()].sort((a,b)=>{
  const left=order.indexOf(a[0]);
  const right=order.indexOf(b[0]);
  if(left!==-1||right!==-1)return (left===-1?99:left)-(right===-1?99:right);
  return String(a[0]).localeCompare(String(b[0]),'de');
 }).map(([unit,cells])=>({
  unit,
  points:[...cells.entries()].map(([bucket,cell])=>{
   const measured=cell.measured;
   const estimated=cell.estimated;
   return {
    bucket,
    measured,
    estimated,
    invalid:cell.invalid,
    total:cell.invalid?null:(measured??0n)+(estimated??0n)
   };
  }).filter(point=>point.invalid||point.measured!=null||point.estimated!=null).sort((a,b)=>a.bucket<b.bucket?-1:1)
 })).filter(group=>group.points.length);
 return {groups:result,hiddenSubmeters};
}

function svgNode(name,attrs){
 const node=document.createElementNS('http://www.w3.org/2000/svg',name);
 for(const [key,value] of Object.entries(attrs))node.setAttribute(key,String(value));
 return node;
}

function showTrendNote(text){
 const body=el('trend-body');
 if(!body)return;
 body.replaceChildren();
 trendView=null;
 if(!text)return;
 const note=document.createElement('p');
 note.className='help';
 note.textContent=text;
 body.append(note);
}

function clearTrend(text){
 trendSeq++;
 trendRows=[];
 trendFocus=null;
 showTrendNote(text);
}

function renderTrend(range,grain,meterSelected){
 const body=el('trend-body');
 if(!body)return;
 trendView={range,grain,meterSelected};
 const width=Math.max(body.clientWidth||0,320);
 trendWidth=width;
 body.replaceChildren();
 const {groups,hiddenSubmeters}=aggregateTrend(trendRows,meterSelected);
 const scope=document.createElement('p');
 scope.className='help';
 scope.textContent=meterSelected?'Angezeigt wird nur der ausgewählte Zähler.':'Die Betriebssumme enthält nur Zähler ohne übergeordneten Zähler, die in die Betriebssumme zählen.';
 body.append(scope);
 if(!groups.length){
  const empty=document.createElement('p');
  empty.className='help';
  empty.textContent=hiddenSubmeters?'Für die Betriebssumme gibt es in diesem Zeitraum keinen Verbrauch. Unterzähler bleiben aus der Summe heraus und können einzeln gewählt werden.':'Für diesen Zeitraum gibt es keine gemessenen oder geschätzten Verbrauchsanteile.';
  body.append(empty);
  return;
 }
 const averageNote=document.createElement('p');
 averageNote.className='help';
 averageNote.textContent='Der Durchschnitt verwendet nur dargestellte Zeiträume mit einem Verbrauchswert. Leere Zeiträume zählen nicht als Null.';
 body.append(averageNote);
 if(groups.length>1){
  const split=document.createElement('p');
  split.className='help';
  split.textContent='Unterschiedliche Einheiten stehen in getrennten Diagrammen.';
  body.append(split);
 }
 const slots=trendSlots(range.from,range.to,grain);
 const grainLabel=grain==='year'?'Jahr':grain==='month'?'Monat':'Tag';
 for(const group of groups)body.append(renderTrendGroup(group,slots,grain,grainLabel,width));
 const detail=document.createElement('div');
 detail.id='trend-detail';
 body.append(detail);
 renderTrendDetail(groups,grain);
 if(trendFocus)body.querySelector('.is-selected')?.focus();
}

function renderTrendGroup(group,slots,grain,grainLabel,width){
 const section=document.createElement('section');
 section.className='trend-group';
 const title=document.createElement('h3');
 title.textContent=unitNames[group.unit]||group.unit||'ohne Einheit';
 section.append(title);
 const valid=group.points.filter(point=>!point.invalid&&point.total!=null);
 const estimated=valid.some(point=>point.estimated!=null);
 let total=0n;
 let highest=null;
 for(const point of valid){
  total+=point.total;
  if(highest==null||point.total>highest)highest=point.total;
 }
 const count=BigInt(valid.length);
 const average=count>0n?(total+count/2n)/count:null;
 const kpis=document.createElement('div');
 kpis.className='trend-kpis';
 for(const [label,value] of [['Gesamtverbrauch',valid.length?total:null],['Durchschnitt je '+grainLabel,average],['Höchster dargestellter Verbrauch',highest]]){
  const item=document.createElement('p');
  const name=document.createElement('strong');
  name.textContent=label;
  item.append(name,document.createTextNode(value==null?'–':(formatAmount(thousandthsText(value),group.unit)||'–')));
  kpis.append(item);
 }
 section.append(kpis);
 if(estimated){
  const mark=document.createElement('p');
  mark.className='help';
  mark.textContent='Diese Kennzahlen enthalten zeitanteilig geschätzte Werte.';
  section.append(mark);
 }
 const legend=document.createElement('div');
 legend.className='period-chart-legend';
 for(const [label,color] of [['Gemessen','#e1bf48'],['Geschätzt','#8ea4b8']]){
  const item=document.createElement('span');
  const swatch=document.createElement('i');
  swatch.className='period-swatch';
  swatch.style.background=color;
  item.append(swatch,document.createTextNode(label));
  legend.append(item);
 }
 section.append(legend,trendSvg(group,slots,grain,width));
 return section;
}

function trendSvg(group,slots,grain,width){
 const height=230;
 const left=58;
 const right=10;
 const top=14;
 const bottom=38;
 const plotW=Math.max(width-left-right,120);
 const plotH=height-top-bottom;
 const valid=group.points.filter(point=>!point.invalid&&point.total!=null);
 const max=valid.reduce((highest,point)=>point.total>highest?point.total:highest,1n);
 const byBucket=new Map(group.points.map(point=>[point.bucket,point]));
 const svg=svgNode('svg',{viewBox:'0 0 '+width+' '+height,role:'img','aria-label':'Verbrauchsentwicklung'});
 svg.classList.add('trend-svg');
 const axis=svgNode('line',{x1:left,y1:top,x2:left,y2:top+plotH,stroke:'#38536b'});
 const base=svgNode('line',{x1:left,y1:top+plotH,x2:left+plotW,y2:top+plotH,stroke:'#38536b'});
 svg.append(axis,base);
 const yOf=total=>top+plotH-Number(total*1000n/max)/1000*plotH;
 const topLabel=svgNode('text',{x:left-6,y:top+4,'text-anchor':'end',fill:'#aabed0','font-size':11});
  topLabel.textContent=formatAmount(thousandthsText(max),group.unit)||'';
 topLabel.setAttribute('y',String(top+11));
 const zero=svgNode('text',{x:left-6,y:top+plotH,'text-anchor':'end',fill:'#aabed0','font-size':11});
 zero.textContent='0';
 svg.append(topLabel,zero);
 const labelWidth=grain==='year'?36:grain==='month'?46:48;
 const step=Math.max(1,Math.ceil(slots.length*labelWidth/plotW));
 const slotW=plotW/Math.max(slots.length,1);
 slots.forEach((bucket,index)=>{
  if(index%step===0||(index===slots.length-1&&index%step!==0)){
   const label=svgNode('text',{x:left+slotW*index+slotW/2,y:height-12,'text-anchor':'middle',fill:'#aabed0','font-size':11});
   label.textContent=formatTrendAxis(bucket,grain);
   svg.append(label);
  }
 });
 if(grain==='day'){
  for(let index=1;index<slots.length;index++){
   const previous=byBucket.get(slots[index-1]);
   const current=byBucket.get(slots[index]);
   if(!previous||!current||previous.invalid||current.invalid||previous.total==null||current.total==null)continue;
   const estimated=previous.estimated!=null||current.estimated!=null;
   const segment=svgNode('line',{
    x1:left+slotW*(index-1)+slotW/2,
    y1:yOf(previous.total),
    x2:left+slotW*index+slotW/2,
    y2:yOf(current.total),
    stroke:estimated?'#8ea4b8':'#e1bf48',
    'stroke-width':2
   });
   if(estimated)segment.setAttribute('stroke-dasharray','5 4');
   svg.append(segment);
  }
 }
 for(let index=0;index<slots.length;index++){
  const point=byBucket.get(slots[index]);
  if(!point||point.invalid||point.total==null)continue;
  const x=left+slotW*index+slotW/2;
  const selected=trendFocus&&trendFocus.unit===group.unit&&trendFocus.bucket===point.bucket;
  if(grain==='day'){
   const hit=svgNode('circle',{cx:x,cy:yOf(point.total),r:14,fill:'transparent'});
   const dot=svgNode('circle',{
    cx:x,
    cy:yOf(point.total),
    r:selected?7:5,
    fill:point.estimated!=null&&point.measured==null?'#8ea4b8':'#e1bf48',
    stroke:point.measured!=null&&point.estimated!=null?'#8ea4b8':selected?'#eef5fc':'#142538',
    'stroke-width':selected?3:2
   });
   dot.style.pointerEvents='none';
   trendActivate(hit,group,point);
   svg.append(hit,dot);
  }else{
   const measured=point.measured??0n;
   const estimated=point.estimated??0n;
   const totalH=plotH-yOf(point.total)+top;
   const measuredH=point.total>0n?Number(measured*1000n/point.total)/1000*totalH:0;
   const estimatedH=Math.max(totalH-measuredH,0);
   const barW=Math.max(4,Math.min(28,slotW*0.62));
   const barX=x-barW/2;
   const baseY=top+plotH;
   if(measured>0n)svg.append(svgNode('rect',{x:barX,y:baseY-measuredH,width:barW,height:Math.max(measuredH,1),fill:'#e1bf48'}));
   if(estimated>0n)svg.append(svgNode('rect',{x:barX,y:baseY-measuredH-estimatedH,width:barW,height:Math.max(estimatedH,1),fill:'#8ea4b8'}));
   const hit=svgNode('rect',{x:left+slotW*index,y:top,width:slotW,height:plotH,fill:'transparent',stroke:selected?'#eef5fc':'transparent','stroke-width':selected?2:0});
   trendActivate(hit,group,point);
   svg.append(hit);
  }
 }
 return svg;
}

function trendActivate(node,group,point){
 node.setAttribute('tabindex','0');
 node.setAttribute('role','button');
 node.setAttribute('class',trendFocus&&trendFocus.unit===group.unit&&trendFocus.bucket===point.bucket?'is-selected':'');
 node.setAttribute('aria-label',formatTrendBucket(point.bucket,el('trend-grain')?.value||'day')+', '+(formatAmount(thousandthsText(point.total),group.unit)||'')+', '+trendQuality(point));
 const choose=()=>{
  trendFocus={unit:group.unit,bucket:point.bucket};
  if(trendView)renderTrend(trendView.range,trendView.grain,trendView.meterSelected);
 };
 node.addEventListener('click',choose);
 node.addEventListener('keydown',event=>{
  if(event.key==='Enter'||event.key===' '){
   event.preventDefault();
   choose();
  }
 });
}

function renderTrendDetail(groups,grain){
 const detail=el('trend-detail');
 if(!detail)return;
 detail.replaceChildren();
 const point=trendFocus?groups.flatMap(group=>group.points.map(item=>({...item,unit:group.unit}))).find(item=>item.unit===trendFocus.unit&&item.bucket===trendFocus.bucket):null;
 const hint=document.createElement('p');
 hint.className='help';
 if(!point){
  hint.textContent=grain==='day'?'Ein Punkt zeigt Datum, Verbrauch, Einheit und ob der Wert gemessen oder geschätzt ist.':'Eine Säule zeigt Zeitraum, Verbrauch, Einheit und ob der Wert gemessen oder geschätzt ist.';
  detail.append(hint);
  return;
 }
 const title=document.createElement('strong');
 title.textContent=formatTrendBucket(point.bucket,grain);
 const amount=document.createElement('p');
 amount.textContent=point.invalid?'Verbrauch unklar':(formatAmount(thousandthsText(point.total),point.unit)||'');
 const quality=document.createElement('p');
 quality.className='help';
 quality.textContent=trendQuality(point);
 detail.append(title,amount,quality);
 if(!point.invalid&&point.measured!=null&&point.estimated!=null){
  const parts=document.createElement('p');
  parts.className='help';
  parts.textContent='Gemessen '+(formatAmount(thousandthsText(point.measured),point.unit)||'')+' · geschätzt '+(formatAmount(thousandthsText(point.estimated),point.unit)||'');
  detail.append(parts);
 }
}

async function loadTrend(){
 if(periodMode!=='evaluation'||!el('trend-body'))return;
 const facility=selectedFacility();
 if(!facility){
  clearTrend('Für dein Konto sind keine Betriebe freigegeben.');
  return;
 }
 const medium=el('period-medium')?.value;
 if(!Object.hasOwn(mediumNames,medium)){
  showTrendNote('Bitte eine Verbrauchsart auswählen.');
  return;
 }
 syncTrendCustom(false);
 const range=trendRange();
 if(range.error){
  trendSeq++;
  trendRows=[];
  trendFocus=null;
  showTrendNote(range.error);
  return;
 }
 const meterId=el('period-meter')?.value||'';
 const grain=el('trend-grain')?.value==='month'||el('trend-grain')?.value==='year'?el('trend-grain').value:'day';
 const seq=++trendSeq;
 showTrendNote('Verbrauchsentwicklung wird geladen …');
 try{
  const {data,error}=await supabase.rpc('tageswerk_consumption_calendar',{
   p_facility_id:facility.id,
   p_medium:medium,
   p_meter_id:meterId||null,
   p_grain:grain,
   p_from:dateKey(range.from),
   p_to:dateKey(range.to)
  });
  if(seq!==trendSeq)return;
  if(error)throw error;
  trendRows=(data||[]).filter(row=>row&&row.facility_id===facility.id&&row.medium===medium&&(!meterId||row.meter_id===meterId));
  if(trendFocus&&!aggregateTrend(trendRows,!!meterId).groups.some(group=>group.unit===trendFocus.unit&&group.points.some(point=>point.bucket===trendFocus.bucket)))trendFocus=null;
  renderTrend(range,grain,!!meterId);
 }catch(e){
  if(seq!==trendSeq)return;
  trendRows=[];
  trendFocus=null;
  showTrendNote('Die Verbrauchsentwicklung konnte nicht geladen werden: '+(e.message||'Unbekannter Fehler'));
 }
}

function requestPeriods(options){
 if(options.resetMeter&&el('period-meter'))el('period-meter').value='';
 void loadPeriods({append:false,refreshMeters:options.refreshMeters});
}

function setConsumptionMode(mode){
 periodMode=mode==='evaluation'?'evaluation':'manage';
 const evaluation=periodMode==='evaluation';
 el('consumption-manage')?.classList.toggle('hidden',evaluation);
 el('consumption-evaluation')?.classList.toggle('hidden',!evaluation);
 el('consumption-mode-manage')?.classList.toggle('active',!evaluation);
 el('consumption-mode-periods')?.classList.toggle('active',evaluation);
 if(evaluation)requestPeriods({resetMeter:false,refreshMeters:true});
}

function mountConsumptionEvaluation(){
 const panel=el('consumption-panel');
 const facilitySelect=el('consumption-facility');
 const start=el('add-meter');
 const end=el('consumption-meters');
 if(!panel||!facilitySelect||!start||!end||el('consumption-mode')||start.parentNode!==end.parentNode)return;
 const wrap=document.createElement('div');
 wrap.id='consumption-manage';
 start.parentNode.insertBefore(wrap,start);
 let node=start;
 while(node){
  const next=node.nextSibling;
  wrap.append(node);
  if(node===end)break;
  node=next;
 }
 if(!document.getElementById('consumption-period-style')){
  const style=document.createElement('style');
  style.id='consumption-period-style';
  style.textContent='#consumption-mode{margin:14px 0}#consumption-mode button{margin:0 8px 8px 0}#period-table-wrap{overflow-x:auto}#period-table{width:100%;border-collapse:collapse}#period-table th,#period-table td{text-align:left;padding:10px 8px;border-bottom:1px solid #405b73;vertical-align:top}#period-table th{color:#e1bf48;font-weight:650}#period-summary,#period-chart{margin:12px 0;padding:12px;border:1px solid #4b6680;background:#142538}#period-summary h2,#period-chart h2{font-size:18px}#period-chart h3{margin:16px 0 8px;font-size:16px;color:#e1bf48}.period-chart-legend{display:flex;gap:14px;flex-wrap:wrap;margin:8px 0 4px}.period-chart-legend span{display:inline-flex;align-items:center;gap:6px}.period-swatch{width:14px;height:14px;display:inline-block}.period-chart-list{display:flex;flex-direction:column;gap:8px;max-height:520px;overflow:auto}#period-chart button.period-bar{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(90px,1.6fr) auto;gap:8px;align-items:center;width:100%;margin:0;padding:8px;background:#1a2d40;border:1px solid #38536b;color:#eef5fc;text-align:left;font-weight:500;cursor:pointer}#period-chart button.period-bar.is-selected{border-color:#e1bf48}#period-chart button.period-bar svg{width:100%;height:18px;display:block}.period-bar-label{min-width:0}.period-bar-label strong,.period-bar-label small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.period-bar-label small{color:#aabed0;font-size:12px}.period-bar-amount{white-space:nowrap}#period-chart-detail{margin-top:12px;padding-top:8px;border-top:1px solid #405b73}@media(max-width:700px){#period-chart button.period-bar{grid-template-columns:1fr;gap:4px}.period-bar-amount{white-space:normal}#period-table thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}#period-table,#period-table tbody,#period-table tr,#period-table td{display:block;width:100%}#period-table tr{padding:10px 0}#period-table td{border:0;padding:2px 0}#period-table td::before{content:attr(data-label);display:block;color:#aabed0;font-size:12px}}#period-trend{margin:12px 0;padding:12px;border:1px solid #4b6680;background:#142538}#period-trend h2,#period-trend h3{font-size:18px}#period-trend h3{margin:14px 0 8px;color:#e1bf48;font-size:16px}#trend-controls{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:8px 0}#trend-controls label{display:flex;flex-direction:column;gap:4px;margin:0;color:#aabed0;font-size:13px}.trend-kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:8px 0}.trend-kpis p{margin:0;padding:8px;background:#1a2d40;border:1px solid #38536b}.trend-kpis strong{display:block;color:#e1bf48;font-size:13px;font-weight:650}.trend-svg{width:100%;height:auto;display:block;touch-action:manipulation}#trend-detail{margin-top:8px;padding-top:8px;border-top:1px solid #405b73}@media(max-width:700px){#trend-controls,.trend-kpis{grid-template-columns:1fr}}';
  document.head.append(style);
 }
 const mode=document.createElement('div');
 mode.id='consumption-mode';
 mode.className='row';
 const manageButton=document.createElement('button');
 manageButton.type='button';
 manageButton.id='consumption-mode-manage';
 manageButton.className='secondary navbtn active';
 manageButton.textContent='Zählerverwaltung';
 manageButton.addEventListener('click',()=>setConsumptionMode('manage'));
 const periodButton=document.createElement('button');
 periodButton.type='button';
 periodButton.id='consumption-mode-periods';
 periodButton.className='secondary navbtn';
 periodButton.textContent='Auswertung';
 periodButton.addEventListener('click',()=>setConsumptionMode('evaluation'));
 mode.append(manageButton,periodButton);
 const evaluation=document.createElement('div');
 evaluation.id='consumption-evaluation';
 evaluation.classList.add('hidden');
 const heading=document.createElement('h2');
 heading.textContent='Auswertung';
 const intro=document.createElement('p');
 intro.className='help';
 intro.textContent='Der Betrieb kommt aus der Auswahl oben und bleibt auf deine freigegebenen Betriebe begrenzt. Die Verbrauchsentwicklung zeigt Tage, Monate oder Jahre. Darunter bleiben die gemessenen Abschnitte unverändert.';
 const mediumLabel=document.createElement('label');
 mediumLabel.htmlFor='period-medium';
 mediumLabel.textContent='Verbrauchsart';
 const medium=document.createElement('select');
 medium.id='period-medium';
 medium.className='app-filter';
 const meterLabel=document.createElement('label');
 meterLabel.htmlFor='period-meter';
 meterLabel.textContent='Zähler';
 const meter=document.createElement('select');
 meter.id='period-meter';
 meter.className='app-filter';
 const meterNote=document.createElement('p');
 meterNote.id='period-meter-note';
 meterNote.className='help';
 const message=document.createElement('p');
 message.id='period-message';
 message.className='help';
 message.setAttribute('role','status');
 message.setAttribute('aria-live','polite');
 const summary=document.createElement('div');
 summary.id='period-summary';
 const chart=document.createElement('div');
 chart.id='period-chart';
 const trend=document.createElement('div');
 trend.id='period-trend';
 const trendHeading=document.createElement('h2');
 trendHeading.textContent='Verbrauchsentwicklung';
 const trendHelp=document.createElement('p');
 trendHelp.className='help';
 trendHelp.textContent='Die Entwicklung verteilt gemessene Abschnitte zeitanteilig. Leere Zeiträume bleiben leer und sind kein Nullverbrauch. Linien verbinden nur direkt benachbarte Tage mit Werten. Ein Zählerwechsel erzeugt keinen zusätzlichen Abschnitt.';
 const controls=document.createElement('div');
 controls.id='trend-controls';
 const presetLabel=document.createElement('label');
 presetLabel.htmlFor='trend-preset';
 presetLabel.textContent='Zeitraum';
 const preset=document.createElement('select');
 preset.id='trend-preset';
 preset.className='app-filter';
 for(const [value,text] of [['7','Letzte 7 Tage'],['30','Letzte 30 Tage'],['12','Letzte 12 Monate'],['custom','Individueller Zeitraum']]){
  const option=document.createElement('option');
  option.value=value;
  option.textContent=text;
  preset.append(option);
 }
 preset.value='30';
 presetLabel.append(preset);
 const grainLabel=document.createElement('label');
 grainLabel.htmlFor='trend-grain';
 grainLabel.textContent='Auflösung';
 const grainSelect=document.createElement('select');
 grainSelect.id='trend-grain';
 grainSelect.className='app-filter';
 for(const [value,text] of [['day','Tag'],['month','Monat'],['year','Jahr']]){
  const option=document.createElement('option');
  option.value=value;
  option.textContent=text;
  grainSelect.append(option);
 }
 grainSelect.value='day';
 grainLabel.append(grainSelect);
 const fromLabel=document.createElement('label');
 fromLabel.id='trend-from-label';
 fromLabel.className='trend-custom hidden';
 fromLabel.htmlFor='trend-from';
 fromLabel.append(document.createTextNode('Von'));
 const fromInput=document.createElement('input');
 fromInput.id='trend-from';
 fromInput.type='date';
 fromInput.className='app-filter';
 fromLabel.append(fromInput);
 const toLabel=document.createElement('label');
 toLabel.id='trend-to-label';
 toLabel.className='trend-custom hidden';
 toLabel.htmlFor='trend-to';
 toLabel.append(document.createTextNode('Bis'));
 const toInput=document.createElement('input');
 toInput.id='trend-to';
 toInput.type='date';
 toInput.className='app-filter';
 toLabel.append(toInput);
 controls.append(presetLabel,grainLabel,fromLabel,toLabel);
 const trendBody=document.createElement('div');
 trendBody.id='trend-body';
 trend.append(trendHeading,trendHelp,controls,trendBody);
 const reloadTrend=()=>{if(periodMode==='evaluation')void loadTrend()};
 preset.addEventListener('change',()=>{syncTrendCustom(true);reloadTrend()});
 grainSelect.addEventListener('change',reloadTrend);
 fromInput.addEventListener('change',reloadTrend);
 toInput.addEventListener('change',reloadTrend);
 if(!trendResizeBound){
  trendResizeBound=true;
  window.addEventListener('resize',()=>{
   if(!trendView||!el('trend-body')?.querySelector('svg'))return;
   const nextWidth=el('trend-body').clientWidth;
   if(!nextWidth||nextWidth===trendWidth)return;
   renderTrend(trendView.range,trendView.grain,trendView.meterSelected);
  });
 }
 const wrapTable=document.createElement('div');
 wrapTable.id='period-table-wrap';
 const table=document.createElement('table');
 table.id='period-table';
 wrapTable.append(table);
 const more=document.createElement('button');
 more.type='button';
 more.id='period-more';
 more.className='secondary hidden';
 more.textContent='Weitere Abschnitte laden';
 evaluation.append(heading,intro,mediumLabel,medium,meterLabel,meter,meterNote,message,summary,trend,chart,wrapTable,more);
 facilitySelect.insertAdjacentElement('afterend',evaluation);
 facilitySelect.insertAdjacentElement('afterend',mode);
 fillSelect('period-medium',Object.entries(mediumNames),'electricity');
 const all=document.createElement('option');
 all.value='';
 all.textContent='Alle Zähler';
 meter.append(all);
 medium.addEventListener('change',()=>requestPeriods({resetMeter:true,refreshMeters:true}));
 meter.addEventListener('change',()=>requestPeriods({resetMeter:false,refreshMeters:false}));
 more.addEventListener('click',()=>{if(!periodLoading&&periodHasMore)void loadPeriods({append:true,refreshMeters:false})});
 facilitySelect.addEventListener('change',()=>{if(periodMode==='evaluation')requestPeriods({resetMeter:true,refreshMeters:true})});
 new MutationObserver(()=>{
  const facility=selectedFacility();
  if(!facility){
   clearPeriodDisplay('Für dein Konto sind keine Betriebe freigegeben.');
   return;
  }
  if(periodMode==='evaluation'&&facility.id!==periodFacilityId)requestPeriods({resetMeter:true,refreshMeters:true});
 }).observe(facilitySelect,{childList:true});
}

mountConsumptionEvaluation();
