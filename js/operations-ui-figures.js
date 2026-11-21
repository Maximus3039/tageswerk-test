import {state} from './state.js';
import {
 dayFigureAccess,
 employeeFigureWindow,
 formatCalendarDay,
 formatCents,
 historicalFigurePayload
} from './operations.js';
import {
 loadDayFigureBoard,
 saveDayFigures
} from './operations-store.js';
import {
 applyDuplicatePolicy,
 defaultColumnMap,
 importReport,
 mapImportRows,
 parseCsvTables,
 parsePdfTables,
 parseXlsxTables
} from './visitor-import.js';
import {yearEndForecast, revenuePerVisitor} from './statistics.js';
import {
 actor,
 button,
 commit,
 database,
 input,
 labeled,
 missingNote,
 opsUi,
 say,
 select,
 today
} from './operations-ui-shared.js';


export function changeLabel(change) {
 const node = document.createElement('span');
 node.className = change?.tone === 'up' ? 'figure-up' : change?.tone === 'down' ? 'figure-down' : 'figure-flat';
 node.textContent = change?.label || 'Keine Vergleichsdaten';
 return node;
}

function figureCell(value) {
 const cell = document.createElement('td');
 if (value instanceof Node) cell.append(value);
 else cell.textContent = value ?? '';
 return cell;
}

function figureTable(headers, rows) {
 const wrap = document.createElement('div');
 wrap.className = 'figure-table-wrap';
 const table = document.createElement('table');
 table.className = 'figure-table';
 const head = document.createElement('tr');
 for (const label of headers) {
  const cell = document.createElement('th');
  cell.scope = 'col';
  cell.textContent = label;
  head.append(cell);
 }
 table.append(head);
 for (const row of rows) {
  const line = document.createElement('tr');
  if (row.weekend === 'saturday') line.className = 'is-saturday';
  if (row.weekend === 'sunday') line.className = 'is-sunday';
  line.append(...row.cells);
  table.append(line);
 }
 wrap.append(table);
 return wrap;
}

function metricLine(title, metric, money) {
 const line = document.createElement('p');
 const name = document.createElement('strong');
 name.textContent = `${title}: `;
 line.append(name);
 if (metric?.state === 'complete' && metric.current != null) {
  line.append(`${money ? formatCents(metric.current) : new Intl.NumberFormat('de-DE').format(metric.current)} gegenüber ${money ? formatCents(metric.prior) : new Intl.NumberFormat('de-DE').format(metric.prior)} `);
 }
 if (metric?.state === 'incomplete') line.append('Vergleich unvollständig. ');
 line.append(changeLabel(metric?.state === 'complete' ? metric.change : metric));
 return line;
}

function renderFigureBoard(host, board, access) {
 const overview = board?.overview || {rows: []};
 const period = board?.period || {};
 const tableRows = (overview.rows || []).map(row => ({
  weekend: row.weekend,
  cells: access === 'manager'
   ? [figureCell(formatCalendarDay(row.day)), figureCell(row.weekday), figureCell(formatCalendarDay(row.compareDay)), figureCell(row.visitors ?? ''), figureCell(row.priorVisitors ?? ''), figureCell(changeLabel(row.visitorChange)), figureCell(formatCents(row.gateCents)), figureCell(formatCents(row.bistroCents)), figureCell(formatCents(row.totalCents)), figureCell(formatCents(row.priorTotalCents)), figureCell(changeLabel(row.revenueChange))]
   : [figureCell(formatCalendarDay(row.day)), figureCell(row.weekday), figureCell(formatCalendarDay(row.compareDay)), figureCell(row.visitors ?? ''), figureCell(changeLabel(row.visitorChange))]
 }));
 const headers = access === 'manager'
  ? ['Datum', 'Wochentag', 'Vergleichstag VJ', 'Besucher', 'Besucher VJ', 'Besucherabweichung', 'Kassenumsatz', 'Bistroumsatz', 'Gesamtumsatz', 'Gesamtumsatz VJ', 'Umsatzabweichung']
  : ['Datum', 'Wochentag', 'Vergleichstag VJ', 'Besucher', 'Besucherabweichung'];
 const overviewTitle = document.createElement('h3');
 overviewTitle.textContent = access === 'manager' ? 'Tagesübersicht' : 'Tagesübersicht der letzten sieben Tage';
 host.append(overviewTitle, figureTable(headers, tableRows));
 for (const [key, fallback] of [['month', 'Monatsentwicklung'], ['year', 'Jahresentwicklung']]) {
  const block = period[key] || {};
  const title = document.createElement('h3');
  title.textContent = fallback;
  host.append(title);
  host.append(metricLine('Besucher', block.visitors, false));
  if (access === 'manager') {
   host.append(metricLine('Kassenumsatz', block.gate, true));
   host.append(metricLine('Bistroumsatz', block.bistro, true));
  }
  host.append(metricLine('Gesamtumsatz', block.total, true));
  if (access === 'manager' && block.visitors?.state === 'complete' && block.total?.state === 'complete') {
   const per = revenuePerVisitor(block.visitors.current, block.total.current);
   host.append(metricLine('Umsatz pro Besucher', {state: per.state === 'value' ? 'complete' : 'missing', current: per.cents, prior: null, change: {label: per.label}}, true));
  }
 }
 const forecast = yearEndForecast((overview.rows || []).map(row => ({day: row.day, visitors: row.visitors, totalCents: row.totalCents})), overview.rows?.[0]?.day || '');
 if (access === 'manager' && forecast.state) {
  const line = document.createElement('p');
  line.className = 'help';
  line.textContent = forecast.label + (forecast.total != null ? ` Erfasst ${forecast.actual}, Rest ${forecast.rest}, Prognose ${forecast.total}.` : '');
  host.append(line);
 }
}

export function renderDayFigures(host, current) {
 const access = dayFigureAccess(current, state.myMemberships);
 if (access === 'none') return;
 const board = document.createElement('section');
 board.id = 'day-figures';
 board.className = 'figure-board';
 const heading = document.createElement('h3');
 heading.textContent = 'Tageskennzahlen';
 const day = input(today());
 day.type = 'date';
 if (access === 'employee') {
  const window = employeeFigureWindow(today());
  day.min = window.from;
  day.max = window.to;
 }
 const visitors = input('');
 const gate = input('');
 const bistro = input('');
 const total = input('');
 visitors.inputMode = 'numeric';
 gate.inputMode = 'decimal';
 bistro.inputMode = 'decimal';
 gate.placeholder = '0,00';
 bistro.placeholder = '0,00';
 total.readOnly = true;
 total.tabIndex = -1;
 const paintTotal = () => {
  const left = euroCents(gate.value);
  const right = euroCents(bistro.value);
  total.value = left == null || right == null ? '' : formatCents(left + right);
 };
 gate.addEventListener('input', paintTotal);
 bistro.addEventListener('input', paintTotal);
 const note = input('');
 note.placeholder = 'Nur bei einer Änderung eines gespeicherten Tages';
 board.append(heading, labeled('Tag der Kennzahlen', day), labeled('Besucherzahl', visitors), labeled('Kassenumsatz', gate), labeled('Bistroumsatz', bistro), labeled('Gesamtumsatz', total), labeled('Grund der Änderung', note));
 board.append(button('Kennzahlen speichern', '', () => commit(() => saveDayFigures(database(), {
  facility: current,
  access,
  day: day.value,
  visitors: visitors.value,
  gate: gate.value,
  bistro: bistro.value,
  changeNote: note.value,
  replaces: false,
  source: 'erfassung'
 }, actor(), today()))));
 const resultHost = document.createElement('div');
 board.append(resultHost);
 if (access === 'manager') {
  const from = input('');
  const to = input('');
  from.type = 'date';
  to.type = 'date';
  const weekday = select([{value: 'all', label: 'Alle Wochentage'}, {value: 'saturday', label: 'Nur Samstage'}, {value: 'sunday', label: 'Nur Sonntage'}], 'all');
  const reload = range => paintFigures(range);
  board.append(labeled('Von', from), labeled('Bis', to), labeled('Wochentage', weekday));
  const filters = document.createElement('div');
  filters.className = 'figure-filters';
  const presets = document.createElement('div');
  presets.className = 'figure-presets';
  const preset = (label, shift) => button(label, 'secondary', () => {
   const range = figurePreset(today(), shift);
   from.value = range.from;
   to.value = range.to;
   reload({from: range.from, to: range.to, weekday: weekday.value});
  });
  filters.append(button('Zeitraum anzeigen', 'secondary', () => reload({from: from.value, to: to.value, weekday: weekday.value})));
  presets.append(preset('Aktueller Monat', 'month'), preset('Vorheriger Monat', 'previous-month'), preset('Aktuelles Jahr', 'year'), preset('Vorheriges Jahr', 'previous-year'));
  filters.append(presets);
  board.append(filters, figureSettings(current, access));
 }
 host.append(board);
 const paintFigures = range => {
  const token = ++opsUi.figureRender;
  loadDayFigureBoard(database(), current.id, range || {}).then(result => {
   if (token !== opsUi.figureRender || !resultHost.isConnected) return;
   resultHost.replaceChildren();
   if (result.missing) {
    missingNote(resultHost, false, result.error);
    return;
   }
   if (!result.ok) {
    const failure = document.createElement('p');
    failure.className = 'error';
    failure.textContent = result.error;
    resultHost.append(failure);
    return;
   }
   renderFigureBoard(resultHost, result, result.overview?.access || access);
  });
 };
 paintFigures({});
}

function figurePreset(day, kind) {
 const [year, month] = day.split('-').map(Number);
 const startOf = (targetYear, targetMonth) => new Date(Date.UTC(targetYear, targetMonth - 1, 1)).toISOString().slice(0, 10);
 const endOf = (targetYear, targetMonth) => new Date(Date.UTC(targetYear, targetMonth, 0)).toISOString().slice(0, 10);
 if (kind === 'month') return {from: startOf(year, month), to: day};
 if (kind === 'previous-month') {
  const previous = new Date(Date.UTC(year, month - 2, 1));
  return {from: previous.toISOString().slice(0, 10), to: endOf(previous.getUTCFullYear(), previous.getUTCMonth() + 1)};
 }
 if (kind === 'year') return {from: `${year}-01-01`, to: day};
 return {from: `${year - 1}-01-01`, to: `${year - 1}-12-31`};
}

function euroCents(raw) {
 const text = String(raw ?? '').trim().replace(/\s/g, '').replace('€', '');
 if (!text) return null;
 const german = text.includes(',');
 if (!(german ? /^\d{1,9}(\.\d{3})*(,\d{1,2})?$/ : /^\d{1,9}(\.\d{1,2})?$/).test(text)) return null;
 const normalized = german ? text.replace(/\./g, '').replace(',', '.') : text;
 const [whole, fraction = ''] = normalized.split('.');
 return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

function figureSettings(current, access) {
 const wrap = document.createElement('div');
 const panel = document.createElement('div');
 panel.id = 'day-figure-settings';
 panel.className = 'water-settings hidden';
 wrap.append(button('⚙ Einstellungen', 'secondary', () => {
  const open = panel.classList.toggle('hidden') === false;
  wrap.firstChild.setAttribute('aria-expanded', open ? 'true' : 'false');
 }));
 wrap.firstChild.setAttribute('aria-expanded', 'false');
 wrap.firstChild.setAttribute('aria-controls', 'day-figure-settings');
 const title = document.createElement('h3');
 title.textContent = 'Historische Daten';
 const help = document.createElement('p');
 help.className = 'help';
 help.textContent = 'Historische Daten können Besucherzahl und Gesamtumsatz enthalten. Fehlende Kassen- und Bistroumsätze werden nicht ergänzt. Ein vorhandener Tag wird nur mit einem Änderungsgrund ersetzt.';
 const historicDay = input('');
 historicDay.type = 'date';
 const historicVisitors = input('');
 const historicTotal = input('');
 const historicNote = input('');
 historicVisitors.inputMode = 'numeric';
 historicTotal.inputMode = 'decimal';
 historicTotal.placeholder = '0,00';
 historicNote.placeholder = 'Grund, falls der Tag schon gespeichert ist';
 const file = document.createElement('input');
 file.type = 'file';
 file.accept = '.xlsx,.csv,.pdf,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
 const preview = document.createElement('div');
 preview.className = 'help';
 const duplicates = select([{value: 'skip', label: 'Vorhandene Tage überspringen'}, {value: 'update', label: 'Vorhandene Tage nach Bestätigung aktualisieren'}], 'skip');
 file.addEventListener('change', async () => {
  const picked = file.files?.[0];
  file.value = '';
  if (!picked) return;
  const board = await loadDayFigureBoard(database(), current.id, {});
  const existing = new Set((board?.overview?.rows || []).filter(row => row.visitors != null || row.totalCents != null).map(row => row.day));
  let parsed;
  if (/\.csv$/i.test(picked.name) || picked.type === 'text/csv') parsed = parseCsvTables(await picked.text());
  else if (/\.pdf$/i.test(picked.name) || picked.type === 'application/pdf') parsed = parsePdfTables(await picked.text());
  else parsed = parseXlsxTables(globalThis.XLSX?.read(await picked.arrayBuffer(), {type: 'array'}));
  if (!parsed.ok) {
   say('error', parsed.error);
   return;
  }
  const sheet = parsed.sheets[0];
  const mapped = mapImportRows(sheet, defaultColumnMap(sheet.headers), existing);
  if (!mapped.ok) {
   say('error', mapped.error);
   return;
  }
  const planned = applyDuplicatePolicy(mapped.rows, duplicates.value);
  preview.textContent = `${planned.length} Zeilen, ${mapped.errors.length} Lesefehler. Noch nichts gespeichert.`;
  const run = button('Import nach Vorschau speichern', '', () => commit(async () => {
   if (!confirm('Import für '+current.name+' mit '+planned.filter(row => row.action !== 'skip').length+' Speichervorgängen starten?')) return {ok: false, error: 'Import abgebrochen.'};
   const reportRows = [];
   for (const row of planned) {
    if (row.action === 'skip') {
     reportRows.push({...row, skipped: true});
     continue;
    }
    const payload = historicalFigurePayload({
     day: row.day,
     visitors: row.visitors == null ? '' : String(row.visitors),
     total: row.totalCents == null ? '' : (row.totalCents / 100).toFixed(2).replace('.', ','),
     gate: '',
     bistro: '',
     changeNote: row.action === 'update' ? 'Historischer Import aktualisiert '+picked.name : '',
     replaces: row.action === 'update'
    }, access, today());
    if (!payload.ok) {
     reportRows.push({...row, error: payload.error});
     say('error', 'Import bei '+row.day+' gestoppt: '+payload.error);
     break;
    }
    const saved = await saveDayFigures(database(), {
     facility: current,
     access,
     day: row.day,
     visitors: row.visitors == null ? '' : String(row.visitors),
     total: row.totalCents == null ? '' : formatCents(row.totalCents).replace(' €', ''),
     gate: '',
     bistro: '',
     changeNote: row.action === 'update' ? 'Historischer Import aktualisiert '+picked.name : 'Historischer Import '+picked.name,
     replaces: row.action === 'update',
     source: 'import'
    }, actor(), today());
    if (!saved.ok) {
     reportRows.push({...row, error: saved.error});
     say('error', 'Import bei '+row.day+' gestoppt: '+saved.error);
     break;
    }
    reportRows.push({...row, saved: true});
   }
   const report = importReport(reportRows, mapped.errors);
   say('ok', `Importbericht ${picked.name}: gespeichert ${report.imported}, aktualisiert ${report.updated}, übersprungen ${report.skipped}, Fehler ${report.failed}.`);
   return {ok: true, id: 'visitor-import', bundle: {}};
  }));
  preview.append(document.createElement('br'), run);
 });
 panel.append(title, help, labeled('Historisches Datum', historicDay), labeled('Besucherzahl', historicVisitors), labeled('Gesamtumsatz', historicTotal), labeled('Grund der Änderung', historicNote));
 panel.append(button('Historische Kennzahlen speichern', 'secondary', () => commit(() => saveDayFigures(database(), {
  facility: current,
  access,
  day: historicDay.value,
  visitors: historicVisitors.value,
  total: historicTotal.value,
  gate: '',
  bistro: '',
  changeNote: historicNote.value,
  replaces: false,
  source: 'import'
 }, actor(), today()))));
 panel.append(labeled('Datei (XLSX, CSV oder digitale PDF)', file), labeled('Doppelte Tage', duplicates), preview);
 const steps = document.createElement('p');
 steps.className = 'help';
 steps.textContent = 'Der Import führt über Datei, Spaltenzuordnung, Vorschau, Dublettenregel und Bestätigung. Gescannte PDFs ohne Text werden nicht übernommen. Ohne die vorbereitete SQL-Funktion erfolgt die Speicherung zeilenweise und stoppt beim ersten Fehler.';
 panel.append(steps);
 wrap.append(panel);
 return wrap;
}


