import {createClient} from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const url='https://eqtrifscedpsngsysxvc.supabase.co';
const key='sb_publishable_bvmFCNOdwzdCoDES7KTfdQ_MZWqlSfN';

export const supabase=createClient(url,key,{auth:{detectSessionInUrl:true,autoRefreshToken:true,persistSession:true}});
