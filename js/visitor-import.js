const DATE_KEYS = ['datum', 'tag', 'date', 'service_day', 'betriebstag'];
const VISITOR_KEYS = ['besucher', 'gaeste', 'gäste', 'besucherzahl', 'visitors', 'anzahl'];
const REVENUE_KEYS = ['umsatz', 'einnahmen', 'tagesumsatz', 'gesamtumsatz', 'revenue', 'umsatz_eur'];

function fold(value) {
 return String(value ?? '').trim().toLowerCase()
  .replaceAll('ä', 'ae').replaceAll('ö', 'oe').replaceAll('ü', 'ue').replaceAll('ß', 'ss');
}

function headerKey(name) {
 return fold(name).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

export function guessColumn(headers, kinds) {
 const folded = (headers || []).map(header => ({header, key: headerKey(header)}));
 for (const kind of kinds) {
  const hit = folded.find(item => item.key === kind || item.key.includes(kind));
  if (hit) return hit.header;
 }
 return '';
}

export function defaultColumnMap(headers) {
 return {
  day: guessColumn(headers, DATE_KEYS),
  visitors: guessColumn(headers, VISITOR_KEYS),
  revenue: guessColumn(headers, REVENUE_KEYS)
 };
}

export function parseGermanDate(raw) {
 const text = String(raw ?? '').trim();
 const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
 if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
 const de = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
 if (!de) return '';
 const day = de[1].padStart(2, '0');
 const month = de[2].padStart(2, '0');
 const year = de[3].length === 2 ? `20${de[3]}` : de[3];
 return `${year}-${month}-${day}`;
}

export function parseGermanNumber(raw) {
 const text = String(raw ?? '').trim().replace(/\s/g, '').replace('€', '').replace('EUR', '');
 if (!text) return {ok: false, missing: true};
 const cleaned = text.replace(/[^\d,.\-]/g, '');
 if (!cleaned) return {ok: false, missing: true};
 const german = cleaned.includes(',') || /^\d{1,3}(\.\d{3})+$/.test(cleaned);
 const normalized = german ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned.replace(/,/g, '');
 const value = Number(normalized);
 if (!Number.isFinite(value) || value < 0) return {ok: false, error: 'Ungültige Zahl'};
 return {ok: true, value};
}

export function parseCsvTables(text) {
 const source = String(text || '').replace(/^\uFEFF/, '');
 const lines = source.split(/\r?\n/).filter(line => line.trim());
 if (!lines.length) return {ok: false, error: 'Die Datei enthält keine Zeilen.'};
 const delimiter = lines[0].includes(';') && lines[0].split(';').length >= lines[0].split(',').length ? ';' : ',';
 const split = line => {
  const cells = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
   const char = line[index];
   if (char === '"') {
    if (quoted && line[index + 1] === '"') {
     current += '"';
     index += 1;
    } else quoted = !quoted;
   } else if (char === delimiter && !quoted) {
    cells.push(current);
    current = '';
   } else current += char;
  }
  cells.push(current);
  return cells.map(cell => cell.trim());
 };
 const headers = split(lines[0]);
 const rows = lines.slice(1).map(line => {
  const cells = split(line);
  const row = {};
  headers.forEach((header, index) => { row[header] = cells[index] ?? ''; });
  return row;
 });
 return {ok: true, sheets: [{name: 'CSV', headers, rows}]};
}

export function parseXlsxTables(workbook) {
 if (!workbook?.SheetNames?.length) return {ok: false, error: 'Die Arbeitsmappe enthält keine Blätter.'};
 const xlsx = globalThis.XLSX;
 if (!xlsx?.utils?.sheet_to_json) return {ok: false, error: 'Excel-Bibliothek nicht geladen.'};
 const sheets = workbook.SheetNames.map(name => {
  const matrix = xlsx.utils.sheet_to_json(workbook.Sheets[name], {header: 1, raw: false, defval: ''});
  const headers = (matrix[0] || []).map(cell => String(cell ?? '').trim()).filter(Boolean);
  const rows = matrix.slice(1).filter(line => line.some(cell => String(cell ?? '').trim())).map(line => {
   const row = {};
   headers.forEach((header, index) => { row[header] = String(line[index] ?? '').trim(); });
   return row;
  });
  return {name, headers, rows};
 });
 return {ok: true, sheets};
}

export function parsePdfTables(text) {
 const source = String(text || '').trim();
 if (!source) return {ok: false, error: 'Die PDF-Datei enthält keinen auslesbaren Text. Gescannte Seiten werden nicht per Schätzung übernommen.'};
 const lines = source.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
 const rows = [];
 for (const line of lines) {
  const date = line.match(/(\d{1,2}\.\d{1,2}\.\d{2,4}|\d{4}-\d{2}-\d{2})/);
  if (!date) continue;
  const rest = line.slice((date.index || 0) + date[0].length);
  const numbers = [...rest.matchAll(/(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d+)?)/g)].map(item => item[1]);
  if (!numbers.length) continue;
  rows.push({Datum: date[1], Besucher: numbers[0], Umsatz: numbers[1] || ''});
 }
 if (!rows.length) return {ok: false, error: 'In der PDF-Datei wurde keine digitale Tabelle mit Datum und Kennzahlen erkannt.'};
 return {ok: true, sheets: [{name: 'PDF', headers: ['Datum', 'Besucher', 'Umsatz'], rows}]};
}

export const VISITOR_IMPORT_LIMIT = 800;

export function mapImportRows(sheet, mapping, existingDays = new Set()) {
 if ((sheet?.rows || []).length > VISITOR_IMPORT_LIMIT) {
  return {ok: false, error: `Mehr als ${VISITOR_IMPORT_LIMIT} Zeilen werden in einem Vorgang nicht übernommen.`};
 }
 const dayKey = mapping.day;
 const visitorKey = mapping.visitors;
 const revenueKey = mapping.revenue;
 if (!dayKey) return {ok: false, error: 'Bitte eine Datumsspalte zuordnen.'};
 const rows = [];
 const errors = [];
 for (const [index, source] of (sheet?.rows || []).entries()) {
  const day = parseGermanDate(source[dayKey]);
  const visitors = visitorKey ? parseGermanNumber(source[visitorKey]) : {ok: true, missing: true, value: null};
  const revenue = revenueKey ? parseGermanNumber(source[revenueKey]) : {ok: true, missing: true, value: null};
  if (!day) {
   errors.push({line: index + 2, error: 'Datum unlesbar', source});
   continue;
  }
  if (visitorKey && visitors.error) {
   errors.push({line: index + 2, day, error: visitors.error, source});
   continue;
  }
  if (revenueKey && revenue.error) {
   errors.push({line: index + 2, day, error: revenue.error, source});
   continue;
  }
  if ((visitors.missing || visitors.value == null) && (revenue.missing || revenue.value == null)) {
   errors.push({line: index + 2, day, error: 'Weder Besucher noch Umsatz lesbar', source});
   continue;
  }
  const duplicate = existingDays.has(day);
  rows.push({
   day,
   visitors: visitors.missing ? null : Math.round(visitors.value),
   totalCents: revenue.missing ? null : Math.round(revenue.value * 100),
   duplicate,
   action: duplicate ? 'skip' : 'insert'
  });
 }
 return {ok: true, rows, errors};
}

export function applyDuplicatePolicy(rows, policy) {
 return (rows || []).map(row => {
  if (!row.duplicate) return {...row, action: 'insert'};
  if (policy === 'update') return {...row, action: 'update'};
  return {...row, action: 'skip'};
 });
}

export function importReport(rows, errors = []) {
 const list = rows || [];
 return {
  imported: list.filter(row => row.action === 'insert' && row.saved).length,
  updated: list.filter(row => row.action === 'update' && row.saved).length,
  skipped: list.filter(row => row.action === 'skip' || row.skipped).length,
  failed: list.filter(row => row.error).length + errors.length,
  errors
 };
}
