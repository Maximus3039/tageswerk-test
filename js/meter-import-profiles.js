const PROFILES=[{id:"tageszeit_zweizeilig",label:"Zwei Zeilen je Tag (Vormittag/Abend)"}];

const MONTHS={
 jan:1,januar:1,feb:2,februar:2,mar:3,maerz:3,marz:3,maertz:3,
 apr:4,april:4,mai:5,jun:6,juni:6,jul:7,juli:7,aug:8,august:8,
 sep:9,sept:9,september:9,okt:10,oktober:10,nov:11,november:11,dez:12,dezember:12
};

const MEDIA={
 wasser:{verbrauchsart:"Wasser",einheit:"m³"},
 strom:{verbrauchsart:"Strom",einheit:"kWh"},
 fernwaerme:{verbrauchsart:"Wärme",einheit:"kWh",einheitOffen:true},
 waerme:{verbrauchsart:"Wärme",einheit:"kWh",einheitOffen:true},
 erdgas:{verbrauchsart:"Gas",einheit:"m³"},
 gas:{verbrauchsart:"Gas",einheit:"m³"}
};

function fold(value){
 return String(value??"").trim().toLowerCase()
  .replaceAll("ä","ae").replaceAll("ö","oe").replaceAll("ü","ue").replaceAll("ß","ss");
}

function slug(value){
 return fold(value).replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
}

function cellText(cell){
 if(!cell||cell.v==null)return "";
 return String(cell.w??cell.v).trim();
}

function sheetMonth(name){
 const compact=fold(name).replace(/\s+/g,"");
 const match=/^([a-z]+)(\d{2,4})$/.exec(compact);
 if(!match||!MONTHS[match[1]])return null;
 const year=Number(match[2]);
 return {month:MONTHS[match[1]],year:year<100?2000+year:year,label:String(name)};
}

function daysInMonth(year,month){
 return new Date(Date.UTC(year,month,0)).getUTCDate();
}

function excelSerial(serial){
 const date=new Date(Date.UTC(1899,11,30)+Math.round(serial)*86400000);
 return {y:date.getUTCFullYear(),m:date.getUTCMonth()+1,d:date.getUTCDate()};
}

function iso(parts){
 const pad=number=>String(number).padStart(2,"0");
 return parts.y+"-"+pad(parts.m)+"-"+pad(parts.d);
}

function monthToken(token,sheet){
 const key=fold(token).replace(/\./g,"");
 if(MONTHS[key])return MONTHS[key];
 if(key.length<2)return null;
 const values=[...new Set(Object.entries(MONTHS).filter(([name])=>name.startsWith(key)).map(([,value])=>value))];
 if(values.length===1)return values[0];
 if(sheet&&values.includes(sheet.month))return sheet.month;
 return null;
}

function textDate(value,sheet){
 const text=fold(value).replace(/\s+/g," ").trim().replace(/^[a-z]+,?\s*/,"");
 const numeric=/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/.exec(text);
 if(numeric){
  const year=Number(numeric[3]);
  return {y:year<100?2000+year:year,m:Number(numeric[2]),d:Number(numeric[1])};
 }
 const written=/^(\d{1,2})\.?\s+([a-z]+)\.?(?:\s+(\d{2,4}))?$/.exec(text);
 if(!written)return null;
 const month=monthToken(written[2],sheet);
 if(!month)return null;
 let year=written[3]?Number(written[3]):sheet?sheet.year:null;
 if(!year)return null;
 if(written[3]&&year<100)year+=2000;
 if(!written[3]&&sheet&&month<sheet.month)year=sheet.year+1;
 return {y:year,m:month,d:Number(written[1])};
}

function dayMarker(cell,sheet){
 if(!cell||cell.v==null||cell.v==="")return null;
 if(typeof cell.v==="number"&&Number.isFinite(cell.v)){
  if(cell.v>20000)return {kind:"serial",parts:excelSerial(cell.v)};
  if(!cell.f&&Number.isInteger(cell.v)&&cell.v>=1&&cell.v<=31)return {kind:"day",value:cell.v};
 }
 if(typeof cell.v==="string"&&!cell.f){
  const parts=textDate(cell.v,sheet);
  if(parts&&parts.d>=1&&parts.d<=31)return {kind:"calendar",parts};
  if(/^([1-9]|[12]\d|3[01])$/.test(cell.v.trim()))return {kind:"day",value:Number(cell.v.trim())};
 }
 return null;
}

function groupMedium(text){
 const key=fold(text).replace(/\s+/g," ").trim();
 for(const name of ["fernwaerme","erdgas","wasser","strom","gas"]){
  if(key!==name&&!key.startsWith(name+" "))continue;
  const rest=key.slice(name.length).trim();
  const number=/^(\d+(?:[.,]\d+)?)$/.exec(rest);
  return {...MEDIA[name],gruppe:name,nummer:number?number[1].replace(",","."):""};
 }
 return null;
}

function headerKind(text){
 const raw=String(text??"").trim();
 const key=fold(raw);
 if(!raw)return "leer";
 if(key==="verbrauch")return "verbrauch";
 if(key==="x60"||key==="x 60")return "faktor";
 if(/^t\s*halle$/.test(key))return "notiz";
 if(!/[a-z]/i.test(key))return "zahl";
 if(groupMedium(raw))return "medium";
 return "zaehler";
}

function registerOf(label){
 if(/\bNT\b|Niedertarif/i.test(label))return "NT";
 if(/\b(?:HT|HAT)\b|Hochtarif/i.test(label))return "HT";
 return "";
}

function meterNumber(label){
 const match=/(?:HT|HAT|NT)\s*([0-9]+(?:[.,][0-9]+)?)/i.exec(label);
 return match?match[1].replace(",","."):"";
}

function numberText(value){
 const negative=value<0;
 let text=Math.abs(value).toFixed(8);
 if(text.includes("."))text=text.replace(/0+$/,"").replace(/\.$/,"");
 return (negative?"-":"")+text.replace(".",",");
}

function displayNumber(cell){
 if(typeof cell.v==="number"&&Number.isFinite(cell.v))return numberText(cell.v);
 return cellText(cell);
}

function plainDifference(value){
 const rounded=Math.round((value+Number.EPSILON)*1e6)/1e6;
 const text=String(rounded);
 return /e/i.test(text)?rounded.toLocaleString("de-DE",{maximumFractionDigits:6,useGrouping:false}):text.replace(".",",");
}

function decimalPlaces(text){
 const match=/,(\d+)/.exec(String(text).replace(/\./g,""));
 return match?match[1].length:0;
}

function csvField(value){
 const text=value==null?"":String(value);
 const safe=/^[=]/.test(text)?"'"+text:text;
 if(/[;"\n\r]/.test(safe))return '"'+safe.replaceAll('"','""')+'"';
 return safe;
}

function quoteCsv(rows){
 const lines=rows.map(row=>row.map(csvField).join(";"));
 return "\uFEFF"+lines.join("\r\n");
}

function notable(row){
 if(row.wert_art!=="zaehlerstand"||row.pruefstatus==="ausgeschlossen")return false;
 const hints=String(row.pruefhinweis||"").split(";").map(item=>item.trim()).filter(item=>item&&item!=="uhrzeit_unbekannt");
 return hints.length>0;
}

function convertTageszeitZweizeilig(workbook,fileName,XLSX){
 const facility=findFacility(workbook,XLSX);
 const readings=[];
 const meterMap=new Map();
 const sheets=[];
 workbook.SheetNames.forEach((name,sheetIndex)=>{
  const sheet=workbook.Sheets[name];
  const report=readSheet(sheet,name,sheetIndex,fileName,facility,XLSX,readings,meterMap);
  sheets.push(report);
 });
 const meters=[...meterMap.values()];
 markReplacements(meters,readings);
 checkSeries(readings);
 readings.forEach((row,index)=>{row.zeilen_id=String(index+1);});
 readings.forEach(row=>{
  row.vorgaenger_zeile=row._previous?row._previous.zeilen_id:"";
  delete row._previous;
  delete row._sheet;
  delete row._row;
  delete row._value;
 });
 meters.forEach(meter=>{
  meter.anzahl_staende=readings.filter(row=>row.zaehler_schluessel===meter.zaehler_schluessel&&row.wert_art==="zaehlerstand"&&row.pruefstatus!=="ausgeschlossen").length;
  meter.anzahl_pruefung=readings.filter(row=>row.zaehler_schluessel===meter.zaehler_schluessel&&notable(row)).length;
 });
 const stands=readings.filter(row=>row.wert_art==="zaehlerstand"&&row.pruefstatus!=="ausgeschlossen");
 return {
  profile:"tageszeit_zweizeilig",
  readings,
  meters,
  sheets,
  summary:{
   sheets:sheets.length,
   meters:meters.length,
   readings:stands.length,
   notable:readings.filter(notable).length,
   excluded:readings.filter(row=>row.pruefstatus==="ausgeschlossen").length,
   incomplete:sheets.filter(sheet=>sheet.status!=="verarbeitet")
  }
 };
}

function findFacility(workbook,XLSX){
 for(const name of workbook.SheetNames){
  const sheet=workbook.Sheets[name];
  const range=sheet["!ref"]?XLSX.utils.decode_range(sheet["!ref"]):null;
  if(!range)continue;
  for(let row=range.s.r;row<=Math.min(range.e.r,2);row++){
   for(let column=range.s.c;column<=range.e.c;column++){
    const text=cellText(sheet[XLSX.utils.encode_cell({r:row,c:column})]);
    if(/Prignitzer Badewelt/i.test(text))return "Prignitzer Badewelt";
   }
  }
 }
 return "Prignitzer Badewelt";
}

function readSheet(sheet,name,sheetIndex,fileName,facility,XLSX,readings,meterMap){
 const report={name,status:"verarbeitet",hinweis:""};
 const problems=[];
 const warnings=[];
 if(!sheet["!ref"]){
  report.status="unvollstaendig";
  report.hinweis="Das Blatt hat keinen Zellbereich.";
  return report;
 }
 const range=XLSX.utils.decode_range(sheet["!ref"]);
 const month=sheetMonth(name);
 const headerRow=meterHeaderRow(sheet,range,XLSX);
 const mediumRow=mediumHeaderRow(sheet,range,headerRow,XLSX);
 const markers=[];
 if(headerRow!=null){
  for(let row=headerRow+1;row<=range.e.r;row++){
   const marker=dayMarker(sheet[XLSX.utils.encode_cell({r:row,c:0})],month);
   if(marker)markers.push({row,marker});
  }
 }
 if(!markers.length){
  report.status="unvollstaendig";
  report.hinweis=headerRow==null?"Keine Zählerköpfe erkannt.":"Keine Tageszeilen erkannt.";
  return report;
 }
 if(!month&&markers.some(item=>item.marker.kind==="day"))problems.push("Der Blattname nennt keinen Monat, Tageszahlen bleiben ohne Datum.");
 const conflicting=conflictingMonth(sheet,range,XLSX,month);
 if(conflicting)warnings.push(conflicting);
 if(headerRow==null){
  report.status="unvollstaendig";
  report.hinweis=[...problems,"Keine Zählerköpfe erkannt."].join("; ");
  return report;
 }
 const columns=meterColumns(sheet,range,headerRow,mediumRow,XLSX);
 if(!columns.length){
  report.status="unvollstaendig";
  report.hinweis=[...problems,"Keine Zählerspalten erkannt."].join("; ");
  return report;
 }
 const noteColumn=findNoteColumn(sheet,range,headerRow,XLSX);
 const used=new Set();
 let rhythm=false;
 markers.forEach((marker,index)=>{
  const next=markers[index+1];
  const evening=marker.row+1;
  const eveningOk=!next||next.row!==evening;
  if(!eveningOk)rhythm=true;
  const slots=[{row:marker.row,zeitraum:"vormittag"}];
  if(eveningOk&&evening<=range.e.r)slots.push({row:evening,zeitraum:"abend"});
  const date=resolveDate(marker.marker,month);
  slots.forEach(slot=>{
   used.add(slot.row);
   const note=noteColumn==null?"":cellText(sheet[XLSX.utils.encode_cell({r:slot.row,c:noteColumn})]);
   columns.forEach(column=>{
    const address=XLSX.utils.encode_cell({r:slot.row,c:column.column});
    const cell=sheet[address];
    if(!cell||cell.v==null||cell.v==="")return;
    const meter=ensureMeter(meterMap,column,fileName,name,facility);
    readings.push(makeReading({fileName,sheet:name,sheetIndex,address,cell,meter,slot,date,note}));
   });
  });
 });
 let orphans=0;
 for(let row=headerRow+1;row<=range.e.r;row++){
  if(used.has(row))continue;
  columns.forEach(column=>{
   const cell=sheet[XLSX.utils.encode_cell({r:row,c:column.column})];
   if(!cell||cell.f||cell.v==null||cell.v==="")return;
   orphans++;
   const meter=ensureMeter(meterMap,column,fileName,name,facility);
   readings.push(makeReading({
    fileName,sheet:name,sheetIndex,
    address:XLSX.utils.encode_cell({r:row,c:column.column}),
    cell,meter,slot:{zeitraum:"unbekannt"},
    date:{iso:"",genauigkeit:"unbekannt",hint:"datum_unbekannt"},
    note:""
   }));
  });
 }
 if(rhythm)problems.push("Aufeinanderfolgende Tagesmarken, die Abendzeile fehlt.");
 if(orphans)problems.push(orphans+" Werte außerhalb der Tageszeilen");
 if(readings.some(row=>row.quelle_blatt===name&&row.pruefhinweis.includes("datum_ungenau")))warnings.push("Mindestens eine Tageszahl passt nicht in den Monat.");
 if(readings.some(row=>row.quelle_blatt===name&&row.pruefhinweis.includes("datum_blatt_abweichend")))warnings.push("Mindestens ein Datum weicht vom Blattnamen ab.");
 if(problems.length)report.status="unvollstaendig";
 report.hinweis=[...problems,...warnings].join("; ");
 return report;
}

function conflictingMonth(sheet,range,XLSX,month){
 if(!month)return "";
 for(let row=range.s.r;row<=Math.min(range.s.r+1,range.e.r);row++){
  for(let column=1;column<=range.e.c;column++){
   const text=fold(cellText(sheet[XLSX.utils.encode_cell({r:row,c:column})]));
   const found=Object.keys(MONTHS).find(name=>name.length>3&&text===name);
   if(found&&MONTHS[found]!==month.month)return "Eine Titelzelle nennt einen anderen Monat als der Blattname.";
  }
 }
 return "";
}

function meterHeaderRow(sheet,range,XLSX){
 let best=null;
 let score=0;
 for(let row=range.s.r;row<=Math.min(range.e.r,range.s.r+6);row++){
  let count=0;
  for(let column=1;column<=range.e.c;column++){
   const kind=headerKind(cellText(sheet[XLSX.utils.encode_cell({r:row,c:column})]));
   if(kind==="zaehler")count++;
  }
  if(count>score){score=count;best=row;}
 }
 return score>=2?best:null;
}

function mediumHeaderRow(sheet,range,headerRow,XLSX){
 let best=null;
 let score=0;
 for(let row=range.s.r;row<headerRow;row++){
  let count=0;
  for(let column=1;column<=range.e.c;column++){
   if(headerKind(cellText(sheet[XLSX.utils.encode_cell({r:row,c:column})]))==="medium")count++;
  }
  if(count>score){score=count;best=row;}
 }
 return score?best:null;
}

function meterColumns(sheet,range,headerRow,mediumRow,XLSX){
 const columns=[];
 let waterSeen=false;
 for(let column=1;column<=range.e.c;column++){
  const address=XLSX.utils.encode_cell({r:headerRow,c:column});
  const label=cellText(sheet[address]).replace(/\s+/g," ").trim();
  const kind=headerKind(label);
  if(kind!=="zaehler")continue;
  const medium=mediumFor(sheet,mediumRow,column,label,waterSeen,XLSX);
  if(/tauchbecken|technik/i.test(label))waterSeen=true;
  if(fold(label)==="gesamt"&&!waterSeen)waterSeen=true;
  columns.push({column,label,address,medium});
 }
 return columns;
}

function mediumFor(sheet,mediumRow,column,label,waterSeen,XLSX){
 if(mediumRow!=null){
  for(let cursor=column;cursor>=1;cursor--){
   const group=groupMedium(cellText(sheet[XLSX.utils.encode_cell({r:mediumRow,c:cursor})]));
   if(group)return group;
  }
 }
 const key=fold(label);
 if(key==="m3"||key==="m³")return {...MEDIA.erdgas,gruppe:"erdgas"};
 if(key==="waerme"||key==="wärme")return {...MEDIA.waerme,gruppe:"waerme"};
 if(/\b(?:ht|hat|nt)\b/i.test(label))return {...MEDIA.strom,gruppe:"strom"};
 if(/tauchbecken|technik/i.test(label))return {...MEDIA.wasser,gruppe:"wasser"};
 if(fold(label)==="gesamt")return waterSeen?{...MEDIA.strom,gruppe:"strom"}:{...MEDIA.wasser,gruppe:"wasser"};
 return {verbrauchsart:"",einheit:"",einheitOffen:true,gruppe:"unbekannt"};
}

function textNotes(sheet,range,headerRow,column,XLSX){
 let count=0;
 for(let row=headerRow+1;row<=range.e.r;row++){
  const cell=sheet[XLSX.utils.encode_cell({r:row,c:column})];
  if(cell&&typeof cell.v==="string"&&cell.v.trim())count++;
 }
 return count;
}

function findNoteColumn(sheet,range,headerRow,XLSX){
 let labeled=null;
 for(const row of [headerRow,headerRow-1]){
  if(row<range.s.r)continue;
  for(let column=1;column<=range.e.c;column++){
   if(headerKind(cellText(sheet[XLSX.utils.encode_cell({r:row,c:column})]))==="notiz")labeled=column;
  }
 }
 if(labeled==null)return null;
 const next=labeled+1;
 if(next<=range.e.c&&textNotes(sheet,range,headerRow,next,XLSX)>textNotes(sheet,range,headerRow,labeled,XLSX))return next;
 return labeled;
}

function ensureMeter(meterMap,column,fileName,sheetName,facility){
 const label=column.label==="m3"||fold(column.label)==="m3"?"Erdgas":column.label;
 const register=registerOf(label);
 const number=meterNumber(label);
 const key="pbw-"+slug([column.medium.verbrauchsart||"unbekannt",label].join(" "));
 let meter=meterMap.get(key);
 if(!meter){
  meter={
   zaehler_schluessel:key,
   betrieb_name:facility,
   zaehler_bezeichnung:label,
   verbrauchsart:column.medium.verbrauchsart,
   einheit:column.medium.einheit,
   zaehlernummer:number,
   standort:"",
   tarifregister:register,
   tageswerk_betrieb_id:"",
   tageswerk_zaehler_id:"",
   quelle_datei:fileName,
   quelle_blatt:sheetName,
   quelle_zelle:column.address,
   bezeichnungen:column.label,
   anzahl_staende:0,
   anzahl_pruefung:0,
   zuordnung_status:"offen",
   pruefhinweis:column.medium.verbrauchsart?column.medium.einheitOffen?"einheit_nicht_beschriftet":"":"unbekannter_zaehler",
   familie:slug((column.medium.verbrauchsart||"unbekannt")+" "+label.replace(/[0-9.,]+/g,""))
  };
  meterMap.set(key,meter);
 }else if(!meter.bezeichnungen.split("; ").includes(column.label)){
  meter.bezeichnungen+="; "+column.label;
 }
 if(column.medium.nummer){
  const tag=column.medium.verbrauchsart+" "+column.medium.nummer;
  if(!meter.bezeichnungen.split("; ").includes(tag))meter.bezeichnungen+="; "+tag;
 }
 return meter;
}

function resolveDate(marker,month){
 if(marker.kind==="serial"||marker.kind==="calendar"){
  const parts=marker.parts;
  if(parts.d<1||parts.d>daysInMonth(parts.y,parts.m))return {iso:"",genauigkeit:"unbekannt",hint:"datum_ungenau"};
  const hint=month&&(parts.m!==month.month||parts.y!==month.year)?"datum_blatt_abweichend":"";
  return {iso:iso(parts),genauigkeit:"tag",hint};
 }
 if(!month)return {iso:"",genauigkeit:"unbekannt",hint:"datum_unbekannt"};
 if(marker.value>daysInMonth(month.year,month.month))return {iso:"",genauigkeit:"unbekannt",hint:"datum_ungenau"};
 return {iso:iso({y:month.year,m:month.month,d:marker.value}),genauigkeit:"tag",hint:""};
}

function makeReading({fileName,sheet,sheetIndex,address,cell,meter,slot,date,note}){
 const calculated=!!cell.f;
 const numeric=!calculated&&typeof cell.v==="number"&&Number.isFinite(cell.v);
 const hints=[];
 if(date.hint)hints.push(date.hint);
 if(!calculated)hints.push("uhrzeit_unbekannt");
 if(meter.pruefhinweis==="unbekannter_zaehler")hints.push("unbekannter_zaehler");
 const notice=note+" "+meter.zaehler_bezeichnung;
 if(/wechsel|ausbau|einbau|neuzähl|neuzaehl/i.test(notice))hints.push("text_nennt_wechsel");
 if(/rücksetzung|ruecksetzung|\breset\b|auf null/i.test(note))hints.push("text_nennt_ruecksetzung");
 let stand="";
 let status="pruefung";
 if(calculated){
  stand=typeof cell.v==="number"?displayNumber(cell):cellText(cell);
  hints.push("formel_ist_verbrauch");
  status="ausgeschlossen";
 }else if(numeric){
  stand=displayNumber(cell);
  if(cell.v<0)hints.push("negativer_stand");
  if(decimalPlaces(stand)>3)hints.push("zu_viele_nachkommastellen");
 }else{
  stand=cellText(cell);
  hints.push("ungueltige_zahl");
 }
 return {
  zeilen_id:"",
  zaehler_schluessel:meter.zaehler_schluessel,
  ablesedatum:date.iso,
  datum_genauigkeit:date.genauigkeit,
  ablesezeitraum:slot.zeitraum,
  ableseuhrzeit:"",
  uhrzeit_status:"unbekannt",
  import_uhrzeit:"",
  uhrzeit_herkunft:"",
  zaehlerstand:stand,
  wert_art:calculated?"berechneter_verbrauch":"zaehlerstand",
  quelle_datei:fileName,
  quelle_blatt:sheet,
  quelle_zelle:address,
  formel:cell.f?"="+cell.f:"",
  quellenbemerkung:note,
  abrechnungszeitraum:date.iso?date.iso.slice(0,7):"",
  vorgaenger_zeile:"",
  differenz_zum_vorgaenger:"",
  pruefhinweis:[...new Set(hints)].join("; "),
  pruefstatus:status,
  _sheet:sheetIndex,
  _row:Number(address.replace(/^[A-Z]+/,""))||0,
  _value:numeric?cell.v:null
 };
}

function markReplacements(meters,readings){
 const groups=new Map();
 meters.forEach(meter=>{
  if(!meter.tarifregister)return;
  if(!groups.has(meter.familie))groups.set(meter.familie,[]);
  groups.get(meter.familie).push(meter);
 });
 groups.forEach(group=>{
  const names=new Set(group.map(meter=>meter.zaehler_bezeichnung));
  if(names.size<2)return;
  group.forEach(meter=>{
   meter.pruefhinweis=[meter.pruefhinweis,"moeglicher_zaehlerwechsel"].filter(Boolean).join("; ");
   const earliest=readings.find(row=>row.zaehler_schluessel===meter.zaehler_schluessel&&row.wert_art==="zaehlerstand"&&row.datum_genauigkeit==="tag");
   if(earliest)addHint(earliest,"moeglicher_zaehlerwechsel");
  });
 });
}

function checkSeries(readings){
 const groups=new Map();
 readings.forEach(row=>{
  if(row.wert_art!=="zaehlerstand"||row._value==null||row.datum_genauigkeit!=="tag")return;
  if(!groups.has(row.zaehler_schluessel))groups.set(row.zaehler_schluessel,[]);
  groups.get(row.zaehler_schluessel).push(row);
 });
 groups.forEach(rows=>{
  rows.sort((left,right)=>left.ablesedatum<right.ablesedatum?-1:left.ablesedatum>right.ablesedatum?1:(left.ablesezeitraum==="abend")-(right.ablesezeitraum==="abend")||left._sheet-right._sheet||left._row-right._row);
  const seen=new Set();
  const positive=[];
  let previous=null;
  rows.forEach(row=>{
   const key=row.ablesedatum+"|"+row.ablesezeitraum;
   if(seen.has(key)){
    addHint(row,"doppelter_zeitpunkt");
    rows.filter(item=>item!==row&&item.ablesedatum+"|"+item.ablesezeitraum===key).forEach(item=>addHint(item,"doppelter_zeitpunkt"));
   }
   seen.add(key);
   if(previous){
    row.vorgaenger_zeile=previous.zeilen_id||previous.quelle_zelle;
    row._previous=previous;
    const diff=Math.round((row._value-previous._value)*1e6)/1e6;
    row.differenz_zum_vorgaenger=plainDifference(diff);
    if(diff<0)addHint(row,"ruecklaeufig");
    else if(diff>0){
     if(positive.length>=3){
      const ordered=[...positive].sort((a,b)=>a-b);
      const median=ordered[Math.floor((ordered.length-1)/2)];
      if(median>0&&diff>median*10)addHint(row,"auffaelliger_sprung");
     }
     positive.push(diff);
    }
   }
   previous=row;
  });
 });
}

function addHint(row,hint){
 const hints=new Set(String(row.pruefhinweis||"").split(";").map(item=>item.trim()).filter(Boolean));
 hints.add(hint);
 row.pruefhinweis=[...hints].join("; ");
 if(row.pruefstatus!=="ausgeschlossen")row.pruefstatus="pruefung";
}

const READING_COLUMNS=["zeilen_id","zaehler_schluessel","ablesedatum","datum_genauigkeit","ablesezeitraum","ableseuhrzeit","uhrzeit_status","import_uhrzeit","uhrzeit_herkunft","zaehlerstand","wert_art","abrechnungszeitraum","quellenbemerkung","quelle_datei","quelle_blatt","quelle_zelle","formel","vorgaenger_zeile","differenz_zum_vorgaenger","pruefstatus","pruefhinweis"];
const METER_COLUMNS=["zaehler_schluessel","betrieb_name","zaehler_bezeichnung","verbrauchsart","einheit","zaehlernummer","standort","tarifregister","tageswerk_betrieb_id","tageswerk_zaehler_id","quelle_datei","quelle_blatt","quelle_zelle","bezeichnungen","anzahl_staende","anzahl_pruefung","zuordnung_status","pruefhinweis"];

function readingsCsv(readings){
 return quoteCsv([READING_COLUMNS, ...readings.map(row=>READING_COLUMNS.map(column=>row[column]??""))]);
}

function metersCsv(meters){
 return quoteCsv([METER_COLUMNS, ...meters.map(row=>METER_COLUMNS.map(column=>row[column]??""))]);
}

export {PROFILES,convertTageszeitZweizeilig,readingsCsv,metersCsv,notable,READING_COLUMNS,METER_COLUMNS};
