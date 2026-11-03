const FORMAT="tageswerk-pruefstand";
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

function buildSnapshot({source,readings,decisions,choices}){
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
  zaehler
 };
}

function rejectSnapshot(grund){
 return {ok:false,grund,entscheidungen:new Map(),zaehler:new Map()};
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
 return {ok:true,grund:"",entscheidungen,zaehler};
}

export {FORMAT,VERSION,recordId,sha256Hex,buildSnapshot,matchSnapshot};
