import {facilityVisibleToMember, waterHistoryRole} from './permissions.js';
import {
 canCorrectWaterFilterFlush,
 canManageWaterFilters,
 canRecordWaterFilterFlush,
 waterFilterDraftError,
 waterFilterFlushCorrectionArgs,
 waterFilterFlushCorrectionDraftError,
 waterFilterFlushDraftError,
 waterFilterFlushInsertPayload,
 waterFilterInsertPayload
} from './water-filters.js';
import {
 acknowledgeTemperatureAlert,
 acknowledgeWaterAlert,
 alertIsHidden,
 hideFacilityAlert,
 hideOldFacilityAlerts,
 restoreFacilityAlert,
 addWaterParameter,
 createMaterial,
 updateMaterial,
 createTemperaturePoint,
 createWaterPool,
 recordMovement,
 recordTemperature,
 recordWaterCheck,
 reviewWaterRound,
 recordWaterMeasure,
 waterDraftStatusText,
 facilityRoundScheduleError,
 parseFacilityRoundTimes,
 setTemperaturePointActive,
 setWaterPoolActive,
 updateTemperaturePoint,
 updateWaterParameter,
 updateWaterPool
} from './operations-controls.js';
import {
 assignInspection,
 completeMaintenance,
 createAsset,
 createDailyReport,
 createInspectionTemplate,
 createProcurement,
 berlinDay,
 dayFigurePayload,
 emptyOperations,
 historicalFigurePayload,
 linkAssetDefect,
 linkReportDefect,
 recordInspection,
 reviewProcurement,
 reviseDailyReport,
 waterCatalog
} from './operations.js';

const tables = [
 'daily_reports',
 'daily_report_revisions',
 'daily_report_defects',
 'inspection_templates',
 'inspection_points',
 'inspection_runs',
 'inspection_results',
 'assets',
 'maintenance_logs',
 'asset_defects',
 'procurement_requests'
];

const temperatureTables = ['temperature_points', 'temperature_readings', 'temperature_alerts'];
const materialTables = ['materials', 'material_movements'];
const waterTables = ['water_parameter_definitions', 'water_pools', 'water_pool_parameters', 'water_checks', 'water_alerts', 'water_alert_measures', 'water_round_drafts'];

export function supabaseOperationDb(supabase) {
 return {
  select(table) {
   return supabase.from(table).select('*');
  },
  insert(table, row) {
   return supabase.from(table).insert(row).select('*').maybeSingle();
  },
  update(table, id, row) {
   return supabase.from(table).update(row).eq('id', id).select('*').maybeSingle();
  },
  rpc(name, args) {
   return supabase.rpc(name, args);
  },
  from(table) {
   return supabase.from(table);
  }
 };
}

export function storageMessage(error) {
 const code = String(error?.code || '');
 const message = String(error?.message || '');
 if (code === 'PGRST205' || code === '42P01' || code === '42883' || /schema cache|does not exist|relation .* does not exist|function .* does not exist/i.test(message)) {
  return 'Die Betriebsdatenbank ist noch nicht installiert. Es wurde nichts gespeichert.';
 }
 if (message && message.length < 240) return message;
 return 'Die Speicherung wurde nicht bestätigt.';
}

export function waterRoundFailureMessage(error) {
 const text = [error?.code, error?.message, error?.details, error?.hint].filter(Boolean).join(' ');
 const readable = storageMessage(error);
 if (/row-level security|42501|permission denied|Keine Berechtigung/i.test(text)) {
  return 'Keine Berechtigung für diese Kontrollrunde. Die erfassten Werte bleiben im Entwurf.';
 }
 if (/nur über die vorgesehene Funktion/i.test(text)) {
  return 'Die Kontrollrunde konnte nicht abgeschlossen werden. Die erfassten Werte bleiben im Entwurf.';
 }
 if (/water_checks_round_pool|duplicate key value/i.test(text)) {
  return 'Die Kontrollrunde ist bereits gespeichert. Bitte den Abschluss erneut versuchen.';
 }
 if (readable && readable !== 'Die Speicherung wurde nicht bestätigt.') return readable;
 return 'Die Kontrollrunde wurde nicht abgeschlossen. Die erfassten Werte bleiben im Entwurf.';
}

function denied(bundle, error) {
 return {ok: false, error, bundle};
}

function confirmed(result) {
 if (result?.error) return {ok: false, error: storageMessage(result.error)};
 const data = Array.isArray(result?.data) ? result.data[0] : result?.data;
 if (!data?.id) return {ok: false, error: 'Die Speicherung wurde nicht bestätigt.'};
 return {ok: true, data};
}

function personName(context, userId, actor) {
 if (context?.names?.[userId]) return context.names[userId];
 if (actor?.userId === userId && actor.name) return actor.name;
 return 'unbekannte Person';
}

function facilityName(context, facilityId) {
 return context?.facilities?.find(item => item.id === facilityId)?.name || 'Betrieb';
}

function visible(row, actor) {
 return facilityVisibleToMember(
  {id: row?.facility_id, organization_id: row?.organization_id},
  actor?.memberships || []
 );
}

function replace(list, item) {
 return [item, ...(list || []).filter(current => current.id !== item.id)];
}

function mapReport(row, context, actor, revisions, defectIds) {
 return {
  id: row.id,
  facilityId: row.facility_id,
  facilityName: facilityName(context, row.facility_id),
  organizationId: row.organization_id,
  reportDate: String(row.report_date || '').slice(0, 10),
  incidents: row.incidents || '',
  handover: row.handover || '',
  weatherSummary: row.weather_summary || '',
  weatherSource: row.weather_source || '',
  weatherKind: row.weather_kind || '',
  weatherObservedAt: row.weather_observed_at || null,
  authorId: row.created_by,
  authorName: personName(context, row.created_by, actor),
  createdAt: row.created_at,
  defectIds: defectIds || [],
  revisions: revisions || []
 };
}

function mapRevision(row, context, actor) {
 return {
  id: row.id,
  editorId: row.editor_id,
  editorName: personName(context, row.editor_id, actor),
  editedAt: row.edited_at,
  changeNote: row.change_note,
  incidents: row.incidents || '',
  handover: row.handover || ''
 };
}

function mapAlertVisibility(loaded, actor, context) {
 return (loaded.facility_alert_visibility || []).filter(row => visible(row, actor)).map(row => ({
  id: row.id,
  source: row.source,
  alertId: row.alert_id,
  facilityId: row.facility_id,
  facilityName: facilityName(context, row.facility_id),
  organizationId: row.organization_id,
  action: row.action,
  actedBy: row.acted_by,
  actedName: personName(context, row.acted_by, actor),
  actedAt: row.acted_at,
  bulkDays: row.bulk_days == null ? null : Number(row.bulk_days)
 }));
}

function decorateAlert(alert, events, source) {
 const latest = events
  .filter(item => item.source === source && item.alertId === alert.id)
  .slice()
  .sort((left, right) => String(right.actedAt).localeCompare(String(left.actedAt)) || String(right.id).localeCompare(String(left.id)))[0];
 const hidden = latest?.action === 'hide';
 return {
  ...alert,
  hidden,
  hiddenBy: hidden ? latest.actedBy : null,
  hiddenName: hidden ? latest.actedName : '',
  hiddenAt: hidden ? latest.actedAt : null
 };
}

function assemble(loaded, actor, context) {
 const alertVisibility = mapAlertVisibility(loaded, actor, context);
 const readingAt = new Map((loaded.temperature_readings || []).map(row => [row.id, row.measured_at]));
 const reports = (loaded.daily_reports || []).filter(row => visible(row, actor));
 const reportIds = new Set(reports.map(row => row.id));
 const revisions = new Map();
 for (const row of loaded.daily_report_revisions || []) {
  if (!reportIds.has(row.report_id)) continue;
  const list = revisions.get(row.report_id) || [];
  list.push(mapRevision(row, context, actor));
  revisions.set(row.report_id, list);
 }
 const defects = new Map();
 for (const row of loaded.daily_report_defects || []) {
  if (!reportIds.has(row.report_id)) continue;
  const list = defects.get(row.report_id) || [];
  list.push(row.defect_id);
  defects.set(row.report_id, list);
 }
 const templates = (loaded.inspection_templates || []).filter(row => visible(row, actor));
 const templateIds = new Set(templates.map(row => row.id));
 const points = new Map();
 for (const row of (loaded.inspection_points || []).slice().sort((a, b) => a.sort_order - b.sort_order)) {
  if (!templateIds.has(row.template_id)) continue;
  const list = points.get(row.template_id) || [];
  list.push({id: row.id, label: row.label});
  points.set(row.template_id, list);
 }
 const runs = (loaded.inspection_runs || []).filter(row => visible(row, actor));
 const runIds = new Set(runs.map(row => row.id));
 const results = new Map();
 for (const row of loaded.inspection_results || []) {
  if (!runIds.has(row.run_id)) continue;
  const list = results.get(row.run_id) || [];
  list.push({id: row.point_id, label: row.label, mark: row.mark, note: row.note || '', defectId: row.defect_id || null});
  results.set(row.run_id, list);
 }
 const assets = (loaded.assets || []).filter(row => visible(row, actor));
 const assetIds = new Set(assets.map(row => row.id));
 const logs = new Map();
 for (const row of loaded.maintenance_logs || []) {
  if (!assetIds.has(row.asset_id)) continue;
  const list = logs.get(row.asset_id) || [];
  list.push({id: row.id, completedAt: row.completed_at, completedBy: row.completed_by, completedName: personName(context, row.completed_by, actor), note: row.note});
  logs.set(row.asset_id, list);
 }
 const assetDefects = new Map();
 for (const row of loaded.asset_defects || []) {
  if (!assetIds.has(row.asset_id)) continue;
  const list = assetDefects.get(row.asset_id) || [];
  list.push(row.defect_id);
  assetDefects.set(row.asset_id, list);
 }
 return {
  reports: reports.map(row => mapReport(row, context, actor, (revisions.get(row.id) || []).sort((a, b) => String(b.editedAt).localeCompare(String(a.editedAt))), defects.get(row.id) || [])),
  templates: templates.map(row => ({
   id: row.id,
   facilityId: row.facility_id,
   facilityName: facilityName(context, row.facility_id),
   organizationId: row.organization_id,
   name: row.name,
   intervalCount: row.interval_count,
   intervalUnit: row.interval_unit,
   points: points.get(row.id) || [],
   createdBy: row.created_by,
   createdAt: row.created_at
  })),
  runs: runs.map(row => ({
   id: row.id,
   templateId: row.template_id,
   name: row.name,
   facilityId: row.facility_id,
   facilityName: facilityName(context, row.facility_id),
   organizationId: row.organization_id,
   assignedTo: row.assigned_to,
   assignedName: personName(context, row.assigned_to, actor),
   dueAt: row.due_at,
   status: row.status,
   performedBy: row.performed_by || null,
   performedName: row.performed_by ? personName(context, row.performed_by, actor) : '',
   performedAt: row.performed_at || null,
   points: results.get(row.id) || [],
   createdAt: row.created_at
  })),
  assets: assets.map(row => ({
   id: row.id,
   facilityId: row.facility_id,
   facilityName: facilityName(context, row.facility_id),
   organizationId: row.organization_id,
   name: row.name,
   location: row.location || '',
   intervalCount: row.interval_count,
   intervalUnit: row.interval_unit,
   responsibleUserId: row.responsible_user_id || null,
   responsibleName: row.responsible_user_id ? personName(context, row.responsible_user_id, actor) : '',
   anchorAt: row.anchor_at,
   logs: (logs.get(row.id) || []).sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt))),
   defectIds: assetDefects.get(row.id) || [],
   createdAt: row.created_at
  })),
  requests: (loaded.procurement_requests || []).filter(row => visible(row, actor)).map(row => ({
   id: row.id,
   facilityId: row.facility_id,
   facilityName: facilityName(context, row.facility_id),
   organizationId: row.organization_id,
   title: row.title,
   quantity: String(row.quantity),
   unit: row.unit || 'Stück',
   reason: row.reason,
   urgency: row.urgency,
   status: row.status,
   defectId: row.defect_id || null,
   materialId: row.material_id || null,
   requestedBy: row.requested_by,
   requestedName: personName(context, row.requested_by, actor),
   requestedAt: row.requested_at,
   reviewedBy: row.reviewed_by || null,
   reviewedName: row.reviewed_by ? personName(context, row.reviewed_by, actor) : '',
   reviewedAt: row.reviewed_at || null,
   reviewNote: row.review_note || ''
  })),
  preparedDefects: [],
  temperaturePoints: (loaded.temperature_points || []).filter(row => visible(row, actor)).map(row => ({
   id: row.id,
   facilityId: row.facility_id,
   facilityName: facilityName(context, row.facility_id),
   organizationId: row.organization_id,
   name: row.name,
   location: row.location || '',
   minC: String(row.minimum_celsius),
   maxC: String(row.maximum_celsius),
   intervalUnit: row.interval_unit || 'day',
   intervalCount: Number(row.interval_count) || 1,
   active: row.active !== false,
   createdBy: row.created_by,
   createdAt: row.created_at
  })),
  temperatureReadings: (loaded.temperature_readings || []).filter(row => visible(row, actor)).map(row => ({
   id: row.id,
   pointId: row.point_id,
   facilityId: row.facility_id,
   facilityName: facilityName(context, row.facility_id),
   organizationId: row.organization_id,
   measuredAt: row.measured_at,
   valueC: String(row.value_celsius),
   recordedBy: row.recorded_by,
   recordedName: personName(context, row.recorded_by, actor),
   note: row.note || ''
  })).sort((a, b) => String(b.measuredAt).localeCompare(String(a.measuredAt))),
  temperatureAlerts: (loaded.temperature_alerts || []).filter(row => visible(row, actor)).map(row => decorateAlert({
   id: row.id,
   readingId: row.reading_id,
   pointId: row.point_id,
   facilityId: row.facility_id,
   facilityName: facilityName(context, row.facility_id),
   organizationId: row.organization_id,
   valueC: String(row.value_celsius),
   minC: String(row.minimum_celsius),
   maxC: String(row.maximum_celsius),
   status: row.status,
   acknowledgedBy: row.acknowledged_by || null,
   acknowledgedName: row.acknowledged_by ? personName(context, row.acknowledged_by, actor) : '',
   acknowledgedAt: row.acknowledged_at || null,
   remark: row.remark || '',
   measuredAt: readingAt.get(row.reading_id) || null
  }, alertVisibility, 'temperature')),
  materials: (loaded.materials || []).filter(row => visible(row, actor)).map(row => ({
   id: row.id,
   facilityId: row.facility_id,
   facilityName: facilityName(context, row.facility_id),
   organizationId: row.organization_id,
   name: row.name,
   location: row.location || '',
   unit: row.unit || '',
   minimum: String(row.minimum_quantity),
   active: row.is_active !== false,
   createdBy: row.created_by,
   createdAt: row.created_at
  })),
  movements: (loaded.material_movements || []).filter(row => visible(row, actor)).map(row => ({
   id: row.id,
   materialId: row.material_id,
   facilityId: row.facility_id,
   facilityName: facilityName(context, row.facility_id),
   organizationId: row.organization_id,
   direction: row.direction,
   quantity: String(row.quantity),
   note: row.note || '',
   recordedBy: row.recorded_by,
   recordedName: personName(context, row.recorded_by, actor),
   recordedAt: row.recorded_at,
   maintenanceLogId: row.maintenance_log_id || null,
   procurementRequestId: row.procurement_request_id || null
  })).sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt))),
  waterParameters: (loaded.water_parameter_definitions || []).map(row => ({
   code: row.code,
   name: row.name,
   unit: row.unit || '',
   decimals: Number(row.decimals),
   minPlausible: Number(row.min_plausible),
   maxPlausible: Number(row.max_plausible),
   sortOrder: Number(row.sort_order) || 0,
   active: row.active !== false
  })).sort((a, b) => a.sortOrder - b.sortOrder),
  waterPools: (loaded.water_pools || []).filter(row => visible(row, actor)).map(row => ({
   id: row.id,
   facilityId: row.facility_id,
   facilityName: facilityName(context, row.facility_id),
   organizationId: row.organization_id,
   name: row.name,
   active: row.active !== false,
   scheduleMode: row.schedule_mode || 'daily',
   intervalCount: Number(row.interval_count) || 1,
   scheduledTimes: Array.isArray(row.scheduled_times) ? row.scheduled_times.map(String) : [],
   weekdays: Array.isArray(row.weekdays) && row.weekdays.length ? row.weekdays.map(Number) : [1, 2, 3, 4, 5, 6, 7],
   createdBy: row.created_by,
   createdAt: row.created_at
  })),
  waterPoolParameters: (loaded.water_pool_parameters || []).filter(row => visible(row, actor)).map(row => ({
   id: row.id,
   poolId: row.pool_id,
   facilityId: row.facility_id,
   facilityName: facilityName(context, row.facility_id),
   organizationId: row.organization_id,
   parameterCode: row.parameter_code,
   required: row.required !== false,
   active: row.active !== false,
   minValue: row.min_value == null ? null : String(row.min_value),
   maxValue: row.max_value == null ? null : String(row.max_value)
  })),
  waterChecks: (loaded.water_checks || []).filter(row => visible(row, actor)).map(row => ({
   id: row.id,
   poolId: row.pool_id,
   facilityId: row.facility_id,
   facilityName: facilityName(context, row.facility_id),
   organizationId: row.organization_id,
   measuredAt: row.measured_at,
   recordedBy: row.recorded_by,
   recordedName: personName(context, row.recorded_by, actor),
   note: row.note || '',
   followUpAlertId: row.follow_up_alert_id || null,
   roundId: row.round_id || null,
   readings: (Array.isArray(row.readings) ? row.readings : []).map(entry => ({
    parameterCode: entry.parameter_code || entry.parameterCode,
    value: entry.value == null ? '' : String(entry.value),
    unit: entry.unit || '',
    minLimit: entry.min_limit == null ? null : String(entry.min_limit),
    maxLimit: entry.max_limit == null ? null : String(entry.max_limit)
   }))
  })).sort((a, b) => String(b.measuredAt).localeCompare(String(a.measuredAt))),
  waterAlerts: (loaded.water_alerts || []).filter(row => visible(row, actor)).map(row => decorateAlert({
   id: row.id,
   checkId: row.check_id,
   poolId: row.pool_id,
   facilityId: row.facility_id,
   facilityName: facilityName(context, row.facility_id),
   organizationId: row.organization_id,
   parameterCode: row.parameter_code,
   value: row.value_amount == null ? '' : String(row.value_amount),
   minLimit: row.min_value == null ? null : String(row.min_value),
   maxLimit: row.max_value == null ? null : String(row.max_value),
   unit: row.unit || '',
   measuredAt: row.measured_at,
   recordedBy: row.recorded_by,
   status: row.status,
   acknowledgedBy: row.acknowledged_by || null,
   acknowledgedName: row.acknowledged_by ? personName(context, row.acknowledged_by, actor) : '',
   acknowledgedAt: row.acknowledged_at || null,
   acknowledgementNote: row.acknowledgement_note || ''
  }, alertVisibility, 'water')),
  alertVisibility,
  waterMeasures: (loaded.water_alert_measures || []).filter(row => visible(row, actor)).map(row => ({
   id: row.id,
   alertId: row.alert_id,
   facilityId: row.facility_id,
   facilityName: facilityName(context, row.facility_id),
   organizationId: row.organization_id,
   measureText: row.measure_text || '',
   recordedBy: row.recorded_by,
   recordedName: personName(context, row.recorded_by, actor),
   recordedAt: row.recorded_at
  })).sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt))),
  waterRoundDrafts: (loaded.water_round_drafts || []).filter(row => visible(row, actor) && row.user_id === actor?.userId && row.status === 'open').map(row => ({
   id: row.id,
   facilityId: row.facility_id,
   organizationId: row.organization_id,
   userId: row.user_id,
   roundId: row.round_id,
   entries: row.entries && typeof row.entries === 'object' && !Array.isArray(row.entries) ? row.entries : {},
   progress: row.progress && typeof row.progress === 'object' && !Array.isArray(row.progress) ? row.progress : {},
   status: 'open',
   revision: Number(row.revision) || 0,
   createdAt: row.created_at,
   updatedAt: row.updated_at
  })),
  waterFacilitySlots: (loaded.water_facility_slots || []).filter(row => visible(row, actor)).map(row => ({
   id: row.id,
   facilityId: row.facility_id,
   organizationId: row.organization_id,
   time: String(row.slot_time || ''),
   active: row.active !== false,
   effectiveOn: String(row.effective_on || '').slice(0, 10),
   retiredOn: String(row.retired_on || '').slice(0, 10)
  })),
  waterRoundSlots: (loaded.water_round_slots || []).filter(row => visible(row, actor)).map(row => ({
   id: row.id,
   facilityId: row.facility_id,
   organizationId: row.organization_id,
   roundId: row.round_id,
   slotId: row.slot_id || null,
   kind: row.kind === 'extra' ? 'extra' : 'planned',
   slotTime: String(row.slot_time || ''),
   serviceDay: String(row.service_day || '').slice(0, 10),
   userId: row.user_id
  })),
  waterFilters: (loaded.water_filters || []).filter(row => visible(row, actor)).map(row => ({
   id: row.id,
   facilityId: row.facility_id,
   facilityName: facilityName(context, row.facility_id),
   organizationId: row.organization_id,
   poolId: row.pool_id,
   name: row.name,
   active: row.active !== false,
   createdBy: row.created_by,
   createdAt: row.created_at,
   lastFlushedAt: row.last_flushed_at || null,
   lastFlushedBy: row.last_flushed_by || null
  })),
  waterFilterFlushCorrections: (loaded.water_filter_flush_corrections || []).filter(row => visible(row, actor)).map(row => ({
   id: row.id,
   flushId: row.flush_id,
   facilityId: row.facility_id,
   organizationId: row.organization_id,
   correctedAt: row.corrected_at,
   correctedBy: row.corrected_by,
   correctedName: personName(context, row.corrected_by, actor),
   reason: row.reason || '',
   previousFilterId: row.previous_filter_id,
   previousPoolId: row.previous_pool_id,
   previousFlushedAt: row.previous_flushed_at,
   previousNote: row.previous_note || '',
   filterId: row.filter_id,
   poolId: row.pool_id,
   flushedAt: row.flushed_at,
   note: row.note || ''
  })).sort((a, b) => String(b.correctedAt).localeCompare(String(a.correctedAt))),
  waterFilterStatusEvents: (loaded.water_filter_status_events || []).filter(row => visible(row, actor)).map(row => ({
   id: row.id,
   filterId: row.filter_id,
   facilityId: row.facility_id,
   organizationId: row.organization_id,
   changedAt: row.changed_at,
   changedBy: row.changed_by,
   changedName: personName(context, row.changed_by, actor),
   reason: row.reason || '',
   oldActive: row.old_active === true,
   newActive: row.new_active === true
  })).sort((a, b) => String(b.changedAt).localeCompare(String(a.changedAt))),
  waterFilterFlushes: (() => {
   const corrections = (loaded.water_filter_flush_corrections || [])
    .filter(row => visible(row, actor))
    .slice()
    .sort((left, right) => {
     const byTime = String(right.corrected_at || '').localeCompare(String(left.corrected_at || ''));
     return byTime || String(right.id || '').localeCompare(String(left.id || ''));
    });
   const latestByFlush = new Map();
   for (const row of corrections) {
    if (!latestByFlush.has(row.flush_id)) latestByFlush.set(row.flush_id, row);
   }
   return (loaded.water_filter_flushes || []).filter(row => visible(row, actor)).map(row => {
    const latest = latestByFlush.get(row.id);
    return {
     id: row.id,
     facilityId: row.facility_id,
     facilityName: facilityName(context, row.facility_id),
     organizationId: row.organization_id,
     poolId: latest ? latest.pool_id : row.pool_id,
     filterId: latest ? latest.filter_id : row.filter_id,
     flushedAt: latest ? latest.flushed_at : row.flushed_at,
     recordedAt: row.recorded_at,
     recordedBy: row.recorded_by,
     recordedName: personName(context, row.recorded_by, actor),
     note: latest ? (latest.note || '') : (row.note || ''),
     originalFilterId: row.filter_id,
     originalPoolId: row.pool_id,
     originalFlushedAt: row.flushed_at,
     originalNote: row.note || '',
     correctedAt: latest?.corrected_at || null,
     correctedBy: latest?.corrected_by || null,
     correctedName: latest?.corrected_by ? personName(context, latest.corrected_by, actor) : '',
     correctionCount: corrections.filter(item => item.flush_id === row.id).length,
     isCorrected: !!latest
    };
   }).sort((a, b) => String(b.flushedAt).localeCompare(String(a.flushedAt)));
  })()
 };
}

function missingTable(error) {
 return storageMessage(error).startsWith('Die Betriebsdatenbank ist noch nicht installiert');
}

async function readTable(db, table) {
 try {
  return await db.select(table);
 } catch (error) {
  return {data: null, error};
 }
}

async function readGroup(db, loaded, names) {
 const found = {};
 for (const table of names) {
  const result = await readTable(db, table);
  if (result?.error) {
   if (!missingTable(result.error)) return {ok: false, error: storageMessage(result.error)};
   for (const name of names) loaded[name] = [];
   return {ok: true, installed: false};
  }
  found[table] = result?.data || [];
 }
 Object.assign(loaded, found);
 return {ok: true, installed: true};
}

function groupReady(group) {
 return group?.ok !== false && group?.installed === true;
}

export async function loadOperations(db, actor, context) {
 const loaded = {};
 const core = await readGroup(db, loaded, tables);
 const temperature = await readGroup(db, loaded, temperatureTables);
 const materials = await readGroup(db, loaded, materialTables);
 const water = await readGroup(db, loaded, waterTables);
 const schedule = await readOptional(db, loaded, ['water_facility_slots', 'water_round_slots']);
 const filters = await readOptionalGroup(db, loaded, [
  'water_filters',
  'water_filter_flushes',
  'water_filter_flush_corrections',
  'water_filter_status_events'
 ]);
 const hides = await readOptionalGroup(db, loaded, ['facility_alert_visibility']);
 const unexpected = [core, temperature, materials, water, schedule, filters, hides].find(item => item?.ok === false);
 return {
  ok: !unexpected,
  error: unexpected?.error,
  installed: groupReady(core),
  temperatureInstalled: groupReady(temperature),
  materialsInstalled: groupReady(materials),
  waterInstalled: groupReady(water),
  waterFiltersInstalled: groupReady(filters),
  alertHidesInstalled: groupReady(hides),
  bundle: assemble(loaded, actor, context)
 };
}

async function readOptional(db, loaded, names) {
 for (const table of names) {
  const result = await readTable(db, table);
  if (result?.error) {
   if (!missingTable(result.error)) return {ok: false, error: storageMessage(result.error)};
   loaded[table] = [];
   continue;
  }
  loaded[table] = result?.data || [];
 }
 return {ok: true};
}

async function readOptionalGroup(db, loaded, names) {
 const first = await readTable(db, names[0]);
 if (first?.error) {
  if (!missingTable(first.error)) return {ok: false, error: storageMessage(first.error), installed: false};
  for (const name of names) loaded[name] = [];
  return {ok: true, installed: false};
 }
 loaded[names[0]] = first?.data || [];
 for (const table of names.slice(1)) {
  const result = await readTable(db, table);
  if (result?.error) {
   if (!missingTable(result.error)) return {ok: false, error: storageMessage(result.error), installed: false};
   loaded[table] = [];
   continue;
  }
  loaded[table] = result?.data || [];
 }
 return {ok: true, installed: true};
}

function owned(row, facility, actor) {
 return row?.facility_id === facility?.id && visible({...row, organization_id: row.organization_id || facility.organization_id}, actor);
}

function sameHistory(before, after, pointId) {
 const reading = items => (items?.temperatureReadings || []).filter(item => item.pointId === pointId).map(item => `${item.id}|${item.valueC}|${item.note}`).sort().join('\n');
 const alert = items => (items?.temperatureAlerts || []).filter(item => item.pointId === pointId).map(item => `${item.id}|${item.valueC}|${item.minC}|${item.maxC}|${item.status}|${item.remark}`).sort().join('\n');
 return reading(before) === reading(after) && alert(before) === alert(after);
}

export async function saveDailyReport(db, bundle, draft, actor, now, context) {
 const local = createDailyReport(bundle, draft, actor, now);
 if (!local.ok) return denied(bundle, local.error);
 const basePayload = {
  facility_id: draft.facility.id,
  report_date: draft.reportDate,
  incidents: local.report.incidents,
  handover: local.report.handover
 };
 const weatherPayload = String(draft.weatherSummary || '').trim()
  ? {
   weather_summary: String(draft.weatherSummary || '').trim().slice(0, 1000),
   weather_source: String(draft.weatherSource || '').trim().slice(0, 200),
   weather_kind: draft.weatherKind === 'observed' ? 'observed' : 'forecast',
   weather_observed_at: draft.weatherObservedAt || now
  }
  : null;
 let result;
 try {
  result = await db.insert('daily_reports', weatherPayload ? {...basePayload, ...weatherPayload} : basePayload);
  if (result?.error && weatherPayload && /weather_|schema cache|PGRST204|Could not find/i.test(String(result.error.message || result.error.code || ''))) {
   result = await db.insert('daily_reports', basePayload);
  }
 } catch (error) {
  if (weatherPayload && /weather_|schema cache|PGRST204|Could not find/i.test(String(error?.message || error?.code || ''))) {
   try {
    result = await db.insert('daily_reports', basePayload);
   } catch (retryError) {
    return denied(bundle, storageMessage(retryError));
   }
  } else {
   return denied(bundle, storageMessage(error));
  }
 }
 const saved = confirmed(result);
 if (!saved.ok || !owned(saved.data, draft.facility, actor)) return denied(bundle, saved.error || 'Die Speicherung wurde nicht bestätigt.');
 const report = mapReport({...saved.data, organization_id: saved.data.organization_id || draft.facility.organization_id}, context, actor, [], []);
 const next = {...emptyOperations(), ...bundle, reports: replace(bundle?.reports, report)};
 return {ok: true, id: report.id, bundle: next, report};
}

export async function saveDailyReportRevision(db, bundle, reportId, draft, actor, now, context) {
 const local = reviseDailyReport(bundle, reportId, draft, actor, now);
 if (!local.ok) return denied(bundle, local.error);
 const note = local.report.revisions[0].changeNote;
 let result;
 try {
  result = await db.rpc('tageswerk_update_daily_report', {
   p_report_id: reportId,
   p_incidents: local.report.incidents,
   p_handover: local.report.handover,
   p_change_note: note
  });
 } catch (error) {
  return denied(bundle, storageMessage(error));
 }
 const saved = confirmed(result);
 if (!saved.ok || saved.data.id !== reportId) return denied(bundle, saved.error || 'Die Speicherung wurde nicht bestätigt.');
 let history;
 try {
  history = await db.select('daily_report_revisions');
 } catch (error) {
  return denied(bundle, storageMessage(error));
 }
 if (history?.error) return denied(bundle, storageMessage(history.error));
 const revisions = (history.data || []).filter(row => row.report_id === reportId).map(row => mapRevision(row, context, actor));
 if (!revisions.some(row => row.changeNote === note)) return denied(bundle, 'Der Nachtrag wurde nicht bestätigt.');
 const report = mapReport(saved.data, context, actor, revisions.sort((a, b) => String(b.editedAt).localeCompare(String(a.editedAt))), local.report.defectIds);
 const next = {...emptyOperations(), ...bundle, reports: replace(bundle?.reports, report)};
 return {ok: true, id: report.id, bundle: next, report};
}

function figuresErrorText(error) {
 return [error?.code, error?.message, error?.details, error?.hint].filter(Boolean).join(' ');
}

export function figuresMissing(error) {
 const code = String(error?.code || '');
 const text = figuresErrorText(error);
 if (code === 'PGRST202' || /schema cache/i.test(text)) return false;
 if (code === '42883') return true;
 return /function .* does not exist/i.test(text);
}

export function figuresStorageMessage(error) {
 const text = figuresErrorText(error);
 if (/row-level security|42501|permission denied|Keine Berechtigung/i.test(text)) {
  return 'Keine Berechtigung für die Tageskennzahlen. Es wurde nichts gespeichert.';
 }
 if (/schema cache/i.test(text) || String(error?.code || '') === 'PGRST202') {
  return 'Die Kennzahlenfunktion ist in der Datenbank vorhanden, aber für die API noch nicht freigeschaltet. Bitte den Schema-Cache neu laden. Es wurde nichts gespeichert.';
 }
 if (figuresMissing(error)) {
  return 'Die Tageskennzahlen sind noch nicht in der Datenbank installiert. Es wurde nichts gespeichert.';
 }
 return storageMessage(error);
}

export function figureRpcArgs(draft, prepared) {
 const cents = value => value == null ? null : String(value);
 return {
  p_facility_id: draft.facility.id,
  p_service_day: draft.day,
  p_visitors: prepared.visitors,
  p_gate_cents: cents(prepared.gateCents),
  p_bistro_cents: cents(prepared.bistroCents),
  p_total_cents: cents(prepared.totalCents),
  p_change_note: String(draft.changeNote || '').trim(),
  p_source: prepared.source
 };
}

export async function saveDayFigures(db, draft, actor, today) {
 const access = draft?.access;
 const prepared = draft?.source === 'import' ? historicalFigurePayload(draft, access, today) : dayFigurePayload(draft, access, today);
 if (!prepared.ok) return denied(null, prepared.error);
 if (!draft?.facility?.id) return denied(null, 'Bitte zuerst einen Betrieb auswählen.');
 let result;
 try {
  result = await db.rpc('tageswerk_save_day_figures', figureRpcArgs(draft, prepared));
 } catch (error) {
  return denied(null, figuresStorageMessage(error));
 }
 const saved = confirmed(result);
 if (!saved.ok) return denied(null, result?.error ? figuresStorageMessage(result.error) : saved.error);
 return {ok: true, id: saved.data.id, bundle: null, figure: saved.data};
}

export async function loadDayFigureBoard(db, facilityId, range) {
 let overview;
 let period;
 try {
  overview = await db.rpc('tageswerk_day_figure_overview', {
   p_facility_id: facilityId,
   p_from: range?.from || null,
   p_to: range?.to || null,
   p_weekday: range?.weekday || 'all'
  });
  period = await db.rpc('tageswerk_day_figure_period', {p_facility_id: facilityId});
 } catch (error) {
  return {ok: false, missing: figuresMissing(error) || /schema cache|PGRST202/i.test(figuresErrorText(error)), error: figuresStorageMessage(error)};
 }
 if (overview?.error || period?.error) {
  const error = overview?.error || period?.error;
  return {ok: false, missing: figuresMissing(error) || /schema cache|PGRST202/i.test(figuresErrorText(error)), error: figuresStorageMessage(error)};
 }
 return {ok: true, overview: overview.data, period: period.data};
}

export async function importDayFiguresBatch(db, facilityId, fileName, rows) {
 const payload = (rows || []).map(row => ({
  day: row.day,
  visitors: row.visitors,
  total_cents: row.totalCents,
  action: row.action
 }));
 let result;
 try {
  result = await db.rpc('tageswerk_import_day_figures', {
   p_facility_id: facilityId,
   p_file_name: fileName,
   p_rows: payload
  });
 } catch (error) {
  return {ok: false, missing: figuresMissing(error) || /schema cache|PGRST202|42883/i.test(figuresErrorText(error)), error: figuresStorageMessage(error)};
 }
 if (result?.error) {
  return {ok: false, missing: figuresMissing(result.error) || /schema cache|PGRST202|42883/i.test(figuresErrorText(result.error)), error: figuresStorageMessage(result.error)};
 }
 return {ok: true, report: result.data};
}

export async function listDayFigureImports(db, facilityId) {
 let result;
 try {
  result = await db.from('facility_day_figure_imports').select('id,file_name,imported_at,inserted_count,updated_count,skipped_count,error_count,details').eq('facility_id', facilityId).order('imported_at', {ascending: false}).limit(20);
 } catch (error) {
  return {ok: false, missing: true, error: figuresStorageMessage(error), rows: []};
 }
 if (result?.error) return {ok: false, missing: /schema cache|PGRST205|42P01/i.test(result.error.message || ''), error: figuresStorageMessage(result.error), rows: []};
 return {ok: true, rows: result.data || []};
}

export async function saveReportDefect(db, bundle, reportId, defect, actor, context) {
 const local = linkReportDefect(bundle, reportId, defect);
 if (!local.ok) return denied(bundle, local.error);
 if (local.report.defectIds.length === (bundle?.reports || []).find(item => item.id === reportId)?.defectIds.length) {
  return {ok: true, id: reportId, bundle, report: local.report};
 }
 let result;
 try {
  result = await db.rpc('tageswerk_link_daily_report_defect', {p_report_id: reportId, p_defect_id: defect.id});
 } catch (error) {
  return denied(bundle, storageMessage(error));
 }
 const saved = confirmed(result);
 if (!saved.ok || saved.data.defect_id !== defect.id) return denied(bundle, saved.error || 'Die Mangelverknüpfung wurde nicht bestätigt.');
 const next = {...emptyOperations(), ...bundle, reports: replace(bundle?.reports, local.report)};
 return {ok: true, id: reportId, bundle: next, report: local.report};
}

export async function saveInspectionTemplate(db, bundle, draft, actor, now, context) {
 const local = createInspectionTemplate(bundle, draft, actor, now);
 if (!local.ok) return denied(bundle, local.error);
 let result;
 try {
  result = await db.rpc('tageswerk_create_inspection_template', {
   p_facility_id: draft.facility.id,
   p_name: local.template.name,
   p_interval_count: local.template.intervalCount,
   p_interval_unit: local.template.intervalUnit,
   p_labels: local.template.points.map(point => point.label)
  });
 } catch (error) {
  return denied(bundle, storageMessage(error));
 }
 const saved = confirmed(result);
 if (!saved.ok) return denied(bundle, saved.error);
 let loaded;
 try {
  loaded = await loadOperations(db, actor, context);
 } catch (error) {
  return denied(bundle, storageMessage(error));
 }
 const template = loaded.ok ? loaded.bundle.templates.find(item => item.id === saved.data.id) : null;
 if (!template || template.facilityId !== draft.facility.id || template.points.length !== local.template.points.length) {
  return denied(bundle, 'Die Checkliste wurde nicht bestätigt.');
 }
 return {ok: true, id: template.id, bundle: loaded.bundle, template};
}

export async function saveInspectionAssignment(db, bundle, templateId, draft, actor, now, context) {
 const local = assignInspection(bundle, templateId, draft, actor, now);
 if (!local.ok) return denied(bundle, local.error);
 let result;
 try {
  result = await db.rpc('tageswerk_assign_inspection', {
   p_template_id: templateId,
   p_assigned_to: draft.assignedTo,
   p_due_at: local.run.dueAt
  });
 } catch (error) {
  return denied(bundle, storageMessage(error));
 }
 const saved = confirmed(result);
 if (!saved.ok) return denied(bundle, saved.error);
 const loaded = await loadOperations(db, actor, context);
 const run = loaded.ok ? loaded.bundle.runs.find(item => item.id === saved.data.id) : null;
 if (!run || run.status !== 'open' || run.assignedTo !== draft.assignedTo) return denied(bundle, 'Der Kontrollgang wurde nicht bestätigt.');
 return {ok: true, id: run.id, bundle: loaded.bundle, run};
}

export async function saveInspectionResult(db, bundle, runId, results, actor, now, context) {
 const local = recordInspection(bundle, runId, results, actor, now);
 if (!local.ok) return denied(bundle, local.error);
 let result;
 try {
  result = await db.rpc('tageswerk_complete_inspection', {
   p_run_id: runId,
   p_results: results.map(item => ({point_id: item.id, mark: item.mark, note: item.note || ''}))
  });
 } catch (error) {
  return denied(bundle, storageMessage(error));
 }
 const saved = confirmed(result);
 if (!saved.ok || saved.data.status !== 'completed') return denied(bundle, saved.error || 'Die Kontrolle wurde nicht bestätigt.');
 const loaded = await loadOperations(db, actor, context);
 const run = loaded.ok ? loaded.bundle.runs.find(item => item.id === runId) : null;
 if (!run || run.status !== 'completed') return denied(bundle, 'Die Kontrolle wurde nicht bestätigt.');
 return {ok: true, id: run.id, bundle: loaded.bundle, run, notable: run.points.filter(point => point.mark === 'notable')};
}

export async function saveInspectionDefect(db, bundle, runId, pointId, actor, context) {
 const run = (bundle?.runs || []).find(item => item.id === runId);
 const point = run?.points.find(item => item.id === pointId);
 if (!run || point?.mark !== 'notable') return denied(bundle, 'Nur eine Auffälligkeit kann ein Mangel werden.');
 let result;
 try {
  result = await db.rpc('tageswerk_defect_from_inspection', {p_run_id: runId, p_point_id: pointId});
 } catch (error) {
  return denied(bundle, storageMessage(error));
 }
 const saved = confirmed(result);
 if (!saved.ok || saved.data.facility_id !== run.facilityId) return denied(bundle, saved.error || 'Der Mangel wurde nicht bestätigt.');
 const points = run.points.map(item => item.id === pointId ? {...item, defectId: saved.data.id} : item);
 const updated = {...run, points};
 const next = {...emptyOperations(), ...bundle, runs: replace(bundle.runs, updated)};
 return {ok: true, id: saved.data.id, bundle: next, run: updated};
}

export async function saveAssetRecord(db, bundle, draft, actor, now, context) {
 const local = createAsset(bundle, draft, actor, now);
 if (!local.ok) return denied(bundle, local.error);
 let result;
 try {
  result = await db.insert('assets', {
   facility_id: draft.facility.id,
   name: local.asset.name,
   location: local.asset.location,
   interval_count: local.asset.intervalCount,
   interval_unit: local.asset.intervalUnit,
   responsible_user_id: local.asset.responsibleUserId,
   anchor_at: local.asset.anchorAt
  });
 } catch (error) {
  return denied(bundle, storageMessage(error));
 }
 const saved = confirmed(result);
 if (!saved.ok || !owned(saved.data, draft.facility, actor)) return denied(bundle, saved.error || 'Die Speicherung wurde nicht bestätigt.');
 const loaded = await loadOperations(db, actor, context);
 const asset = loaded.ok ? loaded.bundle.assets.find(item => item.id === saved.data.id) : null;
 if (!asset) return denied(bundle, 'Die Anlage wurde nicht bestätigt.');
 return {ok: true, id: asset.id, bundle: loaded.bundle, asset};
}

export async function saveMaintenanceLog(db, bundle, assetId, note, actor, now, context) {
 const local = completeMaintenance(bundle, assetId, note, actor, now);
 if (!local.ok) return denied(bundle, local.error);
 let result;
 try {
  result = await db.insert('maintenance_logs', {asset_id: assetId, note: local.asset.logs[0].note});
 } catch (error) {
  return denied(bundle, storageMessage(error));
 }
 const saved = confirmed(result);
 if (!saved.ok || saved.data.asset_id !== assetId) return denied(bundle, saved.error || 'Die Wartung wurde nicht bestätigt.');
 const loaded = await loadOperations(db, actor, context);
 const asset = loaded.ok ? loaded.bundle.assets.find(item => item.id === assetId) : null;
 if (!asset?.logs.some(item => item.id === saved.data.id)) return denied(bundle, 'Die Wartung wurde nicht bestätigt.');
 return {ok: true, id: saved.data.id, bundle: loaded.bundle, asset};
}

export async function saveAssetDefect(db, bundle, assetId, defect) {
 const previous = (bundle?.assets || []).find(item => item.id === assetId);
 if (previous?.defectIds.includes(defect?.id)) return {ok: true, id: assetId, bundle, asset: previous};
 const local = linkAssetDefect(bundle, assetId, defect);
 if (!local.ok) return denied(bundle, local.error);
 let result;
 try {
  result = await db.insert('asset_defects', {asset_id: assetId, defect_id: defect.id});
 } catch (error) {
  return denied(bundle, storageMessage(error));
 }
 if (result?.error) return denied(bundle, storageMessage(result.error));
 const data = Array.isArray(result?.data) ? result.data[0] : result?.data;
 if (data?.asset_id !== assetId || data?.defect_id !== defect.id) return denied(bundle, 'Die Mangelverknüpfung wurde nicht bestätigt.');
 const next = {...emptyOperations(), ...bundle, assets: replace(bundle.assets, local.asset)};
 return {ok: true, id: assetId, bundle: next, asset: local.asset};
}

export async function saveProcurementRequest(db, bundle, draft, actor, now, context) {
 const local = createProcurement(bundle, draft, actor, now);
 if (!local.ok) return denied(bundle, local.error);
 let result;
 try {
  const payload = {
   facility_id: draft.facility.id,
   title: local.request.title,
   quantity: local.request.quantity,
   unit: local.request.unit,
   reason: local.request.reason,
   urgency: local.request.urgency,
   defect_id: local.request.defectId
  };
  if (local.request.materialId) payload.material_id = local.request.materialId;
  result = await db.insert('procurement_requests', payload);
 } catch (error) {
  return denied(bundle, storageMessage(error));
 }
 const saved = confirmed(result);
 if (!saved.ok || saved.data.status !== 'submitted' || !owned(saved.data, draft.facility, actor)) {
  return denied(bundle, saved.error || 'Die Speicherung wurde nicht bestätigt.');
 }
 const loaded = await loadOperations(db, actor, context);
 const request = loaded.ok ? loaded.bundle.requests.find(item => item.id === saved.data.id) : null;
 if (!request || request.status !== 'submitted') return denied(bundle, 'Die Anfrage wurde nicht bestätigt.');
 return {ok: true, id: request.id, bundle: loaded.bundle, request};
}

export async function saveProcurementReview(db, bundle, requestId, decision, note, actor, now, context) {
 const local = reviewProcurement(bundle, requestId, decision, note, actor, now);
 if (!local.ok) return denied(bundle, local.error);
 let result;
 try {
  result = await db.update('procurement_requests', requestId, {status: decision, review_note: local.request.reviewNote});
 } catch (error) {
  return denied(bundle, storageMessage(error));
 }
 const saved = confirmed(result);
 if (!saved.ok || saved.data.status !== decision || saved.data.reviewed_by !== actor.userId) {
  return denied(bundle, saved.error || 'Die Entscheidung wurde nicht bestätigt.');
 }
 const loaded = await loadOperations(db, actor, context);
 const request = loaded.ok ? loaded.bundle.requests.find(item => item.id === requestId) : null;
 if (!request || request.status !== decision) return denied(bundle, 'Die Entscheidung wurde nicht bestätigt.');
 return {ok: true, id: request.id, bundle: loaded.bundle, request};
}

export async function saveTemperaturePoint(db, bundle, draft, actor, now, context) {
 const local = createTemperaturePoint(bundle, draft, actor, now);
 if (!local.ok) return denied(bundle, local.error);
 let result;
 try {
  result = await db.insert('temperature_points', {
   facility_id: draft.facility.id,
   name: local.point.name,
   location: local.point.location,
   minimum_celsius: local.point.minC,
   maximum_celsius: local.point.maxC,
   interval_unit: local.point.intervalUnit,
   interval_count: local.point.intervalCount,
   active: true
  });
 } catch (error) {
  return denied(bundle, storageMessage(error));
 }
 const saved = confirmed(result);
 if (!saved.ok || saved.data.created_by !== actor.userId || !owned(saved.data, draft.facility, actor)) {
  return denied(bundle, saved.error || 'Die Messstelle wurde nicht bestätigt.');
 }
 const loaded = await loadOperations(db, actor, context);
 const point = loaded.ok ? loaded.bundle.temperaturePoints.find(item => item.id === saved.data.id) : null;
 if (!point || point.facilityId !== draft.facility.id) return denied(bundle, 'Die Messstelle wurde nicht bestätigt.');
 return {ok: true, id: point.id, bundle: loaded.bundle, point};
}

export async function saveTemperaturePointChange(db, bundle, pointId, draft, actor, now, context) {
 const local = updateTemperaturePoint(bundle, pointId, draft, actor);
 if (!local.ok) return denied(bundle, local.error);
 let result;
 try {
  result = await db.update('temperature_points', pointId, {
   name: local.point.name,
   location: local.point.location,
   minimum_celsius: local.point.minC,
   maximum_celsius: local.point.maxC,
   interval_unit: local.point.intervalUnit,
   interval_count: local.point.intervalCount
  });
 } catch (error) {
  return denied(bundle, storageMessage(error));
 }
 const saved = confirmed(result);
 if (!saved.ok || saved.data.name !== local.point.name || Number(saved.data.minimum_celsius) !== Number(local.point.minC) || Number(saved.data.maximum_celsius) !== Number(local.point.maxC)) {
  return denied(bundle, saved.error || 'Die Messstelle wurde nicht bestätigt.');
 }
 const loaded = await loadOperations(db, actor, context);
 const point = loaded.ok ? loaded.bundle.temperaturePoints.find(item => item.id === pointId) : null;
 if (!point || point.name !== local.point.name || Number(point.minC) !== Number(local.point.minC) || point.intervalUnit !== local.point.intervalUnit || Number(point.intervalCount) !== Number(local.point.intervalCount)) {
  return denied(bundle, 'Die Messstelle wurde nicht bestätigt.');
 }
 if (!sameHistory(bundle, loaded.bundle, pointId)) return denied(bundle, 'Die Historie wurde nicht unverändert bestätigt.');
 return {ok: true, id: point.id, bundle: loaded.bundle, point};
}

export async function saveTemperaturePointActive(db, bundle, pointId, active, actor, now, context) {
 const local = setTemperaturePointActive(bundle, pointId, active, actor);
 if (!local.ok) return denied(bundle, local.error);
 let result;
 try {
  result = await db.update('temperature_points', pointId, {active: local.point.active});
 } catch (error) {
  return denied(bundle, storageMessage(error));
 }
 const saved = confirmed(result);
 if (!saved.ok || Boolean(saved.data.active) !== local.point.active) return denied(bundle, saved.error || 'Die Messstelle wurde nicht bestätigt.');
 const loaded = await loadOperations(db, actor, context);
 const point = loaded.ok ? loaded.bundle.temperaturePoints.find(item => item.id === pointId) : null;
 if (!point || point.active !== local.point.active) return denied(bundle, 'Die Messstelle wurde nicht bestätigt.');
 if (!sameHistory(bundle, loaded.bundle, pointId)) return denied(bundle, 'Die Historie wurde nicht unverändert bestätigt.');
 return {ok: true, id: point.id, bundle: loaded.bundle, point};
}

export async function saveTemperatureReading(db, bundle, pointId, draft, actor, now, context) {
 const local = recordTemperature(bundle, pointId, draft, actor, now);
 if (!local.ok) return denied(bundle, local.error);
 let result;
 try {
  result = await db.insert('temperature_readings', {
   point_id: pointId,
   facility_id: local.reading.facilityId,
   value_celsius: local.reading.valueC,
   note: local.reading.note
  });
 } catch (error) {
  return denied(bundle, storageMessage(error));
 }
 const saved = confirmed(result);
 if (!saved.ok || saved.data.recorded_by !== actor.userId || saved.data.point_id !== pointId) {
  return denied(bundle, saved.error || 'Die Messung wurde nicht bestätigt.');
 }
 const loaded = await loadOperations(db, actor, context);
 const reading = loaded.ok ? loaded.bundle.temperatureReadings.find(item => item.id === saved.data.id) : null;
 if (!reading || reading.recordedBy !== actor.userId || !reading.measuredAt) return denied(bundle, 'Die Messung wurde nicht bestätigt.');
 if (local.alert) {
  const alert = loaded.bundle.temperatureAlerts.find(item => item.readingId === reading.id && item.status === 'open');
  if (!alert) return denied(bundle, 'Die Grenzwertwarnung wurde nicht bestätigt.');
  return {ok: true, id: reading.id, bundle: loaded.bundle, reading, alert};
 }
 return {ok: true, id: reading.id, bundle: loaded.bundle, reading, alert: null};
}

export async function saveTemperatureAcknowledgement(db, bundle, alertId, remark, actor, now, context) {
 const local = acknowledgeTemperatureAlert(bundle, alertId, remark, actor, now);
 if (!local.ok) return denied(bundle, local.error);
 let result;
 try {
  result = await db.update('temperature_alerts', alertId, {status: 'acknowledged', remark: local.alert.remark});
 } catch (error) {
  return denied(bundle, storageMessage(error));
 }
 const saved = confirmed(result);
 if (!saved.ok || saved.data.status !== 'acknowledged' || saved.data.acknowledged_by !== actor.userId || !saved.data.acknowledged_at) {
  return denied(bundle, saved.error || 'Die Quittierung wurde nicht bestätigt.');
 }
 const loaded = await loadOperations(db, actor, context);
 const alert = loaded.ok ? loaded.bundle.temperatureAlerts.find(item => item.id === alertId) : null;
 if (!alert || alert.status !== 'acknowledged' || alert.acknowledgedBy !== actor.userId || alert.remark !== local.alert.remark) {
  return denied(bundle, 'Die Quittierung wurde nicht bestätigt.');
 }
 return {ok: true, id: alert.id, bundle: loaded.bundle, alert};
}

export async function saveMaterial(db, bundle, draft, actor, now, context) {
 const local = createMaterial(bundle, draft, actor, now);
 if (!local.ok) return denied(bundle, local.error);
 let result;
 try {
  result = await db.insert('materials', {
   facility_id: draft.facility.id,
   name: local.material.name,
   location: local.material.location,
   unit: local.material.unit,
   minimum_quantity: local.material.minimum
  });
 } catch (error) {
  return denied(bundle, storageMessage(error));
 }
 const saved = confirmed(result);
 if (!saved.ok || saved.data.created_by !== actor.userId || !owned(saved.data, draft.facility, actor)) {
  return denied(bundle, saved.error || 'Das Material wurde nicht bestätigt.');
 }
 const loaded = await loadOperations(db, actor, context);
 const material = loaded.bundle?.materials?.find(item => item.id === saved.data.id);
 if (!material) return denied(loaded.bundle || bundle, loaded.ok === false ? loaded.error : 'Das Material wurde nicht bestätigt.');
 return {ok: true, id: material.id, bundle: loaded.bundle, material};
}

export async function saveMaterialMovement(db, bundle, draft, actor, now, context) {
 const local = recordMovement(bundle, draft, actor, now);
 if (!local.ok) return denied(bundle, local.error);
 let result;
 try {
  result = await db.insert('material_movements', {
   material_id: local.movement.materialId,
   facility_id: local.movement.facilityId,
   direction: local.movement.direction,
   quantity: local.movement.quantity,
   note: local.movement.note,
   maintenance_log_id: local.movement.maintenanceLogId
  });
 } catch (error) {
  return denied(bundle, storageMessage(error));
 }
 const saved = confirmed(result);
 if (!saved.ok || saved.data.recorded_by !== actor.userId || saved.data.material_id !== local.movement.materialId) {
  return denied(bundle, saved.error || 'Die Buchung wurde nicht bestätigt.');
 }
 const loaded = await loadOperations(db, actor, context);
 const movement = loaded.bundle?.movements?.find(item => item.id === saved.data.id);
 if (!movement || Number(movement.quantity) !== Number(local.movement.quantity)) {
  return denied(loaded.bundle || bundle, loaded.ok === false ? loaded.error : 'Die Buchung wurde nicht bestätigt.');
 }
 return {ok: true, id: movement.id, bundle: loaded.bundle, movement};
}

export async function saveMaterialChange(db, bundle, materialId, draft, actor, now, context) {
 const local = updateMaterial(bundle, materialId, draft, actor, now);
 if (!local.ok) return denied(bundle, local.error);
 const payload = {
  name: local.material.name,
  location: local.material.location,
  unit: local.material.unit,
  minimum_quantity: local.material.minimum
 };
 if (draft?.active != null) payload.is_active = local.material.active;
 let result;
 try {
  result = await db.update('materials', materialId, payload);
 } catch (error) {
  return denied(bundle, storageMessage(error));
 }
 if (result?.error && payload.is_active != null && /is_active|PGRST204/i.test(`${result.error.code || ''} ${result.error.message || ''}`)) {
  delete payload.is_active;
  try { result = await db.update('materials', materialId, payload); }
  catch (error) { return denied(bundle, storageMessage(error)); }
 }
 const saved = confirmed(result);
 if (!saved.ok) return denied(bundle, saved.error || 'Die Materialänderung wurde nicht bestätigt.');
 const loaded = await loadOperations(db, actor, context);
 const material = loaded.bundle?.materials?.find(item => item.id === materialId);
 if (!material) return denied(loaded.bundle || bundle, loaded.ok === false ? loaded.error : 'Die Materialänderung wurde nicht bestätigt.');
 return {ok: true, id: material.id, bundle: loaded.bundle, material};
}

function waterHistory(items, poolId) {
 const reading = (items?.waterChecks || []).filter(item => item.poolId === poolId).map(item => `${item.id}|${item.note}|${item.followUpAlertId || ''}|${JSON.stringify(item.readings)}`).sort().join('\n');
 const alert = (items?.waterAlerts || []).filter(item => item.poolId === poolId).map(item => `${item.id}|${item.parameterCode}|${item.value}|${item.minLimit}|${item.maxLimit}|${item.status}|${item.acknowledgementNote}`).sort().join('\n');
 return `${reading}\n${alert}`;
}

function sameWaterHistory(before, after, poolId) {
 return waterHistory(before, poolId) === waterHistory(after, poolId);
}

export async function saveWaterPool(db, bundle, draft, actor, now, context) {
 const local = createWaterPool(bundle, draft, actor, now);
 if (!local.ok) return denied(bundle, local.error);
 let result;
 try {
  result = await db.insert('water_pools', {
   facility_id: draft.facility.id,
   name: local.pool.name,
   schedule_mode: local.pool.scheduleMode,
   interval_count: local.pool.intervalCount,
   scheduled_times: local.pool.scheduledTimes,
   weekdays: local.pool.weekdays,
   active: true
  });
 } catch (error) {
  return denied(bundle, storageMessage(error));
 }
 const saved = confirmed(result);
 if (!saved.ok || saved.data.created_by !== actor.userId || !owned(saved.data, draft.facility, actor)) {
  return denied(bundle, saved.error || 'Das Becken wurde nicht bestätigt.');
 }
 const loaded = await loadOperations(db, actor, context);
 const pool = loaded.ok ? loaded.bundle.waterPools.find(item => item.id === saved.data.id) : null;
 const seeded = pool ? loaded.bundle.waterPoolParameters.filter(item => item.poolId === pool.id) : [];
 if (!pool || pool.name !== local.pool.name || pool.scheduleMode !== local.pool.scheduleMode || seeded.length < waterCatalog(loaded.bundle).length) {
  return denied(bundle, 'Das Becken wurde nicht bestätigt.');
 }
 return {ok: true, id: pool.id, bundle: loaded.bundle, pool};
}

export async function saveWaterPoolChange(db, bundle, poolId, draft, actor, now, context) {
 const local = updateWaterPool(bundle, poolId, draft, actor);
 if (!local.ok) return denied(bundle, local.error);
 let result;
 try {
  result = await db.update('water_pools', poolId, {
   name: local.pool.name,
   schedule_mode: local.pool.scheduleMode,
   interval_count: local.pool.intervalCount,
   scheduled_times: local.pool.scheduledTimes,
   weekdays: local.pool.weekdays
  });
 } catch (error) {
  return denied(bundle, storageMessage(error));
 }
 const saved = confirmed(result);
 if (!saved.ok || saved.data.name !== local.pool.name) return denied(bundle, saved.error || 'Das Becken wurde nicht bestätigt.');
 const loaded = await loadOperations(db, actor, context);
 const pool = loaded.ok ? loaded.bundle.waterPools.find(item => item.id === poolId) : null;
 if (!pool || pool.name !== local.pool.name || pool.scheduleMode !== local.pool.scheduleMode || Number(pool.intervalCount) !== Number(local.pool.intervalCount)) {
  return denied(bundle, 'Das Becken wurde nicht bestätigt.');
 }
 if (!sameWaterHistory(bundle, loaded.bundle, poolId)) return denied(bundle, 'Die Historie wurde nicht unverändert bestätigt.');
 return {ok: true, id: pool.id, bundle: loaded.bundle, pool};
}

export async function saveWaterPoolActive(db, bundle, poolId, active, actor, now, context) {
 const local = setWaterPoolActive(bundle, poolId, active, actor);
 if (!local.ok) return denied(bundle, local.error);
 let result;
 try {
  result = await db.update('water_pools', poolId, {active: local.pool.active});
 } catch (error) {
  return denied(bundle, storageMessage(error));
 }
 const saved = confirmed(result);
 if (!saved.ok || Boolean(saved.data.active) !== local.pool.active) return denied(bundle, saved.error || 'Das Becken wurde nicht bestätigt.');
 const loaded = await loadOperations(db, actor, context);
 const pool = loaded.ok ? loaded.bundle.waterPools.find(item => item.id === poolId) : null;
 if (!pool || pool.active !== local.pool.active) return denied(bundle, 'Das Becken wurde nicht bestätigt.');
 if (!sameWaterHistory(bundle, loaded.bundle, poolId)) return denied(bundle, 'Die Historie wurde nicht unverändert bestätigt.');
 return {ok: true, id: pool.id, bundle: loaded.bundle, pool};
}

export async function saveWaterParameter(db, bundle, parameterId, draft, actor, now, context) {
 const local = updateWaterParameter(bundle, parameterId, draft, actor);
 if (!local.ok) return denied(bundle, local.error);
 let result;
 try {
  result = await db.update('water_pool_parameters', parameterId, {
   min_value: local.parameter.minValue,
   max_value: local.parameter.maxValue,
   required: local.parameter.required,
   active: local.parameter.active
  });
 } catch (error) {
  return denied(bundle, storageMessage(error));
 }
 const saved = confirmed(result);
 if (!saved.ok) return denied(bundle, saved.error || 'Der Parameter wurde nicht bestätigt.');
 const loaded = await loadOperations(db, actor, context);
 const parameter = loaded.ok ? loaded.bundle.waterPoolParameters.find(item => item.id === parameterId) : null;
 const sameLimit = (left, right) => (left == null && right == null) || Number(left) === Number(right);
 if (!parameter || !sameLimit(parameter.minValue, local.parameter.minValue) || !sameLimit(parameter.maxValue, local.parameter.maxValue) || parameter.required !== local.parameter.required || parameter.active !== local.parameter.active) {
  return denied(bundle, 'Der Parameter wurde nicht bestätigt.');
 }
 if (!sameWaterHistory(bundle, loaded.bundle, parameter.poolId)) return denied(bundle, 'Die Historie wurde nicht unverändert bestätigt.');
 return {ok: true, id: parameter.id, bundle: loaded.bundle, parameter};
}

export async function saveWaterParameterAdd(db, bundle, poolId, parameterCode, actor, now, context) {
 const local = addWaterParameter(bundle, poolId, parameterCode, actor, now);
 if (!local.ok) return denied(bundle, local.error);
 let result;
 try {
  result = await db.insert('water_pool_parameters', {
   pool_id: poolId,
   facility_id: local.parameter.facilityId,
   parameter_code: local.parameter.parameterCode,
   required: true,
   active: true,
   min_value: null,
   max_value: null
  });
 } catch (error) {
  return denied(bundle, storageMessage(error));
 }
 const saved = confirmed(result);
 if (!saved.ok || saved.data.pool_id !== poolId || saved.data.parameter_code !== parameterCode) {
  return denied(bundle, saved.error || 'Der Parameter wurde nicht bestätigt.');
 }
 const loaded = await loadOperations(db, actor, context);
 const parameter = loaded.ok ? loaded.bundle.waterPoolParameters.find(item => item.id === saved.data.id) : null;
 if (!parameter || parameter.poolId !== poolId) return denied(bundle, 'Der Parameter wurde nicht bestätigt.');
 return {ok: true, id: parameter.id, bundle: loaded.bundle, parameter};
}

export async function saveWaterCheck(db, bundle, poolId, draft, actor, now, context) {
 const local = recordWaterCheck(bundle, poolId, draft, actor, now);
 if (!local.ok) return denied(bundle, local.error);
 let result;
 try {
  result = await db.insert('water_checks', {
   pool_id: poolId,
   facility_id: local.check.facilityId,
   note: local.check.note,
   follow_up_alert_id: local.check.followUpAlertId,
   readings: local.check.readings.map(reading => ({parameter_code: reading.parameterCode, value: reading.value}))
  });
 } catch (error) {
  return denied(bundle, storageMessage(error));
 }
 const saved = confirmed(result);
 if (!saved.ok || saved.data.recorded_by !== actor.userId || saved.data.pool_id !== poolId || !saved.data.measured_at) {
  return denied(bundle, saved.error || 'Die Messung wurde nicht bestätigt.');
 }
 const loaded = await loadOperations(db, actor, context);
 const check = loaded.ok ? loaded.bundle.waterChecks.find(item => item.id === saved.data.id) : null;
 if (!check || check.recordedBy !== actor.userId || !check.measuredAt) return denied(bundle, 'Die Messung wurde nicht bestätigt.');
 const open = loaded.bundle.waterAlerts.filter(item => item.checkId === check.id && item.status === 'open');
 if (open.length !== local.alerts.length) return denied(bundle, 'Die Grenzwertwarnung wurde nicht bestätigt.');
 for (const expected of local.alerts) {
  const alert = open.find(item => item.parameterCode === expected.parameterCode);
  if (!alert || Number(alert.value) !== Number(expected.value) || String(alert.minLimit) !== String(expected.minLimit) || String(alert.maxLimit) !== String(expected.maxLimit)) {
   return denied(bundle, 'Die Grenzwertwarnung wurde nicht bestätigt.');
  }
 }
 return {ok: true, id: check.id, bundle: loaded.bundle, check, alerts: open};
}

export async function saveWaterRoundDraft(db, round) {
 const kept = round;
 if (!round?.roundId || !round.facilityId || round.saved) {
  return {ok: false, offline: false, conflict: false, round: kept, error: 'Der Entwurf ist unvollständig.'};
 }
 let result;
 try {
  result = await db.rpc('tageswerk_save_water_round_draft', {
   p_facility_id: round.facilityId,
   p_round_id: round.roundId,
   p_entries: round.entries || {},
   p_progress: {
    index: round.index || 0,
    phase: round.phase === 'summary' ? 'summary' : 'edit',
    slotId: round.slotId || null,
    kind: round.kind === 'planned' || round.kind === 'extra' ? round.kind : '',
    slotTime: round.slotTime || '',
    selectedPoolIds: Array.isArray(round.selectedPoolIds) ? round.selectedPoolIds : []
   },
   p_revision: Number(round.revision) || 0
  });
 } catch (error) {
  return {ok: false, offline: true, conflict: false, round: kept, error: storageMessage(error)};
 }
 if (result?.error) {
  return {ok: false, offline: true, conflict: false, round: kept, error: storageMessage(result.error)};
 }
 const payload = result?.data && typeof result.data === 'object' && !Array.isArray(result.data) ? result.data : null;
 if (payload?.status === 'conflict') {
  return {ok: false, offline: false, conflict: true, round: kept, revision: payload.revision, error: waterDraftStatusText.conflict};
 }
 if (payload?.status !== 'stored' || payload.round_id !== round.roundId || !payload.revision) {
  return {ok: false, offline: true, conflict: false, round: kept, error: 'Der Entwurf wurde nicht bestätigt.'};
 }
 return {ok: true, offline: false, conflict: false, round: {...kept, revision: payload.revision}, revision: payload.revision};
}

function withoutOpenRound(bundle, round) {
 if (!bundle) return bundle;
 return {
  ...bundle,
  waterRoundDrafts: (bundle.waterRoundDrafts || []).filter(draft => !(draft.roundId === round?.roundId && draft.facilityId === round?.facilityId))
 };
}

function rememberCompletedRound(bundle, round, actor, now) {
 const next = withoutOpenRound(bundle, round);
 if (round?.kind !== 'planned' && round?.kind !== 'extra') return next;
 if ((next.waterRoundSlots || []).some(item => item.roundId === round.roundId)) return next;
 return {
  ...next,
  waterRoundSlots: [...(next.waterRoundSlots || []), {
   id: `local-${round.roundId}`,
   facilityId: round.facilityId,
   organizationId: '',
   roundId: round.roundId,
   slotId: round.kind === 'planned' ? round.slotId : null,
   kind: round.kind,
   slotTime: round.kind === 'planned' ? (round.slotTime || '') : '',
   serviceDay: berlinDay(now),
   userId: actor.userId
  }]
 };
}

export async function discardWaterRound(db, round) {
 if (!round?.roundId) return {ok: false, error: 'Der Entwurf ist unvollständig.'};
 let result;
 try {
  result = await db.rpc('tageswerk_discard_water_round_draft', {p_round_id: round.roundId});
 } catch (error) {
  return {ok: false, error: storageMessage(error)};
 }
 if (result?.error) return {ok: false, error: storageMessage(result.error)};
 const payload = result?.data && typeof result.data === 'object' && !Array.isArray(result.data) ? result.data : null;
 if (payload?.status === 'discarded' && payload.round_id === round.roundId) return {ok: true, id: round.roundId};
 if (payload?.status === 'absent') return {ok: false, absent: true, error: 'Kein eigener offener Entwurf.'};
 return {ok: false, error: 'Der Entwurf wurde nicht verworfen.'};
}

function reportedWaterRoundFailure(error) {
 const code = String(error?.code || '');
 const raw = String(error?.message || '');
 const logged = raw
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[ohne personenbezogene Daten]')
  .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[ohne personenbezogene Daten]')
  .replace(/"(?:[^"\\]|\\.)*"/g, '"…"')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 240);
 console.error('tageswerk_record_water_round', code, logged);
 const message = raw.replace(/[ \t]+/g, ' ').trim();
 const suitable = message.length > 0
  && message.length < 240
  && !/[\r\n]/.test(raw)
  && !/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(message)
  && !/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|bearer\s+/i.test(message)
  && !/p_checks|parameter_code|"readings"/i.test(message);
 return suitable
  ? message
  : 'Die Kontrollrunde konnte nicht abgeschlossen werden. Die Eingaben bleiben erhalten.';
}

export async function saveWaterRound(db, bundle, round, actor, now, context) {
 const review = reviewWaterRound(bundle, round, actor, now);
 if (!review.ok) return denied(bundle, review.error);
 if (round?.kind === 'planned' && !round.slotId) return denied(bundle, 'Die Kontrollrunde ist keinem Termin zugeordnet.');
 const scheduled = round?.kind === 'planned' || round?.kind === 'extra';
 const rpcName = scheduled ? 'tageswerk_record_scheduled_water_round' : 'tageswerk_record_water_round';
 const args = {
  p_round_id: round.roundId,
  p_checks: review.checks.map(check => ({
   pool_id: check.poolId,
   facility_id: check.facilityId,
   note: check.note,
   readings: check.readings.map(reading => ({parameter_code: reading.parameterCode, value: reading.value}))
  }))
 };
 if (scheduled) args.p_slot_id = round.kind === 'planned' ? round.slotId : null;
 const occupiedSlot = async message => {
  if (!(scheduled && round?.kind === 'planned' && message === 'Dieser Termin wurde bereits abgeschlossen.')) return null;
  const loaded = await loadOperations(db, actor, context);
  return {
   ok: false,
   conflict: true,
   error: 'Dieser Termin wurde bereits abgeschlossen. Die eingegebenen Messwerte bleiben erhalten.',
   bundle: loaded.ok ? loaded.bundle : bundle
  };
 };
 let result;
 try {
  result = await db.rpc(rpcName, args);
 } catch (error) {
  const message = reportedWaterRoundFailure(error);
  return await occupiedSlot(message) || denied(bundle, message);
 }
 if (result?.error) {
  const message = reportedWaterRoundFailure(result.error);
  return await occupiedSlot(message) || denied(bundle, message);
 }
 const payload = result?.data && typeof result.data === 'object' && !Array.isArray(result.data) ? result.data : null;
 if (payload?.status === 'already_stored' && payload.round_id === round.roundId) {
  if (!scheduled) return {ok: true, id: round.roundId, ids: [], bundle: withoutOpenRound(bundle, round)};
  const confirmed = await loadOperations(db, actor, context);
  if (!confirmed.ok) return denied(bundle, 'Die Kontrollrunde wurde nicht vollständig bestätigt.');
  const linked = (confirmed.bundle.waterRoundSlots || []).some(item => item.roundId === round.roundId && item.facilityId === round.facilityId);
  if (!linked) return denied(bundle, 'Die Kontrollrunde wurde nicht vollständig bestätigt.');
  return {ok: true, id: round.roundId, ids: [], bundle: withoutOpenRound(confirmed.bundle, round)};
 }
 const ids = Array.isArray(payload?.ids) ? payload.ids : [];
 if (payload?.status !== 'stored' || payload.round_id !== round.roundId || ids.length !== review.checks.length) {
  return denied(bundle, 'Die Kontrollrunde wurde nicht vollständig bestätigt.');
 }
 const facility = {id: review.checks[0].facilityId, organization_id: review.checks[0].organizationId};
 if (!waterHistoryRole(facility, actor.memberships)) return {ok: true, id: round.roundId, ids, bundle: rememberCompletedRound(bundle, round, actor, now)};
 const loaded = await loadOperations(db, actor, context);
 if (!loaded.ok) return denied(bundle, 'Die Kontrollrunde wurde nicht vollständig bestätigt.');
 for (const expected of review.checks) {
  const check = loaded.bundle.waterChecks.find(item => item.roundId === round.roundId && item.poolId === expected.poolId && item.recordedBy === actor.userId);
  if (!check || check.readings.length !== expected.readings.length) return denied(bundle, 'Die Kontrollrunde wurde nicht vollständig bestätigt.');
  for (const reading of expected.readings) {
   const saved = check.readings.find(item => item.parameterCode === reading.parameterCode);
   if (!saved || Number(saved.value) !== Number(reading.value)) return denied(bundle, 'Die Kontrollrunde wurde nicht vollständig bestätigt.');
  }
 }
 for (const previous of bundle?.waterChecks || []) {
  const again = loaded.bundle.waterChecks.find(item => item.id === previous.id);
  if (again && JSON.stringify(again.readings) !== JSON.stringify(previous.readings)) return denied(bundle, 'Die Historie wurde nicht unverändert bestätigt.');
 }
 return {ok: true, id: round.roundId, ids, bundle: rememberCompletedRound(loaded.bundle, round, actor, now)};
}

export async function saveWaterFacilitySlots(db, bundle, facility, times, actor, now, context) {
 const scheduleError = facilityRoundScheduleError(facility, times, actor);
 if (scheduleError) return denied(bundle, scheduleError);
 let result;
 try {
  result = await db.rpc('tageswerk_save_water_facility_slots', {
   p_facility_id: facility.id,
   p_times: parseFacilityRoundTimes(times)
  });
 } catch (failure) {
  return denied(bundle, storageMessage(failure));
 }
 if (result?.error) return denied(bundle, storageMessage(result.error));
 const loaded = await loadOperations(db, actor, context);
 if (!loaded.ok) return denied(bundle, loaded.error || 'Die Kontrollzeiten wurden nicht bestätigt.');
 return {ok: true, id: facility.id, bundle: loaded.bundle};
}

export async function saveWaterAcknowledgement(db, bundle, alertId, note, actor, now, context) {
 const before = (bundle?.waterAlerts || []).find(item => item.id === alertId);
 const local = acknowledgeWaterAlert(bundle, alertId, note, actor, now);
 if (!local.ok) return denied(bundle, local.error);
 let result;
 try {
  result = await db.update('water_alerts', alertId, {status: 'acknowledged', acknowledgement_note: local.alert.acknowledgementNote});
 } catch (error) {
  return denied(bundle, storageMessage(error));
 }
 const saved = confirmed(result);
 if (!saved.ok || saved.data.status !== 'acknowledged' || saved.data.acknowledged_by !== actor.userId || !saved.data.acknowledged_at) {
  return denied(bundle, saved.error || 'Die Quittierung wurde nicht bestätigt.');
 }
 if (before && (String(saved.data.value_amount) !== String(before.value) || String(saved.data.min_value) !== String(before.minLimit) || String(saved.data.max_value) !== String(before.maxLimit))) {
  return denied(bundle, 'Die Quittierung wurde nicht bestätigt.');
 }
 const loaded = await loadOperations(db, actor, context);
 const alert = loaded.ok ? loaded.bundle.waterAlerts.find(item => item.id === alertId) : null;
 if (!alert || alert.status !== 'acknowledged' || alert.acknowledgementNote !== local.alert.acknowledgementNote || alert.value !== before.value) {
  return denied(bundle, 'Die Quittierung wurde nicht bestätigt.');
 }
 const check = loaded.bundle.waterChecks.find(item => item.id === alert.checkId);
 const previous = (bundle?.waterChecks || []).find(item => item.id === alert.checkId);
 if (!check || JSON.stringify(check.readings) !== JSON.stringify(previous?.readings)) return denied(bundle, 'Die Quittierung wurde nicht bestätigt.');
 return {ok: true, id: alert.id, bundle: loaded.bundle, alert};
}

function visibilityPayload(event) {
 return {
  facility_id: event.facilityId,
  source: event.source,
  alert_id: event.alertId,
  action: event.action,
  bulk_days: event.bulkDays
 };
}

function alertOf(bundle, source, alertId) {
 return source === 'water'
  ? (bundle?.waterAlerts || []).find(item => item.id === alertId)
  : (bundle?.temperatureAlerts || []).find(item => item.id === alertId);
}

export async function saveFacilityAlertVisibility(db, bundle, source, alertId, action, actor, now, context) {
 const local = action === 'restore'
  ? restoreFacilityAlert(bundle, source, alertId, actor, now)
  : hideFacilityAlert(bundle, source, alertId, actor, now);
 if (!local.ok) return denied(bundle, local.error);
 const before = alertOf(bundle, source, alertId);
 let result;
 try {
  result = await db.insert('facility_alert_visibility', visibilityPayload(local.event));
 } catch (error) {
  return denied(bundle, storageMessage(error));
 }
 const saved = confirmed(result);
 if (!saved.ok || saved.data.acted_by !== actor.userId || saved.data.action !== action || saved.data.alert_id !== alertId) {
  return denied(bundle, saved.error || 'Die Ausblendung wurde nicht bestätigt.');
 }
 const loaded = await loadOperations(db, actor, context);
 const after = loaded.ok ? alertOf(loaded.bundle, source, alertId) : null;
 if (!after || alertIsHidden(loaded.bundle, source, alertId) !== (action === 'hide')) {
  return denied(bundle, 'Die Ausblendung wurde nicht bestätigt.');
 }
 if (before && (after.status !== before.status || after.valueC !== before.valueC || after.value !== before.value)) {
  return denied(bundle, 'Die Ausblendung wurde nicht bestätigt.');
 }
 return {ok: true, id: saved.data.id, bundle: loaded.bundle, event: local.event, alert: after};
}

export async function saveOldFacilityAlertHides(db, bundle, facility, days, actor, now, context) {
 const local = hideOldFacilityAlerts(bundle, facility, days, actor, now);
 if (!local.ok) return denied(bundle, local.error);
 if (!local.events.length) return {ok: true, id: facility.id, bundle, warning: 'Keine alten Warnungen zum Ausblenden.'};
 for (const event of local.events) {
  let result;
  try {
   result = await db.insert('facility_alert_visibility', visibilityPayload(event));
  } catch (error) {
   return denied(bundle, storageMessage(error));
  }
  const saved = confirmed(result);
  if (!saved.ok || saved.data.acted_by !== actor.userId || saved.data.action !== 'hide') {
   return denied(bundle, saved.error || 'Die Sammelausblendung wurde nicht bestätigt.');
  }
 }
 const loaded = await loadOperations(db, actor, context);
 if (!loaded.ok) return denied(bundle, loaded.error || 'Die Sammelausblendung wurde nicht bestätigt.');
 for (const event of local.events) {
  if (!alertIsHidden(loaded.bundle, event.source, event.alertId)) {
   return denied(bundle, 'Die Sammelausblendung wurde nicht bestätigt.');
  }
 }
 return {ok: true, id: local.events[0].id, bundle: loaded.bundle, events: local.events};
}

export async function saveWaterMeasure(db, bundle, alertId, measure, actor, now, context) {
 const before = (bundle?.waterAlerts || []).find(item => item.id === alertId);
 const local = recordWaterMeasure(bundle, alertId, measure, actor, now);
 if (!local.ok) return denied(bundle, local.error);
 let result;
 try {
  result = await db.insert('water_alert_measures', {
   alert_id: alertId,
   facility_id: local.measure.facilityId,
   measure_text: local.measure.measureText
  });
 } catch (error) {
  return denied(bundle, storageMessage(error));
 }
 const saved = confirmed(result);
 if (!saved.ok || saved.data.recorded_by !== actor.userId || saved.data.alert_id !== alertId) {
  return denied(bundle, saved.error || 'Die Maßnahme wurde nicht bestätigt.');
 }
 const loaded = await loadOperations(db, actor, context);
 const entry = loaded.ok ? loaded.bundle.waterMeasures.find(item => item.id === saved.data.id) : null;
 const alert = loaded.ok ? loaded.bundle.waterAlerts.find(item => item.id === alertId) : null;
 if (!entry || entry.measureText !== local.measure.measureText || !alert || alert.status !== before.status) {
  return denied(bundle, 'Die Maßnahme wurde nicht bestätigt.');
 }
 return {ok: true, id: entry.id, bundle: loaded.bundle, measure: entry, alert};
}

export async function saveWaterFilter(db, bundle, facility, draft, actor, context) {
 if (!canManageWaterFilters(facility, actor?.memberships)) return denied(bundle, 'Keine Berechtigung für die Filterverwaltung.');
 const error = waterFilterDraftError(draft);
 if (error) return denied(bundle, error);
 let result;
 try {
  result = await db.insert('water_filters', waterFilterInsertPayload(facility, draft, actor));
 } catch (caught) {
  return denied(bundle, storageMessage(caught));
 }
 const saved = confirmed(result);
 if (!saved.ok) return denied(bundle, saved.error);
 const loaded = await loadOperations(db, actor, context);
 const filter = loaded.ok ? loaded.bundle.waterFilters.find(item => item.id === saved.data.id) : null;
 if (!filter) return denied(bundle, 'Der Filter wurde nicht bestätigt.');
 return {ok: true, id: filter.id, bundle: loaded.bundle, filter};
}

export async function saveWaterFilterChange(db, bundle, filterId, draft, actor, context) {
 const before = (bundle?.waterFilters || []).find(item => item.id === filterId);
 if (!before) return denied(bundle, 'Der Filter wurde nicht gefunden.');
 const facility = {id: before.facilityId, organization_id: before.organizationId};
 if (!canManageWaterFilters(facility, actor?.memberships)) return denied(bundle, 'Keine Berechtigung für die Filterverwaltung.');
 const error = waterFilterDraftError({...draft, poolId: before.poolId});
 if (error) return denied(bundle, error);
 let result;
 try {
  result = await db.update('water_filters', filterId, {name: String(draft.name || '').trim()});
 } catch (caught) {
  return denied(bundle, storageMessage(caught));
 }
 const saved = confirmed(result);
 if (!saved.ok) return denied(bundle, saved.error);
 const loaded = await loadOperations(db, actor, context);
 const filter = loaded.ok ? loaded.bundle.waterFilters.find(item => item.id === filterId) : null;
 if (!filter || filter.name !== String(draft.name || '').trim()) return denied(bundle, 'Die Filteränderung wurde nicht bestätigt.');
 return {ok: true, id: filter.id, bundle: loaded.bundle, filter};
}

export async function saveWaterFilterActive(db, bundle, filterId, active, reason, actor, context) {
 const before = (bundle?.waterFilters || []).find(item => item.id === filterId);
 if (!before) return denied(bundle, 'Der Filter wurde nicht gefunden.');
 const facility = {id: before.facilityId, organization_id: before.organizationId};
 if (!canManageWaterFilters(facility, actor?.memberships)) return denied(bundle, 'Keine Berechtigung für die Filterverwaltung.');
 const cleanReason = String(reason || '').trim();
 if (cleanReason.length < 3 || cleanReason.length > 2000) {
  return denied(bundle, 'Bitte eine Begründung mit 3 bis 2000 Zeichen angeben.');
 }
 let result;
 try {
  result = await db.rpc('tageswerk_set_water_filter_active', {
   p_filter_id: filterId,
   p_active: active === true,
   p_reason: cleanReason
  });
 } catch (caught) {
  return denied(bundle, storageMessage(caught));
 }
 if (result?.error) return denied(bundle, storageMessage(result.error));
 const payload = Array.isArray(result?.data) ? result.data[0] : result?.data;
 if (!payload || payload.ok !== true) return denied(bundle, 'Der Filterstatus wurde nicht bestätigt.');
 const loaded = await loadOperations(db, actor, context);
 const filter = loaded.ok ? loaded.bundle.waterFilters.find(item => item.id === filterId) : null;
 if (!filter || filter.active !== (active === true)) return denied(bundle, 'Der Filterstatus wurde nicht bestätigt.');
 return {ok: true, id: filter.id, bundle: loaded.bundle, filter, eventId: payload.event_id};
}

export async function saveWaterFilterFlush(db, bundle, facility, draft, actor, now, context) {
 if (!canRecordWaterFilterFlush(facility, actor?.memberships)) return denied(bundle, 'Keine Berechtigung für diesen Betrieb.');
 const error = waterFilterFlushDraftError(draft, now);
 if (error) return denied(bundle, error);
 let result;
 try {
  result = await db.insert('water_filter_flushes', waterFilterFlushInsertPayload(facility, draft));
 } catch (caught) {
  return denied(bundle, storageMessage(caught));
 }
 const saved = confirmed(result);
 if (!saved.ok) return denied(bundle, saved.error);
 const loaded = await loadOperations(db, actor, context);
 const flush = loaded.ok ? loaded.bundle.waterFilterFlushes.find(item => item.id === saved.data.id) : null;
 // Mitarbeiter sehen keine Historie; Speicherung gilt trotzdem, wenn die DB bestätigt.
 if (flush) return {ok: true, id: flush.id, bundle: loaded.bundle, flush};
 if (saved.data?.id && saved.data.recorded_by === actor.userId) {
  return {ok: true, id: saved.data.id, bundle: loaded.bundle, flush: null};
 }
 return denied(bundle, 'Die Spülung wurde nicht bestätigt.');
}

export async function saveWaterFilterFlushCorrection(db, bundle, flushId, draft, actor, context) {
 const before = (bundle?.waterFilterFlushes || []).find(item => item.id === flushId);
 if (!before) return denied(bundle, 'Die Spülung wurde nicht gefunden.');
 const facility = {id: before.facilityId, organization_id: before.organizationId};
 if (!canCorrectWaterFilterFlush(facility, actor?.memberships)) {
  return denied(bundle, 'Nur Betriebsleitung und Geschäftsführung korrigieren Spülprotokolle.');
 }
 const error = waterFilterFlushCorrectionDraftError(draft, before);
 if (error) return denied(bundle, error);
 let result;
 try {
  result = await db.rpc('tageswerk_correct_water_filter_flush', waterFilterFlushCorrectionArgs(flushId, draft));
 } catch (caught) {
  return denied(bundle, storageMessage(caught));
 }
 if (result?.error) return denied(bundle, storageMessage(result.error));
 const payload = Array.isArray(result?.data) ? result.data[0] : result?.data;
 if (!payload || payload.ok !== true) return denied(bundle, 'Die Korrektur wurde nicht bestätigt.');
 const loaded = await loadOperations(db, actor, context);
 const flush = loaded.ok ? loaded.bundle.waterFilterFlushes.find(item => item.id === flushId) : null;
 if (!flush || flush.isCorrected !== true) return denied(bundle, 'Die Korrektur wurde nicht bestätigt.');
 return {ok: true, id: flush.id, bundle: loaded.bundle, flush, correctionId: payload.correction_id};
}
