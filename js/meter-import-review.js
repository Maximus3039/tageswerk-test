const SERIES_HINTS=["ruecklaeufig","auffaelliger_sprung","doppelter_zeitpunkt"];
const REVIEW_EXTRA=["korrigierter_zaehlerstand","entscheidung","begruendung","pruef_offen","plausibilitaet_neu","quelle_zelle"];

function hintsOf(row){
 return String(row?.pruefhinweis||"").split(";").map(item=>item.trim()).filter(Boolean);
}

function substantiveHints(row){
 return hintsOf(row).filter(hint=>hint!=="uhrzeit_unbekannt");
}

function needsReview(row){
 return row?.wert_art==="zaehlerstand"&&row.pruefstatus==="pruefung"&&substantiveHints(row).length>0;
}

function parseStand(value){
 const raw=String(value??"").trim();
 if(!raw)return null;
 const grouped=/^[+-]?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/;
 const comma=/^[+-]?\d+(?:,\d+)?$/;
 const dot=/^[+-]?\d+(?:\.\d+)?$/;
 if(!grouped.test(raw)&&!comma.test(raw)&&!dot.test(raw))return null;
 const normalized=raw.includes(",")?raw.replaceAll(".","").replace(",","."):raw;
 const number=Number(normalized);
 return Number.isFinite(number)?number:null;
}

function formatStand(value){
 const negative=value<0;
 let text=Math.abs(value).toFixed(6).replace(/0+$/,"").replace(/\.$/,"");
 return (negative?"-":"")+text.replace(".",",");
}

function decisionOf(decisions,id){
 return decisions?.get?.(id)||decisions?.[id]||null;
}

function meterChoice(choices,key){
 return choices?.get?.(key)||choices?.[key]||null;
}

function seriesKey(row,choices){
 const choice=meterChoice(choices,row.zaehler_schluessel);
 if(choice?.status==="zusammengefuehrt"&&choice.ziel)return choice.ziel;
 return row.zaehler_schluessel;
}

function effective(row,decision){
 if(row.wert_art!=="zaehlerstand")return {include:false,reason:"keine_ablesung"};
 if(decision?.entscheidung==="ausgeschlossen")return {include:false,reason:"ausgeschlossen"};
 if(decision?.entscheidung==="korrigiert"){
  const value=parseStand(decision.korrigierter_zaehlerstand);
  if(value==null)return {include:false,reason:"ungueltige_korrektur"};
  if(row.datum_genauigkeit!=="tag")return {include:false,reason:"ohne_datum",value};
  return {include:true,value,corrected:true};
 }
 const value=parseStand(row.zaehlerstand);
 if(value==null||row.datum_genauigkeit!=="tag")return {include:false,reason:"ohne_zahl"};
 return {include:true,value,corrected:false};
}

function analyzeReview(readings,decisions,choices){
 const analysis=new Map();
 const groups=new Map();
 readings.forEach(row=>{
  const state=effective(row,decisionOf(decisions,row.zeilen_id));
  if(!state.include)return;
  const key=seriesKey(row,choices);
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push({row,value:state.value});
 });
 groups.forEach(items=>{
  items.sort((left,right)=>left.row.ablesedatum<right.row.ablesedatum?-1:left.row.ablesedatum>right.row.ablesedatum?1:(left.row.ablesezeitraum==="abend")-(right.row.ablesezeitraum==="abend")||Number(left.row.zeilen_id)-Number(right.row.zeilen_id));
  const seen=new Map();
  const positive=[];
  let previous=null;
  items.forEach(item=>{
   const hints=[];
   const stamp=item.row.ablesedatum+"|"+item.row.ablesezeitraum;
   if(seen.has(stamp)){
    hints.push("doppelter_zeitpunkt");
    const earlier=analysis.get(seen.get(stamp));
    if(earlier&&!earlier.hints.includes("doppelter_zeitpunkt"))earlier.hints.push("doppelter_zeitpunkt");
   }else seen.set(stamp,item.row.zeilen_id);
   let diff="";
   if(previous){
    const delta=Math.round((item.value-previous.value)*1e6)/1e6;
    diff=formatStand(delta);
    if(delta<0)hints.push("ruecklaeufig");
    else if(delta>0){
     if(positive.length>=3){
      const ordered=[...positive].sort((a,b)=>a-b);
      const median=ordered[Math.floor((ordered.length-1)/2)];
      if(median>0&&delta>median*10)hints.push("auffaelliger_sprung");
     }
     positive.push(delta);
    }
   }
   analysis.set(item.row.zeilen_id,{hints,diff,value:item.value,previous:previous?.row.zeilen_id||""});
   previous={row:item.row,value:item.value};
  });
 });
 readings.forEach(row=>{
  if(analysis.has(row.zeilen_id))return;
  const state=effective(row,decisionOf(decisions,row.zeilen_id));
  analysis.set(row.zeilen_id,{hints:[],diff:"",value:state.value??null,previous:"",reason:state.reason||""});
 });
 return analysis;
}

function seriesHints(row){
 return substantiveHints(row).filter(hint=>SERIES_HINTS.includes(hint));
}

function describeChange(oldHints,newHints){
 const messages=[];
 if(oldHints.includes("ruecklaeufig")&&!newHints.includes("ruecklaeufig"))messages.push("Rückgang behoben");
 if(!oldHints.includes("ruecklaeufig")&&newHints.includes("ruecklaeufig"))messages.push("Neuer Rückgang");
 if(oldHints.includes("auffaelliger_sprung")&&!newHints.includes("auffaelliger_sprung"))messages.push("Sprung behoben");
 if(!oldHints.includes("auffaelliger_sprung")&&newHints.includes("auffaelliger_sprung"))messages.push("Neuer Sprung");
 if(!oldHints.includes("doppelter_zeitpunkt")&&newHints.includes("doppelter_zeitpunkt"))messages.push("Doppelter Zeitpunkt");
 return messages.join("; ");
}

function reviewRows(readings,decisions,choices){
 const analysis=analyzeReview(readings,decisions||new Map(),choices||new Map());
 const byId=new Map(readings.map(row=>[row.zeilen_id,row]));
 return readings.map(row=>{
  const decision=decisionOf(decisions,row.zeilen_id);
  const fresh=analysis.get(row.zeilen_id)||{hints:[],diff:"",previous:""};
  const oldSeries=seriesHints(row);
  const effect=describeChange(oldSeries,fresh.hints);
  const nextEffect=readings.filter(other=>{
   const otherFresh=analysis.get(other.zeilen_id);
   return otherFresh?.previous===row.zeilen_id;
  }).map(other=>{
   const change=describeChange(seriesHints(other),analysis.get(other.zeilen_id)?.hints||[]);
   return change?other.quelle_blatt+" "+other.quelle_zelle+": "+change:"";
  }).filter(Boolean);
  const created=fresh.hints.some(hint=>SERIES_HINTS.includes(hint)&&!oldSeries.includes(hint));
  const open=(needsReview(row)||created)&&(!decision?.entscheidung||decision.entscheidung==="zurueckgestellt");
  return {
   ...row,
   zaehlerstand:row.zaehlerstand,
   korrigierter_zaehlerstand:decision?.entscheidung==="korrigiert"?String(decision.korrigierter_zaehlerstand||""):"",
   entscheidung:decision?.entscheidung||"",
   begruendung:decision?.begruendung||"",
   pruef_offen:open?"ja":needsReview(row)?"nein":"",
   plausibilitaet_neu:fresh.hints.join("; "),
   differenz_neu:fresh.diff,
   auswirkung:[effect,...nextEffect].filter(Boolean).join("; "),
   reihe:fresh.reason||""
  };
 });
}

function dateSpan(readings,key){
 const dates=readings.filter(row=>row.zaehler_schluessel===key&&row.ablesedatum).map(row=>row.ablesedatum).sort();
 return {first:dates[0]||"",last:dates[dates.length-1]||"",count:dates.length};
}

function assessMerge(left,right,readings){
 const blockers=[];
 const warnings=[];
 if(!left||!right)blockers.push("Beide Zähler müssen ausgewählt sein.");
 else if(left.zaehler_schluessel===right.zaehler_schluessel)blockers.push("Ein Zähler kann nicht mit sich selbst zusammengeführt werden.");
 else{
  if(left.verbrauchsart!==right.verbrauchsart)blockers.push("Die Verbrauchsart unterscheidet sich.");
  if(left.einheit!==right.einheit)blockers.push("Die Einheit unterscheidet sich.");
  if((left.tarifregister||"")!==(right.tarifregister||""))blockers.push("Das Tarifregister unterscheidet sich.");
  const leftSpan=dateSpan(readings,left.zaehler_schluessel);
  const rightSpan=dateSpan(readings,right.zaehler_schluessel);
  const overlap=!!(leftSpan.first&&rightSpan.first&&leftSpan.first<=rightSpan.last&&rightSpan.first<=leftSpan.last);
  if(overlap)warnings.push("Die Ablesezeiträume überschneiden sich ("+leftSpan.first+" bis "+leftSpan.last+" und "+rightSpan.first+" bis "+rightSpan.last+").");
 }
 return {blockers,warnings,allowed:blockers.length===0};
}

function mergeImpact(left,right,readings,choices,decisions){
 const assessment=assessMerge(left,right,readings);
 const leftSpan=left?dateSpan(readings,left.zaehler_schluessel):{first:"",last:"",count:0};
 const rightSpan=right?dateSpan(readings,right.zaehler_schluessel):{first:"",last:"",count:0};
 const beispiele=[];
 let neue=0;
 if(left&&right&&left.zaehler_schluessel!==right.zaehler_schluessel){
  const currentDecisions=decisions||new Map();
  const currentChoices=choices||new Map();
  const before=analyzeReview(readings,currentDecisions,currentChoices);
  const next=new Map(currentChoices);
  next.set(left.zaehler_schluessel,{status:"zusammengefuehrt",ziel:right.zaehler_schluessel});
  const after=analyzeReview(readings,currentDecisions,next);
  readings.forEach(row=>{
   const oldHints=before.get(row.zeilen_id)?.hints||[];
   const newHints=after.get(row.zeilen_id)?.hints||[];
   const fresh=SERIES_HINTS.filter(hint=>newHints.includes(hint)&&!oldHints.includes(hint));
   if(!fresh.length)return;
   neue+=1;
   if(beispiele.length<5)beispiele.push(row.quelle_blatt+" "+row.quelle_zelle);
  });
 }
 return {...assessment,left,right,leftSpan,rightSpan,neue,beispiele};
}

function canMerge(left,right,readings,choices,confirmedOverlap,decisions){
 const impact=mergeImpact(left,right,readings,choices,decisions);
 const blockers=[...impact.blockers];
 const leftChoice=meterChoice(choices,left?.zaehler_schluessel);
 const rightChoice=meterChoice(choices,right?.zaehler_schluessel);
 if(leftChoice?.status==="zusammengefuehrt")blockers.push("Die erste Bezeichnung ist bereits zusammengeführt.");
 if(rightChoice?.status==="zusammengefuehrt")blockers.push("Das Ziel ist bereits in eine andere Bezeichnung übergegangen.");
 if(impact.warnings.length&&!confirmedOverlap)blockers.push("Die zeitliche Überschneidung muss ausdrücklich bestätigt werden.");
 return {...impact,blockers,allowed:blockers.length===0};
}

function csvField(value){
 const text=value==null?"":String(value);
 const safe=/^=/.test(text)?"'"+text:text;
 if(/[;"\n\r]/.test(safe))return '"'+safe.replaceAll('"','""')+'"';
 return safe;
}

function reviewReadingsCsv(readings,columns){
 const header=[...columns.filter(column=>column!=="quelle_zelle"),"korrigierter_zaehlerstand","entscheidung","begruendung","pruef_offen","plausibilitaet_neu","quelle_zelle"];
 const lines=[header,...readings.map(row=>header.map(column=>csvField(row[column]??"")))];
 return "\uFEFF"+lines.map(line=>line.join(";")).join("\r\n");
}

function reviewMetersCsv(meters,choices,columns){
 const header=[...columns,"pruefentscheidung","zusammengefuehrt_mit"];
 const lines=[header,...meters.map(meter=>{
  const choice=meterChoice(choices,meter.zaehler_schluessel);
  const view={...meter,pruefentscheidung:choice?.status||"offen",zusammengefuehrt_mit:choice?.status==="zusammengefuehrt"?choice.ziel||"":""};
  return header.map(column=>csvField(view[column]??""));
 })];
 return "\uFEFF"+lines.map(line=>line.join(";")).join("\r\n");
}

export {REVIEW_EXTRA,needsReview,substantiveHints,parseStand,analyzeReview,reviewRows,assessMerge,mergeImpact,canMerge,dateSpan,reviewReadingsCsv,reviewMetersCsv};
