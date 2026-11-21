import {state} from './state.js';
import {
 dayFigureAccess,
 employeeFigureWindow,
 formatCalendarDay,
 formatCents,
 historicalFigurePayload
} from './operations.js';
import {
 importDayFiguresBatch,
 listDayFigureImports,
 loadDayFigureBoard,
 saveDayFigures
} from './operations-store.js';
import {
 applyDuplicatePolicy,
 defaultColumnMap,
 importChunks,
 importReport,
 mapImportRows,
 parseCsvTables,
 parsePdfTables,
 parseXlsxTables,
 VISITOR_IMPORT_LIMIT
} from './visitor-import.js';
import {
 chartSvg,
 downloadCsv,
 downloadXlsx,
 monthBuckets,
 printStatisticsPdf,
 revenuePerVisitor,
 statisticsRange,
 statisticsSummary,
 yearEndForecast
} from './statistics.js';
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
 host.append(overviewTitle);
 const table = figureTable(headers, tableRows);
 host.append(table);
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
 if (access === 'manager' && (overview.rows || []).length) {
  const last = overview.rows[overview.rows.length - 1]?.day || today();
  const first = overview.rows[0]?.day || last;
  const summary = statisticsSummary(overview.rows, first, last);
  const avg = document.createElement('p');
  avg.className = 'help';
  avg.textContent = `Durchschnittsbesucher: ${summary.averageVisitors.value ?? 'Keine Daten'} · Umsatz/Besucher: ${summary.revenuePerVisitor.label}`;
  host.append(avg);
  const visitorChart = document.createElement('div');
  visitorChart.className = 'mgmt-chart-wrap';
  visitorChart.innerHTML = chartSvg(monthBuckets(overview.rows, 'visitors').map(item => ({value: item.value})), {title: 'Monatsentwicklung Besucher'});
  const revenueChart = document.createElement('div');
  revenueChart.className = 'mgmt-chart-wrap';
  revenueChart.innerHTML = chartSvg(monthBuckets(overview.rows, 'totalCents').map(item => ({value: item.value})), {title: 'Monatsentwicklung Umsatz'});
  host.append(visitorChart, revenueChart);
  const exports = document.createElement('div');
  exports.className = 'figure-filters';
  exports.append(button('Excel exportieren', 'secondary', () => {
   const rows = (overview.rows || []).map(row => ({Tag: row.day, Besucher: row.visitors ?? '', 'Besucher VJ': row.priorVisitors ?? '', Umsatz: row.totalCents ?? '', 'Umsatz VJ': row.priorTotalCents ?? ''}));
   const saved = downloadXlsx(`tageswerk-kennzahlen-${first}-${last}.xlsx`, rows);
   if (!saved.ok) say('error', saved.error);
  }));
  exports.append(button('CSV exportieren', 'secondary', () => {
   downloadCsv(`tageswerk-kennzahlen-${first}-${last}.csv`, (overview.rows || []).map(row => ({Tag: row.day, Besucher: row.visitors ?? '', Umsatz: row.totalCents ?? ''})));
  }));
  exports.append(button('PDF drucken', 'secondary', () => {
   printStatisticsPdf('Betriebsstatistik', summary, overview.rows);
  }));
  host.append(exports);
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
  presets.append(preset('Aktuelle Woche', 'week'), preset('Aktueller Monat', 'month'), preset('Vorheriger Monat', 'previous-month'), preset('Aktuelles Jahr', 'year'), preset('Vorheriges Jahr', 'previous-year'));
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
 if (kind === 'week') return statisticsRange('week', day);
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
 const mappingHost = document.createElement('div');
 const historyHost = document.createElement('div');
 const duplicates = select([{value: 'skip', label: 'Vorhandene Tage überspringen'}, {value: 'update', label: 'Vorhandene Tage nach Bestätigung aktualisieren'}], 'skip');
 const headerOptions = headers => [{value: '', label: 'Keine Spalte'}, ...(headers || []).map(header => ({value: header, label: header}))];
 const paintHistory = async () => {
  const listed = await listDayFigureImports(database(), current.id);
  historyHost.replaceChildren();
  const heading = document.createElement('h4');
  heading.textContent = 'Importhistorie';
  historyHost.append(heading);
  if (!listed.ok) {
   const miss = document.createElement('p');
   miss.className = 'help';
   miss.textContent = listed.missing ? 'Importhistorie ist vorbereitet, die Tabelle ist in dieser Datenbank noch nicht installiert.' : listed.error;
   historyHost.append(miss);
   return;
  }
  if (!listed.rows.length) {
   const empty = document.createElement('p');
   empty.className = 'muted';
   empty.textContent = 'Noch keine Importblöcke gespeichert.';
   historyHost.append(empty);
   return;
  }
  for (const row of listed.rows) {
   const line = document.createElement('p');
   line.textContent = `${new Date(row.imported_at).toLocaleString('de-DE')} · ${row.file_name} · neu ${row.inserted_count}, aktualisiert ${row.updated_count}, übersprungen ${row.skipped_count}, Fehler ${row.error_count}`;
   historyHost.append(line);
  }
 };
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
  const guessed = defaultColumnMap(sheet.headers);
  mappingHost.replaceChildren();
  const dayCol = select(headerOptions(sheet.headers), guessed.day);
  const visitorCol = select(headerOptions(sheet.headers), guessed.visitors);
  const revenueCol = select(headerOptions(sheet.headers), guessed.revenue);
  mappingHost.append(labeled('Datumsspalte', dayCol), labeled('Besucherspalte', visitorCol), labeled('Umsatzspalte', revenueCol));
  const showPreview = () => {
   const mapped = mapImportRows(sheet, {day: dayCol.value, visitors: visitorCol.value, revenue: revenueCol.value}, existing, {maxRows: Number.MAX_SAFE_INTEGER});
   preview.replaceChildren();
   if (!mapped.ok) {
    preview.textContent = mapped.error;
    return;
   }
   const planned = applyDuplicatePolicy(mapped.rows, duplicates.value);
   const chunks = importChunks(planned, VISITOR_IMPORT_LIMIT);
   const info = document.createElement('p');
   info.textContent = `${planned.length} Zeilen in ${chunks.length} Blöcken zu je höchstens ${VISITOR_IMPORT_LIMIT}, ${mapped.errors.length} Lesefehler. Noch nichts gespeichert.`;
   preview.append(info);
   const run = button('Import nach Vorschau speichern', '', () => commit(async () => {
    if (!confirm('Import für '+current.name+' mit '+planned.filter(row => row.action !== 'skip').length+' Speichervorgängen in '+chunks.length+' Blöcken starten?')) return {ok: false, error: 'Import abgebrochen.'};
    const reportRows = [];
    for (const chunk of chunks) {
     const batch = await importDayFiguresBatch(database(), current.id, `${picked.name}#${chunk.index}`, chunk.rows);
     if (batch.ok) {
      chunk.status = 'ok';
      for (const row of chunk.rows) reportRows.push({...row, saved: row.action !== 'skip', skipped: row.action === 'skip'});
      continue;
     }
     if (!batch.missing) {
      chunk.status = 'error';
      say('error', `Block ${chunk.index} (${chunk.from}–${chunk.to}) fehlgeschlagen: ${batch.error}. Vorherige Blöcke bleiben gespeichert.`);
      break;
     }
     for (const row of chunk.rows) {
      if (row.action === 'skip') {
       reportRows.push({...row, skipped: true});
       continue;
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
       chunk.status = 'error';
       say('error', 'Import bei '+row.day+' gestoppt: '+saved.error+'. Vorherige Zeilen bleiben gespeichert.');
       break;
      }
      reportRows.push({...row, saved: true});
     }
     if (chunk.status === 'error') break;
     chunk.status = 'ok';
    }
    const report = importReport(reportRows, mapped.errors);
    say('ok', `Importbericht ${picked.name}: gespeichert ${report.imported}, aktualisiert ${report.updated}, übersprungen ${report.skipped}, Fehler ${report.failed}. Blöcke: ${chunks.map(item => `${item.index}:${item.status}`).join(', ')}.`);
    await paintHistory();
    return {ok: true, id: 'visitor-import', bundle: {}};
   }));
   preview.append(run);
  };
  dayCol.addEventListener('change', showPreview);
  visitorCol.addEventListener('change', showPreview);
  revenueCol.addEventListener('change', showPreview);
  duplicates.addEventListener('change', showPreview);
  showPreview();
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
 panel.append(labeled('Datei (XLSX, CSV oder digitale PDF)', file), labeled('Doppelte Tage', duplicates), mappingHost, preview, historyHost);
 const steps = document.createElement('p');
 steps.className = 'help';
 steps.textContent = 'Der Import führt über Datei, Spaltenzuordnung, Vorschau, Dublettenregel und bestätigte Blöcke. Mehr als 800 Zeilen werden in Blöcken übernommen. Fehlgeschlagene Blöcke bleiben markiert, erfolgreiche werden nicht wiederholt. Gescannte PDFs ohne Text werden nicht übernommen.';
 panel.append(steps);
 paintHistory();
 wrap.append(panel);
 return wrap;
}


