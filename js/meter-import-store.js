import {reviewRows,seriesKey} from './meter-import-review.js';

const FORMAT="tageswerk-pruefstand";
const IMPORT_LIMIT=10000;
const VERSION=1;
const DECISIONS=new Set(["bestaetigt","korrigiert","ausgeschlossen","zurueckgestellt"]);
const METER_STATUS=new Set(["getrennt","ungeklaert","zusammengefuehrt"]);

function recordId(row){
 return row.quelle_blatt+"!"+row.quelle_zelle;
}

async function sha256Hex(buffer){
 const digest=await crypto.subtle.digest("SHA-256",new Uint8Array(buffer));
 return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("");
}

function validClock(value){
 return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value||""));
}

function defaultHistoricalTimes(){
 return {vormittag:"09:00",abend:"21:00",bestaetigt:false};
}

function reviseHistoricalTimes(entry,patch){
 const base=entry||defaultHistoricalTimes();
 const next={
  vormittag:Object.prototype.hasOwnProperty.call(patch||{},"vormittag")?patch.vormittag:base.vormittag,
  abend:Object.prototype.hasOwnProperty.call(patch||{},"abend")?patch.abend:base.abend,
  bestaetigt:Object.prototype.hasOwnProperty.call(patch||{},"bestaetigt")?patch.bestaetigt===true:base.bestaetigt===true
 };
 if(next.vormittag!==base.vormittag||next.abend!==base.abend)next.bestaetigt=false;
 if(!validClock(next.vormittag)||!validClock(next.abend))return {ok:false,entry:{vormittag:base.vormittag,abend:base.abend,bestaetigt:false},message:"Die Uhrzeit ist ungültig. Erlaubt ist eine Uhrzeit im Format HH:MM, zum Beispiel 09:00."};
 return {ok:true,entry:next,message:""};
}

function historicalPreviewReady(entry){
 return !!(entry&&entry.bestaetigt===true&&validClock(entry.vormittag)&&validClock(entry.abend));
}

function historicalTimeForRow(row,entry){
 const period=row?.ablesezeitraum==="abend"||row?.ablesezeitraum==="vormittag"?row.ablesezeitraum:"";
 const documented=!!String(row?.ableseuhrzeit||"").trim()&&!!row?.uhrzeit_status&&row.uhrzeit_status!=="unbekannt";
 if(!period)return {ablesezeitraum:row?.ablesezeitraum||"",uhrzeit_angenommen:false,bestaetigte_uhrzeit:""};
 if(documented)return {ablesezeitraum:period,uhrzeit_angenommen:false,bestaetigte_uhrzeit:String(row.ableseuhrzeit)};
 if(!historicalPreviewReady(entry))return {ablesezeitraum:period,uhrzeit_angenommen:false,bestaetigte_uhrzeit:""};
 return {ablesezeitraum:period,uhrzeit_angenommen:true,bestaetigte_uhrzeit:entry[period]};
}

function normalizeHistoricalTimes(list){
 if(!Array.isArray(list))return [];
 const seen=new Set();
 const rows=[];
 for(const item of list){
  if(!item||typeof item!=="object")continue;
  const betrieb_id=String(item.betrieb_id||"");
  if(!betrieb_id||seen.has(betrieb_id)||!validClock(item.vormittag)||!validClock(item.abend))continue;
  seen.add(betrieb_id);
  rows.push({betrieb_id,vormittag:item.vormittag,abend:item.abend,bestaetigt:item.bestaetigt===true});
 }
 rows.sort((left,right)=>left.betrieb_id<right.betrieb_id?-1:left.betrieb_id>right.betrieb_id?1:0);
 return rows;
}

function historicalTimesForFacility(list,facilityId){
 const found=normalizeHistoricalTimes(list).find(item=>item.betrieb_id===facilityId);
 return found?{vormittag:found.vormittag,abend:found.abend,bestaetigt:found.bestaetigt}:{...defaultHistoricalTimes()};
}

function buildSnapshot({source,readings,decisions,choices,zeiten}){
 const byId=new Map(readings.map(row=>[row.zeilen_id,row]));
 const entscheidungen=[];
 decisions.forEach((decision,id)=>{
  const row=byId.get(id);
  if(!row||!decision?.entscheidung)return;
  entscheidungen.push({
   datensatz_id:recordId(row),
   quelle_blatt:row.quelle_blatt,
   quelle_zelle:row.quelle_zelle,
   zaehler_schluessel:row.zaehler_schluessel,
   zaehlerstand:row.zaehlerstand,
   entscheidung:decision.entscheidung,
   korrigierter_zaehlerstand:decision.entscheidung==="korrigiert"?String(decision.korrigierter_zaehlerstand||""):"",
   begruendung:String(decision.begruendung||"")
  });
 });
 entscheidungen.sort((left,right)=>left.datensatz_id<right.datensatz_id?-1:left.datensatz_id>right.datensatz_id?1:0);
 const zaehler=[];
 choices.forEach((choice,key)=>{
  if(!choice?.status||choice.status==="offen")return;
  zaehler.push({
   zaehler_schluessel:key,
   status:choice.status,
   ziel:choice.status==="zusammengefuehrt"?String(choice.ziel||""):""
  });
 });
 zaehler.sort((left,right)=>left.zaehler_schluessel<right.zaehler_schluessel?-1:left.zaehler_schluessel>right.zaehler_schluessel?1:0);
 const hash=source?.hash||"";
 return {
  format:FORMAT,
  version:VERSION,
  inhalt_sha256:hash,
  quelle:{dateiname:source?.name||"",inhalt_sha256:hash,groesse:source?.size||0},
  entscheidungen,
  zaehler,
  ablesezeiten:normalizeHistoricalTimes(zeiten)
 };
}

function rejectSnapshot(grund){
 return {ok:false,grund,entscheidungen:new Map(),zaehler:new Map(),ablesezeiten:[]};
}

function matchSnapshot(snapshot,context){
 if(!snapshot||typeof snapshot!=="object")return rejectSnapshot("Das Format ist ungültig.");
 if(snapshot.format!==FORMAT)return rejectSnapshot("Das Format ist unbekannt.");
 if(snapshot.version!==VERSION)return rejectSnapshot("Die Formatversion wird nicht unterstützt.");
 const hash=snapshot.quelle&&snapshot.quelle.inhalt_sha256;
 if(!hash||hash!==context.hash)return rejectSnapshot("Die Quelldatei stimmt nicht überein.");
 if(snapshot.inhalt_sha256&&snapshot.inhalt_sha256!==hash)return rejectSnapshot("Die Dateikennung im Prüfstand ist widersprüchlich.");
 if(!Array.isArray(snapshot.entscheidungen)||!Array.isArray(snapshot.zaehler))return rejectSnapshot("Der Inhalt ist unvollständig.");
 const byRecord=new Map();
 for(const row of context.readings){
  const id=recordId(row);
  if(byRecord.has(id))return rejectSnapshot("Die Zelladresse "+row.quelle_blatt+" "+row.quelle_zelle+" ist nicht eindeutig.");
  byRecord.set(id,row);
 }
 const meters=new Map(context.meters.map(meter=>[meter.zaehler_schluessel,meter]));
 const entscheidungen=new Map();
 const seen=new Set();
 for(const item of snapshot.entscheidungen){
  if(!item||typeof item!=="object")return rejectSnapshot("Eine Entscheidung ist ungültig.");
  const id=item.datensatz_id;
  if(!id||seen.has(id))return rejectSnapshot("Eine Datensatzkennung fehlt oder ist doppelt.");
  seen.add(id);
  const row=byRecord.get(id);
  if(!row||item.quelle_blatt!==row.quelle_blatt||item.quelle_zelle!==row.quelle_zelle)return rejectSnapshot("Die Datensatzkennung "+(id||"")+" gehört nicht zu dieser Datei.");
  if(item.zaehlerstand!==row.zaehlerstand||item.zaehler_schluessel!==row.zaehler_schluessel)return rejectSnapshot("Der Originalwert von "+row.quelle_blatt+" "+row.quelle_zelle+" weicht ab.");
  if(!DECISIONS.has(item.entscheidung))return rejectSnapshot("Die Entscheidung für "+row.quelle_blatt+" "+row.quelle_zelle+" ist unbekannt.");
  if(item.entscheidung==="korrigiert"&&!String(item.korrigierter_zaehlerstand||"").trim())return rejectSnapshot("Die Korrektur für "+row.quelle_blatt+" "+row.quelle_zelle+" hat keinen Wert.");
  entscheidungen.set(row.zeilen_id,{
   entscheidung:item.entscheidung,
   korrigierter_zaehlerstand:item.entscheidung==="korrigiert"?String(item.korrigierter_zaehlerstand):"",
   begruendung:String(item.begruendung||"")
  });
 }
 const zaehler=new Map();
 const seenMeters=new Set();
 for(const item of snapshot.zaehler){
  if(!item||typeof item!=="object"||!meters.has(item.zaehler_schluessel)||seenMeters.has(item.zaehler_schluessel))return rejectSnapshot("Eine Zählerzuordnung passt nicht zu dieser Datei.");
  seenMeters.add(item.zaehler_schluessel);
  if(!METER_STATUS.has(item.status))return rejectSnapshot("Der Status von "+item.zaehler_schluessel+" ist unbekannt.");
  if(item.status==="zusammengefuehrt"&&(!item.ziel||item.ziel===item.zaehler_schluessel||!meters.has(item.ziel)))return rejectSnapshot("Das Ziel einer Zusammenführung fehlt in dieser Datei.");
  zaehler.set(item.zaehler_schluessel,{status:item.status,ziel:item.status==="zusammengefuehrt"?item.ziel:""});
 }
 return {ok:true,grund:"",entscheidungen,zaehler,ablesezeiten:normalizeHistoricalTimes(snapshot.ablesezeiten)};
}

function recognizedReading(row){
 return !!row&&row.wert_art==="zaehlerstand"&&row.pruefstatus!=="ausgeschlossen";
}

function importStandText(value){
 const text=String(value??"").trim();
 if(!/^[0-9]+([.,][0-9]+)?$/.test(text))return null;
 const normalized=text.replace(",",".");
 if(/\.[0-9]{4,}$/.test(normalized))return null;
 const number=Number(normalized);
 if(!Number.isFinite(number)||number>99999999999.999)return null;
 return number;
}

function validImportDate(value){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value||"")))return false;
 const [year,month,day]=value.split("-").map(Number);
 const date=new Date(Date.UTC(year,month-1,day));
 return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day;
}

function validImportClock(value){
 return /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(String(value||""));
}

function validSheetName(value){
 const text=String(value??"");
 return text.length>=1&&text.length<=100&&!text.includes("!")&&!/[\u0000-\u001F\u007F]/.test(text);
}

function validCell(value){
 return /^[A-Za-z]{1,3}[0-9]{1,7}$/.test(String(value||""));
}

function berlinParts(date){
 const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Berlin",hourCycle:"h23",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"}).formatToParts(date);
 const read=type=>Number(parts.find(part=>part.type===type)?.value);
 let hour=read("hour");
 if(hour===24)hour=0;
 return {year:read("year"),month:read("month"),day:read("day"),hour,minute:read("minute"),second:read("second")};
}

function berlinInstant(dateText,clock){
 const [year,month,day]=dateText.split("-").map(Number);
 const [hour,minute,second=0]=clock.split(":").map(Number);
 const intended=Date.UTC(year,month-1,day,hour,minute,second);
 let utc=intended;
 for(let step=0;step<2;step++){
  const wall=berlinParts(new Date(utc));
  utc+=intended-Date.UTC(wall.year,wall.month-1,wall.day,wall.hour,wall.minute,wall.second);
 }
 return new Date(utc);
}

function activeMapping(mappings,facilityId,key){
 return (mappings||[]).find(row=>row&&row.facility_id===facilityId&&row.excel_schluessel===key&&!row.revoked_at&&row.meter_id)||null;
}

function planHistoricalPayload({readings,decisions,choices,facilityId,timeEntry,mappings,mappingState,meters}){
 const reviewed=reviewRows(readings||[],decisions||new Map(),choices||new Map());
 const recognized=reviewed.filter(recognizedReading);
 const counts={erkannt:recognized.length,bestaetigt:0,korrigiert:0,ausgeschlossen:0,offen:0,vorbereitet:0,zuordnungFehlt:mappingState==="ready"?0:null};
 const sperren=[];
 const hinweise=[];
 const ids=new Map();
 recognized.forEach(row=>{
  const id=recordId(row);
  ids.set(id,(ids.get(id)||0)+1);
 });
 if(!facilityId)sperren.push("Ein Betrieb ist nicht ausgewählt.");
 const timesReady=historicalPreviewReady(timeEntry);
 if(facilityId&&!timesReady)sperren.push("Die Uhrzeiten sind für diesen Betrieb und diese Datei nicht bestätigt.");
 if(facilityId&&mappingState==="loading")sperren.push("Die Zählerzuordnungen dieses Betriebs werden noch geladen.");
 if(facilityId&&mappingState==="error")sperren.push("Die gespeicherten Zählerzuordnungen konnten nicht geladen werden.");
 const meterIds=new Set((meters||[]).map(meter=>meter.id));
 const missingKeys=new Set();
 const payload=[];
 recognized.forEach(row=>{
  const label=row.quelle_blatt+" "+row.quelle_zelle;
  let bucket="offen";
  if(row.entscheidung==="ausgeschlossen")bucket="ausgeschlossen";
  else if(row.entscheidung==="zurueckgestellt"||row.pruef_offen==="ja")bucket="offen";
  else if(row.entscheidung==="korrigiert")bucket="korrigiert";
  else if(row.entscheidung==="bestaetigt"||row.entscheidung==="")bucket="bestaetigt";
  counts[bucket]+=1;
  if(bucket==="offen"){
   hinweise.push(label+": Die Prüfentscheidung ist noch offen.");
   return;
  }
  if(bucket==="ausgeschlossen")return;
  const id=recordId(row);
  if((ids.get(id)||0)>1){
   hinweise.push(label+": Die Herkunft "+id+" ist mehrfach vorhanden.");
   return;
  }
  if(!validSheetName(row.quelle_blatt)||!validCell(row.quelle_zelle)||id!==row.quelle_blatt+"!"+row.quelle_zelle){
   hinweise.push(label+": Blatt oder Zelle ist ungültig.");
   return;
  }
  if(row.datum_genauigkeit!=="tag"||!validImportDate(row.ablesedatum)){
   hinweise.push(label+": Das Ablesedatum ist ungültig.");
   return;
  }
  if(row.ablesezeitraum!=="vormittag"&&row.ablesezeitraum!=="abend"){
   hinweise.push(label+": Der Ablesezeitraum muss Vormittag oder Abend sein.");
   return;
  }
  const time=historicalTimeForRow(row,timesReady?timeEntry:null);
  if(timesReady&&(!validImportClock(time.bestaetigte_uhrzeit)||(time.uhrzeit_angenommen!==true&&time.uhrzeit_angenommen!==false))){
   hinweise.push(label+": Die bestätigte Uhrzeit ist ungültig.");
   return;
  }
  if(timesReady&&validImportClock(time.bestaetigte_uhrzeit)&&berlinInstant(row.ablesedatum,time.bestaetigte_uhrzeit).getTime()>Date.now()+5*60*1000){
   hinweise.push(label+": Der Zeitpunkt liegt in der Zukunft.");
   return;
  }
  const correction=String(row.korrigierter_zaehlerstand||"").trim();
  const stand=bucket==="korrigiert"?correction:row.zaehlerstand;
  if(bucket==="korrigiert"&&!correction){
   hinweise.push(label+": Die Korrektur hat keinen Wert.");
   return;
  }
  if(importStandText(stand)==null){
   hinweise.push(label+": Der Zählerstand ist ungültig oder hat mehr als drei Nachkommastellen.");
   return;
  }
  if(String(row.zaehlerstand??"").length<1||String(row.zaehlerstand??"").length>200||correction.length>200){
   hinweise.push(label+": Der Zählerstand ist zu lang.");
   return;
  }
  const reason=String(row.begruendung||"").trim();
  const hint=String(row.pruefhinweis||"").trim();
  if(reason.length>2000||hint.length>2000){
   hinweise.push(label+": Begründung oder Prüfhinweis ist zu lang.");
   return;
  }
  const key=seriesKey(row,choices);
  if(!key||String(key).trim().length<1||String(key).length>200){
   hinweise.push(label+": Der Zählerschlüssel fehlt.");
   return;
  }
  if(mappingState==="ready"){
   const mapping=activeMapping(mappings,facilityId,key);
   if(!mapping||(Array.isArray(meters)&&!meterIds.has(mapping.meter_id))){
    missingKeys.add(key);
    hinweise.push(label+": Für "+key+" fehlt eine gültige Zählerzuordnung.");
    return;
   }
  }
  counts.vorbereitet+=1;
  if(!timesReady||mappingState!=="ready"||sperren.length)return;
  const item={
   excel_schluessel:key,
   datensatz_id:id,
   quelle_blatt:row.quelle_blatt,
   quelle_zelle:row.quelle_zelle,
   original_zaehlerstand:row.zaehlerstand,
   entscheidung:bucket,
   ablesedatum:row.ablesedatum,
   ablesezeitraum:time.ablesezeitraum,
   uhrzeit_bestaetigt:true,
   bestaetigte_uhrzeit:time.bestaetigte_uhrzeit,
   uhrzeit_angenommen:time.uhrzeit_angenommen
  };
  if(bucket==="korrigiert")item.korrigierter_zaehlerstand=correction;
  if(reason)item.begruendung=reason;
  if(hint)item.pruefhinweis=hint;
  payload.push(item);
 });
 counts.zuordnungFehlt=mappingState==="ready"?missingKeys.size:null;
 if(counts.offen>0)sperren.push(counts.offen===1?"Eine Ablesung ist noch ungeprüft. Sie bleibt offen und wird nicht als ausgeschlossen behandelt.":counts.offen+" Ablesungen sind noch ungeprüft. Sie bleiben offen und werden nicht als ausgeschlossen behandelt.");
 if(missingKeys.size)sperren.push(missingKeys.size===1?"Für einen Excel-Zähler fehlt die gespeicherte Zuordnung.":"Für "+missingKeys.size+" Excel-Zähler fehlt die gespeicherte Zuordnung.");
 if(hinweise.some(item=>!item.endsWith("Die Prüfentscheidung ist noch offen.")))sperren.push("Mindestens eine Ablesung erfüllt die Importprüfung nicht.");
 if(payload.length>IMPORT_LIMIT)sperren.push("Der Import enthält mehr als 10.000 Datensätze.");
 if(!sperren.length&&payload.length===0)sperren.push("Es ist keine Ablesung für den Import vorbereitet.");
 const ready=sperren.length===0&&payload.length>0&&payload.length<=IMPORT_LIMIT;
 return {ready,payload:ready?payload:null,counts,sperren:[...new Set(sperren)],hinweise};
}

function previewNumber(value){
 if(value==null||value==="")return null;
 const number=typeof value==="number"?value:Number(value);
 return Number.isFinite(number)?number:null;
}

function previewDifference(bisher,danach){
 const left=previewNumber(bisher);
 const right=previewNumber(danach);
 if(left==null||right==null)return null;
 return Math.round((right-left)*1000)/1000;
}

function splitRecordId(value){
 const text=String(value||"");
 const mark=text.indexOf("!");
 if(mark<1||mark===text.length-1)return {blatt:"",zelle:""};
 return {blatt:text.slice(0,mark),zelle:text.slice(mark+1)};
}

function normalizePreviewResult(data){
 if(!data||typeof data!=="object"||Array.isArray(data))return {ok:false,message:"Die Importvorschau hat keine auswertbare Antwort geliefert."};
 const uebernehmbar=previewNumber(data.uebernehmbar);
 const blockiert=previewNumber(data.blockiert);
 if(uebernehmbar==null||blockiert==null||!Number.isInteger(uebernehmbar)||!Number.isInteger(blockiert)||typeof data.schreibbar!=="boolean"||!Array.isArray(data.zeilen)||!Array.isArray(data.verbrauchsauswirkungen))return {ok:false,message:"Die Importvorschau hat eine unvollständige Antwort geliefert."};
 const blocked=[];
 for(const row of data.zeilen){
  if(!row||row.status!=="blockiert")continue;
  const place=splitRecordId(row.datensatz_id);
  const gruende=Array.isArray(row.gruende)?row.gruende.map(item=>String(item||"").trim()).filter(Boolean):[];
  blocked.push({datensatz_id:String(row.datensatz_id||""),blatt:place.blatt,zelle:place.zelle,gruende});
 }
 const effects=data.verbrauchsauswirkungen.map(row=>{
  const bisher=previewNumber(row?.bisher);
  const danach=previewNumber(row?.danach);
  return {reading_id:row?.reading_id?String(row.reading_id):"",bisher,danach,differenz:previewDifference(bisher,danach)};
 });
 return {ok:true,uebernehmbar,blockiert,schreibbar:data.schreibbar===true,blocked,effects};
}

function preparePreviewCall({plan,permission}){
 if(permission)return {call:false,message:permission};
 if(!plan?.ready||!Array.isArray(plan.payload)||!plan.payload.length)return {call:false,message:"Importvorschau gesperrt."};
 return {call:true,message:""};
}

function acceptPreviewResponse({sentKey,currentKey,sentSeq,currentSeq}){
 return !!sentKey&&sentKey===currentKey&&sentSeq===currentSeq;
}

function previewErrorMessage(error){
 const text=String(error?.message||error||"").trim();
 const code=String(error?.code||"");
 if(code==="57014"||/statement timeout|canceling statement/i.test(text))return "Die Importvorschau hat das Zeitlimit erreicht. Es wurde nichts gespeichert. Die Ablesungen werden nicht auf mehrere Vorgänge aufgeteilt.";
 if(/Failed to fetch|NetworkError|Load failed|network/i.test(text))return "Die Verbindung zur Importvorschau ist abgebrochen. Es wurde nichts gespeichert.";
 if(code==="42501"||/permission denied/i.test(text)||/Betriebsleitung oder Geschäftsführung/.test(text))return "Historische Importe darf die Betriebsleitung oder Geschäftsführung.";
 if(text)return text;
 return "Die Importvorschau konnte nicht ausgeführt werden. Es wurde nichts gespeichert.";
}

const COMMIT_TOKEN=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function prepareCommitCall({permission,confirmed,busy,preview,plan,planKey,hash,fileName}){
 if(busy)return {call:false,message:"Die Übernahme läuft bereits."};
 if(permission)return {call:false,message:permission};
 if(!confirmed)return {call:false,message:"Die Übernahme muss ausdrücklich bestätigt werden."};
 if(!preview?.ok||preview.key!==planKey)return {call:false,message:"Die Vorschau ist veraltet. Bitte die Importvorschau erneut ausführen."};
 if(preview.schreibbar!==true||preview.blockiert!==0)return {call:false,message:"Die Vorschau gibt den Import nicht frei. Es wird nichts gespeichert."};
 if(!plan?.ready||!Array.isArray(plan.payload)||!plan.payload.length)return {call:false,message:"Die Übernahme bleibt gesperrt."};
 const fileHash=String(hash||"").toLowerCase();
 if(!/^[0-9a-f]{64}$/.test(fileHash))return {call:false,message:"Die Dateikennung ist kein SHA-256."};
 const name=String(fileName||"").trim();
 if(name.length<1||name.length>500)return {call:false,message:"Der Dateiname fehlt oder ist zu lang."};
 const token=String(preview.token||"");
 if(!COMMIT_TOKEN.test(token))return {call:false,message:"Die Importkennung fehlt."};
 return {call:true,message:"",token,hash:fileHash,fileName:name,payload:plan.payload};
}

function normalizeCommitResult(data){
 let parsed=data;
 if(typeof data==="string"){
  try{parsed=JSON.parse(data);}catch{parsed=null;}
 }
 if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))return {ok:false,message:"Die Übernahme hat keine auswertbare Antwort geliefert."};
 const zeilen=previewNumber(parsed.zeilen);
 if(parsed.status!=="uebernommen"||zeilen==null||!Number.isInteger(zeilen)||zeilen<1||typeof parsed.batch_id!=="string"||!COMMIT_TOKEN.test(parsed.batch_id)||typeof parsed.erneut!=="boolean")return {ok:false,message:"Die Übernahme hat eine unvollständige Antwort geliefert."};
 return {ok:true,status:"uebernommen",batchId:parsed.batch_id,zeilen,erneut:parsed.erneut===true};
}

function commitErrorMessage(error){
 const text=String(error?.message||error||"").trim();
 const code=String(error?.code||"");
 if(code==="57014"||/statement timeout|canceling statement/i.test(text))return "Die Übernahme hat das Zeitlimit erreicht. Es wurde nichts gespeichert. Bitte die Importvorschau erneut ausführen, bevor ein neuer Versuch gestartet wird.";
 if(/Failed to fetch|NetworkError|Load failed|network/i.test(text))return "Die Verbindung zur Übernahme ist abgebrochen. Bitte die Verbrauchsanzeige prüfen, bevor ein neuer Versuch gestartet wird.";
 if(code==="42501"||/permission denied/i.test(text)||/Betriebsleitung oder Geschäftsführung/.test(text))return "Historische Importe darf die Betriebsleitung oder Geschäftsführung.";
 if(text)return text;
 return "Die Übernahme konnte nicht ausgeführt werden. Es wurde nichts gespeichert.";
}

function commitRefreshesConsumption(result){
 return !!(result&&result.ok&&result.status==="uebernommen");
}

async function runHistoricalCommit({decision,facilityId,rpc}){
 if(!decision?.call)return {ok:false,called:false,message:decision?.message||"Die Übernahme bleibt gesperrt.",refresh:false};
 const response=await rpc("tageswerk_commit_historical_import",{
  p_facility_id:facilityId,
  p_client_token:decision.token,
  p_inhalt_sha256:decision.hash,
  p_dateiname:decision.fileName,
  p_payload:decision.payload
 });
 if(response?.error)return {ok:false,called:true,message:commitErrorMessage(response.error),refresh:false};
 const normalized=normalizeCommitResult(response?.data);
 if(!normalized.ok)return {ok:false,called:true,message:normalized.message,refresh:false};
 return {ok:true,called:true,result:normalized,message:"",refresh:commitRefreshesConsumption(normalized)};
}

export {FORMAT,VERSION,IMPORT_LIMIT,recordId,sha256Hex,buildSnapshot,matchSnapshot,validClock,defaultHistoricalTimes,reviseHistoricalTimes,historicalPreviewReady,historicalTimeForRow,historicalTimesForFacility,normalizeHistoricalTimes,importStandText,planHistoricalPayload,normalizePreviewResult,preparePreviewCall,acceptPreviewResponse,previewErrorMessage,prepareCommitCall,normalizeCommitResult,commitErrorMessage,commitRefreshesConsumption,runHistoricalCommit};
