import {supabase} from './supabase.js';
import {meterInsertPayload,meterUpdatePayload} from './meters-domain.js';

export async function fetchFacilityMeters(facilityId){
 if(!facilityId)return [];
 const {data,error}=await supabase.from('utility_meters').select('id,label,meter_number,medium,unit,location,is_active,interval_unit,interval_count,replaces_meter_id').eq('facility_id',facilityId).order('label');
 if(error)throw error;
 return data||[];
}

export function fetchFacilityConsumption(facilityId){
 return supabase.from('utility_meter_consumption').select('meter_id,reading_at,effective_value,consumption_value,reading_type,unit').eq('facility_id',facilityId);
}

export function fetchMeterHistory(meterId,facilityId){
 return supabase.from('utility_meter_consumption').select('reading_id,reading_at,effective_value,consumption_value,reading_type,unit').eq('meter_id',meterId).eq('facility_id',facilityId).order('reading_at',{ascending:false});
}

export function insertReadingRow(payload){
 return supabase.from('utility_meter_readings').insert(payload);
}

export function insertMeter(facilityId,draft){
 return supabase.from('utility_meters').insert(meterInsertPayload(facilityId,draft));
}

export function updateMeter(meterId,facilityId,draft){
 return supabase.from('utility_meters').update(meterUpdatePayload(draft)).eq('id',meterId).eq('facility_id',facilityId).select('id');
}

export function updateMeterActive(meterId,facilityId,active){
 return supabase.from('utility_meters').update({is_active:active}).eq('id',meterId).eq('facility_id',facilityId).eq('is_active',!active).select('id');
}

export function replaceUtilityMeter(args){
 return supabase.rpc('tageswerk_replace_utility_meter',args);
}

export function fetchPeriodMeterOptions(facilityId,medium,from,page){
 return supabase.from('utility_meter_consumption_periods').select('meter_id,meter_label,facility_id,medium').eq('facility_id',facilityId).eq('medium',medium).order('meter_label',{ascending:true}).order('meter_id',{ascending:true}).range(from,from+page-1);
}

export async function fetchPeriodRows(facilityId,medium,meterId,offset,pageSize){
 let request=supabase.from('utility_meter_consumption_periods').select('reading_id,meter_id,meter_label,facility_id,medium,unit,period_start,period_end,consumption_value,parent_meter_id,counts_in_facility_total,is_main_meter').eq('facility_id',facilityId).eq('medium',medium).order('period_end',{ascending:false}).order('reading_id',{ascending:false}).range(offset,offset+pageSize-1);
 if(meterId)request=request.eq('meter_id',meterId);
 return request;
}

export function fetchConsumptionCalendar(args){
 return supabase.rpc('tageswerk_consumption_calendar',args);
}

export function fetchMonthlyConsumption(facilityId,year){
 return supabase.from('utility_monthly_consumption').select('id,facility_id,medium,unit,meter_id,year,month,consumption_value,note,recorded_by,corrected_by,correction_reason,created_at,updated_at').eq('facility_id',facilityId).eq('year',year).order('month');
}

export function insertMonthlyConsumption(payload){
 return supabase.from('utility_monthly_consumption').insert(payload);
}

export function updateMonthlyConsumption(id,facilityId,payload){
 return supabase.from('utility_monthly_consumption').update(payload).eq('id',id).eq('facility_id',facilityId).select('id');
}

export function fetchMonthlyRevisions(consumptionId){
 return supabase.from('utility_monthly_consumption_revisions').select('id,consumption_id,previous_value,previous_note,new_value,new_note,correction_reason,changed_by,changed_at').eq('consumption_id',consumptionId).order('changed_at',{ascending:false});
}
