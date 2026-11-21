const STORAGE = 'tageswerk-management-dashboard';

export const DASHBOARD_PRESETS = {
 overview: {label: 'Gesamtübersicht', showDefects: true, showMaintenance: true, showConsumption: true, showForecast: true, showRevenuePerVisitor: true},
 visitors: {label: 'Besucher und Umsatz', showDefects: false, showMaintenance: false, showConsumption: false, showForecast: true, showRevenuePerVisitor: true},
 technique: {label: 'Technik und Verbrauch', showDefects: false, showMaintenance: true, showConsumption: true, showForecast: false, showRevenuePerVisitor: false},
 defects: {label: 'Mängel und Wartungen', showDefects: true, showMaintenance: true, showConsumption: false, showForecast: false, showRevenuePerVisitor: false}
};

export function defaultLayout() {
 return {
  name: 'Standard',
  preset: 'overview',
  facilityIds: [],
  columns: 2,
  compact: false,
  monitor: false,
  refreshSeconds: 60,
  perFacility: {},
  isDefault: true
 };
}

export function facilityTileConfig(layout, facilityId) {
 const preset = DASHBOARD_PRESETS[layout?.preset] || DASHBOARD_PRESETS.overview;
 const custom = layout?.perFacility?.[facilityId] || {};
 return {
  showDefects: custom.showDefects ?? preset.showDefects,
  showMaintenance: custom.showMaintenance ?? preset.showMaintenance,
  showConsumption: custom.showConsumption ?? preset.showConsumption,
  showForecast: custom.showForecast ?? preset.showForecast,
  showRevenuePerVisitor: custom.showRevenuePerVisitor ?? preset.showRevenuePerVisitor,
  defectLimit: custom.defectLimit ?? 3,
  media: custom.media || ['electricity', 'water', 'gas', 'heat']
 };
}

export function allowedFacilityIds(requested, accessible) {
 const allowed = new Set((accessible || []).map(item => item.id));
 const selected = (requested || []).filter(id => allowed.has(id));
 return selected.length ? selected : [...allowed];
}

export function gridColumns(count, preferred) {
 const n = Number(preferred);
 if (n >= 1 && n <= 6) return n;
 if (count <= 2) return count || 1;
 if (count <= 4) return 2;
 if (count <= 6) return 3;
 if (count <= 8) return 4;
 return 4;
}

export function readLocalLayouts(userId) {
 try {
  const raw = localStorage.getItem(`${STORAGE}:${userId || 'anon'}`);
  const parsed = raw ? JSON.parse(raw) : null;
  if (Array.isArray(parsed?.layouts) && parsed.layouts.length) return parsed;
 } catch {
  return {layouts: [defaultLayout()], source: 'default'};
 }
 return {layouts: [defaultLayout()], source: 'default'};
}

export function writeLocalLayouts(userId, layouts) {
 localStorage.setItem(`${STORAGE}:${userId || 'anon'}`, JSON.stringify({layouts, savedAt: new Date().toISOString()}));
}

export function copyConfigToFacilities(layout, facilityIds) {
 const template = layout.perFacility?.[facilityIds[0]] || {};
 const next = {...layout, perFacility: {...layout.perFacility}};
 for (const id of facilityIds) next.perFacility[id] = {...template};
 return next;
}
