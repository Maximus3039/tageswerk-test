import {supabase} from './supabase.js';

export const getCurrentUser=()=>supabase.auth.getUser();
export const signInWithPassword=credentials=>supabase.auth.signInWithPassword(credentials);
export const signOut=()=>supabase.auth.signOut();
export const updateUser=attributes=>supabase.auth.updateUser(attributes);
export const resetPasswordForEmail=(email,redirectTo)=>supabase.auth.resetPasswordForEmail(email,{redirectTo});

export async function acceptInvitation(){
 const {data,error}=await supabase.rpc('accept_staff_invitation');
 if(error)throw error;
 if(data?.success)return data;
 // No invitation is a valid outcome for previously registered managers.
 return data;
}
