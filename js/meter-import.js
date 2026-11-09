import {PROFILES,convertTageszeitZweizeilig,notable,READING_COLUMNS,METER_COLUMNS} from './meter-import-profiles.js';
import {needsReview,reviewRows,canMerge,dateSpan,reviewReadingsCsv,reviewMetersCsv} from './meter-import-review.js';
import {sha256Hex,buildSnapshot,matchSnapshot,defaultHistoricalTimes,reviseHistoricalTimes,historicalPreviewReady,historicalTimesForFacility,planHistoricalPayload,normalizePreviewResult,preparePreviewCall,acceptPreviewResponse,previewErrorMessage,prepareCommitCall,commitErrorMessage,runHistoricalCommit} from './meter-import-store.js';
import {isManager} from './permissions.js';
import {state} from './state.js';
import {supabase} from './supabase.js';
import {fetchFacilityMeters,loadFacilityMeters} from './meters.js';
import {mediumNames,unitNames} from './labels.js';

const PREVIEW_LIMIT=350;
const REVIEW_LIMIT=40;
const HINT_LABELS={ruecklaeufig:"Rückläufig",auffaelliger_sprung:"Sprung",datum_unbekannt:"Datum fehlt",datum_ungenau:"Datum ungenau",datum_blatt_abweichend:"Datum abweichend",ungueltige_zahl:"Ungültige Zahl",moeglicher_zaehlerwechsel:"Möglicher Wechsel",doppelter_zeitpunkt:"Doppelter Zeitpunkt"};
const DECISION_LABELS={bestaetigt:"Original bestätigt",korrigiert:"Korrigiert",ausgeschlossen:"Ausgeschlossen",zurueckgestellt:"Zurückgestellt"};
let result=null;
let fileName="";
let source=null;
let decisions=new Map();
let meterChoices=new Map();
let mergeCheck=null;
let databasePromise=null;
let persistQueue=Promise.resolve();
let selectedFacilityId="";
let meterLoadSeq=0;
let facilityMeterRows=[];
let savedMappings=[];
let mappingFacilityId="";
let mappingError="";
let mappingFlash="";
let stockByMeter=new Map();
let stockKnown=true;
let mappingLoading=false;
let timeSettings=new Map();
let preparedImport=null;
let importPlanCache=null;
let importPlanKey="";
let previewSeq=0;
let previewBusy=false;
let previewSentKey="";
let serverPreview=null;
let commitSeq=0;
let commitBusy=false;
let commitSentKey="";
let commitResult=null;
let commitConfirmed=false;

function node(tag,className,text){
 const element=document.createElement(tag);
 if(className)element.className=className;
 if(text!=null)element.textContent=text;
 return element;
}

function foldImportText(value){
 return String(value??"").trim()
  .replaceAll("Ä","a").replaceAll("Ö","o").replaceAll("Ü","u")
  .replaceAll("ä","a").replaceAll("ö","o").replaceAll("ü","u")
  .replaceAll("³","3")
  .toLowerCase();
}

function translateImportMedium(art,einheit){
 const table={
  "wasser|m3":{medium:"water",unit:"m3"},
  "strom|kwh":{medium:"electricity",unit:"kWh"},
  "erdgas|m3":{medium:"gas",unit:"m3"},
  "erdgas|kwh":{medium:"gas",unit:"kWh"},
  "gas|m3":{medium:"gas",unit:"m3"},
  "gas|kwh":{medium:"gas",unit:"kWh"},
  "warme|kwh":{medium:"heat",unit:"kWh"},
  "warme|m3":{medium:"heat",unit:"m3"},
  "waerme|kwh":{medium:"heat",unit:"kWh"},
  "waerme|m3":{medium:"heat",unit:"m3"}
 };
 return table[foldImportText(art)+"|"+foldImportText(einheit)]||null;
}

function excelRegister(label){
 if(/\bNT\b|Niedertarif/i.test(label||""))return "NT";
 if(/\b(?:HT|HAT)\b|Hochtarif/i.test(label||""))return "HT";
 return "";
}

function mappingCandidates(excelMeter,meters){
 const translated=translateImportMedium(excelMeter?.verbrauchsart,excelMeter?.einheit);
 if(!translated)return [];
 const register=excelMeter.tarifregister||excelRegister(excelMeter.zaehler_bezeichnung);
 return (meters||[]).filter(meter=>{
  if(meter.medium!==translated.medium||meter.unit!==translated.unit)return false;
  const other=excelRegister(meter.label);
  return !(register&&other&&register!==other);
 });
}

function mappingForFacility(rows,facilityId,key){
 return (rows||[]).find(row=>row.facility_id===facilityId&&row.excel_schluessel===key&&!row.revoked_at)||null;
}

function planMappingSave({excel,selectedMeterId,saved,confirmChange,altbestandChecked,stockCount,candidates,allMeters,localStatus}){
 if(localStatus==="zusammengefuehrt")return {ok:false,action:"blocked",message:"Diese Bezeichnung ist lokal zusammengeführt. Die Datenbankzuordnung erfolgt an der Zielbezeichnung."};
 const selected=(candidates||[]).find(meter=>meter.id===selectedMeterId)||null;
 if(!selectedMeterId)return {ok:false,action:"blocked",message:"Bitte einen Tageswerk-Zähler auswählen."};
 if(!selected){
  const register=excel?.tarifregister||excelRegister(excel?.zaehler_bezeichnung);
  const foreign=(allMeters||[]).find(meter=>meter.id===selectedMeterId);
  if(register&&foreign&&excelRegister(foreign.label)&&excelRegister(foreign.label)!==register)return {ok:false,action:"blocked",message:"Unterschiedliche Stromtarifregister werden nicht zugeordnet."};
  return {ok:false,action:"blocked",message:"Verbrauchsart oder Einheit passt nicht zum Zähler."};
 }
 const inactive=selected.is_active===false;
 const altbestand=inactive&&stockCount===0&&altbestandChecked===true;
 if(inactive&&stockCount===0&&!altbestandChecked)return {ok:false,action:"blocked",message:"Der deaktivierte Zähler hat keinen Bestand. Bitte den Altbestand ausdrücklich bestätigen."};
 if(inactive&&stockCount==null)return {ok:false,action:"blocked",message:"Der Ablesebestand des deaktivierten Zählers konnte nicht geprüft werden. Die Zuordnung wird nicht gespeichert."};
 const same=saved&&saved.meter_id===selected.id&&saved.altbestand_bestaetigt===altbestand&&saved.excel_bezeichnung===excel.zaehler_bezeichnung&&saved.excel_verbrauchsart===excel.verbrauchsart&&saved.excel_einheit===excel.einheit;
 if(same)return {ok:true,action:"unchanged",message:"Diese Zuordnung ist bereits gespeichert.",meter:selected,altbestand};
 if(saved&&!confirmChange)return {ok:false,action:"blocked",message:"Die gespeicherte Zuordnung bleibt bestehen. Eine Änderung muss ausdrücklich bestätigt werden."};
 return {ok:true,action:saved?"replace":"insert",message:"",meter:selected,altbestand};
}

function mappingPermission(facility){
 if(!state.currentUser||!facility||!isManager(facility))return "Historische Importe darf die Betriebsleitung oder Geschäftsführung.";
 return "";
}

function managerFacilities(){
 if(!state.currentUser)return [];
 return state.accessibleFacilities.filter(isManager);
}

function importFacilityId(){
 return managerFacilities().some(facility=>facility.id===selectedFacilityId)?selectedFacilityId:"";
}

function meterCell(text){
 return node("td",null,text);
}

function clearMappingState(){
 savedMappings=[];
 mappingFacilityId="";
 mappingError="";
 mappingFlash="";
 stockByMeter=new Map();
 stockKnown=true;
 renderMapping();
}

function renderImportMeters(meters,noteText){
 facilityMeterRows=meters||[];
 const body=document.getElementById("import-facility-meter-body");
 const note=document.getElementById("import-facility-meter-note");
 if(!body)return;
 body.replaceChildren();
 if(note)note.textContent=noteText;
 for(const meter of meters){
  const row=node("tr");
  row.append(
   meterCell(meter.label||""),
   meterCell(mediumNames[meter.medium]||meter.medium||""),
   meterCell(unitNames[meter.unit]||meter.unit||""),
   meterCell(meter.is_active?"Aktiv":"Inaktiv")
  );
  body.append(row);
 }
}

async function loadInactiveStock(meters){
 const inactive=(meters||[]).filter(meter=>meter.is_active===false);
 const counts=new Map();
 if(!inactive.length)return {counts,known:true};
 const results=await Promise.all(inactive.map(async meter=>{
  const {count,error}=await supabase.from("utility_meter_readings").select("id",{count:"exact",head:true}).eq("meter_id",meter.id).is("voided_at",null).neq("reading_type","correction");
  return {id:meter.id,count,error};
 }));
 if(results.some(result=>result.error))return {counts,known:false};
 results.forEach(result=>counts.set(result.id,result.count||0));
 return {counts,known:true};
}

async function loadMappingContext(facilityId,seq){
 const [maps,stock]=await Promise.all([
  supabase.from("utility_meter_import_mappings").select("id,facility_id,excel_schluessel,excel_bezeichnung,excel_verbrauchsart,excel_einheit,meter_id,altbestand_bestaetigt,revoked_at").eq("facility_id",facilityId).is("revoked_at",null),
  loadInactiveStock(facilityMeterRows)
 ]);
 if(seq!==meterLoadSeq||importFacilityId()!==facilityId)return;
 mappingLoading=false;
 stockByMeter=stock.counts;
 stockKnown=stock.known;
 if(maps.error){
  savedMappings=[];
  mappingFacilityId="";
  mappingError=maps.error.message||"Die gespeicherten Zuordnungen konnten nicht geladen werden.";
 }else{
  savedMappings=(maps.data||[]).filter(row=>row.facility_id===facilityId&&!row.revoked_at);
  mappingFacilityId=facilityId;
  mappingError="";
 }
 renderMapping();
}

async function loadImportMeters(facilityId){
 const seq=++meterLoadSeq;
 facilityMeterRows=[];
 mappingLoading=true;
 clearMappingState();
 if(importFacilityId()!==facilityId){
  mappingLoading=false;
  renderImportMeters([],"");
  renderMapping();
  return;
 }
 renderImportMeters([],"Zähler werden geladen …");
 try{
  const meters=await fetchFacilityMeters(facilityId);
  if(seq!==meterLoadSeq||importFacilityId()!==facilityId)return;
  renderImportMeters(meters,meters.length?meters.length+" Zähler, einschließlich deaktivierter. Es wird nichts zugeordnet oder gespeichert.":"Für diesen Betrieb sind keine Zähler vorhanden.");
  await loadMappingContext(facilityId,seq);
 }catch(error){
  if(seq!==meterLoadSeq||importFacilityId()!==facilityId)return;
  renderImportMeters([],"Zähler konnten nicht geladen werden: "+(error.message||"Unbekannter Fehler"));
  mappingLoading=false;
  clearMappingState();
 }
}

function syncMeterImportAccess(){
 const button=document.getElementById("open-meter-import");
 const card=document.getElementById("meter-import-card");
 const select=document.getElementById("import-facility");
 const note=document.getElementById("import-facility-note");
 if(!button||!card||!select)return;
 const facilities=managerFacilities();
 button.classList.toggle("hidden",facilities.length===0);
 if(!facilities.length){
  card.classList.add("hidden");
  button.classList.remove("active");
  selectedFacilityId="";
  select.replaceChildren();
  renderImportMeters([],"");
  mappingLoading=false;
  clearMappingState();
  return;
 }
 const previous=importFacilityId();
 select.replaceChildren();
 for(const facility of facilities){
  const option=node("option",null,facility.name);
  option.value=facility.id;
  select.append(option);
 }
 select.value=facilities.some(facility=>facility.id===previous)?previous:facilities[0].id;
 select.disabled=facilities.length===1;
 selectedFacilityId=select.value;
 if(note)note.textContent=facilities.length===1?"Dieser Betrieb ist für den Import festgelegt.":"Der gewählte Betrieb gilt für die folgenden Importschritte.";
 if(selectedFacilityId!==previous)loadImportMeters(selectedFacilityId);
}

function readingCount(meter){
 if(!result)return meter.anzahl_staende||0;
 return result.readings.filter(row=>row.zaehler_schluessel===meter.zaehler_schluessel&&row.wert_art==="zaehlerstand"&&row.pruefstatus!=="ausgeschlossen").length;
}

function localMappingStatus(meter){
 const choice=meterChoices.get(meter.zaehler_schluessel);
 if(choice?.status==="zusammengefuehrt")return {status:"zusammengefuehrt",text:"Lokal zusammengeführt mit "+meterName(choice.ziel)+". Daraus entsteht keine Datenbankzuordnung."};
 if(choice?.status==="getrennt")return {status:"getrennt",text:"Lokal getrennt gehalten."};
 if(choice?.status==="ungeklaert")return {status:"ungeklaert",text:"Lokal ungeklärt."};
 return {status:"offen",text:"Keine lokale Zusammenführung."};
}

function stockCountFor(meter){
 if(!meter||meter.is_active!==false)return 0;
 if(!stockKnown)return null;
 return stockByMeter.has(meter.id)?stockByMeter.get(meter.id):0;
}

function mappingMessage(error){
 const text=error?.message||"Die Zuordnung konnte nicht gespeichert werden.";
 if(error?.code==="23505"||/utility_meter_import_mappings_active_meter/i.test(text))return "Dieser Tageswerk-Zähler ist bereits einer anderen Excel-Bezeichnung zugeordnet.";
 if(/utility_meter_import_mappings_active_key/i.test(text))return "Für diese Excel-Bezeichnung besteht bereits eine aktive Zuordnung. Die Liste wird neu geladen.";
 return text;
}

function renderMapping(){
 const section=document.getElementById("import-mapping");
 const note=document.getElementById("import-mapping-note");
 const list=document.getElementById("import-mapping-list");
 if(!section||!note||!list)return;
 const facilityId=importFacilityId();
 if(mappingLoading){
  note.textContent="Zähler und Zuordnungen werden geladen …";
  list.replaceChildren();
  renderImportPreparation();
  return;
 }
 if(!result||!facilityId){
  note.textContent=facilityId?"Die Zählerzuordnung erscheint, nachdem eine Excel-Datei eingelesen wurde.":"Zuerst einen berechtigten Betrieb auswählen.";
  list.replaceChildren();
  renderImportPreparation();
  return;
 }
 note.textContent=mappingFlash||mappingError||"Gespeicherte Zuordnungen gelten nur für den ausgewählten Betrieb. Verbrauchsart und Einheit müssen übereinstimmen.";
 mappingFlash="";
 list.replaceChildren();
 const taken=new Set(savedMappings.filter(row=>row.facility_id===facilityId).map(row=>row.meter_id));
 result.meters.forEach(excel=>{
  const saved=mappingFacilityId===facilityId?mappingForFacility(savedMappings,facilityId,excel.zaehler_schluessel):null;
  const local=localMappingStatus(excel);
  const candidates=mappingCandidates(excel,facilityMeterRows);
  const article=node("article","mapping-row");
  article.append(node("h3",null,excel.zaehler_bezeichnung||excel.zaehler_schluessel));
  article.append(node("p","mapping-meta","Excel-Schlüssel: "+excel.zaehler_schluessel));
  article.append(node("p","mapping-meta","Verbrauchsart: "+(excel.verbrauchsart||"unbekannt")+" · Einheit: "+(excel.einheit||"offen")+" · Ablesungen: "+readingCount(excel)));
  article.append(node("p","mapping-meta",local.text));
  const status=node("p","mapping-meta");
  if(saved){
   const target=facilityMeterRows.find(meter=>meter.id===saved.meter_id);
   status.textContent="Gespeichert: "+(target?target.label+" · "+(target.is_active?"Aktiv":"Inaktiv"):"Zähler nicht mehr im Betrieb");
  }else status.textContent="Noch nicht zugeordnet.";
  article.append(status);
  if(local.status==="zusammengefuehrt"){
   list.append(article);
   return;
  }
  if(!candidates.length){
   article.append(node("p",null,"Kein passender Zähler vorhanden. Bitte zunächst einen Zähler in Tageswerk anlegen."));
   list.append(article);
   return;
  }
  const field=node("label");
  field.append("Tageswerk-Zähler");
  const select=node("select");
  select.append(new Option("Zähler auswählen",""));
  candidates.forEach(meter=>{
   const occupied=taken.has(meter.id)&&saved?.meter_id!==meter.id;
   const option=new Option(meter.label+" · "+(mediumNames[meter.medium]||meter.medium)+" · "+(unitNames[meter.unit]||meter.unit)+" · "+(meter.is_active?"Aktiv":"Inaktiv")+(occupied?" · bereits zugeordnet":""),meter.id);
   option.disabled=occupied;
   select.append(option);
  });
  if(saved&&candidates.some(meter=>meter.id===saved.meter_id))select.value=saved.meter_id;
  field.append(select);
  article.append(field);
  const selectedMeter=()=>candidates.find(meter=>meter.id===select.value)||null;
  const altLabel=node("label");
  const altInput=node("input");
  altInput.type="checkbox";
  altInput.style.width="auto";
  altLabel.append(altInput,document.createTextNode(" Ich bestätige den Altbestand. Dieser deaktivierte Zähler hat noch keine Ablesung."));
  const changeLabel=node("label");
  const changeInput=node("input");
  changeInput.type="checkbox";
  changeInput.style.width="auto";
  changeLabel.append(changeInput,document.createTextNode(" Ich bestätige die Änderung der gespeicherten Zuordnung."));
  if(saved?.altbestand_bestaetigt&&select.value===saved.meter_id)altInput.checked=true;
  const hint=node("p","mapping-meta");
  const message=node("p");
  message.id="";
  const refreshChoice=()=>{
   const meter=selectedMeter();
   const stock=stockCountFor(meter);
   altLabel.classList.toggle("hidden",!(meter&&meter.is_active===false&&stock===0));
   if(!meter||meter.is_active!==false)altInput.checked=false;
   hint.textContent=meter&&meter.is_active===false?(stock===0?"Historische Ablesungen eines deaktivierten Zählers werden besonders geprüft. Ohne bestätigten Altbestand kann der spätere Import diese Zeilen nicht übernehmen.":stock==null?"Historische Ablesungen eines deaktivierten Zählers werden besonders geprüft. Der Ablesebestand konnte nicht gelesen werden.":"Historische Ablesungen eines deaktivierten Zählers werden besonders geprüft und müssen vor dem letzten vorhandenen Stand liegen."):"";
   const textDiffers=!!(saved&&(saved.excel_bezeichnung!==excel.zaehler_bezeichnung||saved.excel_verbrauchsart!==excel.verbrauchsart||saved.excel_einheit!==excel.einheit));
   const differs=!!(saved&&(select.value!==saved.meter_id||textDiffers||(meter&&meter.is_active===false&&stock===0&&altInput.checked!==saved.altbestand_bestaetigt)));
   changeLabel.classList.toggle("hidden",!differs);
   if(!differs)changeInput.checked=false;
  };
  select.addEventListener("change",refreshChoice);
  altInput.addEventListener("change",refreshChoice);
  article.append(altLabel,changeLabel,hint,message);
  const actions=node("div","import-actions");
  const save=node("button",null,"Zuordnung speichern");
  save.type="button";
  save.addEventListener("click",()=>storeMapping(excel,select.value,changeInput.checked,altInput.checked,message));
  actions.append(save);
  if(saved){
   const revoke=node("button","secondary","Zuordnung aufheben");
   revoke.type="button";
   revoke.addEventListener("click",()=>revokeMapping(saved,changeInput.checked,message));
   actions.append(revoke);
  }
  article.append(actions);
  refreshChoice();
  list.append(article);
 });
 renderImportPreparation();
}

async function storeMapping(excel,selectedMeterId,confirmChange,altbestandChecked,message){
 const facility=state.accessibleFacilities.find(item=>item.id===importFacilityId());
 const denied=mappingPermission(facility);
 if(denied){
  message.className="error";
  message.textContent=denied;
  return;
 }
 if(mappingFacilityId!==facility.id){
  message.className="error";
  message.textContent="Die Zuordnungen dieses Betriebs sind noch nicht geladen.";
  return;
 }
 const local=localMappingStatus(excel);
 const candidates=mappingCandidates(excel,facilityMeterRows);
 const saved=mappingForFacility(savedMappings,facility.id,excel.zaehler_schluessel);
 const selected=candidates.find(meter=>meter.id===selectedMeterId)||null;
 const plan=planMappingSave({
  excel,
  selectedMeterId,
  saved,
  confirmChange,
  altbestandChecked,
  stockCount:stockCountFor(selected),
  candidates,
  allMeters:facilityMeterRows,
  localStatus:local.status
 });
 if(!plan.ok||plan.action==="unchanged"){
  message.className=plan.ok?"ok":"error";
  message.textContent=plan.message;
  return;
 }
 message.className="help";
 message.textContent="Zuordnung wird gespeichert …";
 try{
  if(plan.action==="replace"){
   const lifted=await supabase.from("utility_meter_import_mappings").update({revoked_at:new Date().toISOString()}).eq("id",saved.id).eq("facility_id",facility.id).is("revoked_at",null).select("id");
   if(lifted.error)throw lifted.error;
   if(!lifted.data?.length)throw new Error("Die gespeicherte Zuordnung wurde zwischenzeitlich geändert. Die Liste wird neu geladen.");
  }
  const inserted=await supabase.from("utility_meter_import_mappings").insert({
   facility_id:facility.id,
   organization_id:facility.organization_id,
   excel_schluessel:excel.zaehler_schluessel,
   excel_bezeichnung:excel.zaehler_bezeichnung,
   excel_verbrauchsart:excel.verbrauchsart,
   excel_einheit:excel.einheit,
   meter_id:plan.meter.id,
   altbestand_bestaetigt:plan.altbestand
  }).select("id");
  if(inserted.error)throw inserted.error;
  mappingFlash=plan.action==="replace"?"Die bisherige Zuordnung wurde aufgehoben und die neue Zuordnung gespeichert.":"Zuordnung gespeichert.";
  await loadMappingContext(facility.id,meterLoadSeq);
 }catch(error){
  mappingFlash=(plan.action==="replace"?"Die bisherige Zuordnung wurde aufgehoben. ":"")+mappingMessage(error);
  await loadMappingContext(facility.id,meterLoadSeq);
 }
}

async function revokeMapping(saved,confirmChange,message){
 const facility=state.accessibleFacilities.find(item=>item.id===importFacilityId());
 const denied=mappingPermission(facility);
 if(denied||saved?.facility_id!==facility?.id){
  message.className="error";
  message.textContent=denied||"Die gespeicherte Zuordnung gehört zu einem anderen Betrieb.";
  return;
 }
 if(!confirmChange){
  message.className="error";
  message.textContent="Die gespeicherte Zuordnung bleibt bestehen. Eine Änderung muss ausdrücklich bestätigt werden.";
  return;
 }
 message.className="help";
 message.textContent="Zuordnung wird aufgehoben …";
 try{
  const lifted=await supabase.from("utility_meter_import_mappings").update({revoked_at:new Date().toISOString()}).eq("id",saved.id).eq("facility_id",facility.id).is("revoked_at",null).select("id");
  if(lifted.error)throw lifted.error;
  if(!lifted.data?.length)throw new Error("Die gespeicherte Zuordnung wurde zwischenzeitlich geändert. Die Liste wird neu geladen.");
  mappingFlash="Die Zuordnung wurde aufgehoben.";
  await loadMappingContext(facility.id,meterLoadSeq);
 }catch(error){
  mappingFlash=mappingMessage(error);
  await loadMappingContext(facility.id,meterLoadSeq);
 }
}

function currentTimeEntry(){
 return timeSettings.get(importFacilityId())||{...defaultHistoricalTimes()};
}

function storedTimeRows(){
 return [...timeSettings.entries()].map(([betrieb_id,entry])=>({betrieb_id,vormittag:entry.vormittag,abend:entry.abend,bestaetigt:entry.bestaetigt===true}));
}

function applyStoredTimes(rows){
 timeSettings=new Map();
 for(const item of rows||[])timeSettings.set(item.betrieb_id,{vormittag:item.vormittag,abend:item.abend,bestaetigt:item.bestaetigt===true});
}

function renderHistoricalTimes(){
 const section=document.getElementById("import-times");
 const note=document.getElementById("import-times-note");
 const morning=document.getElementById("import-time-morning");
 const evening=document.getElementById("import-time-evening");
 const confirm=document.getElementById("import-time-confirm");
 const preview=document.getElementById("import-preview-start");
 const status=document.getElementById("import-preview-status");
 if(!section||!note||!morning||!evening||!confirm||!preview||!status)return;
 if(!result||!importFacilityId()){
  note.textContent="Die Uhrzeiten erscheinen, nachdem eine Excel-Datei eingelesen und ein Betrieb ausgewählt wurde.";
  morning.disabled=true;
  evening.disabled=true;
  confirm.disabled=true;
  confirm.checked=false;
  preview.disabled=true;
  status.textContent="Importvorschau gesperrt.";
  preparedImport=null;
  renderImportPreparation(null);
  return;
 }
 const entry=currentTimeEntry();
 morning.disabled=false;
 evening.disabled=false;
 morning.value=entry.vormittag;
 evening.value=entry.abend;
 const ready=historicalPreviewReady(entry);
 confirm.disabled=false;
 confirm.checked=ready;
 note.textContent=ready?"Die Bestätigung gilt für diese Datei und den ausgewählten Betrieb.":"Ohne diese Bestätigung bleibt die Importvorschau gesperrt.";
 renderImportPreparation();
}

function updateHistoricalTimes(patch){
 const facilityId=importFacilityId();
 const message=document.getElementById("import-times-message");
 if(!facilityId||!result){
  if(message){message.className="error";message.textContent="Zuerst Betrieb und Excel-Datei festlegen.";}
  renderHistoricalTimes();
  return;
 }
 const revised=reviseHistoricalTimes(currentTimeEntry(),patch);
 if(!revised.ok){
  if(message){message.className="error";message.textContent=revised.message;}
  renderHistoricalTimes();
  return;
 }
 timeSettings.set(facilityId,revised.entry);
 if(message)message.textContent="";
 renderHistoricalTimes();
 return persistSnapshot();
}

function currentImportPlan(){
 if(!result)return null;
 const facilityId=importFacilityId();
 let mappingState="ready";
 if(!facilityId)mappingState="missing";
 else if(mappingError)mappingState="error";
 else if(mappingLoading||mappingFacilityId!==facilityId)mappingState="loading";
 const entry=facilityId?currentTimeEntry():null;
 const key=[
  facilityId,
  mappingState,
  mappingError,
  source?.hash||"",
  String(result.readings.length),
  entry?entry.vormittag+"|"+entry.abend+"|"+(entry.bestaetigt?"1":"0"):"",
  savedMappings.map(row=>[row.id,row.excel_schluessel,row.meter_id,row.altbestand_bestaetigt].join("|")).join(","),
  facilityMeterRows.map(meter=>meter.id).join(","),
  [...decisions].map(([id,value])=>[id,value.entscheidung,value.korrigierter_zaehlerstand,value.begruendung].join("|")).join(","),
  [...meterChoices].map(([id,value])=>[id,value.status,value.ziel].join("|")).join(",")
 ].join("\n");
 if(importPlanCache&&importPlanKey===key)return importPlanCache;
 importPlanKey=key;
 importPlanCache=planHistoricalPayload({
  readings:result.readings,
  decisions,
  choices:meterChoices,
  facilityId,
  timeEntry:entry,
  mappings:mappingState==="ready"?savedMappings:[],
  mappingState,
  meters:mappingState==="ready"?facilityMeterRows:undefined
 });
 return importPlanCache;
}

function renderImportPreparation(plan){
 const summary=document.getElementById("import-prepare-summary");
 const note=document.getElementById("import-prepare-note");
 const list=document.getElementById("import-prepare-list");
 const preview=document.getElementById("import-preview-start");
 const status=document.getElementById("import-preview-status");
 if(!summary||!note||!list||!preview||!status)return;
 if(plan===undefined)plan=currentImportPlan();
 summary.replaceChildren();
 list.replaceChildren();
 syncPreviewLifetime(plan);
 if(!plan){
  preparedImport=null;
  note.textContent="";
  preview.disabled=true;
  status.textContent="Importvorschau gesperrt.";
  renderServerPreview();
  return;
 }
 const labels=[
  ["erkannt","Erkannte Ablesungen"],
  ["bestaetigt","Bestätigte Ablesungen"],
  ["korrigiert","Korrigierte Ablesungen"],
  ["ausgeschlossen","Ausgeschlossene Ablesungen"],
  ["offen","Noch offene Ablesungen"],
  ["vorbereitet","Für den Import vorbereitet"],
  ["zuordnungFehlt","Fehlende Zählerzuordnungen"]
 ];
 labels.forEach(([key,label])=>{
  const box=node("div");
  const value=plan.counts[key];
  box.append(node("strong",null,value==null?"–":String(value)),node("span",null,label));
  summary.append(box);
 });
 preparedImport=plan.ready?{facilityId:importFacilityId(),hash:source?.hash||"",payload:plan.payload}:null;
 note.textContent=plan.sperren.join(" ");
 const shown=plan.hinweise.slice(0,40);
 shown.forEach(text=>list.append(node("p",null,text)));
 if(plan.hinweise.length>shown.length)list.append(node("p",null,"und "+(plan.hinweise.length-shown.length)+" weitere."));
 preview.disabled=previewBusy||!plan.ready;
 if(previewBusy)status.textContent="Die Importvorschau wird geladen. Es werden keine Zählerstände gespeichert.";
 else if(!plan.ready)status.textContent="Importvorschau gesperrt.";
 else if(serverPreview?.ok)status.textContent="Die serverseitige Vorschau entspricht den aktuellen Eingaben. Es wurden keine Zählerstände gespeichert.";
 else status.textContent="Die Import-Payload ist geprüft. Die Vorschau speichert keine Zählerstände.";
 renderServerPreview();
}

function syncPreviewLifetime(plan){
 const current=plan?.ready?importPlanKey:"";
 if(previewBusy&&previewSentKey!==current){
  previewSeq++;
  previewBusy=false;
  previewSentKey="";
 }
 if(commitBusy&&commitSentKey!==current){
  commitSeq++;
  commitBusy=false;
  commitSentKey="";
 }
 if(!plan?.ready||(serverPreview&&serverPreview.key!==importPlanKey)){
  serverPreview=null;
  commitConfirmed=false;
  commitResult=null;
 }
}

function formatPreviewNumber(value){
 if(value==null)return "kein Wert";
 return Number(value).toLocaleString("de-DE",{maximumFractionDigits:3});
}

function formatPreviewInstant(value){
 const date=new Date(value);
 if(!value||Number.isNaN(date.getTime()))return "";
 return date.toLocaleString("de-DE",{timeZone:"Europe/Berlin",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});
}

function renderServerPreview(){
 const section=document.getElementById("import-server-preview");
 const note=document.getElementById("import-server-note");
 const summary=document.getElementById("import-server-summary");
 const blocked=document.getElementById("import-server-blocked");
 const effects=document.getElementById("import-server-effects");
 const error=document.getElementById("import-server-error");
 if(!section||!note||!summary||!blocked||!effects||!error){
  renderCommit();
  return;
 }
 section.classList.toggle("hidden",!result);
 summary.replaceChildren();
 blocked.replaceChildren();
 effects.replaceChildren();
 error.textContent="";
 if(!result){
  note.textContent="";
  renderCommit();
  return;
 }
 if(previewBusy){
  note.textContent="Die Importvorschau wird geladen. Es werden keine Zählerstände gespeichert.";
  renderCommit();
  return;
 }
 if(!serverPreview){
  note.textContent="Noch keine serverseitige Vorschau.";
  renderCommit();
  return;
 }
 if(!serverPreview.ok){
  note.textContent="Die Importvorschau konnte nicht angezeigt werden.";
  error.textContent=serverPreview.message||"Die Importvorschau konnte nicht ausgeführt werden. Es wurde nichts gespeichert.";
  renderCommit();
  return;
 }
 const boxes=[
  [String(serverPreview.uebernehmbar),"Übernehmbare Ablesungen"],
  [String(serverPreview.blockiert),"Blockierte Ablesungen"],
  [serverPreview.schreibbar?"Ja":"Nein",serverPreview.schreibbar?"Der Import wäre freigegeben":"Der Import ist nicht freigegeben"]
 ];
 boxes.forEach(([value,label])=>{
  const box=node("div");
  box.append(node("strong",null,value),node("span",null,label));
  summary.append(box);
 });
 note.textContent=serverPreview.schreibbar?"Die Vorschau gibt den Import frei. Es wird noch nichts übernommen und kein Zählerstand gespeichert.":"Die Vorschau gibt den Import nicht frei. Es wurde nichts gespeichert.";
 const blockedRows=serverPreview.blocked||[];
 blocked.append(node("h3",null,"Blockierte Ablesungen"));
 if(!blockedRows.length)blocked.append(node("p","help","Keine Ablesung ist blockiert."));
 blockedRows.slice(0,40).forEach(row=>{
  const place=row.blatt&&row.zelle?row.blatt+" "+row.zelle:row.datensatz_id||"Ohne Herkunft";
  blocked.append(node("p",null,place+": "+(row.gruende.length?row.gruende.join(" "):"Ohne Begründung")));
 });
 if(blockedRows.length>40)blocked.append(node("p",null,"und "+(blockedRows.length-40)+" weitere."));
 const changes=serverPreview.effects||[];
 effects.append(node("h3",null,"Verbrauchsänderungen"));
 if(serverPreview.effectNote)effects.append(node("p","help",serverPreview.effectNote));
 if(!changes.length)effects.append(node("p","help","Keine vorhandene Verbrauchsanzeige ändert sich."));
 changes.slice(0,40).forEach(row=>{
  const meter=row.meter||(row.reading_id?"Ablesung "+row.reading_id:"Ablesung");
  const when=formatPreviewInstant(row.reading_at);
  const parts=[meter];
  if(when)parts.push(when);
  const unit=row.unit?" "+row.unit:"";
  parts.push("bisher "+formatPreviewNumber(row.bisher)+(row.bisher==null?"":unit));
  parts.push("danach "+formatPreviewNumber(row.danach)+(row.danach==null?"":unit));
  parts.push("Differenz "+(row.differenz==null?"kein Wert":formatPreviewNumber(row.differenz)+(unit)));
  effects.append(node("p",null,parts.join(" · ")));
 });
 if(changes.length>40)effects.append(node("p",null,"und "+(changes.length-40)+" weitere."));
 renderCommit();
}

async function loadEffectContext(facilityId,effects){
 const ids=[...new Set(effects.map(row=>row.reading_id).filter(Boolean))];
 if(!ids.length)return {effects,note:""};
 const chunks=[];
 for(let index=0;index<ids.length;index+=100)chunks.push(ids.slice(index,index+100));
 try{
  const results=await Promise.all(chunks.map(chunk=>supabase.from("utility_meter_consumption").select("reading_id,meter_id,reading_at,unit").eq("facility_id",facilityId).in("reading_id",chunk)));
  if(results.some(result=>result.error))return {effects,note:"Die Zählerbezeichnungen der Verbrauchsänderungen konnten nicht geladen werden. Die Verbrauchswerte stammen aus der Vorschau."};
  const byId=new Map(results.flatMap(result=>result.data||[]).map(row=>[row.reading_id,row]));
  return {effects:effects.map(row=>{
   const found=byId.get(row.reading_id);
   if(!found)return row;
   const meter=facilityMeterRows.find(item=>item.id===found.meter_id);
   return {...row,meter:meter?.label||"",reading_at:found.reading_at,unit:found.unit||""};
  }),note:""};
 }catch{
  return {effects,note:"Die Zählerbezeichnungen der Verbrauchsänderungen konnten nicht geladen werden. Die Verbrauchswerte stammen aus der Vorschau."};
 }
}

async function startHistoricalPreview(){
 if(previewBusy)return;
 const facility=state.accessibleFacilities.find(item=>item.id===importFacilityId());
 const plan=currentImportPlan();
 const decision=preparePreviewCall({plan,permission:mappingPermission(facility)});
 renderImportPreparation(plan);
 if(!decision.call){
  const error=document.getElementById("import-server-error");
  if(error)error.textContent=decision.message==="Importvorschau gesperrt."?"":decision.message;
  return;
 }
 const key=importPlanKey;
 const facilityId=facility.id;
 const seq=++previewSeq;
 previewBusy=true;
 previewSentKey=key;
 serverPreview=null;
 commitConfirmed=false;
 commitResult=null;
 renderImportPreparation(plan);
 try{
  const {data,error}=await supabase.rpc("tageswerk_preview_historical_import",{p_facility_id:facilityId,p_payload:plan.payload});
  if(!acceptPreviewResponse({sentKey:key,currentKey:importPlanKey,sentSeq:seq,currentSeq:previewSeq}))return;
  if(error)throw error;
  const normalized=normalizePreviewResult(typeof data==="string"?JSON.parse(data):data);
  if(!normalized.ok)throw new Error(normalized.message);
  const context=await loadEffectContext(facilityId,normalized.effects);
  if(!acceptPreviewResponse({sentKey:key,currentKey:importPlanKey,sentSeq:seq,currentSeq:previewSeq}))return;
  commitConfirmed=false;
  commitResult=null;
  serverPreview={key,ok:true,token:crypto.randomUUID(),uebernehmbar:normalized.uebernehmbar,blockiert:normalized.blockiert,schreibbar:normalized.schreibbar,blocked:normalized.blocked,effects:context.effects,effectNote:context.note};
 }catch(error){
  if(!acceptPreviewResponse({sentKey:key,currentKey:importPlanKey,sentSeq:seq,currentSeq:previewSeq}))return;
  serverPreview={key,ok:false,message:previewErrorMessage(error)};
 }finally{
  if(seq===previewSeq){
   previewBusy=false;
   previewSentKey="";
   renderImportPreparation();
  }
 }
}

function commitDecision(){
 const facility=state.accessibleFacilities.find(item=>item.id===importFacilityId());
 return prepareCommitCall({
  permission:mappingPermission(facility),
  confirmed:commitConfirmed,
  busy:commitBusy,
  preview:serverPreview,
  plan:currentImportPlan(),
  planKey:importPlanKey,
  hash:source?.hash||"",
  fileName:fileName||source?.name||""
 });
}

function renderCommit(){
 const note=document.getElementById("import-commit-note");
 const box=document.getElementById("import-commit-confirm");
 const button=document.getElementById("import-commit-start");
 const summary=document.getElementById("import-commit-summary");
 const error=document.getElementById("import-commit-error");
 if(!note||!box||!button||!summary||!error)return;
 const decision=commitDecision();
 const current=commitResult&&serverPreview&&commitResult.key===serverPreview.key?commitResult:null;
 box.checked=commitConfirmed;
 box.disabled=!serverPreview?.ok||serverPreview.schreibbar!==true||serverPreview.blockiert!==0||previewBusy||commitBusy;
 if(box.disabled)commitConfirmed=false;
 box.checked=commitConfirmed;
 button.disabled=!decision.call||!!(current&&current.ok);
 summary.replaceChildren();
 error.textContent="";
 if(commitBusy){
  note.textContent="Die Übernahme wird ausgeführt. Bitte nicht erneut klicken.";
  return;
 }
 if(current?.ok){
  note.textContent=current.erneut?"Diese Datei wurde bereits übernommen. Es wurden keine weiteren Zählerstände gespeichert.":"Die historischen Ablesungen wurden übernommen.";
  const row=node("div");
  row.append(node("strong",null,String(current.zeilen)),node("span",null,"Übernommene Ablesungen"));
  summary.append(row);
  if(current.refreshNote)error.textContent=current.refreshNote;
  return;
 }
 if(current&&!current.ok)error.textContent=current.message||"Die Übernahme konnte nicht ausgeführt werden.";
 note.textContent=serverPreview?.ok&&serverPreview.schreibbar?"Die Übernahme speichert die freigegebenen Ablesungen erst nach dieser Bestätigung.":"Die Übernahme bleibt gesperrt, bis die aktuelle Vorschau den Import freigibt.";
 if(!decision.call&&commitConfirmed)error.textContent=decision.message;
}

async function refreshConsumptionAfterCommit(facilityId){
 const select=document.getElementById("consumption-facility");
 const card=document.getElementById("consumption-card");
 const opener=document.getElementById("open-consumption");
 if(select){
  if(![...select.options].some(option=>option.value===facilityId)){
   const facility=state.accessibleFacilities.find(item=>item.id===facilityId);
   const option=document.createElement("option");
   option.value=facilityId;
   option.textContent=facility?.name||"Betrieb";
   select.append(option);
  }
  select.value=facilityId;
 }
 if(card)card.classList.remove("hidden");
 if(opener)opener.classList.add("active");
 await loadFacilityMeters(facilityId);
}

async function startHistoricalCommit(){
 if(commitBusy)return;
 const facility=state.accessibleFacilities.find(item=>item.id===importFacilityId());
 const decision=commitDecision();
 renderCommit();
 if(!decision.call||!facility){
  const error=document.getElementById("import-commit-error");
  if(error&&decision.message&&decision.message!=="Die Übernahme läuft bereits.")error.textContent=decision.message;
  return;
 }
 const key=importPlanKey;
 const facilityId=facility.id;
 const seq=++commitSeq;
 commitBusy=true;
 commitSentKey=key;
 commitResult=null;
 renderCommit();
 try{
  const outcome=await runHistoricalCommit({decision,facilityId,rpc:(name,args)=>supabase.rpc(name,args)});
  if(!acceptPreviewResponse({sentKey:key,currentKey:importPlanKey,sentSeq:seq,currentSeq:commitSeq}))return;
  if(!outcome.ok){
   commitResult={key,ok:false,message:outcome.message};
   return;
  }
  commitResult={key,ok:true,status:outcome.result.status,zeilen:outcome.result.zeilen,erneut:outcome.result.erneut,batchId:outcome.result.batchId};
  if(outcome.refresh){
   try{await refreshConsumptionAfterCommit(facilityId);}
   catch{commitResult.refreshNote="Die Zählerstände wurden übernommen. Die Verbrauchsanzeige konnte nicht aktualisiert werden.";}
  }
 }catch(error){
  if(!acceptPreviewResponse({sentKey:key,currentKey:importPlanKey,sentSeq:seq,currentSeq:commitSeq}))return;
  commitResult={key,ok:false,message:commitErrorMessage(error)};
 }finally{
  if(seq===commitSeq){
   commitBusy=false;
   commitSentKey="";
   renderImportPreparation();
  }
 }
}

function preparedImportPayload(){
 return preparedImport?{facilityId:preparedImport.facilityId,hash:preparedImport.hash,payload:preparedImport.payload}:null;
}

function mountMeterImport(){
 const more=document.getElementById("view-more");
 if(!more||document.getElementById("open-meter-import"))return;
 const style=node("style");
 style.textContent="#meter-import-card.hidden{display:none}#open-meter-import.hidden{display:none}#meter-import-card select{display:block;width:100%;max-width:100%;padding:13px;background:#0e1b29;border:1px solid #6a839b;color:white;border-radius:3px;font-size:16px}#import-facility-meters{margin:8px 0 18px}#import-facility-meter-scroll{overflow:auto;max-height:320px;border:1px solid #4b6680;border-radius:6px}#import-facility-meters table{width:100%;border-collapse:collapse}#import-facility-meters th,#import-facility-meters td{border-bottom:1px solid #4b6680;padding:7px 8px;text-align:left;font-size:14px;white-space:normal}#import-facility-meters th{color:#e1bf48}#import-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:16px 0}#import-summary div{background:#142538;border:1px solid #4b6680;border-radius:6px;padding:12px}#import-summary strong{display:block;color:#e1bf48;font-size:26px}#import-summary span{color:#aabed0}#import-filters,#review-filters,#merge-controls{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px}#import-filters label,#review-filters label,#merge-controls label{margin:0}#import-table,#meter-table{width:100%;border-collapse:collapse;margin-top:14px}#import-table th,#import-table td,#meter-table th,#meter-table td{border-bottom:1px solid #4b6680;padding:7px 8px;text-align:left;font-size:13px;white-space:nowrap}#import-table th,#meter-table th{color:#e1bf48}#import-scroll,#meter-scroll{overflow:auto;max-height:520px;border:1px solid #4b6680;border-radius:6px}#import-warnings,#merge-result,#import-store-note{margin:12px 0;color:#ffc48c}.import-actions,.review-actions{display:flex;flex-wrap:wrap;gap:8px}.import-actions button,.review-actions button{margin-top:0}#import-review,#import-meters{margin-top:28px}#review-list{display:flex;flex-direction:column;gap:10px;margin-top:12px}.review-row{background:#142538;border:1px solid #4b6680;border-radius:6px;padding:12px}.review-row.review-open{border-color:#e1bf48}.review-row h3{margin:0 0 6px;font-size:16px}#import-mapping-list{display:flex;flex-direction:column;gap:12px}.mapping-row{background:#142538;border:1px solid #4b6680;border-radius:6px;padding:12px}.mapping-row h3{margin:0 0 6px;font-size:16px}.mapping-meta{color:#aabed0;margin:4px 0}.mapping-row label{display:flex;gap:8px;align-items:flex-start;margin-top:10px}.mapping-row select,.mapping-row .import-actions button{width:100%}@media(max-width:850px){.mapping-row{padding:14px}.mapping-row h3{font-size:18px}}#import-times-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}#import-times-fields label{margin:0}#import-time-confirm-label{display:flex;gap:8px;align-items:flex-start;margin-top:12px}#import-preview-start{margin-top:12px}#import-prepare-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:12px 0}#import-prepare-summary div{background:#142538;border:1px solid #4b6680;border-radius:6px;padding:12px}#import-prepare-summary strong{display:block;color:#e1bf48;font-size:22px}#import-prepare-summary span{color:#aabed0}#import-prepare-list{max-height:240px;overflow:auto;margin-top:8px}#import-prepare-list p{display:block;margin:4px 0}#import-server-preview.hidden{display:none}#import-server-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:12px 0}#import-server-summary div{background:#142538;border:1px solid #4b6680;border-radius:6px;padding:12px}#import-server-summary strong{display:block;color:#e1bf48;font-size:22px}#import-server-summary span{color:#aabed0}#import-server-blocked,#import-server-effects{max-height:240px;overflow:auto;margin-top:8px}#import-server-blocked p,#import-server-effects p{display:block;margin:4px 0}#import-server-blocked h3,#import-server-effects h3{margin:8px 0;font-size:16px;color:#e1bf48}#import-server-error:empty{display:none}#import-commit{margin-top:28px}#import-commit-confirm-label{display:flex;gap:8px;align-items:flex-start;margin-top:12px}#import-commit-start{margin-top:12px;width:100%}#import-commit-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:12px 0}#import-commit-summary div{background:#142538;border:1px solid #4b6680;border-radius:6px;padding:12px}#import-commit-summary strong{display:block;color:#e1bf48;font-size:22px}#import-commit-summary span{color:#aabed0}#import-commit-error:empty{display:none}";
 document.head.append(style);
 const button=node("button","secondary hidden","Excel-Import");
 button.type="button";
 button.id="open-meter-import";
 const buttonAnchor=document.getElementById("open-consumption");
 if(buttonAnchor)buttonAnchor.after(button);
 else more.append(button);
 const card=node("div","card hidden");
 card.id="meter-import-card";
 card.append(node("h2",null,"Excel-Import"));
 card.append(node("p","help","Die Datei bleibt auf diesem Gerät. Es wird nichts nach Tageswerk geschrieben und keine Uhrzeit ergänzt. Profil: erste Zeile eines Tages ist Vormittag, die zweite ist Abend. Leere Zellen erzeugen keine Ablesung."));
 const facilityLabel=node("label");
 facilityLabel.append("Betrieb");
 const facilitySelect=node("select");
 facilitySelect.id="import-facility";
 facilityLabel.append(facilitySelect);
 const facilityNote=node("p","help");
 facilityNote.id="import-facility-note";
 const facilityMeters=node("section");
 facilityMeters.id="import-facility-meters";
 facilityMeters.append(node("h2",null,"Vorhandene Zähler"));
 const facilityMeterNote=node("p","help");
 facilityMeterNote.id="import-facility-meter-note";
 const facilityMeterScroll=node("div");
 facilityMeterScroll.id="import-facility-meter-scroll";
 const facilityMeterTable=node("table");
 const facilityMeterHead=node("thead");
 const facilityMeterHeadRow=node("tr");
 ["Bezeichnung","Verbrauchsart","Einheit","Status"].forEach(label=>facilityMeterHeadRow.append(node("th",null,label)));
 facilityMeterHead.append(facilityMeterHeadRow);
 const facilityMeterBody=node("tbody");
 facilityMeterBody.id="import-facility-meter-body";
 facilityMeterTable.append(facilityMeterHead,facilityMeterBody);
 facilityMeterScroll.append(facilityMeterTable);
 facilityMeters.append(facilityMeterNote,facilityMeterScroll);
 const profileLabel=node("label");
 profileLabel.append("Profil");
 const profile=node("select");
 profile.id="import-profile";
 PROFILES.forEach(item=>{
  const option=node("option",null,item.label);
  option.value=item.id;
  profile.append(option);
 });
 profileLabel.append(profile);
 const fileLabel=node("label");
 fileLabel.append("Excel-Datei");
 const file=node("input");
 file.id="import-file";
 file.type="file";
 file.accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
 fileLabel.append(file);
 const summary=node("div");
 summary.id="import-summary";
 const warnings=node("div");
 warnings.id="import-warnings";
 const filters=node("div");
 filters.id="import-filters";
 filters.classList.add("hidden");
 [["import-meter","Zähler"],["import-sheet","Blatt"],["import-status","Status"]].forEach(([id,label])=>{
  const field=node("label");
  field.append(label);
  const select=node("select");
  select.id=id;
  field.append(select);
  filters.append(field);
 });
 const onlyLabel=node("label");
 onlyLabel.append("Nur auffällige");
 const only=node("input");
 only.id="import-notable";
 only.type="checkbox";
 only.style.width="auto";
 onlyLabel.append(only);
 filters.append(onlyLabel);
 const actions=node("div","import-actions hidden");
 actions.id="import-actions";
 const readingsButton=node("button","secondary","Ablesungen als CSV");
 readingsButton.type="button";
 readingsButton.id="import-readings-csv";
 const metersButton=node("button","secondary","Zähler als CSV");
 metersButton.type="button";
 metersButton.id="import-meters-csv";
 actions.append(readingsButton,metersButton);
 const note=node("p","help");
 note.id="import-note";
 const scroll=node("div");
 scroll.id="import-scroll";
 scroll.classList.add("hidden");
 const table=node("table");
 table.id="import-table";
 scroll.append(table);
 const review=node("section");
 review.id="import-review";
 review.classList.add("hidden");
 review.append(node("h2",null,"Datenprüfung"));
 review.append(node("p","help","Hier erscheinen nur fachliche Auffälligkeiten. Eine unbekannte Uhrzeit allein bleibt außen vor. Der ursprüngliche Zählerstand wird nicht überschrieben. Entscheidungen bleiben auf diesem Gerät und gelten nur für denselben Dateiinhalt."));
 const storeActions=node("div","review-actions");
 const exportButton=node("button","secondary","Prüfstand exportieren");
 exportButton.type="button";
 exportButton.id="export-review-state";
 const importButton=node("button","secondary","Prüfstand importieren");
 importButton.type="button";
 importButton.id="import-review-state";
 const importFile=node("input");
 importFile.type="file";
 importFile.id="import-review-file";
 importFile.accept=".json,application/json";
 importFile.hidden=true;
 storeActions.append(exportButton,importButton,importFile);
 const storeNote=node("p","help");
 storeNote.id="import-store-note";
 review.append(storeActions,storeNote);
 const reviewFilters=node("div");
 reviewFilters.id="review-filters";
 [["review-meter","Zähler"],["review-year","Jahr"],["review-hint","Auffälligkeit"],["review-state","Bearbeitung"]].forEach(([id,label])=>{
  const field=node("label");
  field.append(label);
  const select=node("select");
  select.id=id;
  field.append(select);
  reviewFilters.append(field);
 });
 const reviewNote=node("p","help");
 reviewNote.id="review-note";
 const reviewList=node("div");
 reviewList.id="review-list";
 review.append(reviewFilters,reviewNote,reviewList);
 const meters=node("section");
 meters.id="import-meters";
 meters.classList.add("hidden");
 meters.append(node("h2",null,"Lokale Zusammenführung"));
 meters.append(node("p","help","Bezeichnungen werden nur zusammengeführt, wenn Sie das ausdrücklich auslösen. Vorher stehen Verbrauchsart, Einheit, Zeitraum, Überschneidung und die Zahl neuer Auffälligkeiten. Die ursprünglichen Bezeichnungen bleiben erhalten. Diese Zusammenführung bleibt auf diesem Gerät und erzeugt keine Datenbankzuordnung."));
 const meterScroll=node("div");
 meterScroll.id="meter-scroll";
 const meterTable=node("table");
 meterTable.id="meter-table";
 meterScroll.append(meterTable);
 const merge=node("div");
 merge.id="merge-controls";
 [["merge-source","Erste Bezeichnung"],["merge-target","Zielbezeichnung"]].forEach(([id,label])=>{
  const field=node("label");
  field.append(label);
  const select=node("select");
  select.id=id;
  field.append(select);
  merge.append(field);
 });
 const overlapLabel=node("label");
 overlapLabel.append("Überschneidung geprüft");
 const overlap=node("input");
 overlap.id="merge-overlap";
 overlap.type="checkbox";
 overlap.style.width="auto";
 overlapLabel.append(overlap);
 merge.append(overlapLabel);
 const mergeActions=node("div","review-actions");
 const checkButton=node("button","secondary","Zusammenführung prüfen");
 checkButton.type="button";
 checkButton.id="merge-check";
 const mergeButton=node("button",null,"Zusammenführen");
 mergeButton.type="button";
 mergeButton.id="merge-apply";
 const separateButton=node("button","secondary","Getrennt halten");
 separateButton.type="button";
 separateButton.id="merge-separate";
 const unclearButton=node("button","secondary","Als ungeklärt markieren");
 unclearButton.type="button";
 unclearButton.id="merge-unclear";
 mergeActions.append(checkButton,mergeButton,separateButton,unclearButton);
 const mergeResult=node("div");
 mergeResult.id="merge-result";
 meters.append(meterScroll,merge,mergeActions,mergeResult);
 const mapping=node("section");
 mapping.id="import-mapping";
 mapping.classList.add("hidden");
 mapping.append(node("h2",null,"Zählerzuordnung"));
 mapping.append(node("p","help","Jeder erkannte Excel-Zähler kann einem vorhandenen Zähler des ausgewählten Betriebs zugeordnet werden. Die Zuordnung wird nur nach ausdrücklicher Auswahl gespeichert. Es wird kein Zähler angelegt."));
 const mappingNote=node("p","help");
 mappingNote.id="import-mapping-note";
 const mappingList=node("div");
 mappingList.id="import-mapping-list";
 mapping.append(mappingNote,mappingList);
 const times=node("section");
 times.id="import-times";
 times.classList.add("hidden");
 times.append(node("h2",null,"Historische Ablesezeiten"));
 times.append(node("p","help","Die Vorschläge gelten ausschließlich für historische Excel-Ablesungen ohne dokumentierte Uhrzeit. Der Ablesezeitraum vormittag oder abend bleibt unverändert."));
 const timeFields=node("div");
 timeFields.id="import-times-fields";
 [["import-time-morning","Vormittagsablesung"],["import-time-evening","Abendablesung"]].forEach(([id,label])=>{
  const field=node("label");
  field.append(label);
  const input=node("input");
  input.id=id;
  input.type="time";
  input.value=id.endsWith("morning")?"09:00":"21:00";
  input.disabled=true;
  field.append(input);
  timeFields.append(field);
 });
 const confirmLabel=node("label");
 confirmLabel.id="import-time-confirm-label";
 const confirm=node("input");
 confirm.id="import-time-confirm";
 confirm.type="checkbox";
 confirm.disabled=true;
 confirm.style.width="auto";
 confirmLabel.append(confirm,document.createTextNode(" Ich bestätige, dass die angegebenen Uhrzeiten für historische Ablesungen ohne dokumentierte Uhrzeit als angenommene Zeiten verwendet werden dürfen."));
 const timeMessage=node("p");
 timeMessage.id="import-times-message";
 const prepareSummary=node("div");
 prepareSummary.id="import-prepare-summary";
 const prepareNote=node("p","help");
 prepareNote.id="import-prepare-note";
 const prepareList=node("div");
 prepareList.id="import-prepare-list";
 const previewStatus=node("p","help");
 previewStatus.id="import-preview-status";
 previewStatus.textContent="Importvorschau gesperrt.";
 const preview=node("button",null,"Importvorschau");
 preview.id="import-preview-start";
 preview.type="button";
 preview.disabled=true;
 const timeNote=node("p","help");
 timeNote.id="import-times-note";
 times.append(timeFields,confirmLabel,timeMessage,prepareSummary,prepareNote,prepareList,previewStatus,preview,timeNote);
 const serverPreviewSection=node("section","hidden");
 serverPreviewSection.id="import-server-preview";
 serverPreviewSection.append(node("h2",null,"Serverseitige Importvorschau"));
 const serverNote=node("p","help");
 serverNote.id="import-server-note";
 const serverSummary=node("div");
 serverSummary.id="import-server-summary";
 const serverBlocked=node("div");
 serverBlocked.id="import-server-blocked";
 const serverEffects=node("div");
 serverEffects.id="import-server-effects";
 const serverError=node("p","error");
 serverError.id="import-server-error";
 serverPreviewSection.append(serverNote,serverSummary,serverError,serverBlocked,serverEffects);
 const commitSection=node("section");
 commitSection.id="import-commit";
 commitSection.append(node("h2",null,"Historische Übernahme"));
 const commitNote=node("p","help");
 commitNote.id="import-commit-note";
 const commitLabel=node("label");
 commitLabel.id="import-commit-confirm-label";
 const commitBox=node("input");
 commitBox.id="import-commit-confirm";
 commitBox.type="checkbox";
 commitBox.disabled=true;
 commitBox.style.width="auto";
 commitLabel.append(commitBox,document.createTextNode(" Ich bestätige, dass die freigegebenen historischen Ablesungen als Zählerstände übernommen werden."));
 const commitButton=node("button",null,"Historische Ablesungen übernehmen");
 commitButton.id="import-commit-start";
 commitButton.type="button";
 commitButton.disabled=true;
 const commitSummary=node("div");
 commitSummary.id="import-commit-summary";
 const commitError=node("p","error");
 commitError.id="import-commit-error";
 commitSection.append(commitNote,commitLabel,commitButton,commitSummary,commitError);
 card.append(facilityLabel,facilityNote,facilityMeters,profileLabel,fileLabel,summary,warnings,filters,actions,note,scroll,review,meters,mapping,times,serverPreviewSection,commitSection);
 const cardAnchor=document.getElementById("consumption-card");
 if(cardAnchor)cardAnchor.after(card);
 else more.append(card);
 button.addEventListener("click",()=>{
  if(!managerFacilities().length){
   card.classList.add("hidden");
   button.classList.add("hidden");
   button.classList.remove("active");
   return;
  }
  const hidden=card.classList.toggle("hidden");
  button.classList.toggle("active",!hidden);
  if(!hidden)card.scrollIntoView({behavior:"smooth",block:"start"});
 });
 facilitySelect.addEventListener("change",()=>{
  if(!managerFacilities().some(facility=>facility.id===facilitySelect.value))return;
  selectedFacilityId=facilitySelect.value;
  loadImportMeters(selectedFacilityId);
  renderHistoricalTimes();
 });
 document.getElementById("import-time-morning").addEventListener("change",()=>updateHistoricalTimes({vormittag:document.getElementById("import-time-morning").value}));
 document.getElementById("import-time-evening").addEventListener("change",()=>updateHistoricalTimes({abend:document.getElementById("import-time-evening").value}));
 document.getElementById("import-time-confirm").addEventListener("change",()=>updateHistoricalTimes({bestaetigt:document.getElementById("import-time-confirm").checked}));
 document.getElementById("import-preview-start").addEventListener("click",()=>{startHistoricalPreview();});
 document.getElementById("import-commit-confirm").addEventListener("change",()=>{
  commitConfirmed=document.getElementById("import-commit-confirm").checked===true;
  renderCommit();
 });
 document.getElementById("import-commit-start").addEventListener("click",()=>{startHistoricalCommit();});
 file.addEventListener("change",()=>readWorkbook(file.files&&file.files[0]));
 [profile,document.getElementById("import-meter"),document.getElementById("import-sheet"),document.getElementById("import-status"),only].forEach(control=>{
  control.addEventListener("change",renderPreview);
 });
 readingsButton.addEventListener("click",()=>download("ablesungen.csv",result&&reviewReadingsCsv(currentReview(),READING_COLUMNS)));
 metersButton.addEventListener("click",()=>download("zaehler.csv",result&&reviewMetersCsv(result.meters,meterChoices,METER_COLUMNS)));
 exportButton.addEventListener("click",exportReviewState);
 importButton.addEventListener("click",()=>importFile.click());
 importFile.addEventListener("change",()=>{
  const selected=importFile.files&&importFile.files[0];
  importFile.value="";
  if(selected)selected.text().then(importReviewText).catch(()=>setStoreNotice("Die Prüfstand-Datei konnte nicht gelesen werden."));
 });
 reviewFilters.querySelectorAll("select").forEach(select=>select.addEventListener("change",renderReview));
 checkButton.addEventListener("click",refreshMergePreview);
 mergeButton.addEventListener("click",()=>applyMerge(true));
 separateButton.addEventListener("click",()=>markMeter("getrennt"));
 unclearButton.addEventListener("click",()=>markMeter("ungeklaert"));
 [document.getElementById("merge-source"),document.getElementById("merge-target"),overlap].forEach(control=>control.addEventListener("change",refreshMergePreview));
 syncMeterImportAccess();
}

function readWorkbook(file){
 const summary=document.getElementById("import-summary");
 const warnings=document.getElementById("import-warnings");
 summary.replaceChildren();
 warnings.replaceChildren();
 result=null;
 decisions=new Map();
 meterChoices=new Map();
 mergeCheck=null;
 timeSettings=new Map();
 preparedImport=null;
 importPlanCache=null;
 importPlanKey="";
 previewSeq++;
 previewBusy=false;
 previewSentKey="";
 serverPreview=null;
 commitSeq++;
 commitBusy=false;
 commitSentKey="";
 commitResult=null;
 commitConfirmed=false;
 source=null;
 renderHistoricalTimes();
 if(!file)return;
 const XLSX=globalThis.XLSX;
 if(!XLSX||typeof XLSX.read!=="function"){
  warnings.textContent="Die lokale Excel-Bibliothek wurde nicht geladen.";
  return;
 }
 fileName=file.name;
 const reader=new FileReader();
 reader.onload=()=>{
  Promise.resolve().then(async()=>{
   try{
    const buffer=reader.result;
    const hash=await sha256Hex(buffer);
    const workbook=XLSX.read(buffer,{type:"array",cellFormula:true,cellDates:false});
    if(document.getElementById("import-profile").value!=="tageszeit_zweizeilig")throw new Error("Dieses Profil ist nicht verfügbar.");
    await presentImportResult(convertTageszeitZweizeilig(workbook,fileName,XLSX),{name:fileName,hash,size:buffer.byteLength});
   }catch(error){
    timeSettings=new Map();
    renderHistoricalTimes();
    warnings.textContent="Die Datei konnte nicht gelesen werden. "+(error&&error.message?error.message:"");
   }
  });
 };
 reader.onerror=()=>{warnings.textContent="Die Datei konnte nicht gelesen werden.";};
 reader.readAsArrayBuffer(file);
}

function renderResult(){
 const summary=document.getElementById("import-summary");
 const warnings=document.getElementById("import-warnings");
 const counts=[
  ["Blätter",result.summary.sheets],
  ["Zähler",result.summary.meters],
  ["Ablesungen",result.summary.readings],
  ["Auffällig",result.summary.notable],
  ["Ausgeschlossen",result.summary.excluded]
 ];
 summary.replaceChildren();
 counts.forEach(([label,value])=>{
  const box=node("div");
  box.append(node("strong",null,String(value)),node("span",null,label));
  summary.append(box);
 });
 warnings.replaceChildren();
 result.sheets.filter(sheet=>sheet.hinweis).forEach(sheet=>{
  warnings.append(node("p",null,sheet.name+": "+sheet.hinweis));
 });
 fillSelect("import-meter","Alle Zähler",result.meters.map(meter=>[meter.zaehler_schluessel,meter.verbrauchsart+" · "+meter.zaehler_bezeichnung]));
 fillSelect("import-sheet","Alle Blätter",result.sheets.map(sheet=>[sheet.name,sheet.name]));
 fillSelect("import-status","Alle Status",[["zaehlerstand","Zählerstände"],["pruefung","Prüfung"],["ausgeschlossen","Ausgeschlossen"],["uebernehmbar","Übernehmbar"]]);
 document.getElementById("import-filters").classList.remove("hidden");
 document.getElementById("import-actions").classList.remove("hidden");
 document.getElementById("import-scroll").classList.remove("hidden");
 document.getElementById("import-review").classList.remove("hidden");
 document.getElementById("import-meters").classList.remove("hidden");
 document.getElementById("import-mapping").classList.remove("hidden");
 document.getElementById("import-times").classList.remove("hidden");
 renderPreview();
 renderReview();
 renderMeters();
 renderHistoricalTimes();
}

function fillSelect(id,first,options){
 const select=document.getElementById(id);
 const previous=select.value;
 select.replaceChildren();
 select.append(new Option(first,""));
 options.forEach(([value,label])=>select.append(new Option(label,value)));
 if([...select.options].some(option=>option.value===previous))select.value=previous;
}

function filteredRows(){
 if(!result)return [];
 const meter=document.getElementById("import-meter").value;
 const sheet=document.getElementById("import-sheet").value;
 const status=document.getElementById("import-status").value;
 const only=document.getElementById("import-notable").checked;
 return result.readings.filter(row=>{
  if(meter&&row.zaehler_schluessel!==meter)return false;
  if(sheet&&row.quelle_blatt!==sheet)return false;
  if(status==="zaehlerstand"&&row.wert_art!=="zaehlerstand")return false;
  if(status==="pruefung"&&!(row.pruefstatus==="pruefung"&&notable(row)))return false;
  if((status==="ausgeschlossen"||status==="uebernehmbar")&&row.pruefstatus!==status)return false;
  if(only&&!notable(row))return false;
  return true;
 });
}

function renderPreview(){
 const table=document.getElementById("import-table");
 const note=document.getElementById("import-note");
 if(!table||!result)return;
 const rows=filteredRows();
 const columns=["zeilen_id","quelle_blatt","quelle_zelle","zaehler_schluessel","ablesedatum","ablesezeitraum","zaehlerstand","wert_art","pruefstatus","pruefhinweis"];
 const head=node("thead");
 const headRow=node("tr");
 columns.forEach(column=>headRow.append(node("th",null,READING_COLUMNS.includes(column)?column:column)));
 head.append(headRow);
 const body=node("tbody");
 rows.slice(0,PREVIEW_LIMIT).forEach(row=>{
  const line=node("tr");
  columns.forEach(column=>line.append(node("td",null,row[column]||"")));
  body.append(line);
 });
 table.replaceChildren(head,body);
 note.textContent=rows.length>PREVIEW_LIMIT
  ?rows.length+" passende Zeilen, davon "+PREVIEW_LIMIT+" in der Vorschau. Die CSV enthält alle Zeilen."
  :rows.length+" passende Zeilen. Die CSV enthält alle erkannten Zeilen.";
}

async function presentImportResult(converted,identity){
 await persistQueue;
 result=converted;
 decisions=new Map();
 meterChoices=new Map();
 mergeCheck=null;
 source=identity?.hash?{name:identity.name||fileName||"",hash:identity.hash,size:identity.size||0}:null;
 timeSettings=new Map();
 let notice="";
 if(source){
  try{
   const stored=await readSnapshot(source.hash);
   if(stored){
    const verdict=matchSnapshot(stored,{hash:source.hash,readings:result.readings,meters:result.meters});
    if(verdict.ok){
     decisions=verdict.entscheidungen;
     meterChoices=verdict.zaehler;
     applyStoredTimes(verdict.ablesezeiten);
     const confirmed=historicalTimesForFacility(verdict.ablesezeiten,importFacilityId()).bestaetigt;
     notice="Wiederhergestellt: "+anzahl(decisions.size,"Entscheidung","Entscheidungen")+", "+anzahl(meterChoices.size,"Zählerzuordnung","Zählerzuordnungen")+(confirmed?", bestätigte Ablesezeiten.":".");
    }else notice="Gespeicherte Entscheidungen wurden nicht übernommen. "+verdict.grund;
   }
  }catch(error){
   notice="Gespeicherte Entscheidungen konnten nicht gelesen werden.";
  }
 }
 renderResult();
 setStoreNotice(notice);
 return {decisions:decisions.size,meters:meterChoices.size,notice};
}

function currentReview(){
 return result?reviewRows(result.readings,decisions,meterChoices):[];
}

function reviewCandidates(){
 return currentReview().filter(row=>needsReview(row)||row.pruef_offen==="ja");
}

function renderReview(){
 const list=document.getElementById("review-list");
 const note=document.getElementById("review-note");
 if(!list||!result)return;
 const rows=reviewCandidates();
 const years=[...new Set(rows.map(row=>row.ablesedatum?row.ablesedatum.slice(0,4):"ohne"))].sort();
 const hints=[...new Set(rows.flatMap(row=>row.pruefhinweis.split(";").map(item=>item.trim()).filter(item=>item&&item!=="uhrzeit_unbekannt")))].sort();
 fillSelect("review-meter","Alle Zähler",result.meters.map(meter=>[meter.zaehler_schluessel,meterLabel(meter)]));
 fillSelect("review-year","Alle Jahre",years.map(year=>[year,year==="ohne"?"Ohne Datum":year]));
 fillSelect("review-hint","Alle Auffälligkeiten",hints.map(hint=>[hint,HINT_LABELS[hint]||hint]));
 fillSelect("review-state","Alle Bearbeitungen",[["offen","Offen"],["bestaetigt","Original bestätigt"],["korrigiert","Korrigiert"],["ausgeschlossen","Ausgeschlossen"],["zurueckgestellt","Zurückgestellt"]]);
 const selected=filteredReview(rows);
 const open=rows.filter(row=>row.pruef_offen==="ja").length;
 note.textContent=open+" von "+rows.length+" Auffälligkeiten sind noch nicht bestätigt. Angezeigt werden "+Math.min(selected.length,REVIEW_LIMIT)+" von "+selected.length+" passenden Zeilen.";
 list.replaceChildren();
 selected.slice(0,REVIEW_LIMIT).forEach(row=>list.append(reviewCard(row)));
 renderImportPreparation();
}

function filteredReview(rows){
 const meter=document.getElementById("review-meter").value;
 const year=document.getElementById("review-year").value;
 const hint=document.getElementById("review-hint").value;
 const state=document.getElementById("review-state").value;
 return rows.filter(row=>{
  if(meter&&row.zaehler_schluessel!==meter&&seriesTarget(row.zaehler_schluessel)!==meter)return false;
  const rowYear=row.ablesedatum?row.ablesedatum.slice(0,4):"ohne";
  if(year&&rowYear!==year)return false;
  if(hint&&!row.pruefhinweis.split(";").map(item=>item.trim()).includes(hint))return false;
  const status=row.entscheidung||"offen";
  if(state&&status!==state)return false;
  return true;
 });
}

function seriesTarget(key){
 const choice=meterChoices.get(key);
 return choice?.status==="zusammengefuehrt"&&choice.ziel?choice.ziel:key;
}

function reviewCard(row){
 const card=node("article","review-row"+(row.pruef_offen==="ja"?" review-open":""));
 const title=node("h3",null,row.quelle_blatt+" "+row.quelle_zelle+" · "+meterName(row.zaehler_schluessel));
 const facts=node("p","help",(row.ablesedatum||"ohne Datum")+" · "+row.ablesezeitraum+" · Original "+row.zaehlerstand+" · "+row.pruefhinweis);
 const state=node("p",null,(DECISION_LABELS[row.entscheidung]||"Offen")+(row.korrigierter_zaehlerstand?" · korrigiert auf "+row.korrigierter_zaehlerstand:""));
 const effect=node("p","help",row.auswirkung||(row.pruef_offen==="ja"?"Noch keine Entscheidung.":"Die ursprüngliche Auffälligkeit bleibt im Hinweis erhalten."));
 const correction=node("input");
 correction.type="text";
 correction.placeholder="Korrigierter Zählerstand";
 correction.value=row.korrigierter_zaehlerstand||"";
 correction.setAttribute("aria-label","Korrigierter Zählerstand");
 const reason=node("input");
 reason.type="text";
 reason.placeholder="Begründung, optional";
 reason.value=row.begruendung||"";
 reason.setAttribute("aria-label","Begründung");
 const actions=node("div","review-actions");
 const confirm=node("button","secondary","Originalwert bestätigen");
 const save=node("button",null,"Korrektur speichern");
 const exclude=node("button","secondary","Vom Import ausschließen");
 const defer=node("button","secondary","Zurückstellen");
 [confirm,save,exclude,defer].forEach(button=>{button.type="button";});
 confirm.addEventListener("click",()=>storeDecision(row,"bestaetigt","",reason.value.trim()));
 save.addEventListener("click",()=>{
  if(parseReviewNumber(correction.value)==null){effect.textContent="Der korrigierte Zählerstand ist keine gültige Zahl. Der Originalwert bleibt unverändert.";return;}
  storeDecision(row,"korrigiert",correction.value.trim(),reason.value.trim());
 });
 exclude.addEventListener("click",()=>storeDecision(row,"ausgeschlossen","",reason.value.trim()));
 defer.addEventListener("click",()=>storeDecision(row,"zurueckgestellt","",reason.value.trim()));
 actions.append(confirm,save,exclude,defer);
 card.append(title,facts,state,effect,correction,reason,actions);
 return card;
}

function parseReviewNumber(value){
 const raw=String(value??"").trim();
 if(!raw)return null;
 const normalized=raw.includes(",")?raw.replaceAll(".","").replace(",","."):raw;
 return /^[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:[.,]\d+)?$/.test(raw)&&Number.isFinite(Number(normalized))?Number(normalized):null;
}

function storeDecision(row,entscheidung,korrigierter,begruendung){
 const current=decisions.get(row.zeilen_id);
 decisions.set(row.zeilen_id,{entscheidung,korrigierter_zaehlerstand:korrigierter||"",begruendung:begruendung??(current?.begruendung||"")});
 renderReview();
 renderMeters();
 return persistSnapshot();
}

function meterName(key){
 const meter=result.meters.find(item=>item.zaehler_schluessel===key);
 return meter?meter.verbrauchsart+" "+meter.zaehler_bezeichnung:key;
}

function meterLabel(meter){
 return meter.verbrauchsart+" · "+meter.zaehler_bezeichnung+(meter.tarifregister?" · "+meter.tarifregister:"");
}

function renderMeters(){
 const table=document.getElementById("meter-table");
 if(!table||!result)return;
 const head=node("thead");
 const headRow=node("tr");
 ["Bezeichnung","Art","Einheit","Register","Zeitraum","Entscheidung"].forEach(label=>headRow.append(node("th",null,label)));
 head.append(headRow);
 const body=node("tbody");
 result.meters.forEach(meter=>{
  const span=dateSpan(result.readings,meter.zaehler_schluessel);
  const choice=meterChoices.get(meter.zaehler_schluessel);
  const text=choice?.status==="zusammengefuehrt"?"Zusammengeführt mit "+meterName(choice.ziel):choice?.status==="getrennt"?"Getrennt gehalten":choice?.status==="ungeklaert"?"Ungeklärt":"Offen";
  const line=node("tr");
  [meter.zaehler_bezeichnung,meter.verbrauchsart,meter.einheit,meter.tarifregister||"",span.first&&span.last?span.first+" bis "+span.last:"",text].forEach(value=>line.append(node("td",null,value)));
  body.append(line);
 });
 table.replaceChildren(head,body);
 const options=result.meters.map(meter=>[meter.zaehler_schluessel,meterLabel(meter)]);
 fillSelect("merge-source","Bezeichnung wählen",options);
 fillSelect("merge-target","Ziel wählen",options);
 renderMergeMessage();
 renderMapping();
}

function selectedMeters(){
 const source=result.meters.find(meter=>meter.zaehler_schluessel===document.getElementById("merge-source").value);
 const target=result.meters.find(meter=>meter.zaehler_schluessel===document.getElementById("merge-target").value);
 return {source,target};
}

function refreshMergePreview(){
 if(!result){mergeCheck=null;renderMergeMessage();return;}
 const {source:left,target:right}=selectedMeters();
 mergeCheck=canMerge(left,right,result.readings,meterChoices,document.getElementById("merge-overlap").checked,decisions);
 renderMergeMessage();
}

function spanText(span){
 return span&&span.first&&span.last?span.first+" bis "+span.last+" · "+span.count+" Ablesungen":"kein datierter Zeitraum";
}

function renderMergeMessage(){
 const box=document.getElementById("merge-result");
 if(!box)return;
 box.replaceChildren();
 if(!mergeCheck){box.textContent="Noch keine Prüfung.";return;}
 const left=mergeCheck.left;
 const right=mergeCheck.right;
 if(left)box.append(node("p",null,meterLabel(left)+" · Einheit "+left.einheit+" · "+spanText(mergeCheck.leftSpan)));
 if(right)box.append(node("p",null,meterLabel(right)+" · Einheit "+right.einheit+" · "+spanText(mergeCheck.rightSpan)));
 if(left&&right){
  box.append(node("p",null,mergeCheck.warnings.length?mergeCheck.warnings.join(" "):"Die Zeiträume überschneiden sich nicht."));
  const examples=mergeCheck.beispiele&&mergeCheck.beispiele.length?" ("+mergeCheck.beispiele.join(", ")+")":"";
  box.append(node("p",null,"Neu entstehende Auffälligkeiten: "+mergeCheck.neue+examples));
 }
 if(mergeCheck.blockers.length)box.append(node("p",null,mergeCheck.blockers.join(" ")));
 else if(left&&right)box.append(node("p",null,"Verbrauchsart, Einheit und Tarifregister stimmen überein."));
 if(mergeCheck.ergebnis)box.append(node("p",null,mergeCheck.ergebnis));
}

function applyMerge(requireReady){
 const {source:left,target:right}=selectedMeters();
 const verdict=canMerge(left,right,result.readings,meterChoices,document.getElementById("merge-overlap").checked,decisions);
 mergeCheck=verdict;
 if(requireReady&&!verdict.allowed){renderMergeMessage();return;}
 meterChoices.set(left.zaehler_schluessel,{status:"zusammengefuehrt",ziel:right.zaehler_schluessel});
 mergeCheck={...verdict,ergebnis:meterLabel(left)+" wurde mit "+meterLabel(right)+" zusammengeführt. Die Originalbezeichnungen bleiben erhalten."};
 renderReview();
 renderMeters();
 return persistSnapshot();
}

function markMeter(status){
 const {source:left}=selectedMeters();
 const box=document.getElementById("merge-result");
 if(!left){box.textContent="Bitte zuerst eine Bezeichnung auswählen.";return;}
 meterChoices.set(left.zaehler_schluessel,{status,ziel:""});
 renderMeters();
 box.textContent=meterLabel(left)+" ist "+(status==="getrennt"?"getrennt gehalten.":"als ungeklärt markiert.");
 return persistSnapshot();
}

function download(name,content,type){
 if(!content)return;
 const link=node("a");
 link.href=URL.createObjectURL(new Blob([content],{type:type||"text/csv;charset=utf-8"}));
 link.download=name;
 link.click();
 setTimeout(()=>URL.revokeObjectURL(link.href),1000);
}

function anzahl(count,singular,plural){
 return count+" "+(count===1?singular:plural);
}

function setStoreNotice(text){
 const note=document.getElementById("import-store-note");
 if(note)note.textContent=text||"";
}

function currentSnapshot(){
 return buildSnapshot({source,readings:result.readings,decisions,choices:meterChoices,zeiten:storedTimeRows()});
}

function persistSnapshot(){
 if(!source||!result)return Promise.resolve(false);
 const snapshot=currentSnapshot();
 persistQueue=persistQueue.then(()=>writeSnapshot(snapshot)).then(()=>{
  setStoreNotice("Prüfstand lokal gespeichert.");
  return true;
 }).catch(()=>{
  setStoreNotice("Der Prüfstand konnte nicht gespeichert werden.");
  return false;
 });
 return persistQueue;
}

function exportReviewState(){
 if(!result||!source){setStoreNotice("Zuerst eine Excel-Datei öffnen. Der Prüfstand gilt nur für deren Dateiinhalt.");return;}
 download("pruefstand.json",JSON.stringify(currentSnapshot(),null,2),"application/json");
 setStoreNotice("Prüfstand exportiert. Er passt nur zu dieser Quelldatei.");
}

async function importReviewText(text){
 if(!result||!source){setStoreNotice("Zuerst die zugehörige Excel-Datei öffnen.");return {ok:false};}
 let snapshot;
 try{
  snapshot=JSON.parse(text);
 }catch(error){
  setStoreNotice("Der Prüfstand wurde nicht übernommen. Die Datei ist kein gültiges JSON.");
  return {ok:false};
 }
 const verdict=matchSnapshot(snapshot,{hash:source.hash,readings:result.readings,meters:result.meters});
 if(!verdict.ok){
  setStoreNotice("Der Prüfstand wurde nicht übernommen. "+verdict.grund);
  return {ok:false,grund:verdict.grund};
 }
 decisions=verdict.entscheidungen;
 meterChoices=verdict.zaehler;
 applyStoredTimes(verdict.ablesezeiten);
 mergeCheck=null;
 renderReview();
 renderMeters();
 renderHistoricalTimes();
 await persistSnapshot();
 setStoreNotice("Prüfstand übernommen: "+anzahl(decisions.size,"Entscheidung","Entscheidungen")+", "+anzahl(meterChoices.size,"Zählerzuordnung","Zählerzuordnungen")+".");
 return {ok:true,decisions:decisions.size,meters:meterChoices.size};
}

function openDatabase(){
 if(typeof indexedDB==="undefined")return Promise.reject(new Error("IndexedDB ist nicht verfügbar."));
 if(!databasePromise){
  databasePromise=new Promise((resolve,reject)=>{
   const request=indexedDB.open("tageswerk-pruefstand",1);
   request.onupgradeneeded=()=>{
    const database=request.result;
    if(!database.objectStoreNames.contains("dateien"))database.createObjectStore("dateien",{keyPath:"inhalt_sha256"});
   };
   request.onsuccess=()=>resolve(request.result);
   request.onerror=()=>{databasePromise=null;reject(request.error);};
  });
 }
 return databasePromise;
}

function requestToPromise(request){
 return new Promise((resolve,reject)=>{
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error);
 });
}

async function readSnapshot(hash){
 const database=await openDatabase();
 return requestToPromise(database.transaction("dateien").objectStore("dateien").get(hash));
}

async function writeSnapshot(snapshot){
 const database=await openDatabase();
 return requestToPromise(database.transaction("dateien","readwrite").objectStore("dateien").put(snapshot));
}

async function clearReviewStore(){
 const database=await openDatabase();
 await requestToPromise(database.transaction("dateien","readwrite").objectStore("dateien").clear());
}

export {presentImportResult,importReviewText,clearReviewStore,syncMeterImportAccess,importFacilityId,translateImportMedium,mappingCandidates,planMappingSave,mappingForFacility,mappingPermission,preparedImportPayload};

if(typeof document!=="undefined"){
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mountMeterImport);
 else mountMeterImport();
}
