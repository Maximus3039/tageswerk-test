export const el=id=>document.getElementById(id);
export const show=(id,on)=>el(id).classList.toggle('hidden',!on);
