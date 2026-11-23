import {el} from './utils.js';
import {state} from './state.js';
import {mediumNames, unitNames} from './labels.js';
import {membershipAllowsMeterAdmin, unitsForMedium} from './meters-domain.js';
import {fetchConsumptionCalendar, fetchFacilityConsumption, fetchFacilityMeters, fetchMonthlyConsumption, fetchMonthlyRevisions, insertMonthlyConsumption, insertReadingRow, updateMonthlyConsumption} from './meters-store.js';
import {
 SOURCE_LABELS,
 SOURCE_RULE,
 MONTH_NAMES,
 existingReadingDates,
 formatMonthlyAmount,
 historicalReadingDraftError,
 historicalReadingPayload,
 mergeMonthlySources,
 monthlyConsumptionDraftError,
 monthlyCorrectionDraftError,
 monthlyCorrectionPayload,
 monthlyInsertPayload,
 monthlyKey,
 historicalMonthAverageLabel,
 historicalYearKpiLabel,
 monthlyStats,
 yearOverYear
} from './historical-consumption.js';

let monthlyRowsCache = [];
let correctionRowId = '';

function selectedFacility() {
 const facilityId = el('consumption-facility')?.value || '';
 return state.accessibleFacilities.find(item => item.id === facilityId) || null;
}

function canCaptureHistorical() {
 const facility = selectedFacility();
 return membershipAllowsMeterAdmin(facility, state.myMemberships, state.currentUser?.id);
}

function setMessage(id, className, text) {
 const node = el(id);
 if (!node) return;
 node.className = className;
 node.textContent = text;
}

function fillOptions(selectId, entries, selected) {
 const sel = el(selectId);
 if (!sel) return;
 sel.replaceChildren();
 for (const [value, text] of entries) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = text;
  sel.append(option);
 }
 if (selected != null) sel.value = selected;
}

function yearOptions(today) {
 const years = [];
 for (let year = today.y; year >= today.y - 20; year -= 1) years.push([String(year), String(year)]);
 return years;
}

async function populateMeters() {
 const facility = selectedFacility();
 const select = el('historical-stand-meter');
 const monthSelect = el('historical-month-meter');
 if (!select || !monthSelect) return [];
 const empty = [['', 'Zähler auswählen']];
 const monthEmpty = [['', 'Gesamter Betrieb']];
 if (!facility) {
  fillOptions('historical-stand-meter', empty, '');
  fillOptions('historical-month-meter', monthEmpty, '');
  return [];
 }
 try {
  const meters = await fetchFacilityMeters(facility.id);
  const options = meters.map(meter => [meter.id, `${meter.label} · ${mediumNames[meter.medium] || meter.medium}`]);
  fillOptions('historical-stand-meter', empty.concat(options), select.value || '');
  fillOptions('historical-month-meter', monthEmpty.concat(options), monthSelect.value || '');
  return meters;
 } catch {
  fillOptions('historical-stand-meter', empty, '');
  fillOptions('historical-month-meter', monthEmpty, '');
  return [];
 }
}

function syncKind() {
 const kind = el('historical-kind')?.value || 'stand';
 el('historical-stand-form')?.classList.toggle('hidden', kind !== 'stand');
 el('historical-month-form')?.classList.toggle('hidden', kind !== 'month');
 el('historical-correct-form')?.classList.toggle('hidden', kind !== 'correct');
}

function syncMonthUnit() {
 const medium = el('historical-month-medium')?.value || 'electricity';
 const units = unitsForMedium(medium);
 fillOptions('historical-month-unit', units.map(unit => [unit, unitNames[unit] || unit]), units[0]);
}

function barChart(months, unit) {
 const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
 svg.setAttribute('viewBox', '0 0 360 160');
 svg.setAttribute('role', 'img');
 svg.setAttribute('aria-label', 'Verbrauchsdiagramm der erfassten Monate');
 const usable = months.filter(row => row.total != null);
 const max = usable.reduce((high, row) => row.total > high ? row.total : high, 1n);
 usable.forEach((row, index) => {
  const height = Math.max(4, Number(row.total * 110n / max));
  const x = 20 + index * (320 / Math.max(usable.length, 1));
  const width = Math.max(12, 280 / Math.max(usable.length, 3));
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', String(x));
  rect.setAttribute('y', String(130 - height));
  rect.setAttribute('width', String(width));
  rect.setAttribute('height', String(height));
  rect.setAttribute('fill', row.source === 'monthly' ? '#8ea4b8' : '#e1bf48');
  svg.append(rect);
  const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  label.setAttribute('x', String(x + width / 2));
  label.setAttribute('y', '148');
  label.setAttribute('text-anchor', 'middle');
  label.setAttribute('fill', '#aabed0');
  label.setAttribute('font-size', '9');
  label.textContent = MONTH_NAMES[row.month - 1].slice(0, 3);
  svg.append(label);
 });
 if (!usable.length) {
  const empty = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  empty.setAttribute('x', '180');
  empty.setAttribute('y', '80');
  empty.setAttribute('text-anchor', 'middle');
  empty.setAttribute('fill', '#aabed0');
  empty.textContent = 'Keine erfassten Monate';
  svg.append(empty);
 }
 return svg;
}

function renderOverview(months, previousMonths, unit, year) {
 const host = el('historical-overview');
 if (!host) return;
 host.replaceChildren();
 const heading = document.createElement('h3');
 heading.textContent = `${mediumNames[el('historical-overview-medium')?.value] || 'Verbrauch'} ${year}`;
 const rule = document.createElement('p');
 rule.className = 'help';
 rule.textContent = SOURCE_RULE;
 host.append(heading, rule);
 const stats = monthlyStats(months);
 const kpis = document.createElement('div');
 kpis.className = 'historical-kpis';
 const addKpi = (label, value) => {
  const box = document.createElement('p');
  const strong = document.createElement('strong');
  strong.textContent = label;
  box.append(strong, document.createTextNode(value));
  kpis.append(box);
 };
 addKpi(historicalYearKpiLabel(stats), stats.yearTotal == null ? '—' : formatMonthlyAmount(stats.yearTotal, unit));
 addKpi(historicalMonthAverageLabel(stats), stats.avgMonth == null ? '—' : formatMonthlyAmount(stats.avgMonth, unit));
 addKpi('Ø abgedeckter Tag', stats.avgDay == null ? '—' : formatMonthlyAmount(stats.avgDay, unit));
 const yoy = yearOverYear(months, previousMonths);
 addKpi('Vorjahr', yoy.kind === 'empty' ? 'kein Vergleich' : `${yoy.months} gemeinsame Monate`);
 host.append(kpis);
 if (stats.incomplete) {
  const note = document.createElement('p');
  note.className = 'help';
  note.textContent = stats.kind === 'empty'
   ? 'Kein Monat ist abgedeckt. Fehlende Monate gelten nicht als Nullverbrauch.'
   : `Unvollständig: ${stats.covered} von 12 Monaten sind abgedeckt. Fehlende Monate gelten nicht als Nullverbrauch.`;
  host.append(note);
 }
 if (yoy.kind !== 'empty') {
  const delta = document.createElement('p');
  delta.className = 'help';
  const rounded = yoy.delta == null ? null : Math.round(yoy.delta * 10) / 10;
  delta.textContent = rounded == null
   ? 'Vorjahresvergleich ohne Prozent, weil die Vorjahressumme 0 ist.'
   : `Vorjahresvergleich über ${yoy.months} Monate: ${rounded > 0 ? '+' : ''}${rounded} %.`;
  host.append(delta);
 }
 const chart = document.createElement('div');
 chart.className = 'historical-chart';
 chart.append(barChart(months, unit));
 host.append(chart);
 const wrap = document.createElement('div');
 wrap.id = 'historical-table-wrap';
 const table = document.createElement('table');
 table.id = 'historical-table';
 const head = document.createElement('thead');
 const headRow = document.createElement('tr');
 for (const label of ['Monat', 'Verbrauch', 'Quelle', 'Aktion']) {
  const th = document.createElement('th');
  th.scope = 'col';
  th.textContent = label;
  headRow.append(th);
 }
 head.append(headRow);
 const body = document.createElement('tbody');
 for (const row of months) {
  const tr = document.createElement('tr');
  const monthCell = document.createElement('td');
  monthCell.dataset.label = 'Monat';
  monthCell.textContent = MONTH_NAMES[row.month - 1];
  const valueCell = document.createElement('td');
  valueCell.dataset.label = 'Verbrauch';
  valueCell.textContent = row.total == null ? '—' : formatMonthlyAmount(row.total, unit);
  const sourceCell = document.createElement('td');
  sourceCell.dataset.label = 'Quelle';
  const avg = stats.avgMonth;
  let source = SOURCE_LABELS[row.source] || row.source;
  if (row.total != null && avg != null && avg !== 0n) {
   const diff = Number(row.total - avg) / Number(avg) * 100;
   if (Number.isFinite(diff)) source += ` · ${diff > 0 ? '+' : ''}${Math.round(diff)} % zum erfassten Durchschnitt`;
  }
  sourceCell.textContent = source;
  const actionCell = document.createElement('td');
  actionCell.dataset.label = 'Aktion';
  if (row.source === 'monthly' && row.id && canCaptureHistorical()) {
   const button = document.createElement('button');
   button.type = 'button';
   button.className = 'secondary compact-button';
   button.textContent = 'Korrigieren';
   button.addEventListener('click', () => openMonthlyCorrection(row.id));
   actionCell.append(button);
  } else {
   actionCell.textContent = row.incomplete ? 'kein vollständiger Monat' : '—';
  }
  tr.append(monthCell, valueCell, sourceCell, actionCell);
  body.append(tr);
 }
 table.append(head, body);
 wrap.append(table);
 host.append(wrap);
 const history = document.createElement('div');
 history.id = 'historical-revisions';
 host.append(history);
 if (correctionRowId) void loadRevisions(correctionRowId);
}

async function loadOverview() {
 const facility = selectedFacility();
 const host = el('historical-overview');
 if (!host) return;
 if (!facility) {
  host.replaceChildren();
  const empty = document.createElement('p');
  empty.className = 'help';
  empty.textContent = 'Bitte einen Betrieb auswählen.';
  host.append(empty);
  return;
 }
 const year = Number(el('historical-overview-year')?.value);
 const medium = el('historical-overview-medium')?.value || 'electricity';
 const unit = (unitsForMedium(medium)[0] || 'kWh');
 const meterId = el('historical-month-meter')?.value || '';
 setMessage('historical-overview-message', 'help', 'Auswertung wird geladen …');
 try {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const prevFrom = `${year - 1}-01-01`;
  const prevTo = `${year - 1}-12-31`;
  const [calendar, previousCalendar, monthly, previousMonthly] = await Promise.all([
   fetchConsumptionCalendar({p_facility_id: facility.id, p_medium: medium, p_meter_id: meterId || null, p_grain: 'day', p_from: from, p_to: to}),
   fetchConsumptionCalendar({p_facility_id: facility.id, p_medium: medium, p_meter_id: meterId || null, p_grain: 'day', p_from: prevFrom, p_to: prevTo}),
   fetchMonthlyConsumption(facility.id, year),
   fetchMonthlyConsumption(facility.id, year - 1)
  ]);
  monthlyRowsCache = monthly.error ? [] : (monthly.data || []);
  const monthlyMissing = /schema cache|does not exist|42P01|PGRST/i.test(monthly.error?.message || monthly.error?.code || '');
  const months = mergeMonthlySources({
   year,
   unit,
   calendarRows: calendar.error ? [] : calendar.data,
   monthlyRows: monthly.error ? [] : monthly.data,
   meterId
  });
  const previous = mergeMonthlySources({
   year: year - 1,
   unit,
   calendarRows: previousCalendar.error ? [] : previousCalendar.data,
   monthlyRows: previousMonthly.error ? [] : previousMonthly.data,
   meterId
  });
  renderOverview(months, previous, unit, year);
  if (monthlyMissing) setMessage('historical-overview-message', 'help', 'Manuelle Monatsverbräuche brauchen die vorbereitete Tabelle. Zählerstände werden trotzdem ausgewertet.');
  else if (monthly.error) setMessage('historical-overview-message', 'error', 'Monatsverbräuche konnten nicht geladen werden: ' + (monthly.error.message || 'Unbekannter Fehler'));
  else setMessage('historical-overview-message', 'help', '');
 } catch (error) {
  setMessage('historical-overview-message', 'error', 'Die Auswertung konnte nicht geladen werden: ' + (error.message || 'Unbekannter Fehler'));
 }
}

async function saveHistoricalStand(event) {
 event.preventDefault();
 if (!canCaptureHistorical()) {
  setMessage('historical-stand-message', 'error', 'Historische Zählerstände darf die Betriebsleitung oder Geschäftsführung.');
  return;
 }
 const facility = selectedFacility();
 const meterId = el('historical-stand-meter')?.value || '';
 const draft = {
  meterId,
  reading_date: el('historical-stand-date')?.value,
  reading_value: el('historical-stand-value')?.value,
  note: el('historical-stand-note')?.value
 };
 let existingDates = [];
 try {
  const {data, error} = await fetchFacilityConsumption(facility.id);
  if (error) throw error;
  existingDates = existingReadingDates(data, meterId);
 } catch (error) {
  setMessage('historical-stand-message', 'error', 'Vorhandene Ablesungen konnten nicht geprüft werden: ' + (error.message || 'Unbekannter Fehler'));
  return;
 }
 const problem = historicalReadingDraftError(draft, {existingDates});
 if (problem) {
  setMessage('historical-stand-message', 'error', problem);
  return;
 }
 const save = el('historical-stand-save');
 if (save) save.disabled = true;
 setMessage('historical-stand-message', 'help', 'Historischer Zählerstand wird gespeichert …');
 try {
  const {error} = await insertReadingRow(historicalReadingPayload(meterId, draft));
  if (error) throw error;
  setMessage('historical-stand-message', 'ok', '✓ Historischer Zählerstand gespeichert. Der Verbrauch folgt der Zählerreihe.');
  if (el('historical-stand-value')) el('historical-stand-value').value = '';
  if (el('historical-stand-note')) el('historical-stand-note').value = '';
  el('consumption-facility')?.dispatchEvent(new Event('change'));
  void loadOverview();
 } catch (error) {
  const text = error.message || 'Unbekannter Fehler';
  const duplicate = /utility_readings_one_active_moment|duplicate key/i.test(text);
  setMessage('historical-stand-message', 'error', duplicate
   ? 'Für diesen Zeitpunkt liegt bereits eine Ablesung vor. Es wurde nichts überschrieben.'
   : 'Historischer Zählerstand konnte nicht gespeichert werden: ' + text);
 } finally {
  if (save) save.disabled = false;
 }
}

async function saveHistoricalMonth(event) {
 event.preventDefault();
 if (!canCaptureHistorical()) {
  setMessage('historical-month-message', 'error', 'Historische Monatsverbräuche darf die Betriebsleitung oder Geschäftsführung.');
  return;
 }
 const facility = selectedFacility();
 const draft = {
  facilityId: facility?.id || '',
  medium: el('historical-month-medium')?.value,
  unit: el('historical-month-unit')?.value,
  meterId: el('historical-month-meter')?.value || '',
  year: el('historical-month-year')?.value,
  month: el('historical-month-month')?.value,
  consumption_value: el('historical-month-value')?.value,
  note: el('historical-month-note')?.value
 };
 let existingKeys = [];
 try {
  const {data, error} = await fetchMonthlyConsumption(facility.id, Number(draft.year));
  if (error) throw error;
  existingKeys = (data || []).map(row => monthlyKey(row));
 } catch (error) {
  const missing = /schema cache|does not exist|42P01|PGRST/i.test(error.message || error.code || '');
  setMessage('historical-month-message', 'error', missing
   ? 'Die Tabelle für Monatsverbräuche ist in dieser Datenbank noch nicht eingerichtet. Die SQL-Datei ist vorbereitet und wartet auf Freigabe.'
   : 'Vorhandene Monatswerte konnten nicht geprüft werden: ' + (error.message || 'Unbekannter Fehler'));
  return;
 }
 const problem = monthlyConsumptionDraftError(draft, {existingKeys});
 if (problem) {
  setMessage('historical-month-message', 'error', problem);
  return;
 }
 const save = el('historical-month-save');
 if (save) save.disabled = true;
 setMessage('historical-month-message', 'help', 'Monatsverbrauch wird gespeichert …');
 try {
  const {error} = await insertMonthlyConsumption(monthlyInsertPayload(draft));
  if (error) throw error;
  setMessage('historical-month-message', 'ok', '✓ Manueller Monatsverbrauch gespeichert. Er bleibt von Zählerständen getrennt.');
  if (el('historical-month-value')) el('historical-month-value').value = '';
  if (el('historical-month-note')) el('historical-month-note').value = '';
  void loadOverview();
 } catch (error) {
  const text = error.message || 'Unbekannter Fehler';
  const duplicate = /duplicate key|utility_monthly_consumption_/i.test(text);
  setMessage('historical-month-message', 'error', duplicate
   ? 'Für diesen Monat ist bereits ein Wert gespeichert. Es wurde nichts überschrieben.'
   : 'Monatsverbrauch konnte nicht gespeichert werden: ' + text);
 } finally {
  if (save) save.disabled = false;
 }
}

function openMonthlyCorrection(id) {
 const row = monthlyRowsCache.find(item => item.id === id);
 if (!row || !canCaptureHistorical()) return;
 correctionRowId = id;
 el('historical-kind').value = 'correct';
 syncKind();
 if (el('historical-correct-value')) el('historical-correct-value').value = String(row.consumption_value ?? '').replace('.', ',');
 if (el('historical-correct-note')) el('historical-correct-note').value = row.note || '';
 if (el('historical-correct-reason')) el('historical-correct-reason').value = '';
 const label = el('historical-correct-label');
 if (label) label.textContent = `${MONTH_NAMES[Number(row.month) - 1]} ${row.year} · bisher ${String(row.consumption_value).replace('.', ',')} ${row.unit || ''}`.trim();
 setMessage('historical-correct-message', 'help', 'Die bisherige Zeile bleibt in der Änderungshistorie.');
 void loadRevisions(id);
}

async function loadRevisions(consumptionId) {
 const host = el('historical-revisions');
 if (!host) return;
 host.replaceChildren();
 const heading = document.createElement('h3');
 heading.textContent = 'Änderungshistorie';
 host.append(heading);
 try {
  const {data, error} = await fetchMonthlyRevisions(consumptionId);
  if (error) throw error;
  if (!data?.length) {
   const empty = document.createElement('p');
   empty.className = 'help';
   empty.textContent = 'Noch keine Korrektur gespeichert.';
   host.append(empty);
   return;
  }
  for (const row of data) {
   const line = document.createElement('p');
   line.className = 'help';
   const when = new Date(row.changed_at).toLocaleString('de-DE');
   line.textContent = `${when}: ${String(row.previous_value).replace('.', ',')} → ${String(row.new_value).replace('.', ',')} · ${row.correction_reason}`;
   host.append(line);
  }
 } catch (error) {
  const fail = document.createElement('p');
  fail.className = 'error';
  fail.textContent = 'Änderungshistorie konnte nicht geladen werden: ' + (error.message || 'Unbekannter Fehler');
  host.append(fail);
 }
}

async function saveHistoricalCorrection(event) {
 event.preventDefault();
 if (!canCaptureHistorical()) {
  setMessage('historical-correct-message', 'error', 'Korrekturen darf die Betriebsleitung oder Geschäftsführung.');
  return;
 }
 const facility = selectedFacility();
 const current = monthlyRowsCache.find(item => item.id === correctionRowId);
 const draft = {
  consumption_value: el('historical-correct-value')?.value,
  note: el('historical-correct-note')?.value,
  correction_reason: el('historical-correct-reason')?.value
 };
 const problem = monthlyCorrectionDraftError(draft, current);
 if (problem) {
  setMessage('historical-correct-message', 'error', problem);
  return;
 }
 const save = el('historical-correct-save');
 if (save) save.disabled = true;
 setMessage('historical-correct-message', 'help', 'Korrektur wird gespeichert …');
 try {
  const {error} = await updateMonthlyConsumption(current.id, facility.id, monthlyCorrectionPayload(draft));
  if (error) throw error;
  setMessage('historical-correct-message', 'ok', '✓ Monatsverbrauch korrigiert. Die vorherige Zeile steht in der Historie.');
  if (el('historical-correct-reason')) el('historical-correct-reason').value = '';
  await loadOverview();
 } catch (error) {
  setMessage('historical-correct-message', 'error', 'Korrektur konnte nicht gespeichert werden: ' + (error.message || 'Unbekannter Fehler'));
 } finally {
  if (save) save.disabled = false;
 }
}

function field(id, labelText, input) {
 const label = document.createElement('label');
 label.htmlFor = id;
 label.textContent = labelText;
 input.id = id;
 return [label, input];
}

export function syncHistoricalCapture() {
 const allowed = canCaptureHistorical();
 el('historical-open')?.classList.toggle('hidden', !allowed);
 if (!allowed) el('historical-capture')?.classList.add('hidden');
}

export function mountHistoricalCapture() {
 const panel = el('consumption-panel');
 const facilitySelect = el('consumption-facility');
 if (!panel || !facilitySelect || el('historical-capture')) return;
 if (!document.getElementById('historical-capture-style')) {
  const style = document.createElement('style');
  style.id = 'historical-capture-style';
  style.textContent = '#historical-open{margin:8px 8px 8px 0}#historical-capture{margin:12px 0;padding:12px;border:1px solid #4b6680;background:#142538}#historical-capture h2,#historical-capture h3{font-size:18px}#historical-kind{margin:8px 0}.historical-kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:8px 0}.historical-kpis p{margin:0;padding:8px;background:#1a2d40;border:1px solid #38536b}.historical-kpis strong{display:block;color:#e1bf48;font-size:13px}#historical-table-wrap{overflow-x:auto}.historical-chart svg{width:100%;height:auto}#historical-table{width:100%;border-collapse:collapse}#historical-table th,#historical-table td{text-align:left;padding:10px 8px;border-bottom:1px solid #405b73}#historical-table th{color:#e1bf48}@media(max-width:700px){.historical-kpis{grid-template-columns:1fr}#historical-table thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}#historical-table,#historical-table tbody,#historical-table tr,#historical-table td{display:block;width:100%}#historical-table tr{margin:0 0 10px;padding:12px;background:#1a2d40;border:1px solid #38536b;border-radius:8px}#historical-table td{border:0;padding:2px 0}#historical-table td::before{content:attr(data-label);display:block;color:#aabed0;font-size:12px}}';
  document.head.append(style);
 }
 const open = document.createElement('button');
 open.type = 'button';
 open.id = 'historical-open';
 open.className = 'secondary compact-button hidden';
 open.textContent = 'Historische Werte erfassen';
 const box = document.createElement('div');
 box.id = 'historical-capture';
 box.className = 'hidden';
 const heading = document.createElement('h2');
 heading.textContent = 'Historische Werte erfassen';
 const intro = document.createElement('p');
 intro.className = 'help';
 intro.textContent = 'Ohne Excel. Tägliche Ablesungen bleiben unverändert. Historische Stände nutzen die vorhandene Zählerreihe. Monatsverbräuche werden getrennt gespeichert.';
 const kindLabel = document.createElement('label');
 kindLabel.htmlFor = 'historical-kind';
 kindLabel.textContent = 'Erfassungsart';
 const kind = document.createElement('select');
 kind.id = 'historical-kind';
 kind.className = 'app-filter';
 for (const [value, text] of [['stand', 'Historischer Zählerstand'], ['month', 'Historischer Monatsverbrauch'], ['correct', 'Monatsverbrauch korrigieren']]) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = text;
  kind.append(option);
 }
 const standForm = document.createElement('form');
 standForm.id = 'historical-stand-form';
 const standMeter = document.createElement('select');
 standMeter.required = true;
 const standDate = document.createElement('input');
 standDate.type = 'date';
 standDate.required = true;
 const standValue = document.createElement('input');
 standValue.inputMode = 'decimal';
 standValue.autocomplete = 'off';
 standValue.required = true;
 standValue.placeholder = 'z. B. 1250,5';
 const standNote = document.createElement('input');
 standNote.autocomplete = 'off';
 standNote.maxLength = 2000;
 const standSave = document.createElement('button');
 standSave.type = 'submit';
 standSave.id = 'historical-stand-save';
 standSave.textContent = 'Historischen Stand speichern';
 const standMessage = document.createElement('p');
 standMessage.id = 'historical-stand-message';
 standMessage.className = 'help';
 standMessage.setAttribute('role', 'status');
 standForm.append(
  ...field('historical-stand-meter', 'Zähler (Pflichtfeld)', standMeter),
  ...field('historical-stand-date', 'Ablesedatum (Pflichtfeld)', standDate),
  ...field('historical-stand-value', 'Zählerstand (Pflichtfeld)', standValue),
  ...field('historical-stand-note', 'Kommentar (optional)', standNote),
  standSave,
  standMessage
 );
 const monthForm = document.createElement('form');
 monthForm.id = 'historical-month-form';
 monthForm.classList.add('hidden');
 const monthMedium = document.createElement('select');
 monthMedium.required = true;
 const monthUnit = document.createElement('select');
 monthUnit.required = true;
 const monthMeter = document.createElement('select');
 const monthYear = document.createElement('select');
 monthYear.required = true;
 const monthMonth = document.createElement('select');
 monthMonth.required = true;
 const monthValue = document.createElement('input');
 monthValue.inputMode = 'decimal';
 monthValue.autocomplete = 'off';
 monthValue.required = true;
 monthValue.placeholder = 'z. B. 12500';
 const monthNote = document.createElement('input');
 monthNote.autocomplete = 'off';
 monthNote.maxLength = 2000;
 const monthSave = document.createElement('button');
 monthSave.type = 'submit';
 monthSave.id = 'historical-month-save';
 monthSave.textContent = 'Monatsverbrauch speichern';
 const monthMessage = document.createElement('p');
 monthMessage.id = 'historical-month-message';
 monthMessage.className = 'help';
 monthMessage.setAttribute('role', 'status');
 monthForm.append(
  ...field('historical-month-medium', 'Medium (Pflichtfeld)', monthMedium),
  ...field('historical-month-unit', 'Einheit (Pflichtfeld)', monthUnit),
  ...field('historical-month-meter', 'Zähler (optional)', monthMeter),
  ...field('historical-month-year', 'Jahr (Pflichtfeld)', monthYear),
  ...field('historical-month-month', 'Monat (Pflichtfeld)', monthMonth),
  ...field('historical-month-value', 'Verbrauch (Pflichtfeld)', monthValue),
  ...field('historical-month-note', 'Kommentar (optional)', monthNote),
  monthSave,
  monthMessage
 );
 const correctForm = document.createElement('form');
 correctForm.id = 'historical-correct-form';
 correctForm.classList.add('hidden');
 const correctLabel = document.createElement('p');
 correctLabel.id = 'historical-correct-label';
 correctLabel.className = 'help';
 correctLabel.textContent = 'Wähle in der Tabelle Korrigieren.';
 const correctValue = document.createElement('input');
 correctValue.inputMode = 'decimal';
 correctValue.autocomplete = 'off';
 correctValue.required = true;
 const correctNote = document.createElement('input');
 correctNote.autocomplete = 'off';
 correctNote.maxLength = 2000;
 const correctReason = document.createElement('input');
 correctReason.autocomplete = 'off';
 correctReason.required = true;
 correctReason.maxLength = 2000;
 const correctSave = document.createElement('button');
 correctSave.type = 'submit';
 correctSave.id = 'historical-correct-save';
 correctSave.textContent = 'Korrektur speichern';
 const correctMessage = document.createElement('p');
 correctMessage.id = 'historical-correct-message';
 correctMessage.className = 'help';
 correctMessage.setAttribute('role', 'status');
 correctForm.append(
  correctLabel,
  ...field('historical-correct-value', 'Korrigierter Verbrauch (Pflichtfeld)', correctValue),
  ...field('historical-correct-note', 'Kommentar (optional)', correctNote),
  ...field('historical-correct-reason', 'Korrekturgrund (Pflichtfeld)', correctReason),
  correctSave,
  correctMessage
 );
 const overviewYear = document.createElement('select');
 const overviewMedium = document.createElement('select');
 const overviewMessage = document.createElement('p');
 overviewMessage.id = 'historical-overview-message';
 overviewMessage.className = 'help';
 overviewMessage.setAttribute('role', 'status');
 const overview = document.createElement('div');
 overview.id = 'historical-overview';
 box.append(
  heading,
  intro,
  kindLabel,
  kind,
  standForm,
  monthForm,
  correctForm,
  ...field('historical-overview-year', 'Auswertungsjahr', overviewYear),
  ...field('historical-overview-medium', 'Auswertungsmedium', overviewMedium),
  overviewMessage,
  overview
 );
 const manage = el('consumption-manage') || el('add-meter')?.parentNode;
 if (manage) manage.insertBefore(open, el('add-meter'));
 else facilitySelect.insertAdjacentElement('afterend', open);
 open.insertAdjacentElement('afterend', box);
 const today = {y: new Date().getFullYear(), m: new Date().getMonth() + 1, d: 1};
 fillOptions('historical-month-medium', Object.entries(mediumNames), 'electricity');
 fillOptions('historical-overview-medium', Object.entries(mediumNames), 'electricity');
 fillOptions('historical-month-year', yearOptions(today), String(today.y - (today.m === 1 ? 1 : 0)));
 fillOptions('historical-overview-year', yearOptions(today), String(today.y));
 fillOptions('historical-month-month', MONTH_NAMES.map((name, index) => [String(index + 1), name]), '1');
 syncMonthUnit();
 kind.addEventListener('change', syncKind);
 monthMedium.addEventListener('change', syncMonthUnit);
 overviewYear.addEventListener('change', () => void loadOverview());
 overviewMedium.addEventListener('change', () => void loadOverview());
 monthMeter.addEventListener('change', () => void loadOverview());
 standForm.addEventListener('submit', saveHistoricalStand);
 monthForm.addEventListener('submit', saveHistoricalMonth);
 correctForm.addEventListener('submit', saveHistoricalCorrection);
 open.addEventListener('click', () => {
  const show = box.classList.contains('hidden');
  box.classList.toggle('hidden', !show);
  if (show) {
   void populateMeters();
   void loadOverview();
  }
 });
 facilitySelect.addEventListener('change', () => {
  syncHistoricalCapture();
  if (!box.classList.contains('hidden')) {
   void populateMeters();
   void loadOverview();
  }
 });
 syncHistoricalCapture();
}
