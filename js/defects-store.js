import {supabase} from './supabase.js';

const DEFECT_COLUMNS = 'id,title,description,priority,status,facility_id,organization_id,assigned_to,created_at,resolution_due_at,resolved_at,archived_at,archived_by';
const PAGE_SIZE = 500;

export async function fetchDefectRows() {
 const rows = [];
 const seen = new Set();
 let from = 0;
 while (true) {
  const to = from + PAGE_SIZE - 1;
  const {data, error} = await supabase
   .from('defects')
   .select(DEFECT_COLUMNS)
   .order('created_at', {ascending: false})
   .order('id', {ascending: false})
   .range(from, to);
  if (error) return {data: null, error};
  const page = data || [];
  for (const row of page) {
   if (!row?.id || seen.has(row.id)) continue;
   seen.add(row.id);
   rows.push(row);
  }
  if (page.length < PAGE_SIZE) break;
  from += PAGE_SIZE;
 }
 return {data: rows, error: null};
}

export async function insertDefectRow(payload) {
 return supabase.from('defects').insert(payload);
}

export async function updateDefectRow(defectId, patch) {
 return supabase.from('defects').update(patch).eq('id', defectId);
}

export async function employeeUpdateAssignedDefect(defectId, status, note) {
 return supabase.rpc('employee_update_assigned_defect', {
  p_defect_id: defectId,
  p_status: status,
  p_note: note
 });
}

export async function archiveClosedDefectsForFacility(facilityId) {
 return supabase.rpc('tageswerk_archive_closed_defects', {p_facility_id: facilityId});
}

export async function archiveDefectById(defectId) {
 return supabase.rpc('tageswerk_archive_defect', {p_defect_id: defectId});
}

export async function restoreArchivedDefect(defectId) {
 return supabase.rpc('tageswerk_restore_archived_defect', {p_defect_id: defectId});
}

export async function fetchDefectEvents(defectId) {
 return supabase
  .from('defect_events')
  .select('created_at,action,note,actor_id')
  .eq('defect_id', defectId)
  .order('created_at', {ascending: false})
  .limit(8);
}
