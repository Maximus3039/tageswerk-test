export const el=id=>document.getElementById(id);
export const show=(id,on)=>el(id).classList.toggle('hidden',!on);
export const status=(msg,isError=false)=>{el('status').textContent=msg;el('status').className=isError?'error':'ok'};
