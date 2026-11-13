import {membershipCoversFacility} from './permissions.js';
import {intervalNames,unitNames} from './labels.js';

export const scheduleNames={current:'Aktuell',soon:'Bald fällig',overdue:'Überfällig'};
export const soonWindowMs=3*24*60*60*1000;
export const mediumUnits={electricity:['kWh'],water:['m3'],gas:['kWh','m3'],heat:['kWh','m3']};

export function unitsForMedium(medium){return mediumUnits[medium]||[]}

export function membershipAllowsMeterAdmin(facility,memberships,userId){
 if(!facility||!userId)return false;
 return (memberships||[]).some(m=>m.user_id===userId&&membershipCoversFacility(facility,m,false));
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
 return (memberships||[]).some(m=>m.user_id===userId&&membershipCoversFacility(facility,m,true));
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

export function standError(raw){
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

export function localDateTimeValue(date){
 const pad=n=>String(n).padStart(2,'0');
 return date.getFullYear()+'-'+pad(date.getMonth()+1)+'-'+pad(date.getDate())+'T'+pad(date.getHours())+':'+pad(date.getMinutes());
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

export function formatWhen(value){
 const date=new Date(value);
 if(Number.isNaN(date.getTime()))return null;
 return date.toLocaleString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
}

export function formatAmount(value,unit){
 if(value==null||value==='')return null;
 const number=Number(value);
 if(!Number.isFinite(number))return String(value);
 const text=number.toLocaleString('de-DE',{maximumFractionDigits:3});
 const label=unitNames[unit]||unit||'';
 return label?text+' '+label:text;
}

export function thousandths(value){
 const raw=String(value??'').trim().replace(',','.');
 if(!/^\d+(\.\d{1,3})?$/.test(raw))return null;
 const [whole,fraction='']=raw.split('.');
 return BigInt(whole)*1000n+BigInt((fraction+'000').slice(0,3));
}

export function thousandthsText(total){
 const whole=total/1000n;
 const fraction=(total%1000n).toString().padStart(3,'0').replace(/0+$/,'');
 return fraction?whole.toString()+'.'+fraction:whole.toString();
}

export function countsInFacilityTotal(row){
 return row.is_main_meter===true&&row.counts_in_facility_total===true&&(row.parent_meter_id==null||row.parent_meter_id==='');
}

export function periodType(row){
 if(row.is_main_meter===true&&(row.parent_meter_id==null||row.parent_meter_id===''))return 'Hauptzähler';
 if(row.is_main_meter===false||row.parent_meter_id)return 'Unterzähler';
 return 'Zuordnung unklar';
}

export function measuredSummary(rows){
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

export function acceptPeriod(row,facilityId,medium,meterId){
 return !!row&&row.facility_id===facilityId&&row.medium===medium&&(!meterId||row.meter_id===meterId);
}

export function meterChartType(periods){
 const types=new Set(periods.map(periodType));
 if(types.size===1)return [...types][0];
 return 'Zuordnung unklar';
}

export function unitRank(unit){
 if(unit==='kWh')return 0;
 if(unit==='m3')return 1;
 return 2;
}

export function chartMeters(rows){
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

export function berlinToday(){
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
 const read=type=>Number(parts.find(part=>part.type===type)?.value);
 return {y:read('year'),m:read('month'),d:read('day')};
}

export function dateKey(date){
 return String(date.y).padStart(4,'0')+'-'+String(date.m).padStart(2,'0')+'-'+String(date.d).padStart(2,'0');
}

export function parseDateKey(value){
 const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value||''));
 if(!match)return null;
 const date={y:Number(match[1]),m:Number(match[2]),d:Number(match[3])};
 const check=new Date(Date.UTC(date.y,date.m-1,date.d));
 if(check.getUTCFullYear()!==date.y||check.getUTCMonth()!==date.m-1||check.getUTCDate()!==date.d)return null;
 return date;
}

export function compareDates(left,right){
 if(left.y!==right.y)return left.y<right.y?-1:1;
 if(left.m!==right.m)return left.m<right.m?-1:1;
 if(left.d!==right.d)return left.d<right.d?-1:1;
 return 0;
}

export function addDays(date,days){
 const next=new Date(Date.UTC(date.y,date.m-1,date.d+days));
 return {y:next.getUTCFullYear(),m:next.getUTCMonth()+1,d:next.getUTCDate()};
}

export function addMonths(date,months){
 const index=date.m-1+months;
 const year=date.y+Math.floor(index/12);
 const month=((index%12)+12)%12;
 const last=new Date(Date.UTC(year,month+1,0)).getUTCDate();
 return {y:year,m:month+1,d:Math.min(date.d,last)};
}

export function trendSlots(from,to,grain){
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

export function formatTrendBucket(bucket,grain){
 const [y,m,d]=bucket.split('-').map(Number);
 const date=new Date(Date.UTC(y,(m||1)-1,d||1));
 if(grain==='year')return String(y);
 if(grain==='month')return new Intl.DateTimeFormat('de-DE',{month:'long',year:'numeric',timeZone:'UTC'}).format(date);
 return new Intl.DateTimeFormat('de-DE',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'UTC'}).format(date);
}

export function formatTrendAxis(bucket,grain){
 const [y,m,d]=bucket.split('-').map(Number);
 const date=new Date(Date.UTC(y,(m||1)-1,d||1));
 if(grain==='year')return String(y);
 if(grain==='month')return new Intl.DateTimeFormat('de-DE',{month:'short',timeZone:'UTC'}).format(date);
 return new Intl.DateTimeFormat('de-DE',{day:'2-digit',month:'2-digit',timeZone:'UTC'}).format(date);
}

export function trendQuality(point){
 if(point.invalid)return 'Verbrauch unklar';
 if(point.measured!=null&&point.estimated!=null)return 'Gemischt, zeitanteilig geschätzt';
 if(point.estimated!=null)return 'Geschätzt';
 return 'Gemessen';
}

export function countsForTrend(row){
 return (row.parent_meter_id==null||row.parent_meter_id==='')&&row.counts_in_facility_total===true;
}

export function aggregateTrend(rows,meterSelected){
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

