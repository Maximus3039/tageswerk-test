export const el=id=>document.getElementById(id);

export function hideFromAssistive(node, hide) {
 if (!node) return;
 const off = Boolean(hide);
 node.toggleAttribute('inert', off);
 if (off) node.setAttribute('aria-hidden', 'true');
 else node.removeAttribute('aria-hidden');
}

export function setHidden(node, hidden) {
 if (!node) return;
 const off = Boolean(hidden);
 node.classList.toggle('hidden', off);
 hideFromAssistive(node, off);
}

export const show=(id,on)=>{
 const node=el(id);
 if (!node) return;
 setHidden(node, !on);
};

export function syncHiddenDialogs() {
 const selector = [
  '#login',
  '#password-request',
  '#password-recovery',
  '#invitation-setup',
  '#app',
  '.view',
  '.capture-sheet',
  '.defect-composer',
  '#mobile-sheet',
  '#consumption-empty'
 ].join(',');
 for (const node of document.querySelectorAll(selector)) {
  hideFromAssistive(node, node.classList.contains('hidden'));
 }
}

export const status=(msg,isError=false)=>{el('status').textContent=msg;el('status').className=isError?'error':'ok'};
