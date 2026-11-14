import {el} from './utils.js';
import {isManager} from './permissions.js';
import {intervalNames} from './labels.js';
import {
 configureTemperatureInput,
 missingTemperaturePoints,
 temperatureDefectDraft
} from './operations-controls.js';
import {
 saveTemperatureAcknowledgement,
 saveTemperaturePoint,
 saveTemperaturePointActive,
 saveTemperaturePointChange,
 saveTemperatureReading
} from './operations-store.js';
import {
 actor,
 amountLabel,
 bundle,
 button,
 commit,
 context,
 database,
 input,
 item,
 labeled,
 missingNote,
 opsUi,
 say,
 select
} from './operations-ui-shared.js';

function intervalLabel(point) {
 const count = Number(point.intervalCount) || 1;
 if ((point.intervalUnit || 'day') === 'day' && count === 1) return 'täglich';
 if (point.intervalUnit === 'week' && count === 1) return 'wöchentlich';
 if (point.intervalUnit === 'month' && count === 1) return 'monatlich';
 const unit = point.intervalUnit === 'week' ? 'Wochen' : point.intervalUnit === 'month' ? 'Monate' : 'Tage';
 return `alle ${count} ${unit}`;
}

export function renderTemperature(host, current) {
 missingNote(host, opsUi.temperatureInstalled, 'Temperaturkontrollen sind noch nicht in der Datenbank installiert. Es wurde nichts gespeichert.');
 const data = bundle();
 let settings = null;
 if (isManager(current)) {
  settings = document.createElement('div');
  settings.id = 'temperature-settings';
  settings.className = opsUi.temperatureSettingsOpen ? 'water-settings' : 'water-settings hidden';
  const toggle = button('⚙ Einstellungen', 'secondary', () => {
   opsUi.temperatureSettingsOpen = settings.classList.toggle('hidden') === false;
   toggle.setAttribute('aria-expanded', opsUi.temperatureSettingsOpen ? 'true' : 'false');
  });
  toggle.setAttribute('aria-expanded', opsUi.temperatureSettingsOpen ? 'true' : 'false');
  toggle.setAttribute('aria-controls', 'temperature-settings');
  host.append(toggle);
  const name = input();
  const location = input();
  const minimum = configureTemperatureInput(input());
  const maximum = configureTemperatureInput(input());
  const unit = select(Object.entries(intervalNames).map(([value, label]) => ({value, label})), 'day');
  const count = input('1');
  count.inputMode = 'numeric';
  settings.append(labeled('Messstelle', name), labeled('Bereich', location), labeled('Mindestens °C', minimum), labeled('Höchstens °C', maximum), labeled('Kontrollintervall', unit), labeled('Intervallanzahl', count));
  settings.append(button('Messstelle speichern', '', () => commit(() => saveTemperaturePoint(database(), bundle(), {facility: current, name: name.value, location: location.value, minimum: minimum.value, maximum: maximum.value, intervalUnit: unit.value, intervalCount: count.value}, actor(), new Date().toISOString(), context()))));
  host.append(settings);
 }
 const missing = new Set(missingTemperaturePoints(data, current.id, new Date().toISOString()).map(point => point.id));
 const points = data.temperaturePoints.filter(item => item.facilityId === current.id).sort((left, right) => Number(left.active === false) - Number(right.active === false) || left.name.localeCompare(right.name, 'de'));
 for (const point of points) {
  const readings = data.temperatureReadings.filter(item => item.pointId === point.id);
  const status = point.active === false ? 'Deaktiviert. Die bisherigen Messungen bleiben sichtbar.' : missing.has(point.id) ? 'Die Kontrolle ist fällig.' : 'Die nächste Kontrolle ist noch nicht fällig.';
  const row = item(`${point.name}${point.active === false ? ' · deaktiviert' : ''}`, [`${point.location} · zulässig ${amountLabel(point.minC)} bis ${amountLabel(point.maxC)} °C · ${intervalLabel(point)}`, status], missing.has(point.id));
  if (isManager(current) && settings) {
   const managed = document.createElement('div');
   managed.className = 'water-parameter';
   const title = document.createElement('strong');
   title.textContent = point.name;
   const actions = document.createElement('div');
   actions.className = 'point-actions';
   const editor = document.createElement('div');
   editor.className = 'point-editor hidden';
   const name = input(point.name);
   const location = input(point.location);
   const minimum = configureTemperatureInput(input(), String(point.minC));
   const maximum = configureTemperatureInput(input(), String(point.maxC));
   const unit = select(Object.entries(intervalNames).map(([value, label]) => ({value, label})), point.intervalUnit || 'day');
   const count = input(String(point.intervalCount || 1));
   count.inputMode = 'numeric';
   editor.append(labeled('Bezeichnung', name), labeled('Bereich', location), labeled('Mindestens °C', minimum), labeled('Höchstens °C', maximum), labeled('Kontrollintervall', unit), labeled('Intervallanzahl', count));
   editor.append(button('Änderungen speichern', '', () => commit(() => saveTemperaturePointChange(database(), bundle(), point.id, {name: name.value, location: location.value, minimum: minimum.value, maximum: maximum.value, intervalUnit: unit.value, intervalCount: count.value}, actor(), new Date().toISOString(), context()))));
   actions.append(button('Bearbeiten', 'secondary', () => { editor.classList.toggle('hidden'); }));
   actions.append(button(point.active === false ? 'Reaktivieren' : 'Deaktivieren', 'secondary', () => commit(() => saveTemperaturePointActive(database(), bundle(), point.id, point.active === false, actor(), new Date().toISOString(), context()))));
   managed.append(title, actions, editor);
   settings.append(managed);
  }
  if (point.active !== false) {
   const value = configureTemperatureInput(input());
   const note = input();
   note.placeholder = 'Bemerkung, falls nötig';
   row.append(labeled('Gemessener Wert °C', value), labeled('Bemerkung', note));
   row.append(button('Messung speichern', 'secondary', () => commit(() => saveTemperatureReading(database(), bundle(), point.id, {value: value.value, note: note.value}, actor(), new Date().toISOString(), context()))));
  }
  for (const reading of readings) {
   const line = document.createElement('p');
   line.className = 'help';
   line.textContent = `${new Date(reading.measuredAt).toLocaleString('de-DE')} · ${reading.recordedName}: ${amountLabel(reading.valueC)} °C${reading.note ? ` · ${reading.note}` : ''}`;
   row.append(line);
  }
  for (const alert of data.temperatureAlerts.filter(item => item.pointId === point.id)) {
   const line = document.createElement('p');
   line.className = 'help';
   line.textContent = alert.status === 'open'
    ? `Offene Warnung: ${amountLabel(alert.valueC)} °C außerhalb von ${amountLabel(alert.minC)} bis ${amountLabel(alert.maxC)} °C`
    : `Quittiert ${new Date(alert.acknowledgedAt).toLocaleString('de-DE')} · ${alert.acknowledgedName}: ${alert.remark}`;
   row.append(line);
   if (alert.status !== 'open') continue;
   const remark = input();
   remark.placeholder = 'Bemerkung zur Quittierung';
   row.append(labeled('Quittierung', remark));
   row.append(button('Warnung quittieren', 'secondary', () => commit(() => saveTemperatureAcknowledgement(database(), bundle(), alert.id, remark.value, actor(), new Date().toISOString(), context()))));
   row.append(button('Mangel vorbereiten', 'secondary', () => {
    const draft = temperatureDefectDraft(bundle(), alert.id);
    if (!draft.ok) {
     say('error', draft.error);
     return;
    }
    if (el('defect-title')) el('defect-title').value = draft.defect.title;
    if (el('defect-desc')) el('defect-desc').value = draft.defect.description;
    if (el('defect-facility')) el('defect-facility').value = draft.defect.facility_id;
    if (el('defect-priority')) el('defect-priority').value = draft.defect.priority;
    say('ok', 'Der Mangel ist vorbereitet und noch nicht gespeichert.');
   }));
  }
  host.append(row);
 }
}


