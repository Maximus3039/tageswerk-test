import {el} from './utils.js';
import {state} from './state.js';
import {acknowledgeNotice, visibleNotices} from './notifications.js';
import {isManager} from './permissions.js';
import {intervalNames, priorityNames} from './labels.js';
import {
 canBookMaterial,
 facilityNotices,
 materialBelowMinimum,
 procurementFromStock,
 stockOf
} from './operations-controls.js';
import {
 assetNextDue,
 assetOverdue,
 dailyReportEmail,
 filterDailyReports,
 inspectionOverdue
} from './operations.js';
import {
 saveAssetDefect,
 saveAssetRecord,
 saveDailyReport,
 saveDailyReportRevision,
 saveInspectionAssignment,
 saveInspectionDefect,
 saveInspectionResult,
 saveInspectionTemplate,
 saveMaintenanceLog,
 saveMaterial,
 saveMaterialChange,
 saveMaterialMovement,
 saveProcurementRequest,
 saveProcurementReview,
 saveReportDefect
} from './operations-store.js';
import {renderDayFigures} from './operations-ui-figures.js';
import {
 actor,
 amountLabel,
 area,
 berlinLocal,
 bundle,
 button,
 commit,
 context,
 database,
 defectsFor,
 input,
 item,
 labeled,
 markNames,
 missingNote,
 opsUi,
 renderPanel,
 say,
 select,
 statusNames,
 today
} from './operations-ui-shared.js';

function rareFold(title, ...nodes) {
 const details = document.createElement('details');
 details.className = 'mobile-fold';
 const summary = document.createElement('summary');
 summary.textContent = title;
 details.append(summary, ...nodes.filter(Boolean));
 return details;
}

export function renderReports(host, current) {
 const data = bundle();
 const date = input(today());
 date.type = 'date';
 const incidents = area();
 incidents.placeholder = 'Was war heute besonders?';
 const handover = area();
 handover.placeholder = 'Was muss die nächste Schicht wissen?';
 const weatherPreview = area();
 weatherPreview.readOnly = true;
 weatherPreview.placeholder = 'Noch kein Wettersnapshot übernommen.';
 const defect = select([{value: '', label: 'Keinen Mangel verknüpfen'}, ...defectsFor(current.id).map(row => ({value: row.id, label: row.title}))]);
 let weatherSnapshot = '';
 const loadWeather = button('Wetter für Bericht laden', 'secondary', async () => {
  loadWeather.disabled = true;
  try {
   const {weatherForFacility, weatherReportLine} = await import('./weather.js');
   const result = await weatherForFacility(current, {allowGeocode: true});
   if (!result.ok) {
    say('error', result.error);
    return;
   }
   weatherSnapshot = weatherReportLine(result.weather, result.location);
   weatherPreview.value = weatherSnapshot;
   if (result.location.uncertain || result.location.source === 'geocode') {
    say('ok', 'Wettersnapshot geladen (Standort geschätzt). Bitte vor dem Speichern prüfen; danach bleibt der Text unveränderlich.');
   } else {
    say('ok', 'Wettersnapshot geladen. Er wird beim Speichern unveränderlich in den Bericht übernommen.');
   }
  } catch (error) {
   say('error', error?.message || 'Wetter konnte nicht geladen werden.');
  } finally {
   loadWeather.disabled = false;
  }
 });
 const figuresHint = document.createElement('p');
 figuresHint.className = 'help';
 figuresHint.textContent = 'Besucher, Umsatz und Wetter werden nicht erneut erfasst, wenn sie am selben Tag schon unter Tageskennzahlen bzw. als Wettersnapshot vorliegen.';
 const save = button('Tagesbericht speichern', '', () => commit(async () => {
  const weatherText = String(weatherSnapshot || weatherPreview.value || '').trim();
  const body = String(incidents.value || '').trim();
  const mergedIncidents = weatherText
   ? (body ? `${weatherText}\n\n${body}` : weatherText)
   : body;
  const saved = await saveDailyReport(database(), bundle(), {
   facility: current,
   reportDate: date.value,
   incidents: mergedIncidents,
   handover: handover.value,
   weatherSummary: weatherText,
   weatherSource: weatherText ? 'Open-Meteo' : '',
   weatherKind: weatherText ? 'forecast' : '',
   weatherObservedAt: weatherText ? new Date().toISOString() : null
  }, actor(), new Date().toISOString(), context());
  const chosen = defectsFor(current.id).find(row => row.id === defect.value);
  if (!saved.ok || !chosen) return saved;
  const linked = await saveReportDefect(database(), saved.bundle, saved.id, chosen, actor(), context());
  if (!linked.ok) return {...saved, warning: linked.error};
  return linked;
 }));
 host.append(
  labeled('Datum', date),
  figuresHint,
  labeled('Wettersnapshot (Prognose zum Speicherzeitpunkt)', weatherPreview),
  loadWeather,
  labeled('Besondere Vorkommnisse', incidents),
  labeled('Hinweis für die nächste Schicht', handover),
  labeled('Vorhandenen Mangel verknüpfen', defect),
  save
 );
 renderDayFigures(host, current);
 const filterDate = input('');
 filterDate.type = 'date';
 const filter = button('An diesem Tag anzeigen', 'secondary', () => renderPanel(filterDate.value));
 const history = rareFold('Frühere Berichte', labeled('Berichte filtern', filterDate), filter);
 for (const report of filterDailyReports(data.reports, {facilityId: current.id, date: host.dataset.filter || ''})) {
  const lines = [
   `${report.facilityName} · ${report.authorName} · ${new Date(report.createdAt).toLocaleString('de-DE')}`,
   report.weatherSummary
    ? `Wetter (eingefroren): ${report.weatherSummary}${report.weatherSource ? ` · ${report.weatherSource}` : ''}${report.weatherKind ? ` · ${report.weatherKind === 'observed' ? 'Beobachtung' : 'Prognose'}` : ''}`
    : null,
   `Vorkommnisse: ${report.incidents || 'Keine'}`,
   `Nächste Schicht: ${report.handover || 'Kein Hinweis'}`,
   report.defectIds.length ? `Verknüpfte Mängel: ${report.defectIds.length}` : 'Kein Mangel verknüpft.'
  ].filter(Boolean);
  for (const revision of report.revisions) lines.push(`Nachtrag ${new Date(revision.editedAt).toLocaleString('de-DE')} · ${revision.editorName}: ${revision.changeNote}`);
  const row = item(report.reportDate, lines, false);
  const note = input();
  note.placeholder = 'Grund der Änderung';
  const nextIncidents = area(report.incidents);
  const nextHandover = area(report.handover);
  row.append(labeled('Geänderte Vorkommnisse', nextIncidents), labeled('Geänderter Hinweis', nextHandover), labeled('Grund der Änderung', note));
  row.append(button('Nachtrag speichern', 'secondary', () => commit(() => saveDailyReportRevision(database(), bundle(), report.id, {incidents: nextIncidents.value, handover: nextHandover.value, changeNote: note.value}, actor(), new Date().toISOString(), context()))));
  row.append(button('E-Mail-Zusammenfassung anzeigen', 'secondary', () => {
   const mail = dailyReportEmail(report, report.facilityName);
   say('ok', `${mail.subject}\n${mail.body}\n\nDie E-Mail wird nicht versendet.`);
  }));
  history.append(row);
 }
 host.append(history);
}

export function renderInspections(host, current) {
 const data = bundle();
 const manager = isManager(current);
 if (manager) {
  const name = input();
  const points = area();
  points.placeholder = 'Ein Prüfpunkt je Zeile';
  const unit = select(Object.entries(intervalNames).map(([value, label]) => ({value, label})), 'week');
  const count = input('1');
  count.type = 'number';
  count.inputMode = 'numeric';
  host.append(rareFold(
   'Checkliste anlegen',
   labeled('Bezeichnung des Kontrollgangs', name),
   labeled('Prüfpunkte', points),
   labeled('Wiederholung', unit),
   labeled('Intervallanzahl', count),
   button('Checkliste anlegen', '', () => commit(() => saveInspectionTemplate(database(), bundle(), {facility: current, name: name.value, points: points.value, intervalUnit: unit.value, intervalCount: count.value}, actor(), new Date().toISOString(), context())))
  ));
  const template = select((data.templates || []).filter(item => item.facilityId === current.id).map(item => ({value: item.id, label: item.name})));
  const people = state.staff.filter(member => member.is_active === true && member.facility_id === current.id);
  const person = select(people.map(member => ({value: member.user_id, label: member.name})));
  const due = input();
  due.type = 'datetime-local';
  due.value = berlinLocal();
  host.append(labeled('Checkliste zuweisen', template), labeled('Mitarbeiter', person), labeled('Fällig am', due));
  host.append(button('Kontrollgang zuweisen', 'secondary', () => {
   const chosen = people.find(member => member.user_id === person.value);
   return commit(() => saveInspectionAssignment(database(), bundle(), template.value, {assignedTo: person.value, assignedName: chosen?.name, dueAt: due.value}, actor(), new Date().toISOString(), context()));
  }));
 }
 for (const run of data.runs.filter(item => item.facilityId === current.id)) {
  const overdue = inspectionOverdue(run, new Date().toISOString());
  const row = item(run.name, [`${run.assignedName} · fällig ${new Date(run.dueAt).toLocaleString('de-DE')}`, run.status === 'completed' ? `Ausgeführt von ${run.performedName} am ${new Date(run.performedAt).toLocaleString('de-DE')}` : 'Noch nicht ausgeführt.'], overdue);
  if (run.status !== 'completed') {
   const controls = [];
   for (const point of run.points) {
    const mark = select(Object.entries(markNames).map(([value, label]) => ({value, label})), 'unchecked');
    const note = input();
    note.placeholder = 'Bemerkung, falls nötig';
    row.append(labeled(point.label, mark), note);
    controls.push({id: point.id, mark, note});
   }
   row.append(button('Kontrolle abschließen', '', () => commit(() => saveInspectionResult(database(), bundle(), run.id, controls.map(control => ({id: control.id, mark: control.mark.value, note: control.note.value})), actor(), new Date().toISOString(), context()))));
  } else {
   for (const point of run.points.filter(item => item.mark === 'notable' && !item.defectId)) {
    row.append(button(`Auffälligkeit „${point.label}“ als Mangel speichern`, 'secondary', () => commit(() => saveInspectionDefect(database(), bundle(), run.id, point.id, actor(), context()))));
   }
  }
  host.append(row);
 }
}

export function renderMaintenance(host, current) {
 const data = bundle();
 if (isManager(current)) {
  const name = input();
  const location = input();
  const unit = select(Object.entries(intervalNames).map(([value, label]) => ({value, label})), 'month');
  const count = input('1');
  count.type = 'number';
  count.inputMode = 'numeric';
  const anchor = input();
  anchor.type = 'date';
  anchor.value = berlinLocal().slice(0, 10);
  const people = state.staff.filter(member => member.is_active === true && (member.facility_id === current.id || member.facility_id == null));
  const person = select([{value: '', label: 'Noch niemand'}, ...people.map(member => ({value: member.user_id, label: member.name}))]);
  host.append(labeled('Anlage', name), labeled('Standort', location), labeled('Wartung alle', unit), labeled('Intervallanzahl', count), labeled('Letzte oder erste Wartung', anchor), labeled('Verantwortliche Person', person));
  host.append(button('Anlage speichern', '', () => {
   const chosen = people.find(member => member.user_id === person.value);
   return commit(() => saveAssetRecord(database(), bundle(), {facility: current, name: name.value, location: location.value, intervalUnit: unit.value, intervalCount: count.value, anchorAt: anchor.value, responsibleUserId: person.value || null, responsibleName: chosen?.name || ''}, actor(), new Date().toISOString(), context()));
  }));
 }
 for (const asset of data.assets.filter(item => item.facilityId === current.id)) {
  const due = assetNextDue(asset);
  const row = item(asset.name, [`${asset.location || 'Ohne Standort'} · ${asset.responsibleName || 'Keine zuständige Person'}`, due ? `Nächste Wartung ${due.toLocaleDateString('de-DE')}` : 'Kein Termin berechenbar.', asset.logs[0] ? `Zuletzt ${new Date(asset.logs[0].completedAt).toLocaleString('de-DE')} · ${asset.logs[0].completedName}: ${asset.logs[0].note}` : 'Noch keine erledigte Wartung.'], assetOverdue(asset, new Date().toISOString()));
  const note = input();
  note.placeholder = 'Was wurde gewartet?';
  const defect = select([{value: '', label: 'Keinen Mangel verknüpfen'}, ...defectsFor(current.id).map(row => ({value: row.id, label: row.title}))]);
  const materials = bundle().materials.filter(item => item.facilityId === current.id);
  const used = input();
  used.inputMode = 'decimal';
  const material = select(materials.map(item => ({value: item.id, label: item.name})));
  row.append(labeled('Wartung dokumentieren', note), button('Als erledigt speichern', 'secondary', () => commit(() => saveMaintenanceLog(database(), bundle(), asset.id, note.value, actor(), new Date().toISOString(), context()))));
  if (asset.logs[0] && materials.length) {
   row.append(labeled('Benötigtes Material', material), labeled('Menge', used));
   row.append(button('Material zur Wartung buchen', 'secondary', () => commit(() => saveMaterialMovement(database(), bundle(), {materialId: material.value, direction: 'out', quantity: used.value, note: `Wartung ${asset.name}`, maintenanceLogId: asset.logs[0].id}, actor(), new Date().toISOString(), context()))));
  }
  row.append(labeled('Vorhandenen Mangel verknüpfen', defect), button('Mangel mit Anlage verknüpfen', 'secondary', () => {
   const chosen = defectsFor(current.id).find(row => row.id === defect.value);
   return commit(() => saveAssetDefect(database(), bundle(), asset.id, chosen));
  }));
  host.append(row);
 }
}

export function renderProcurement(host, current) {
 const data = bundle();
 const title = input();
 const quantity = input('1');
 quantity.inputMode = 'decimal';
 const unit = input('Stück');
 const reason = area();
 const urgency = select(Object.entries(priorityNames).map(([value, label]) => ({value, label})), 'normal');
 const defect = select([{value: '', label: 'Keinen Mangel verknüpfen'}, ...defectsFor(current.id).map(row => ({value: row.id, label: row.title}))]);
 host.append(labeled('Was wird gebraucht?', title), labeled('Menge', quantity), labeled('Einheit', unit), labeled('Begründung', reason), labeled('Dringlichkeit', urgency), labeled('Vorhandenen Mangel verknüpfen', defect));
 host.append(button('Bedarf melden', '', () => {
  const chosen = defectsFor(current.id).find(row => row.id === defect.value);
  return commit(() => saveProcurementRequest(database(), bundle(), {facility: current, title: title.value, quantity: quantity.value, unit: unit.value, reason: reason.value, urgency: urgency.value, defect: chosen || null}, actor(), new Date().toISOString(), context()));
 }));
 for (const request of data.requests.filter(item => item.facilityId === current.id)) {
  const lines = [`${request.quantity} ${request.unit} · ${priorityNames[request.urgency] || request.urgency}`, request.reason, `${request.requestedName} · ${new Date(request.requestedAt).toLocaleString('de-DE')}`, request.defectId ? 'Mit einem Mangel verknüpft.' : 'Ohne Mangel.'];
  if (request.reviewedAt) lines.push(`${statusNames[request.status]} · ${request.reviewedName} · ${new Date(request.reviewedAt).toLocaleString('de-DE')}: ${request.reviewNote}`);
  const row = item(`${request.title} · ${statusNames[request.status] || request.status}`, lines, request.urgency === 'critical' && request.status === 'submitted');
  if (request.status === 'submitted' && isManager(current)) {
   const note = input();
   note.placeholder = 'Begründung der Entscheidung';
   row.append(labeled('Entscheidung begründen', note));
   row.append(button('Genehmigen', '', () => commit(() => saveProcurementReview(database(), bundle(), request.id, 'approved', note.value, actor(), new Date().toISOString(), context()))));
   row.append(button('Ablehnen', 'secondary', () => commit(() => saveProcurementReview(database(), bundle(), request.id, 'rejected', note.value, actor(), new Date().toISOString(), context()))));
  }
  host.append(row);
 }
}

export function renderStock(host, current) {
 missingNote(host, opsUi.materialsInstalled, 'Materialbestände sind noch nicht in der Datenbank installiert. Es wurde nichts gespeichert.');
 const data = bundle();
 const materials = data.materials.filter(item => item.facilityId === current.id && item.active !== false);
 if (isManager(current)) {
  const name = input();
  const location = input();
  const unit = input('Stück');
  const minimum = input('0');
  minimum.inputMode = 'decimal';
  host.append(rareFold(
   'Material anlegen',
   labeled('Material', name),
   labeled('Lagerort', location),
   labeled('Einheit', unit),
   labeled('Mindestbestand', minimum),
   button('Material speichern', '', () => commit(() => saveMaterial(database(), bundle(), {facility: current, name: name.value, location: location.value, unit: unit.value, minimum: minimum.value}, actor(), new Date().toISOString(), context())))
  ));
 }
 if (!materials.length) {
  const empty = document.createElement('p');
  empty.className = 'muted';
  empty.textContent = opsUi.materialsInstalled
   ? 'Für diesen Betrieb sind keine Materialien erfasst.'
   : 'Die Bestandsliste bleibt leer, bis die Materialtabellen installiert sind.';
  host.append(empty);
  return;
 }
 for (const material of materials) {
  const stock = stockOf(data, material.id);
  const low = materialBelowMinimum(data, material);
  const openRequest = data.requests.some(item => item.materialId === material.id && item.status === 'submitted');
  const row = item(material.name, [`${material.location} · Bestand ${amountLabel(stock)} ${material.unit}`, `Mindestbestand ${amountLabel(material.minimum)} ${material.unit}`, openRequest ? 'Offene Beschaffung vorhanden.' : 'Keine offene Beschaffung.'], low);
  row.classList.add('stock-card');
  if (low) {
   const hint = document.createElement('p');
   hint.className = 'help';
   hint.textContent = openRequest
    ? 'Nachbestellhinweis: Es liegt bereits eine offene Beschaffung vor. Es wird nicht automatisch bestellt.'
    : 'Nachbestellhinweis: Mindestbestand unterschritten. Bitte eine Beschaffung mit Freigabe anlegen.';
   row.append(hint);
  }
  if (isManager(current)) {
   const editName = input(material.name);
   const editLocation = input(material.location);
   const editUnit = input(material.unit);
   const editMinimum = input(String(material.minimum));
   editMinimum.inputMode = 'decimal';
   row.append(rareFold(
    'Stammdaten',
    labeled('Bezeichnung ändern', editName),
    labeled('Lagerort ändern', editLocation),
    labeled('Einheit ändern', editUnit),
    labeled('Mindestbestand ändern', editMinimum),
    button('Material aktualisieren', 'secondary', () => commit(() => saveMaterialChange(database(), bundle(), material.id, {
     name: editName.value,
     location: editLocation.value,
     unit: editUnit.value,
     minimum: editMinimum.value
    }, actor(), new Date().toISOString(), context()))),
    button('Material deaktivieren', 'secondary', () => commit(() => saveMaterialChange(database(), bundle(), material.id, {
     name: material.name,
     location: material.location,
     unit: material.unit,
     minimum: material.minimum,
     active: false
    }, actor(), new Date().toISOString(), context())))
   ));
  }
  if (canBookMaterial(current, actor())) {
   const quantity = input();
   quantity.inputMode = 'decimal';
   const note = input();
   note.placeholder = 'Bemerkung zur Buchung';
   row.append(labeled('Menge', quantity), labeled('Bemerkung', note));
   const book = direction => commit(() => saveMaterialMovement(database(), bundle(), {materialId: material.id, direction, quantity: quantity.value, note: note.value}, actor(), new Date().toISOString(), context()));
   row.append(button('Zugang buchen', 'secondary', () => book('in')));
   row.append(button('Entnahme buchen', 'secondary', () => book('out')));
  }
  if (low && !openRequest) {
   row.append(button('Beschaffung vorbereiten', '', () => {
    const prepared = procurementFromStock(bundle(), material.id, actor(), new Date().toISOString());
    if (!prepared.ok) {
     say('error', prepared.error);
     return null;
    }
    return commit(() => saveProcurementRequest(database(), bundle(), {
     facility: current,
     title: prepared.request.title,
     quantity: prepared.request.quantity,
     unit: prepared.request.unit,
     reason: prepared.request.reason,
     urgency: prepared.request.urgency,
     materialId: material.id
    }, actor(), new Date().toISOString(), context()));
   }));
  }
  for (const movement of data.movements.filter(item => item.materialId === material.id).slice(0, 8)) {
   const line = document.createElement('p');
   line.className = 'help';
   const direction = movement.direction === 'in' ? 'Zugang' : 'Entnahme';
   line.textContent = `${new Date(movement.recordedAt).toLocaleString('de-DE')} · Gebucht von ${movement.recordedName}: ${direction} ${amountLabel(movement.quantity)} ${material.unit}${movement.maintenanceLogId ? ' · für eine Wartung' : ''}${movement.note ? ` · ${movement.note}` : ''}`;
   row.append(line);
  }
  host.append(row);
 }
}

export function renderNotices(host, current) {
 missingNote(host, opsUi.temperatureInstalled, 'Temperaturkontrollen sind noch nicht in der Datenbank installiert. Es wurde nichts gespeichert.');
 missingNote(host, opsUi.materialsInstalled, 'Materialbestände sind noch nicht in der Datenbank installiert. Es wurde nichts gespeichert.');
 missingNote(host, opsUi.waterInstalled, 'Wasserhygiene ist noch nicht in der Datenbank installiert. Es wurde nichts gespeichert.');
 const notices = visibleNotices(facilityNotices(bundle(), state.cachedDefects, {
  facilityIds: [current.id],
  now: new Date().toISOString(),
  actor: actor()
 }), {userId: state.currentUser?.id});
 if (!notices.length) {
  const empty = document.createElement('p');
  empty.className = 'muted';
  empty.textContent = 'Keine offenen Hinweise für diesen Betrieb.';
  host.append(empty);
  return;
 }
 for (const notice of notices) {
  const row = item(notice.title, [notice.detail], notice.warn);
  row.append(button('Quittieren', 'secondary', () => {
   acknowledgeNotice(state.currentUser?.id, notice.id);
   renderPanel();
  }));
  host.append(row);
 }
}


