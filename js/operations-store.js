import {facilityVisibleToMember} from './permissions.js';
import {
 assignInspection,
 completeMaintenance,
 createAsset,
 createDailyReport,
 createInspectionTemplate,
 createProcurement,
 emptyOperations,
 linkAssetDefect,
 linkReportDefect,
 recordInspection,
 reviewProcurement,
 reviseDailyReport
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
 return 'Mitarbeiter';
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

function assemble(loaded, actor, context) {
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
   requestedBy: row.requested_by,
   requestedName: personName(context, row.requested_by, actor),
   requestedAt: row.requested_at,
   reviewedBy: row.reviewed_by || null,
   reviewedName: row.reviewed_by ? personName(context, row.reviewed_by, actor) : '',
   reviewedAt: row.reviewed_at || null,
   reviewNote: row.review_note || ''
  })),
  preparedDefects: []
 };
}

export async function loadOperations(db, actor, context) {
 const loaded = {};
 for (const table of tables) {
  let result;
  try {
   result = await db.select(table);
  } catch (error) {
   return {ok: false, installed: false, error: storageMessage(error), bundle: emptyOperations()};
  }
  if (result?.error) {
   const missing = storageMessage(result.error).startsWith('Die Betriebsdatenbank ist noch nicht installiert');
   return {ok: false, installed: !missing, error: storageMessage(result.error), bundle: emptyOperations()};
  }
  loaded[table] = result?.data || [];
 }
 return {ok: true, installed: true, bundle: assemble(loaded, actor, context)};
}

function owned(row, facility, actor) {
 return row?.facility_id === facility?.id && visible({...row, organization_id: row.organization_id || facility.organization_id}, actor);
}

export async function saveDailyReport(db, bundle, draft, actor, now, context) {
 const local = createDailyReport(bundle, draft, actor, now);
 if (!local.ok) return denied(bundle, local.error);
 let result;
 try {
  result = await db.insert('daily_reports', {
   facility_id: draft.facility.id,
   report_date: draft.reportDate,
   incidents: local.report.incidents,
   handover: local.report.handover
  });
 } catch (error) {
  return denied(bundle, storageMessage(error));
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
  result = await db.insert('procurement_requests', {
   facility_id: draft.facility.id,
   title: local.request.title,
   quantity: local.request.quantity,
   unit: local.request.unit,
   reason: local.request.reason,
   urgency: local.request.urgency,
   defect_id: local.request.defectId
  });
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
