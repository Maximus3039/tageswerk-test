const icons = {
 brand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2 3 7v10l9 5 9-5V7l-9-5Zm0 2.2 6.5 3.6v7.4L12 19.8 5.5 16.2V8.8L12 4.2Z"/></svg>',
 dashboard: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 4h7v7H4V4Zm9 0h7v5h-7V4ZM4 13h7v7H4v-7Zm9 3h7v4h-7v-4Z"/></svg>',
 tasks: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 3h10v2H7V3Zm-2 4h14v14H5V7Zm2 2v10h10V9H7Zm2 2h6v2H9v-2Zm0 4h6v2H9v-2Z"/></svg>',
 capture: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z"/></svg>',
 notices: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3a7 7 0 0 1 7 7v3.2l1.6 2.4H3.4L5 13.2V10a7 7 0 0 1 7-7Zm0 18a3 3 0 0 1-2.8-2h5.6A3 3 0 0 1 12 21Z"/></svg>',
 more: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 11h4v4H5v-4Zm5 0h4v4h-4v-4Zm5 0h4v4h-4v-4Z"/></svg>',
 reports: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 3h9l5 5v13H6V3Zm8 1.5V9h4.5L14 4.5ZM8 12h8v2H8v-2Zm0 4h8v2H8v-2Z"/></svg>',
 inspections: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M10.5 3a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15Zm0 2a5.5 5.5 0 1 0 .01 0ZM16.8 15.4l1.5-1.4 3.8 3.8-1.4 1.5-3.9-3.9Z"/></svg>',
 maintenance: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19 13.1 21 15l-2 2-1.5-1.5a6.5 6.5 0 0 1-3 1.2V19h-3v-2.3a6.5 6.5 0 0 1-3-1.2L7 17 5 15l1.5-1.5A6.5 6.5 0 0 1 5.3 11H3V8h2.3a6.5 6.5 0 0 1 1.2-3L5 3.5 7 1.5l1.5 1.5A6.5 6.5 0 0 1 11.5 2V0h3v2a6.5 6.5 0 0 1 3 1.2L19 1.5 21 3.5 19.5 5a6.5 6.5 0 0 1 1.2 3H23v3h-2.3a6.5 6.5 0 0 1-1.7 2.1ZM13 8a2.5 2.5 0 1 0 .01 0Z"/></svg>',
 procurement: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 4h14l-1.4 8H8.1L7 4Zm.8 11H20v2H7.8v-2ZM6 2H3v2h2l1 5.2L4.2 15H19v-2H7.1l.7-3.8H20L21.4 2H6Zm1 17a1.5 1.5 0 1 0 .01 0Zm10 0a1.5 1.5 0 1 0 .01 0Z"/></svg>',
 temperature: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M11 2h2v11.2a3.5 3.5 0 1 1-2 0V2Zm-2 2h1v9.1a3.5 3.5 0 1 0 4 0V4h1a3 3 0 0 1 3 3v7.2a5.5 5.5 0 1 1-11 0V7a3 3 0 0 1 3-3Z"/></svg>',
 water: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2c4.4 5.1 7 8.9 7 12.1A7 7 0 1 1 5 14.1C5 10.9 7.6 7.1 12 2Zm0 4.8C9.4 9.8 8 12 8 14.1a4 4 0 0 0 8 0c0-2.1-1.4-4.3-4-7.3Z"/></svg>',
 stock: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m3 7 9-5 9 5v10l-9 5-9-5V7Zm9 2.1L7.5 7 12 4.6 16.5 7 12 9.1ZM5 8.8v7l6 3.3v-7L5 8.8Zm8 10.3 6-3.3v-7l-6 3.3v7Z"/></svg>',
 defect: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2 1 21h22L12 2Zm0 4.6 7 12.1H5l7-12.1ZM11 10h2v5h-2v-5Zm0 6h2v2h-2v-2Z"/></svg>'
};

export function decorateNavIcons() {
 const map = {
  dashboard: 'dashboard',
  agenda: 'tasks',
  capture: 'capture',
  notices: 'notices',
  more: 'more',
  defects: 'defect'
 };
 for (const [view, icon] of Object.entries(map)) {
  for (const button of document.querySelectorAll(`[data-view="${view}"]`)) {
   const old = button.querySelector('span:not(.nexus-ico)');
   if (old) old.remove();
   let host = button.querySelector('.nexus-ico');
   if (!host) {
    host = document.createElement('span');
    host.className = 'nexus-ico';
    button.prepend(host);
   }
   host.innerHTML = icons[icon];
   host.dataset.icon = icon;
  }
 }
}

export function decorateModuleIcons() {
 const map = {
  reports: {icon: 'reports', accent: 'accent-cyan'},
  inspections: {icon: 'inspections', accent: 'accent-cyan'},
  maintenance: {icon: 'maintenance', accent: 'accent-yellow'},
  procurement: {icon: 'procurement', accent: 'accent-cyan'},
  temperature: {icon: 'temperature', accent: 'accent-red'},
  water: {icon: 'water', accent: 'accent-cyan'},
  stock: {icon: 'stock', accent: 'accent-green'},
  notices: {icon: 'notices', accent: 'accent-yellow'}
 };
 for (const [operation, conf] of Object.entries(map)) {
  const button = document.querySelector(`[data-operation="${operation}"]`);
  if (!button) continue;
  button.classList.remove('accent-cyan', 'accent-yellow', 'accent-red', 'accent-green');
  button.classList.add('neon-tile', conf.accent);
  let host = button.querySelector('.module-icon');
  if (!host) {
   host = document.createElement('span');
   host.className = 'module-icon';
   button.prepend(host);
  }
  host.innerHTML = icons[conf.icon];
 }
}
