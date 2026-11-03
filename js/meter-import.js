import {PROFILES,convertTageszeitZweizeilig,notable,READING_COLUMNS,METER_COLUMNS} from './meter-import-profiles.js';
import {needsReview,reviewRows,canMerge,dateSpan,reviewReadingsCsv,reviewMetersCsv} from './meter-import-review.js';
import {sha256Hex,buildSnapshot,matchSnapshot} from './meter-import-store.js';

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

function node(tag,className,text){
 const element=document.createElement(tag);
 if(className)element.className=className;
 if(text!=null)element.textContent=text;
 return element;
}

function mountMeterImport(){
 const more=document.getElementById("view-more");
 if(!more||document.getElementById("open-meter-import"))return;
 const style=node("style");
 style.textContent="#meter-import-card.hidden{display:none}#import-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:16px 0}#import-summary div{background:#142538;border:1px solid #4b6680;border-radius:6px;padding:12px}#import-summary strong{display:block;color:#e1bf48;font-size:26px}#import-summary span{color:#aabed0}#import-filters,#review-filters,#merge-controls{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px}#import-filters label,#review-filters label,#merge-controls label{margin:0}#import-table,#meter-table{width:100%;border-collapse:collapse;margin-top:14px}#import-table th,#import-table td,#meter-table th,#meter-table td{border-bottom:1px solid #4b6680;padding:7px 8px;text-align:left;font-size:13px;white-space:nowrap}#import-table th,#meter-table th{color:#e1bf48}#import-scroll,#meter-scroll{overflow:auto;max-height:520px;border:1px solid #4b6680;border-radius:6px}#import-warnings,#merge-result,#import-store-note{margin:12px 0;color:#ffc48c}.import-actions,.review-actions{display:flex;flex-wrap:wrap;gap:8px}.import-actions button,.review-actions button{margin-top:0}#import-review,#import-meters{margin-top:28px}#review-list{display:flex;flex-direction:column;gap:10px;margin-top:12px}.review-row{background:#142538;border:1px solid #4b6680;border-radius:6px;padding:12px}.review-row.review-open{border-color:#e1bf48}.review-row h3{margin:0 0 6px;font-size:16px}";
 document.head.append(style);
 const button=node("button","secondary","Zählerimport");
 button.type="button";
 button.id="open-meter-import";
 const buttonAnchor=document.getElementById("open-consumption");
 if(buttonAnchor)buttonAnchor.after(button);
 else more.append(button);
 const card=node("div","card hidden");
 card.id="meter-import-card";
 card.append(node("h2",null,"Zählerimport"));
 card.append(node("p","help","Die Datei bleibt auf diesem Gerät. Es wird nichts nach Tageswerk geschrieben und keine Uhrzeit ergänzt. Profil: erste Zeile eines Tages ist Vormittag, die zweite ist Abend. Leere Zellen erzeugen keine Ablesung."));
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
 meters.append(node("h2",null,"Zählerzuordnung"));
 meters.append(node("p","help","Bezeichnungen werden nur zusammengeführt, wenn Sie das ausdrücklich auslösen. Vorher stehen Verbrauchsart, Einheit, Zeitraum, Überschneidung und die Zahl neuer Auffälligkeiten. Die ursprünglichen Bezeichnungen bleiben erhalten."));
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
 card.append(profileLabel,fileLabel,summary,warnings,filters,actions,note,scroll,review,meters);
 const cardAnchor=document.getElementById("consumption-card");
 if(cardAnchor)cardAnchor.after(card);
 else more.append(card);
 button.addEventListener("click",()=>{
  const hidden=card.classList.toggle("hidden");
  button.classList.toggle("active",!hidden);
  if(!hidden)card.scrollIntoView({behavior:"smooth",block:"start"});
 });
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
 source=null;
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
 renderPreview();
 renderReview();
 renderMeters();
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
 let notice="";
 if(source){
  try{
   const stored=await readSnapshot(source.hash);
   if(stored){
    const verdict=matchSnapshot(stored,{hash:source.hash,readings:result.readings,meters:result.meters});
    if(verdict.ok){
     decisions=verdict.entscheidungen;
     meterChoices=verdict.zaehler;
     notice="Wiederhergestellt: "+anzahl(decisions.size,"Entscheidung","Entscheidungen")+", "+anzahl(meterChoices.size,"Zählerzuordnung","Zählerzuordnungen")+".";
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
 return buildSnapshot({source,readings:result.readings,decisions,choices:meterChoices});
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
 mergeCheck=null;
 renderReview();
 renderMeters();
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

export {presentImportResult,importReviewText,clearReviewStore};

if(typeof document!=="undefined"){
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mountMeterImport);
 else mountMeterImport();
}
