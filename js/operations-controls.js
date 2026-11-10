import {facilityVisibleToMember, membershipCoversFacility} from './permissions.js';
import {
 assetOverdue,
 berlinDay,
 createProcurement,
 emptyOperations,
 inspectionOverdue,
 materialStock,
 temperatureCheckDue,
 waterCatalog,
 waterControlState,
 waterScheduleLabel
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
 if (!text(draft.location, 200)) return 'Bitte den Bereich eintragen.';
 const minimum = celsius(draft.minimum);
 const maximum = celsius(draft.maximum);
 if (minimum === null || maximum === null) return 'Bitte den zulässigen Bereich mit einem Wert zwischen −50 und 200 °C eintragen.';
 if (Number(minimum) > Number(maximum)) return 'Der Mindestwert darf nicht über dem Höchstwert liegen.';
 const unit = draft.intervalUnit || 'day';
 const count = draft.intervalCount == null || draft.intervalCount === '' ? 1 : Number(draft.intervalCount);
 if (!['day', 'week', 'month'].includes(unit)) return 'Bitte ein Kontrollintervall wählen.';
 if (!Number.isInteger(count) || count < 1 || count > 365) return 'Bitte eine Intervallanzahl von 1 bis 365 eingeben.';
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
  intervalUnit: draft.intervalUnit || 'day',
  intervalCount: Number(draft.intervalCount || 1),
  active: true,
  createdBy: actor.userId,
  createdAt: now
 };
 return {ok: true, bundle: carry(bundle, {temperaturePoints: [point, ...(bundle?.temperaturePoints || [])]}), point};
}

export function updateTemperaturePoint(bundle, pointId, draft, actor) {
 const point = (bundle?.temperaturePoints || []).find(item => item.id === pointId);
 if (!point) return {ok: false, error: 'Die Messstelle wurde nicht gefunden.', bundle};
 if (!canManage(facilityOf(point), actor)) return {ok: false, error: 'Messstellen ändert die Betriebsleitung oder Geschäftsführung.', bundle};
 const error = temperaturePointDraftError({...draft, facility: facilityOf(point)});
 if (error) return {ok: false, error, bundle};
 const updated = {
  ...point,
  name: text(draft.name, 200),
  location: text(draft.location, 200),
  minC: celsius(draft.minimum),
  maxC: celsius(draft.maximum),
  intervalUnit: draft.intervalUnit || 'day',
  intervalCount: Number(draft.intervalCount || 1)
 };
 return {ok: true, bundle: carry(bundle, {temperaturePoints: (bundle?.temperaturePoints || []).map(item => item.id === point.id ? updated : item), temperatureReadings: bundle?.temperatureReadings || [], temperatureAlerts: bundle?.temperatureAlerts || []}), point: updated};
}

export function setTemperaturePointActive(bundle, pointId, active, actor) {
 const point = (bundle?.temperaturePoints || []).find(item => item.id === pointId);
 if (!point) return {ok: false, error: 'Die Messstelle wurde nicht gefunden.', bundle};
 if (!canManage(facilityOf(point), actor)) return {ok: false, error: 'Messstellen aktiviert die Betriebsleitung oder Geschäftsführung.', bundle};
 const updated = {...point, active: active === true};
 return {ok: true, bundle: carry(bundle, {temperaturePoints: (bundle?.temperaturePoints || []).map(item => item.id === point.id ? updated : item), temperatureReadings: bundle?.temperatureReadings || [], temperatureAlerts: bundle?.temperatureAlerts || []}), point: updated};
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
 return (bundle?.temperaturePoints || []).filter(point => point.facilityId === facilityId && temperatureCheckDue(point, bundle?.temperatureReadings, now));
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

function definitionOf(bundle, code) {
 return waterCatalog(bundle).find(item => item.code === code) || null;
}

function poolOf(bundle, poolId) {
 return (bundle?.waterPools || []).find(item => item.id === poolId) || null;
}

function parameterOf(bundle, parameterId) {
 return (bundle?.waterPoolParameters || []).find(item => item.id === parameterId) || null;
}

function poolParameters(bundle, poolId) {
 return (bundle?.waterPoolParameters || []).filter(item => item.poolId === poolId);
}

export function waterAmount(definition, value) {
 if (!definition) return null;
 const raw = String(value ?? '').trim().replace(',', '.');
 const decimals = Number(definition.decimals);
 const pattern = decimals === 0 ? /^-?\d+$/ : new RegExp(`^-?\\d+(\\.\\d{1,${decimals}})?$`);
 if (!pattern.test(raw)) return null;
 const amount = Number(raw);
 if (!Number.isFinite(amount) || amount < Number(definition.minPlausible) || amount > Number(definition.maxPlausible)) return null;
 return raw;
}

function optionalLimit(definition, value) {
 if (String(value ?? '').trim() === '') return {ok: true, value: null};
 const amount = waterAmount(definition, value);
 if (amount === null) return {ok: false, value: null};
 return {ok: true, value: amount};
}

export function parseWaterTimes(value) {
 const tokens = String(value ?? '').split(/[,;\s]+/).map(item => item.trim()).filter(Boolean);
 const times = [];
 for (const token of tokens) {
  const match = token.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  times.push(`${String(hour).padStart(2, '0')}:${match[2]}`);
 }
 const unique = [...new Set(times)].sort();
 if (!unique.length || unique.length > 12) return null;
 return unique;
}

export function waterPoolDraftError(draft) {
 if (!draft?.facility?.id && !draft?.pool) return 'Bitte einen Betrieb auswählen.';
 const name = text(draft.name, 200);
 if (!name) return 'Bitte eine Beckenbezeichnung eintragen.';
 const mode = draft.scheduleMode || 'daily';
 if (!['daily', 'weekly', 'times'].includes(mode)) return 'Bitte einen Kontrollplan wählen.';
 if (mode === 'times') {
  if (!parseWaterTimes(draft.scheduledTimes)) return 'Bitte gültige Uhrzeiten eintragen, zum Beispiel 08:00, 14:00.';
  const days = [...new Set((draft.weekdays || []).map(Number))].filter(day => day >= 1 && day <= 7);
  if (!days.length) return 'Bitte mindestens einen Wochentag wählen.';
  return '';
 }
 const count = draft.intervalCount == null || draft.intervalCount === '' ? 1 : Number(draft.intervalCount);
 if (!Number.isInteger(count) || count < 1 || count > 365) return 'Bitte eine Intervallanzahl von 1 bis 365 eintragen.';
 return '';
}

function scheduleFrom(draft) {
 const mode = draft.scheduleMode || 'daily';
 if (mode === 'times') {
  return {
   scheduleMode: 'times',
   intervalCount: 1,
   scheduledTimes: parseWaterTimes(draft.scheduledTimes) || [],
   weekdays: [...new Set((draft.weekdays || []).map(Number))].filter(day => day >= 1 && day <= 7).sort((left, right) => left - right)
  };
 }
 return {
  scheduleMode: mode,
  intervalCount: Number(draft.intervalCount || 1),
  scheduledTimes: [],
  weekdays: [1, 2, 3, 4, 5, 6, 7]
 };
}

export function createWaterPool(bundle, draft, actor, now) {
 const error = waterPoolDraftError(draft);
 if (error) return {ok: false, error, bundle};
 if (!canManage(draft.facility, actor)) return {ok: false, error: 'Becken legt die Betriebsleitung oder Geschäftsführung an.', bundle};
 const pool = {
  id: newId(),
  facilityId: draft.facility.id,
  facilityName: draft.facility.name || 'Betrieb',
  organizationId: draft.facility.organization_id,
  name: text(draft.name, 200),
  active: true,
  ...scheduleFrom(draft),
  createdBy: actor.userId,
  createdAt: now
 };
 const parameters = waterCatalog(bundle).map(definition => ({
  id: newId(),
  poolId: pool.id,
  facilityId: pool.facilityId,
  organizationId: pool.organizationId,
  parameterCode: definition.code,
  required: true,
  active: true,
  minValue: null,
  maxValue: null
 }));
 return {ok: true, bundle: carry(bundle, {waterPools: [pool, ...(bundle?.waterPools || [])], waterPoolParameters: [...parameters, ...(bundle?.waterPoolParameters || [])]}), pool, parameters};
}

export function updateWaterPool(bundle, poolId, draft, actor) {
 const pool = poolOf(bundle, poolId);
 if (!pool) return {ok: false, error: 'Das Becken wurde nicht gefunden.', bundle};
 if (!canManage(facilityOf(pool), actor)) return {ok: false, error: 'Becken ändert die Betriebsleitung oder Geschäftsführung.', bundle};
 const error = waterPoolDraftError({...draft, pool});
 if (error) return {ok: false, error, bundle};
 const updated = {...pool, name: text(draft.name, 200), ...scheduleFrom(draft)};
 return {ok: true, bundle: carry(bundle, {waterPools: (bundle?.waterPools || []).map(item => item.id === pool.id ? updated : item)}), pool: updated};
}

export function setWaterPoolActive(bundle, poolId, active, actor) {
 const pool = poolOf(bundle, poolId);
 if (!pool) return {ok: false, error: 'Das Becken wurde nicht gefunden.', bundle};
 if (!canManage(facilityOf(pool), actor)) return {ok: false, error: 'Becken aktiviert die Betriebsleitung oder Geschäftsführung.', bundle};
 const updated = {...pool, active: active === true};
 return {ok: true, bundle: carry(bundle, {waterPools: (bundle?.waterPools || []).map(item => item.id === pool.id ? updated : item)}), pool: updated};
}

export function waterParameterDraftError(bundle, parameter, draft) {
 const definition = definitionOf(bundle, parameter?.parameterCode);
 if (!definition) return 'Dieser Parameter ist nicht vorgesehen.';
 const minimum = optionalLimit(definition, draft?.minValue);
 const maximum = optionalLimit(definition, draft?.maxValue);
 if (!minimum.ok || !maximum.ok) return `Bitte den Sollbereich für ${definition.name} im vorgesehenen Format eintragen oder leer lassen.`;
 if (minimum.value !== null && maximum.value !== null && Number(minimum.value) > Number(maximum.value)) return 'Der untere Sollwert darf nicht über dem oberen liegen.';
 return '';
}

export function updateWaterParameter(bundle, parameterId, draft, actor) {
 const parameter = parameterOf(bundle, parameterId);
 if (!parameter) return {ok: false, error: 'Der Parameter wurde nicht gefunden.', bundle};
 if (!canManage(facilityOf(parameter), actor)) return {ok: false, error: 'Parameter ändert die Betriebsleitung oder Geschäftsführung.', bundle};
 const error = waterParameterDraftError(bundle, parameter, draft);
 if (error) return {ok: false, error, bundle};
 const definition = definitionOf(bundle, parameter.parameterCode);
 const updated = {
  ...parameter,
  minValue: optionalLimit(definition, draft.minValue).value,
  maxValue: optionalLimit(definition, draft.maxValue).value,
  required: draft.required !== false,
  active: draft.active !== false
 };
 return {ok: true, bundle: carry(bundle, {waterPoolParameters: (bundle?.waterPoolParameters || []).map(item => item.id === parameter.id ? updated : item)}), parameter: updated};
}

export function addWaterParameter(bundle, poolId, parameterCode, actor, now) {
 const pool = poolOf(bundle, poolId);
 if (!pool) return {ok: false, error: 'Das Becken wurde nicht gefunden.', bundle};
 if (!canManage(facilityOf(pool), actor)) return {ok: false, error: 'Parameter ergänzt die Betriebsleitung oder Geschäftsführung.', bundle};
 const definition = definitionOf(bundle, parameterCode);
 if (!definition) return {ok: false, error: 'Dieser Parameter ist nicht vorgesehen.', bundle};
 if (poolParameters(bundle, pool.id).some(item => item.parameterCode === definition.code)) return {ok: false, error: 'Dieser Parameter ist dem Becken bereits zugeordnet.', bundle};
 const parameter = {
  id: newId(),
  poolId: pool.id,
  facilityId: pool.facilityId,
  organizationId: pool.organizationId,
  parameterCode: definition.code,
  required: true,
  active: true,
  minValue: null,
  maxValue: null,
  createdAt: now
 };
 return {ok: true, bundle: carry(bundle, {waterPoolParameters: [parameter, ...(bundle?.waterPoolParameters || [])]}), parameter};
}

function waterBreached(reading) {
 const value = Number(reading?.value);
 if (!Number.isFinite(value)) return false;
 const below = reading.minLimit != null && reading.minLimit !== '' && value < Number(reading.minLimit);
 const above = reading.maxLimit != null && reading.maxLimit !== '' && value > Number(reading.maxLimit);
 return below || above;
}

export function recordWaterCheck(bundle, poolId, draft, actor, now) {
 const pool = poolOf(bundle, poolId);
 if (!pool || pool.active === false) return {ok: false, error: 'Das Becken ist nicht aktiv.', bundle};
 if (!canUse(facilityOf(pool), actor)) return {ok: false, error: 'Keine Berechtigung für diesen Betrieb.', bundle};
 const note = text(draft?.note, 2000);
 if (note === null) return {ok: false, error: 'Der Kommentar darf höchstens 2000 Zeichen haben.', bundle};
 const followUpAlertId = draft?.followUpAlertId || null;
 if (followUpAlertId && !(bundle?.waterAlerts || []).some(item => item.id === followUpAlertId && item.poolId === pool.id)) {
  return {ok: false, error: 'Die Wiederholung gehört zu einer anderen Warnung.', bundle};
 }
 const configured = poolParameters(bundle, pool.id).filter(item => item.active !== false);
 if (!configured.length) return {ok: false, error: 'Für dieses Becken ist kein Parameter aktiv.', bundle};
 const sent = draft?.values || {};
 for (const code of Object.keys(sent)) {
  if (String(sent[code] ?? '').trim() === '') continue;
  if (!configured.some(item => item.parameterCode === code)) return {ok: false, error: 'Dieser Parameter ist für das Becken nicht vorgesehen.', bundle};
 }
 const readings = [];
 for (const parameter of configured) {
  const raw = sent[parameter.parameterCode];
  if (String(raw ?? '').trim() === '') {
   if (parameter.required !== false) return {ok: false, error: 'Bitte alle erforderlichen Messwerte eintragen.', bundle};
   continue;
  }
  const definition = definitionOf(bundle, parameter.parameterCode);
  const amount = waterAmount(definition, raw);
  if (amount === null) return {ok: false, error: `Bitte ${definition?.name || 'den Messwert'} im vorgesehenen Format eintragen.`, bundle};
  readings.push({
   parameterCode: parameter.parameterCode,
   value: amount,
   unit: definition?.unit || '',
   minLimit: parameter.minValue,
   maxLimit: parameter.maxValue
  });
 }
 if (!readings.length) return {ok: false, error: 'Bitte mindestens einen Messwert eintragen.', bundle};
 const check = {
  id: newId(),
  poolId: pool.id,
  facilityId: pool.facilityId,
  facilityName: pool.facilityName,
  organizationId: pool.organizationId,
  measuredAt: now,
  recordedBy: actor.userId,
  recordedName: actor.name || 'Mitarbeiter',
  note,
  followUpAlertId,
  readings
 };
 const created = [];
 let alerts = bundle?.waterAlerts || [];
 for (const reading of readings) {
  if (!waterBreached(reading)) continue;
  const alert = {
   id: newId(),
   checkId: check.id,
   poolId: pool.id,
   facilityId: pool.facilityId,
   facilityName: pool.facilityName,
   organizationId: pool.organizationId,
   parameterCode: reading.parameterCode,
   value: reading.value,
   minLimit: reading.minLimit,
   maxLimit: reading.maxLimit,
   unit: reading.unit,
   measuredAt: now,
   recordedBy: actor.userId,
   status: 'open',
   acknowledgedBy: null,
   acknowledgedName: '',
   acknowledgedAt: null,
   acknowledgementNote: ''
  };
  created.push(alert);
  alerts = [alert, ...alerts];
 }
 return {ok: true, bundle: carry(bundle, {waterChecks: [check, ...(bundle?.waterChecks || [])], waterAlerts: alerts}), check, alerts: created};
}

export function acknowledgeWaterAlert(bundle, alertId, note, actor, now) {
 const alert = (bundle?.waterAlerts || []).find(item => item.id === alertId);
 if (!alert) return {ok: false, error: 'Die Warnung wurde nicht gefunden.', bundle};
 if (!canUse(facilityOf(alert), actor)) return {ok: false, error: 'Keine Berechtigung für diesen Betrieb.', bundle};
 if (alert.status !== 'open') return {ok: false, error: 'Diese Warnung wurde bereits quittiert.', bundle};
 const acknowledgementNote = text(note, 2000);
 if (!acknowledgementNote || acknowledgementNote.length < 3) return {ok: false, error: 'Bitte die Quittierung mit mindestens 3 Zeichen begründen.', bundle};
 const updated = {
  ...alert,
  status: 'acknowledged',
  acknowledgedBy: actor.userId,
  acknowledgedName: actor.name || 'Mitarbeiter',
  acknowledgedAt: now,
  acknowledgementNote
 };
 return {ok: true, bundle: carry(bundle, {waterAlerts: (bundle?.waterAlerts || []).map(item => item.id === alert.id ? updated : item)}), alert: updated};
}

export function recordWaterMeasure(bundle, alertId, measure, actor, now) {
 const alert = (bundle?.waterAlerts || []).find(item => item.id === alertId);
 if (!alert) return {ok: false, error: 'Die Warnung wurde nicht gefunden.', bundle};
 if (!canUse(facilityOf(alert), actor)) return {ok: false, error: 'Keine Berechtigung für diesen Betrieb.', bundle};
 const measureText = text(measure, 2000);
 if (!measureText || measureText.length < 3) return {ok: false, error: 'Bitte die Maßnahme mit mindestens 3 Zeichen dokumentieren.', bundle};
 const entry = {
  id: newId(),
  alertId: alert.id,
  facilityId: alert.facilityId,
  facilityName: alert.facilityName,
  organizationId: alert.organizationId,
  measureText,
  recordedBy: actor.userId,
  recordedName: actor.name || 'Mitarbeiter',
  recordedAt: now
 };
 return {ok: true, bundle: carry(bundle, {waterMeasures: [entry, ...(bundle?.waterMeasures || [])], waterAlerts: bundle?.waterAlerts || []}), measure: entry, alert};
}

export function waterAttention(bundle, facilityId, now) {
 return (bundle?.waterPools || []).filter(pool => pool.facilityId === facilityId && waterControlState(pool, bundle?.waterChecks, bundle?.waterPoolParameters, now).bucket);
}

export function waterParameterName(bundle, code) {
 return definitionOf(bundle, code)?.name || code || 'Parameter';
}

export {waterScheduleLabel};

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
  if (!temperatureCheckDue(point, bundle?.temperatureReadings, now)) continue;
  const daily = (point.intervalUnit || 'day') === 'day' && Number(point.intervalCount || 1) === 1;
  push({id: `temperature-missing:${point.id}`, facilityId: point.facilityId, organizationId: point.organizationId, kind: 'temperature-missing', title: point.name || 'Temperaturkontrolle', detail: daily ? 'Für heute liegt keine Messung vor.' : 'Die Kontrolle ist fällig.', warn: true});
 }
 for (const alert of bundle?.waterAlerts || []) {
  if (alert.status !== 'open') continue;
  const pool = poolOf(bundle, alert.poolId);
  const name = waterParameterName(bundle, alert.parameterCode);
  const range = alert.minLimit != null && alert.maxLimit != null
   ? `${alert.minLimit} bis ${alert.maxLimit}`
   : alert.minLimit != null ? `mindestens ${alert.minLimit}` : `höchstens ${alert.maxLimit}`;
  const unit = alert.unit ? ` ${alert.unit}` : '';
  push({id: `water-warning:${alert.id}`, poolId: alert.poolId, facilityId: alert.facilityId, organizationId: alert.organizationId, kind: 'water-warning', title: pool?.name || 'Wasserhygiene', detail: `${name}: ${alert.value}${unit} außerhalb von ${range}. Die Warnung ist offen.`, warn: true});
 }
 for (const pool of bundle?.waterPools || []) {
  const status = waterControlState(pool, bundle?.waterChecks, bundle?.waterPoolParameters, now);
  if (!status.due) continue;
  push({id: `water-missing:${pool.id}`, poolId: pool.id, facilityId: pool.facilityId, organizationId: pool.organizationId, kind: 'water-missing', title: pool.name || 'Wasserhygiene', detail: status.detail, warn: true});
 }
 for (const material of bundle?.materials || []) {
  if (!materialBelowMinimum(bundle, material)) continue;
  push({id: `stock-low:${material.id}`, facilityId: material.facilityId, organizationId: material.organizationId, kind: 'stock-low', title: material.name || 'Material', detail: `Bestand ${stockOf(bundle, material.id)} ${material.unit}, Minimum ${material.minimum} ${material.unit}.`, warn: true});
 }
 return notices.sort((left, right) => Number(right.warn) - Number(left.warn) || left.title.localeCompare(right.title, 'de'));
}
