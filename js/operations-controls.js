import {facilityVisibleToMember, membershipCoversFacility} from './permissions.js';
import {
 assetOverdue,
 berlinDay,
 createProcurement,
 emptyOperations,
 inspectionOverdue,
 materialStock
} from './operations.js';

// Die Sitzungen von Betriebsleitung und Mitarbeiter haben die Regeln von
// Tageswerk 3.0 nicht bestätigt. Dieser Stand darf nicht auf "passed" wechseln,
// solange keine eigene Sitzung die Datenbankantworten geprüft hat.
export const roleSessionConfirmation = {
 facilityManager: 'open',
 employee: 'open'
};

function newId() {
 if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
 return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function carry(bundle, patch) {
 return {...emptyOperations(), ...(bundle || {}), ...patch};
}

function canUse(facility, actor) {
 return !!actor?.userId && facilityVisibleToMember(facility, actor.memberships);
}

function canManage(facility, actor) {
 return !!actor?.userId && (actor.memberships || []).some(membership => membershipCoversFacility(facility, membership, false));
}

function text(value, max) {
 const trimmed = String(value ?? '').trim();
 if (trimmed.length > max) return null;
 return trimmed;
}

function quantity(value, allowZero) {
 const raw = String(value ?? '').trim().replace(',', '.');
 if (!/^\d+(\.\d{1,3})?$/.test(raw)) return null;
 const amount = Number(raw);
 if (!Number.isFinite(amount) || amount < 0 || (!allowZero && amount === 0)) return null;
 return raw;
}

function celsius(value) {
 const raw = String(value ?? '').trim().replace(',', '.');
 if (!/^-?\d+(\.\d)?$/.test(raw)) return null;
 const amount = Number(raw);
 if (amount < -50 || amount > 200) return null;
 return raw;
}

function facilityOf(record) {
 return {id: record?.facilityId, organization_id: record?.organizationId, name: record?.facilityName};
}

function inScope(facilityId, organizationId, actor, ids) {
 if (!ids.has(facilityId)) return false;
 if (!organizationId) return true;
 return facilityVisibleToMember({id: facilityId, organization_id: organizationId}, actor?.memberships || []);
}

export function temperaturePointDraftError(draft) {
 if (!draft?.facility?.id) return 'Bitte einen Betrieb auswählen.';
 if (!text(draft.name, 200)) return 'Bitte eine Bezeichnung für die Messstelle eintragen.';
 if (!text(draft.location, 200)) return 'Bitte den Standort eintragen.';
 const minimum = celsius(draft.minimum);
 const maximum = celsius(draft.maximum);
 if (minimum === null || maximum === null) return 'Bitte den zulässigen Bereich mit einem Wert zwischen −50 und 200 °C eintragen.';
 if (Number(minimum) > Number(maximum)) return 'Der Mindestwert darf nicht über dem Höchstwert liegen.';
 return '';
}

export function createTemperaturePoint(bundle, draft, actor, now) {
 const error = temperaturePointDraftError(draft);
 if (error) return {ok: false, error, bundle};
 if (!canManage(draft.facility, actor)) return {ok: false, error: 'Messstellen legt die Betriebsleitung oder Geschäftsführung an.', bundle};
 const point = {
  id: newId(),
  facilityId: draft.facility.id,
  facilityName: draft.facility.name || 'Betrieb',
  organizationId: draft.facility.organization_id,
  name: text(draft.name, 200),
  location: text(draft.location, 200),
  minC: celsius(draft.minimum),
  maxC: celsius(draft.maximum),
  active: true,
  createdBy: actor.userId,
  createdAt: now
 };
 return {ok: true, bundle: carry(bundle, {temperaturePoints: [point, ...(bundle?.temperaturePoints || [])]}), point};
}

export function temperatureReadingDraftError(draft) {
 if (celsius(draft?.value) === null) return 'Bitte den gemessenen Temperaturwert eintragen.';
 if (text(draft?.note, 2000) === null) return 'Die Bemerkung darf höchstens 2000 Zeichen haben.';
 return '';
}

export function temperatureBreached(point, value) {
 const measured = Number(value);
 return measured < Number(point?.minC) || measured > Number(point?.maxC);
}

export function recordTemperature(bundle, pointId, draft, actor, now) {
 const point = (bundle?.temperaturePoints || []).find(item => item.id === pointId);
 if (!point || point.active === false) return {ok: false, error: 'Die Messstelle wurde nicht gefunden.', bundle};
 if (!canUse(facilityOf(point), actor)) return {ok: false, error: 'Keine Berechtigung für diesen Betrieb.', bundle};
 const error = temperatureReadingDraftError(draft);
 if (error) return {ok: false, error, bundle};
 const reading = {
  id: newId(),
  pointId: point.id,
  facilityId: point.facilityId,
  facilityName: point.facilityName,
  organizationId: point.organizationId,
  measuredAt: now,
  valueC: celsius(draft.value),
  recordedBy: actor.userId,
  recordedName: actor.name || 'Mitarbeiter',
  note: text(draft.note, 2000)
 };
 const readings = [reading, ...(bundle?.temperatureReadings || [])];
 let alert = null;
 let alerts = bundle?.temperatureAlerts || [];
 if (temperatureBreached(point, reading.valueC)) {
  alert = {
   id: newId(),
   readingId: reading.id,
   pointId: point.id,
   facilityId: point.facilityId,
   facilityName: point.facilityName,
   organizationId: point.organizationId,
   valueC: reading.valueC,
   minC: point.minC,
   maxC: point.maxC,
   status: 'open',
   acknowledgedBy: null,
   acknowledgedName: '',
   acknowledgedAt: null,
   remark: ''
  };
  alerts = [alert, ...alerts];
 }
 return {ok: true, bundle: carry(bundle, {temperatureReadings: readings, temperatureAlerts: alerts}), reading, alert};
}

export function missingTemperaturePoints(bundle, facilityId, now) {
 const day = berlinDay(now);
 const measured = new Set((bundle?.temperatureReadings || []).filter(reading => reading.facilityId === facilityId && berlinDay(reading.measuredAt) === day).map(reading => reading.pointId));
 return (bundle?.temperaturePoints || []).filter(point => point.facilityId === facilityId && point.active !== false && !measured.has(point.id));
}

export function acknowledgeTemperatureAlert(bundle, alertId, remark, actor, now) {
 const alert = (bundle?.temperatureAlerts || []).find(item => item.id === alertId);
 if (!alert) return {ok: false, error: 'Die Warnung wurde nicht gefunden.', bundle};
 if (!canUse(facilityOf(alert), actor)) return {ok: false, error: 'Keine Berechtigung für diesen Betrieb.', bundle};
 if (alert.status !== 'open') return {ok: false, error: 'Diese Warnung wurde bereits quittiert.', bundle};
 const note = text(remark, 2000);
 if (!note || note.length < 3) return {ok: false, error: 'Bitte die Quittierung mit mindestens 3 Zeichen begründen.', bundle};
 const updated = {
  ...alert,
  status: 'acknowledged',
  acknowledgedBy: actor.userId,
  acknowledgedName: actor.name || 'Mitarbeiter',
  acknowledgedAt: now,
  remark: note
 };
 return {ok: true, bundle: carry(bundle, {temperatureAlerts: (bundle?.temperatureAlerts || []).map(item => item.id === alert.id ? updated : item)}), alert: updated};
}

export function temperatureDefectDraft(bundle, alertId) {
 const alert = (bundle?.temperatureAlerts || []).find(item => item.id === alertId);
 const point = (bundle?.temperaturePoints || []).find(item => item.id === alert?.pointId);
 if (!alert || alert.status !== 'open' || !point) return {ok: false, error: 'Nur eine offene Temperaturwarnung kann ein Mangel werden.'};
 return {
  ok: true,
  defect: {
   facility_id: alert.facilityId,
   organization_id: alert.organizationId,
   title: `Temperatur ${point.name}`,
   description: `Messwert ${alert.valueC} °C außerhalb von ${alert.minC} bis ${alert.maxC} °C. ${point.location}`,
   priority: 'high',
   source: 'temperature',
   sourceId: alert.id
  }
 };
}

export function materialDraftError(draft) {
 if (!draft?.facility?.id) return 'Bitte einen Betrieb auswählen.';
 if (!text(draft.name, 200)) return 'Bitte eine Bezeichnung für das Material eintragen.';
 if (!text(draft.location, 200)) return 'Bitte den Lagerort eintragen.';
 const unit = text(draft.unit, 40);
 if (!unit) return 'Bitte eine Einheit eintragen.';
 if (quantity(draft.minimum, true) === null) return 'Bitte einen Mindestbestand von 0 oder größer eintragen.';
 return '';
}

export function createMaterial(bundle, draft, actor, now) {
 const error = materialDraftError(draft);
 if (error) return {ok: false, error, bundle};
 if (!canManage(draft.facility, actor)) return {ok: false, error: 'Material erfasst die Betriebsleitung oder Geschäftsführung.', bundle};
 const material = {
  id: newId(),
  facilityId: draft.facility.id,
  facilityName: draft.facility.name || 'Betrieb',
  organizationId: draft.facility.organization_id,
  name: text(draft.name, 200),
  location: text(draft.location, 200),
  unit: text(draft.unit, 40),
  minimum: quantity(draft.minimum, true),
  createdBy: actor.userId,
  createdAt: now
 };
 return {ok: true, bundle: carry(bundle, {materials: [material, ...(bundle?.materials || [])]}), material};
}

export function stockOf(bundle, materialId) {
 return materialStock(bundle?.movements, materialId);
}

export function materialBelowMinimum(bundle, material) {
 return !!material && stockOf(bundle, material.id) < Number(material.minimum);
}

function maintenanceLog(bundle, logId, facilityId) {
 if (!logId) return null;
 for (const asset of bundle?.assets || []) {
  if (asset.facilityId !== facilityId) continue;
  const log = (asset.logs || []).find(item => item.id === logId);
  if (log) return log;
 }
 return null;
}

export function recordMovement(bundle, draft, actor, now) {
 const material = (bundle?.materials || []).find(item => item.id === draft?.materialId);
 if (!material) return {ok: false, error: 'Das Material wurde nicht gefunden.', bundle};
 if (!canUse(facilityOf(material), actor)) return {ok: false, error: 'Keine Berechtigung für diesen Betrieb.', bundle};
 if (!['in', 'out'].includes(draft?.direction)) return {ok: false, error: 'Bitte Zugang oder Entnahme wählen.', bundle};
 const amount = quantity(draft.quantity, false);
 if (amount === null) return {ok: false, error: 'Bitte eine Menge größer als 0 eingeben.', bundle};
 if (text(draft.note, 2000) === null) return {ok: false, error: 'Die Bemerkung darf höchstens 2000 Zeichen haben.', bundle};
 if (draft.maintenanceLogId && !maintenanceLog(bundle, draft.maintenanceLogId, material.facilityId)) {
  return {ok: false, error: 'Die Wartung gehört zu einem anderen Betrieb.', bundle};
 }
 if (draft.direction === 'out' && Number(amount) > stockOf(bundle, material.id)) {
  return {ok: false, error: 'Der Bestand reicht für diese Entnahme nicht.', bundle};
 }
 const movement = {
  id: newId(),
  materialId: material.id,
  facilityId: material.facilityId,
  facilityName: material.facilityName,
  organizationId: material.organizationId,
  direction: draft.direction,
  quantity: amount,
  note: text(draft.note, 2000),
  recordedBy: actor.userId,
  recordedName: actor.name || 'Mitarbeiter',
  recordedAt: now,
  maintenanceLogId: draft.maintenanceLogId || null,
  procurementRequestId: null
 };
 return {ok: true, bundle: carry(bundle, {movements: [movement, ...(bundle?.movements || [])]}), movement};
}

export function procurementFromStock(bundle, materialId, actor, now) {
 const material = (bundle?.materials || []).find(item => item.id === materialId);
 if (!material) return {ok: false, error: 'Das Material wurde nicht gefunden.', bundle};
 if (!materialBelowMinimum(bundle, material)) return {ok: false, error: 'Der Bestand liegt nicht unter dem Mindestbestand.', bundle};
 const facility = facilityOf(material);
 const needed = Math.round((Number(material.minimum) - stockOf(bundle, material.id)) * 1000) / 1000;
 return createProcurement(bundle, {
  facility,
  title: material.name.slice(0, 180),
  quantity: String(needed),
  unit: material.unit,
  reason: `Mindestbestand unterschritten. Aktuell ${stockOf(bundle, material.id)} ${material.unit}, Minimum ${material.minimum} ${material.unit}.`,
  urgency: 'high',
  materialId: material.id
 }, actor, now);
}

export function facilityNotices(bundle, defects, options) {
 const ids = new Set(options?.facilityIds || []);
 const actor = options?.actor;
 const now = options?.now;
 const today = berlinDay(now);
 const notices = [];
 const push = notice => {
  if (!inScope(notice.facilityId, notice.organizationId, actor, ids)) return;
  notices.push(notice);
 };
 for (const defect of defects || []) {
  const facilityId = defect.facility_id;
  const organizationId = defect.organization_id || '';
  const created = defect.created_at || defect.createdAt;
  if (defect.status === 'open' && berlinDay(created) === today) {
   push({id: `defect-new:${defect.id}`, facilityId, organizationId, kind: 'defect-new', title: defect.title || 'Neuer Mangel', detail: 'Heute gemeldet und noch offen.', warn: false});
  }
  const due = defect.resolution_due_at || defect.due_at || defect.dueAt;
  const pastDue = due && new Date(due).getTime() < new Date(now).getTime();
  if (pastDue && !['resolved', 'pending_review'].includes(defect.status)) {
   push({id: `defect-overdue:${defect.id}`, facilityId, organizationId, kind: 'defect-overdue', title: defect.title || 'Überfälliger Mangel', detail: 'Die Frist ist abgelaufen.', warn: true});
  }
 }
 for (const run of bundle?.runs || []) {
  if (!inspectionOverdue(run, now)) continue;
  push({id: `inspection-overdue:${run.id}`, facilityId: run.facilityId, organizationId: run.organizationId, kind: 'inspection-overdue', title: run.name || 'Kontrollgang', detail: 'Der Kontrollgang ist überfällig.', warn: true});
 }
 for (const asset of bundle?.assets || []) {
  if (!assetOverdue(asset, now)) continue;
  push({id: `maintenance-overdue:${asset.id}`, facilityId: asset.facilityId, organizationId: asset.organizationId, kind: 'maintenance-overdue', title: asset.name || 'Wartung', detail: 'Die Wartung ist überfällig.', warn: true});
 }
 for (const request of bundle?.requests || []) {
  if (request.status !== 'submitted') continue;
  push({id: `procurement-open:${request.id}`, facilityId: request.facilityId, organizationId: request.organizationId, kind: 'procurement-open', title: request.title || 'Beschaffung', detail: 'Die Beschaffung ist noch nicht entschieden.', warn: false});
 }
 for (const alert of bundle?.temperatureAlerts || []) {
  if (alert.status !== 'open') continue;
  const point = (bundle?.temperaturePoints || []).find(item => item.id === alert.pointId);
  push({id: `temperature-warning:${alert.id}`, facilityId: alert.facilityId, organizationId: alert.organizationId, kind: 'temperature-warning', title: point?.name || 'Temperaturwarnung', detail: `${alert.valueC} °C außerhalb von ${alert.minC} bis ${alert.maxC} °C.`, warn: true});
 }
 for (const point of bundle?.temperaturePoints || []) {
  if (point.active === false || berlinDay(now) === '') continue;
  const measured = (bundle?.temperatureReadings || []).some(reading => reading.pointId === point.id && berlinDay(reading.measuredAt) === today);
  if (measured) continue;
  push({id: `temperature-missing:${point.id}`, facilityId: point.facilityId, organizationId: point.organizationId, kind: 'temperature-missing', title: point.name || 'Temperaturkontrolle', detail: 'Für heute liegt keine Messung vor.', warn: true});
 }
 for (const material of bundle?.materials || []) {
  if (!materialBelowMinimum(bundle, material)) continue;
  push({id: `stock-low:${material.id}`, facilityId: material.facilityId, organizationId: material.organizationId, kind: 'stock-low', title: material.name || 'Material', detail: `Bestand ${stockOf(bundle, material.id)} ${material.unit}, Minimum ${material.minimum} ${material.unit}.`, warn: true});
 }
 return notices.sort((left, right) => Number(right.warn) - Number(left.warn) || left.title.localeCompare(right.title, 'de'));
}
