import {supabase} from './supabase.js';
import {state} from './state.js';
import {status} from './utils.js';

export function isManager(facility){return state.myMemberships.some(m=>m.is_active!==false&&m.organization_id===facility.organization_id&&(m.role==='company_admin'||(m.role==='facility_manager'&&m.facility_id===facility.id)))}

export async function loadPermissionData(){
 const [members,people]=await Promise.all([
  supabase.from('memberships').select('user_id,organization_id,facility_id,role,is_active'),
  supabase.from('profiles').select('id,full_name')
 ]);
 if(members.error)throw members.error;
 if(people.error)throw people.error;
 state.myMemberships=(members.data||[]).filter(m=>m.user_id===state.currentUser?.id&&m.is_active!==false);
 const profiles=new Map((people.data||[]).map(p=>[p.id,p.full_name]));
 state.staff=(members.data||[]).map(m=>({...m,name:profiles.get(m.user_id)||'Mitarbeiter '+m.user_id.slice(0,8)}));
 const managerFacilities=state.accessibleFacilities.filter(isManager);
 if(managerFacilities.length){
  const {data,error}=await supabase.rpc('list_facility_employees');
  if(error){status('Mitarbeiterübersicht konnte nicht geladen werden: '+error.message,true)}
  else{
   const orgByFacility=new Map(state.accessibleFacilities.map(f=>[f.id,f.organization_id]));
   for(const p of data||[]){
    const index=state.staff.findIndex(m=>m.user_id===p.user_id&&m.facility_id===p.facility_id&&m.role===p.role);
    const record={user_id:p.user_id,organization_id:orgByFacility.get(p.facility_id),facility_id:p.facility_id,role:p.role,name:p.full_name||profiles.get(p.user_id)||'Mitarbeiter '+p.user_id.slice(0,8),email:p.email,is_active:p.is_active};
    if(index>=0)state.staff[index]={...state.staff[index],...record};else state.staff.push(record);
   }
  }
 }
 return managerFacilities;
}
