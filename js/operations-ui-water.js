import {el} from './utils.js';
import {state} from './state.js';
import {isManager, waterHistoryRole} from './permissions.js';
import {
 beginWaterRound,
 clearWaterRound,
 loadWaterRound,
 moveWaterRound,
 ownOpenWaterDraft,
 rememberWaterEntry,
 reviewWaterRound,
 roundFromWaterDraft,
 storeWaterRound,
 waterDraftSaveDelay,
 waterDraftStatusText,
 waterParameterName,
 waterRoundDisplayStatus,
 waterRoundTableRows,
 waterRoundPools,
 waterRoundProgress,
 waterRoundSelection
} from './operations-controls.js';
import {
 waterCatalog,
 waterControlState,
 waterDayRounds,
 waterFacilityPlan,
 waterFacilitySlots,
 waterHistoryByPool,
 waterHistoryCsv,
 waterHistoryRows,
 waterOverviewRows,
 waterReadingOutside,
 waterRowsForMember,
 waterScheduleLabel
} from './operations.js';
import {
 discardWaterRound,
 saveWaterAcknowledgement,
 saveWaterCheck,
 saveWaterFacilitySlots,
 saveWaterMeasure,
 saveWaterParameter,
 saveWaterParameterAdd,
 saveWaterPool,
 saveWaterPoolActive,
 saveWaterPoolChange,
 saveWaterRound,
 saveWaterRoundDraft
} from './operations-store.js';
import {
 actor,
 amountLabel,
 berlinLocal,
 bundle,
 button,
 commit,
 context,
 database,
 input,
 labeled,
 missingNote,
 opsUi,
 renderPanel,
 say,
 select,
 today
} from './operations-ui-shared.js';

function choice(text, checked) {
 const node = document.createElement('label');
 node.className = 'choice';
 const box = document.createElement('input');
 box.type = 'checkbox';
 box.checked = checked === true;
 node.append(box, document.createTextNode(text));
 return {node, box};
}

function weekdayBoxes(selected) {
 const names = [[1, 'Mo'], [2, 'Di'], [3, 'Mi'], [4, 'Do'], [5, 'Fr'], [6, 'Sa'], [7, 'So']];
 const wrap = document.createElement('div');
 wrap.className = 'point-actions';
 const boxes = [];
 for (const [value, label] of names) {
  const item = choice(label, (selected || [1, 2, 3, 4, 5, 6, 7]).map(Number).includes(value));
  item.box.value = String(value);
  boxes.push(item.box);
  wrap.append(item.node);
 }
 return {wrap, boxes};
}

function selectedWeekdays(boxes) {
 return boxes.filter(box => box.checked).map(box => Number(box.value));
}

function limitText(value) {
 return value == null || value === '' ? '' : String(value);
}

function rangeText(parameter) {
 if (parameter.minValue == null && parameter.maxValue == null) return 'Kein Sollbereich hinterlegt.';
 if (parameter.minValue != null && parameter.maxValue != null) return `Sollbereich ${parameter.minValue} bis ${parameter.maxValue}`;
 if (parameter.minValue != null) return `Sollbereich mindestens ${parameter.minValue}`;
 return `Sollbereich höchstens ${parameter.maxValue}`;
}

function downloadWaterCsv(text, name) {
 const blob = new Blob([`\uFEFF${text}`], {type: 'text/csv;charset=utf-8'});
 const url = URL.createObjectURL(blob);
 const link = document.createElement('a');
 link.href = url;
 link.download = name;
 link.click();
 URL.revokeObjectURL(url);
}

function waterEntryValues(fields, note) {
 const values = {};
 for (const [code, field] of fields) values[code] = field.value;
 return {values, note: note.value};
}

function showDraftStatus(text) {
 opsUi.waterDraftStatus = text;
 const node = document.querySelector('.water-draft-status');
 if (node) node.textContent = text;
}

async function flushWaterDraftSave(userId, facilityId) {
 const round = loadWaterRound(userId, facilityId);
 if (!round || round.saved) return;
 const baseRevision = Number(round.revision) || 0;
 const sent = `${JSON.stringify(round.entries)}|${round.index}|${round.phase}|${JSON.stringify(round.selectedPoolIds || [])}`;
 let result;
 try {
  result = await saveWaterRoundDraft(database(), round);
 } catch {
  showDraftStatus(waterDraftStatusText.offline);
  return;
 }
 const current = loadWaterRound(userId, facilityId);
 if (!current) return;
 if (!result?.ok) {
  showDraftStatus(result?.conflict ? waterDraftStatusText.conflict : waterDraftStatusText.offline);
  return;
 }
 if ((Number(current.revision) || 0) === baseRevision) storeWaterRound(userId, {...current, revision: result.revision});
 const latest = loadWaterRound(userId, facilityId);
 const nowSent = `${JSON.stringify(latest.entries)}|${latest.index}|${latest.phase}|${JSON.stringify(latest.selectedPoolIds || [])}`;
 if (nowSent !== sent) scheduleWaterDraftSave(userId, facilityId);
 else showDraftStatus(waterDraftStatusText.saved);
}

function scheduleWaterDraftSave(userId, facilityId) {
 showDraftStatus(waterDraftStatusText.saving);
 window.clearTimeout(opsUi.waterDraftTimer);
 opsUi.waterDraftTimer = window.setTimeout(() => {
  flushWaterDraftSave(userId, facilityId);
 }, waterDraftSaveDelay);
}

async function rememberDraft(userId, round, immediate = false) {
 const stored = storeWaterRound(userId, round);
 if (immediate) {
  window.clearTimeout(opsUi.waterDraftTimer);
  showDraftStatus(waterDraftStatusText.saving);
  await flushWaterDraftSave(userId, stored.facilityId);
 } else scheduleWaterDraftSave(userId, stored.facilityId);
 return stored;
}

function discardButton(person, facilityId, round) {
 return button('Kontrollrunde verwerfen', 'secondary', async () => {
  if (!confirm('Kontrollrunde verwerfen? Die erfassten Werte werden nicht als Messung gespeichert.')) return;
  window.clearTimeout(opsUi.waterDraftTimer);
  const current = round?.roundId ? round : loadWaterRound(person.userId, facilityId);
  if (!current?.roundId) {
   clearWaterRound(person.userId, facilityId);
   renderPanel('');
   return;
  }
  const result = await discardWaterRound(database(), current);
  if (!result?.ok && !result?.absent) {
   showDraftStatus(waterDraftStatusText.offline);
   say('error', result?.error || 'Die Kontrollrunde wurde nicht verworfen.');
   return;
  }
  clearWaterRound(person.userId, facilityId);
  opsUi.waterRoundError = '';
  const preview = bundle();
  state.operationPreview = {
   ...preview,
   waterRoundDrafts: (preview.waterRoundDrafts || []).filter(draft => !(draft.userId === person.userId && draft.facilityId === facilityId && draft.roundId === current.roundId))
  };
  showDraftStatus('');
  say('ok', 'Die Kontrollrunde wurde verworfen. Es wurde keine Messung gespeichert.');
  renderPanel('');
 });
}

function waterTable(headers, rows) {
 const wrap = document.createElement('div');
 wrap.className = 'water-table-wrap';
 const table = document.createElement('table');
 table.className = 'water-table';
 const head = document.createElement('tr');
 for (const label of headers) {
  const cell = document.createElement('th');
  cell.scope = 'col';
  cell.textContent = label;
  head.append(cell);
 }
 table.append(head);
 for (const values of rows) {
  const line = document.createElement('tr');
  for (const value of values) {
   const cell = document.createElement('td');
   writeWaterCell(cell, value);
   line.append(cell);
  }
  table.append(line);
 }
 wrap.append(table);
 return wrap;
}

function writeWaterCell(cell, value) {
 if (value && typeof value === 'object') {
  if (value.breach) {
   cell.className = 'is-breach';
   cell.title = 'Grenzwertabweichung';
   const mark = document.createElement('span');
   mark.setAttribute('aria-hidden', 'true');
   mark.textContent = '⚠ ';
   cell.append(mark);
  }
  cell.append(document.createTextNode(value.text ?? ''));
  return;
 }
 cell.textContent = value ?? '';
 if (value === 'fehlt') cell.className = 'is-missing';
}

function roundLabel(round) {
 if (round?.kind === 'extra') return 'Zusatzkontrolle';
 if (round?.slotTime) return `Kontrollrunde ${round.slotTime}`;
 return 'Kontrollrunde';
}

function startPlannedRound(person, facilityId, plan) {
 if (loadWaterRound(person.userId, facilityId) || ownOpenWaterDraft(bundle(), facilityId, person.userId)) {
  say('error', 'Die geöffnete Kontrollrunde zuerst abschließen oder verwerfen.');
  return;
 }
 const created = beginWaterRound(person.userId, facilityId);
 storeWaterRound(person.userId, {...created, slotId: plan.slotId || null, kind: plan.kind, slotTime: plan.slotTime || '', selectedPoolIds: []});
 renderPanel('');
}

function renderWaterDay(host, current, data, nowIso) {
 const plan = waterFacilityPlan(data, current.id, nowIso);
 if (!plan.current.length) {
  if (!plan.upcoming.length) return;
  const waiting = document.createElement('p');
  waiting.className = 'help';
  waiting.textContent = 'Der Kontrollplan gilt ab morgen. Für heute wird keine Kontrollrunde nachträglich als fehlend geführt.';
  host.append(waiting);
  return;
 }
 const day = waterDayRounds(data, current.id, nowIso);
 const person = actor();
 const section = document.createElement('section');
 const title = document.createElement('h3');
 title.textContent = 'Kontrollrunden heute';
 section.append(title);
 const rows = day.planned.map(item => [item.time, item.status]);
 for (const extra of day.extras) rows.push(['Zusatzkontrolle', extra.status]);
 section.append(waterTable(['Uhrzeit', 'Status'], rows.length ? rows : [['—', 'Keine Kontrollzeit']]));
 const actions = document.createElement('div');
 actions.className = 'point-actions';
 for (const item of day.planned) {
  if (item.state === 'done') continue;
  actions.append(button(`${item.time} starten`, '', () => startPlannedRound(person, current.id, {slotId: item.id, kind: 'planned', slotTime: item.time})));
 }
 actions.append(button('Zusatzkontrolle starten', 'secondary', () => startPlannedRound(person, current.id, {kind: 'extra'})));
 section.append(actions);
 const note = document.createElement('p');
 note.className = 'help';
 note.textContent = plan.changed
  ? `Ab morgen gelten andere Kontrollzeiten: ${plan.upcoming.map(slot => slot.time).join(', ') || 'kein eigener Kontrollplan'}. Heutige Kontrollrunden bleiben unverändert.`
  : 'Eine Kontrollrunde kann vor ihrer Uhrzeit begonnen werden. Eine versäumte Runde bleibt überfällig, auch wenn eine spätere Runde bereits abgeschlossen ist.';
 section.append(note);
 host.append(section);
}

function waterPoolChoices(pools, selectedIds) {
 const selected = new Set(Array.isArray(selectedIds) ? selectedIds : []);
 const group = document.createElement('fieldset');
 group.className = 'water-pool-choices';
 const legend = document.createElement('legend');
 legend.textContent = 'Becken für die Zusatzkontrolle';
 group.append(legend);
 const boxes = new Map();
 for (const pool of pools) {
  const label = document.createElement('label');
  label.className = 'choice';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = selected.has(pool.id);
  const text = document.createElement('span');
  text.textContent = pool.name;
  label.append(box, text);
  group.append(label);
  boxes.set(pool.id, box);
 }
 return {group, boxes};
}

function applyPoolChoice(person, facilityId, round, poolId, checked, currentValues, currentPoolId) {
 const latest = loadWaterRound(person.userId, facilityId) || round;
 const remembered = currentPoolId && typeof currentValues === 'function' ? rememberWaterEntry(latest, currentPoolId, currentValues()) : latest;
 const ids = new Set(Array.isArray(remembered.selectedPoolIds) ? remembered.selectedPoolIds : []);
 if (checked) ids.add(poolId);
 else ids.delete(poolId);
 const selected = waterRoundPools(bundle(), facilityId).filter(pool => ids.has(pool.id));
 const index = Math.max(selected.findIndex(pool => pool.id === currentPoolId), 0);
 rememberDraft(person.userId, {...remembered, selectedPoolIds: selected.map(pool => pool.id), index, phase: 'edit'}).then(() => renderPanel(''));
}

function renderWaterRound(host, current, data) {
 const pools = waterRoundPools(data, current.id);
 const person = actor();
 const remote = ownOpenWaterDraft(data, current.id, person.userId);
 let round = loadWaterRound(person.userId, current.id);
 if (!round && !remote && waterFacilitySlots(data, current.id, new Date().toISOString()).length) {
  if (opsUi.waterRoundNotice) {
   const done = document.createElement('p');
   done.className = 'water-round-status';
   done.textContent = opsUi.waterRoundNotice;
   host.append(done);
   opsUi.waterRoundNotice = '';
  }
  return;
 }
 const card = document.createElement('section');
 const title = document.createElement('h3');
 title.textContent = roundLabel(round || (remote ? roundFromWaterDraft(remote) : null));
 card.append(title);
 if (opsUi.waterRoundNotice) {
  const done = document.createElement('p');
  done.className = 'water-round-status';
  done.textContent = opsUi.waterRoundNotice;
  card.append(done);
  opsUi.waterRoundNotice = '';
 }
 if (!pools.length) {
  const empty = document.createElement('p');
  empty.className = 'muted';
  empty.textContent = 'Für diesen Betrieb ist kein aktives Becken angelegt.';
  card.append(empty);
  host.append(card);
  return;
 }
 if (!round && remote) {
  const pendingPool = opsUi.selectedWaterPoolId;
  opsUi.selectedWaterPoolId = '';
  const note = document.createElement('p');
  note.textContent = 'Eine unterbrochene Kontrollrunde ist gespeichert.';
  const actions = document.createElement('div');
  actions.className = 'point-actions';
  actions.append(button('Kontrollrunde fortsetzen', '', () => {
   const restored = roundFromWaterDraft(remote);
   if (pendingPool) {
    const index = pools.findIndex(pool => pool.id === pendingPool);
    if (index >= 0) restored.index = index;
   }
   storeWaterRound(person.userId, restored);
   showDraftStatus(waterDraftStatusText.saved);
   renderPanel('');
  }));
  actions.append(discardButton(person, current.id, {roundId: remote.roundId, facilityId: current.id, revision: remote.revision}));
  card.append(note, actions);
  host.append(card);
  return;
 }
 if (!round) round = beginWaterRound(person.userId, current.id);
 title.textContent = roundLabel(round);
 const roundPools = waterRoundSelection(data, round);
 if (opsUi.selectedWaterPoolId) {
  const index = roundPools.findIndex(pool => pool.id === opsUi.selectedWaterPoolId);
  if (index >= 0) round = storeWaterRound(person.userId, {...round, index, phase: 'edit'});
  opsUi.selectedWaterPoolId = '';
 }
 if (roundPools.length && round.index >= roundPools.length) round = storeWaterRound(person.userId, {...round, index: 0});
 const progress = waterRoundProgress(data, round, roundPools, person, new Date().toISOString());
 const progressLine = document.createElement('p');
 progressLine.className = 'water-progress';
 progressLine.textContent = round.kind === 'extra' && !roundPools.length
  ? 'Keine Becken ausgewählt'
  : `${progress.label} · ${progress.filled} von ${progress.total} vollständig`;
 card.append(progressLine);
 const roundState = waterRoundDisplayStatus(data, round, person, new Date().toISOString());
 if (roundState) {
  const stateLine = document.createElement('p');
  stateLine.className = 'water-round-status';
  stateLine.textContent = roundState;
  card.append(stateLine);
 }
 const draftStatus = document.createElement('p');
 draftStatus.className = 'water-draft-status';
 draftStatus.textContent = opsUi.waterDraftStatus;
 card.append(draftStatus);
 if (opsUi.waterRoundError) {
  const failure = document.createElement('p');
  failure.className = 'error';
  failure.textContent = opsUi.waterRoundError;
  card.append(failure);
 }
 if (round.phase === 'summary') {
  const review = reviewWaterRound(data, round, person, new Date().toISOString());
  if (!review.ok) {
   const failed = roundPools.findIndex(pool => pool.id === review.poolId);
   round = storeWaterRound(person.userId, {...round, index: failed >= 0 ? failed : round.index, phase: 'edit'});
   const message = document.createElement('p');
   message.className = 'error';
   message.textContent = review.error;
   card.append(message);
  } else {
   const summaryRows = waterRoundTableRows(data, review).map(item => [item.poolName, item.values.temperature, item.values.ph, item.values.free_chlorine, item.values.combined_chlorine, item.status]);
   const chosen = document.createElement('p');
   chosen.className = 'help';
   chosen.textContent = `Diese Becken werden kontrolliert: ${review.pools.map(pool => pool.name).join(', ')}.`;
   card.append(chosen, waterTable(['Becken', 'Temperatur', 'pH-Wert', 'Freies Chlor', 'Gebundenes Chlor', 'Status'], summaryRows));
   const actions = document.createElement('div');
   actions.className = 'point-actions';
   actions.append(button('Zurück zur Eingabe', 'secondary', async () => {
    const latest = loadWaterRound(person.userId, current.id) || round;
    await rememberDraft(person.userId, {...latest, phase: 'edit'}, true);
    renderPanel('');
   }));
   actions.append(discardButton(person, current.id, loadWaterRound(person.userId, current.id) || round));
   const occupied = round.kind === 'planned'
    ? waterDayRounds(data, current.id, new Date().toISOString()).planned.find(item => item.id === round.slotId && item.state === 'done' && item.roundId !== round.roundId)
    : null;
   if (occupied) {
    const kept = document.createElement('p');
    kept.className = 'help';
    kept.textContent = 'Dieser Termin ist abgeschlossen. Die eingegebenen Messwerte bleiben erhalten und können als Zusatzkontrolle gespeichert werden.';
    card.append(kept);
    actions.append(button('Als Zusatzkontrolle speichern', 'secondary', () => {
     const latest = loadWaterRound(person.userId, current.id) || round;
     storeWaterRound(person.userId, {...latest, kind: 'extra', slotId: null, slotTime: '', phase: 'summary', selectedPoolIds: pools.map(pool => pool.id)});
     opsUi.waterRoundError = '';
     renderPanel('');
    }));
   }
   actions.append(button('Kontrollrunde speichern', '', () => {
    const pending = commit(async () => {
     window.clearTimeout(opsUi.waterDraftTimer);
     const result = await saveWaterRound(database(), bundle(), loadWaterRound(person.userId, current.id) || round, person, new Date().toISOString(), context());
     if (result?.ok) {
      clearWaterRound(person.userId, current.id);
      showDraftStatus('');
      opsUi.waterRoundError = '';
      opsUi.waterRoundNotice = 'Endgültig abgeschlossen';
     } else {
      opsUi.waterRoundError = result?.error || 'Die Kontrollrunde wurde nicht abgeschlossen. Die erfassten Werte bleiben im Entwurf.';
      if (result?.conflict && result.bundle) state.operationPreview = result.bundle;
     }
     return result;
    });
    if (!pending?.then) return pending;
    return pending.then(result => {
     if (!result?.ok) renderPanel();
     return result;
    });
   }));
   card.append(actions);
   host.append(card);
   return;
  }
 }
 const choices = round.kind === 'extra' ? waterPoolChoices(pools, round.selectedPoolIds) : null;
 if (choices) card.append(choices.group);
 if (!roundPools.length) {
  const hint = document.createElement('p');
  hint.className = 'help';
  hint.textContent = 'Bitte mindestens ein Becken auswählen. Bereits eingegebene Werte bleiben erhalten.';
  const actions = document.createElement('div');
  actions.className = 'point-actions';
  actions.append(discardButton(person, current.id, loadWaterRound(person.userId, current.id) || round));
  choices?.boxes.forEach((box, poolId) => box.addEventListener('change', () => applyPoolChoice(person, current.id, round, poolId, box.checked, null)));
  card.append(hint, actions);
  host.append(card);
  return;
 }
 const pool = roundPools[round.index] || roundPools[0];
 const savedEntry = round.entries[pool.id] || {values: {}, note: ''};
 const parameters = data.waterPoolParameters.filter(item => item.poolId === pool.id && item.active !== false).sort((left, right) => waterCatalog(data).findIndex(item => item.code === left.parameterCode) - waterCatalog(data).findIndex(item => item.code === right.parameterCode));
 const name = document.createElement('strong');
 name.textContent = pool.name;
 card.append(name);
 const readings = document.createElement('div');
 readings.className = 'water-readings';
 const fields = new Map();
 for (const parameter of parameters) {
  const definition = waterCatalog(data).find(item => item.code === parameter.parameterCode);
  const field = input(savedEntry.values[parameter.parameterCode] || '');
  field.inputMode = 'decimal';
  field.lang = 'de';
  fields.set(parameter.parameterCode, field);
  const caption = `${waterParameterName(data, parameter.parameterCode)}${definition?.unit ? ` ${definition.unit}` : ''}${parameter.required === false ? '' : ' · erforderlich'}`;
  readings.append(labeled(caption, field));
 }
 card.append(readings);
 const note = input(savedEntry.note || '');
 note.placeholder = 'Kommentar, falls nötig';
 const keep = () => {
  const latest = loadWaterRound(person.userId, current.id) || round;
  rememberDraft(person.userId, rememberWaterEntry(latest, pool.id, waterEntryValues(fields, note)));
 };
 choices?.boxes.forEach((box, poolId) => box.addEventListener('change', () => applyPoolChoice(person, current.id, round, poolId, box.checked, () => waterEntryValues(fields, note), pool.id)));
 for (const field of fields.values()) field.addEventListener('input', keep);
 note.addEventListener('input', keep);
 card.append(labeled('Kommentar', note));
 const actions = document.createElement('div');
 actions.className = 'point-actions';
 actions.append(button('Zurück', 'secondary', async () => {
  const latest = loadWaterRound(person.userId, current.id) || round;
  await rememberDraft(person.userId, moveWaterRound(latest, roundPools, -1, waterEntryValues(fields, note)), true);
  renderPanel('');
 }));
 if (round.index < roundPools.length - 1) {
  actions.append(button('Weiter', '', async () => {
   const latest = loadWaterRound(person.userId, current.id) || round;
   await rememberDraft(person.userId, moveWaterRound(latest, roundPools, 1, waterEntryValues(fields, note)), true);
   renderPanel('');
  }));
 } else {
  actions.append(button('Zusammenfassung anzeigen', '', async () => {
   const latest = loadWaterRound(person.userId, current.id) || round;
   const remembered = rememberWaterEntry(latest, pool.id, waterEntryValues(fields, note));
   await rememberDraft(person.userId, {...remembered, phase: 'summary'}, true);
   renderPanel('');
  }));
 }
 if (round.index === 0) actions.firstChild.disabled = true;
 actions.append(discardButton(person, current.id, loadWaterRound(person.userId, current.id) || round));
 card.append(actions);
 host.append(card);
}

const waterHistoryViewKey = 'tageswerk-water-history-view';
const waterHistoryHeaders = ['Datum', 'Uhrzeit', 'Becken', 'Freies Chlor', 'Gebundenes Chlor', 'pH-Wert', 'Wassertemperatur', 'Mitarbeiter', 'Grenzwertstatus'];

function waterHistoryView() {
 try {
  return localStorage.getItem(waterHistoryViewKey) === 'time' ? 'time' : 'pool';
 } catch (error) {
  return 'pool';
 }
}

function storeWaterHistoryView(view) {
 try {
  localStorage.setItem(waterHistoryViewKey, view === 'time' ? 'time' : 'pool');
 } catch (error) {
  return;
 }
}

function historyReadingText(reading) {
 return reading && String(reading.value ?? '') !== '' ? `${reading.value}${reading.unit ? ` ${reading.unit}` : ''}` : '';
}

function historyTable(rows) {
 const table = document.createElement('table');
 table.className = 'water-table';
 const head = document.createElement('tr');
 for (const label of waterHistoryHeaders) {
  const cell = document.createElement('th');
  cell.scope = 'col';
  cell.textContent = label;
  head.append(cell);
 }
 table.append(head);
 for (const row of rows) {
  const line = document.createElement('tr');
  const plain = value => {
   const cell = document.createElement('td');
   cell.textContent = value ?? '';
   return cell;
  };
  const readingCell = reading => {
   const cell = document.createElement('td');
   writeWaterCell(cell, waterReadingOutside(reading) ? {text: historyReadingText(reading), breach: true} : historyReadingText(reading));
   return cell;
  };
  line.append(
   plain(row.date),
   plain(row.time),
   plain(row.poolName),
   readingCell(row.values?.free_chlorine),
   readingCell(row.values?.combined_chlorine),
   readingCell(row.values?.ph),
   readingCell(row.values?.temperature),
   plain(row.recordedName),
   plain(row.limitStatus)
  );
  table.append(line);
 }
 return table;
}

function renderWaterHistory(host, current, data, visible) {
 const wrap = document.createElement('section');
 wrap.id = 'water-history';
 wrap.className = 'water-history';
 const heading = document.createElement('h3');
 heading.textContent = 'Messwertübersicht';
 const from = input();
 const to = input();
 from.type = 'date';
 to.type = 'date';
 const poolOptions = [{value: '', label: 'Alle Becken'}].concat(data.waterPools.filter(pool => pool.facilityId === current.id).map(pool => ({value: pool.id, label: pool.name})));
 const people = [...new Map(visible.checks.filter(check => check.facilityId === current.id).map(check => [check.recordedBy, check.recordedName || 'Mitarbeiter']))];
 const personOptions = [{value: '', label: 'Alle Mitarbeiter'}].concat(people.map(([id, name]) => ({value: id, label: name})));
 const poolFilter = select(poolOptions, '');
 const personFilter = select(personOptions, '');
 const viewBar = document.createElement('div');
 viewBar.className = 'water-view-toggle';
 viewBar.setAttribute('role', 'group');
 viewBar.setAttribute('aria-label', 'Darstellung der Messwerte');
 const poolButton = document.createElement('button');
 const timeButton = document.createElement('button');
 for (const [control, view, label] of [[poolButton, 'pool', 'Nach Becken'], [timeButton, 'time', 'Nach Uhrzeit']]) {
  control.type = 'button';
  control.className = 'secondary';
  control.textContent = label;
  control.addEventListener('click', () => {
   storeWaterHistoryView(view);
   paint();
  });
  viewBar.append(control);
 }
 const tableHost = document.createElement('div');
 const exportButton = document.createElement('button');
 exportButton.type = 'button';
 exportButton.className = 'secondary';
 exportButton.textContent = 'Messwerte als CSV exportieren';
 const paint = () => {
  const rows = waterHistoryRows({...data, waterChecks: visible.checks}, current.id, {from: from.value, to: to.value, poolId: poolFilter.value, recordedBy: personFilter.value});
  const view = waterHistoryView();
  poolButton.setAttribute('aria-pressed', view === 'pool' ? 'true' : 'false');
  timeButton.setAttribute('aria-pressed', view === 'time' ? 'true' : 'false');
  exportButton.disabled = !rows.length;
  exportButton.onclick = () => downloadWaterCsv(waterHistoryCsv(rows), 'Wasserhygiene.csv');
  tableHost.replaceChildren();
  if (!rows.length) {
   const empty = document.createElement('p');
   empty.className = 'help';
   empty.textContent = 'Für diese Auswahl liegen keine Messungen vor.';
   tableHost.append(empty);
   return;
  }
  if (view === 'time') {
   tableHost.append(historyTable(rows));
   return;
  }
  for (const group of waterHistoryByPool(rows)) {
   const title = document.createElement('h4');
   title.textContent = group.poolName;
   tableHost.append(title, historyTable(group.rows));
  }
 };
 for (const control of [from, to, poolFilter, personFilter]) control.addEventListener('change', paint);
 wrap.append(heading, labeled('Von', from), labeled('Bis', to), labeled('Becken', poolFilter), labeled('Mitarbeiter', personFilter), exportButton, viewBar, tableHost);
 paint();
 host.append(wrap);
}

export function renderWater(host, current) {
 missingNote(host, opsUi.waterInstalled, 'Wasserhygiene ist noch nicht in der Datenbank installiert. Es wurde nichts gespeichert.');
 const data = bundle();
 const catalog = waterCatalog(data);
 let settings = null;
 if (isManager(current)) {
  settings = document.createElement('div');
  settings.className = opsUi.waterSettingsOpen ? 'water-settings' : 'water-settings hidden';
  host.append(button('⚙ Einstellungen', 'secondary', () => {
   opsUi.waterSettingsOpen = settings.classList.toggle('hidden') === false;
  }));
  const name = input();
  const mode = select([{value: 'daily', label: 'Täglich'}, {value: 'weekly', label: 'Wöchentlich'}, {value: 'times', label: 'Feste Uhrzeiten'}], 'daily');
  const count = input('1');
  const times = input('08:00, 14:00');
  const days = weekdayBoxes([1, 2, 3, 4, 5, 6, 7]);
  count.inputMode = 'numeric';
  const schedule = document.createElement('div');
  const paintSchedule = () => {
   const timed = mode.value === 'times';
   count.parentElement?.classList.toggle('hidden', timed);
   times.parentElement?.classList.toggle('hidden', !timed);
   days.wrap.classList.toggle('hidden', !timed);
  };
  mode.addEventListener('change', paintSchedule);
  settings.append(labeled('Becken', name), labeled('Kontrollplan', mode), labeled('Intervallanzahl', count), labeled('Uhrzeiten', times), days.wrap);
  settings.append(button('Becken speichern', '', () => commit(() => saveWaterPool(database(), bundle(), {facility: current, name: name.value, scheduleMode: mode.value, intervalCount: count.value, scheduledTimes: times.value, weekdays: selectedWeekdays(days.boxes)}, actor(), new Date().toISOString(), context()))));
  const hint = document.createElement('p');
  hint.className = 'help';
  hint.textContent = 'Sollbereiche werden nicht automatisch gesetzt. Ohne hinterlegten Bereich entsteht keine Grenzwertwarnung.';
  settings.append(hint);
  const savedTimes = waterFacilityPlan(data, current.id, new Date().toISOString()).upcoming.map(slot => slot.time).join(', ');
  const roundTimes = input(savedTimes);
  settings.append(labeled('Tägliche Kontrollzeiten', roundTimes));
  settings.append(button('Kontrollzeiten speichern', 'secondary', () => commit(() => saveWaterFacilitySlots(database(), bundle(), current, roundTimes.value, actor(), new Date().toISOString(), context()))));
  const roundHint = document.createElement('p');
  roundHint.className = 'help';
  roundHint.textContent = 'Bis zu sechs Uhrzeiten gelten für den ganzen Betrieb in der Zeitzone Europe/Berlin. Eine Änderung gilt ab dem nächsten Kalendertag. Heutige Kontrollrunden bleiben unverändert. Die bestehenden Beckenpläne bleiben erhalten.';
  settings.append(roundHint);
  paintSchedule();
  host.append(settings);
 }
 const pools = data.waterPools.filter(item => item.facilityId === current.id).sort((left, right) => Number(left.active === false) - Number(right.active === false) || left.name.localeCompare(right.name, 'de'));
 if (!pools.length) {
  const empty = document.createElement('p');
  empty.className = 'muted';
  empty.textContent = 'Für diesen Betrieb ist noch kein Becken angelegt.';
  host.append(empty);
  return;
 }
 const nowIso = new Date().toISOString();
 const history = waterHistoryRole(current, state.myMemberships);
 const visible = waterRowsForMember(data, state.myMemberships, nowIso, actor().userId);
 const overview = waterOverviewRows(data, current.id, visible.checks, nowIso);
 if (!history) {
  const hiddenValues = document.createElement('p');
  hiddenValues.className = 'help';
  hiddenValues.textContent = 'Gespeicherte Messwerte werden für Mitarbeiter nicht angezeigt. Die noch nicht bestätigte Eingabe steht in der Kontrollrunde.';
  host.append(hiddenValues);
 }
 const day = waterDayRounds(data, current.id, nowIso);
 const urgent = day.planned.find(item => item.state === 'overdue') || day.planned.find(item => item.state === 'due') || day.planned.find(item => item.state === 'waiting');
 const facilityStatus = day.planned.length
  ? (urgent ? `${urgent.time}: ${urgent.status}` : 'Alle geplanten Kontrollrunden sind abgeschlossen.')
  : '';
 host.append(waterTable(
  ['Becken', 'Temperatur', 'pH-Wert', 'Freies Chlor', 'Gebundenes Chlor', 'Letzte Messung', 'Status'],
  overview.map(item => {
   const status = facilityStatus && !String(item.status).startsWith('Grenzwert') ? facilityStatus : item.status;
   const shown = code => {
    const text = history ? item.values[code] : 'nicht sichtbar';
    return history && item.breached?.includes(code) && text !== 'fehlt' ? {text, breach: true} : text;
   };
   return [item.poolName, shown('temperature'), shown('ph'), shown('free_chlorine'), shown('combined_chlorine'), history ? item.measuredLabel : 'nicht sichtbar', status];
  })
 ));
 renderWaterDay(host, current, data, nowIso);
 const duePool = pools.find(pool => waterControlState(pool, visible.checks, data.waterPoolParameters, nowIso).due);
 const initialPool = pools.some(pool => pool.id === opsUi.selectedWaterPoolId) ? selectedWaterPoolId: (duePool || pools[0]).id;
 const pool = pools.find(item => item.id === initialPool) || pools[0];
 if (!pool) return;
 const parameterOrder = code => waterCatalog(data).findIndex(item => item.code === code);
 const parameters = data.waterPoolParameters.filter(item => item.poolId === pool.id).sort((left, right) => parameterOrder(left.parameterCode) - parameterOrder(right.parameterCode));
 const row = document.createElement('div');
 if (isManager(current) && settings) {
  const picker = select(pools.map(entry => ({value: entry.id, label: entry.active === false ? `${entry.name} · deaktiviert` : entry.name})), pool.id);
  picker.addEventListener('change', () => {
   opsUi.selectedWaterPoolId = picker.value;
   opsUi.followUpAlertId = '';
   renderPanel('');
  });
  settings.append(labeled('Becken verwalten', picker));
  const actions = document.createElement('div');
  actions.className = 'point-actions';
  const editor = document.createElement('div');
  editor.className = 'point-editor hidden';
  const name = input(pool.name);
  const mode = select([{value: 'daily', label: 'Täglich'}, {value: 'weekly', label: 'Wöchentlich'}, {value: 'times', label: 'Feste Uhrzeiten'}], pool.scheduleMode || 'daily');
  const count = input(String(pool.intervalCount || 1));
  const times = input((pool.scheduledTimes || []).join(', '));
  const days = weekdayBoxes(pool.weekdays);
  count.inputMode = 'numeric';
  const paintSchedule = () => {
   const timed = mode.value === 'times';
   count.parentElement?.classList.toggle('hidden', timed);
   times.parentElement?.classList.toggle('hidden', !timed);
   days.wrap.classList.toggle('hidden', !timed);
  };
  mode.addEventListener('change', paintSchedule);
  editor.append(labeled('Bezeichnung', name), labeled('Kontrollplan', mode), labeled('Intervallanzahl', count), labeled('Uhrzeiten', times), days.wrap);
  editor.append(button('Änderungen speichern', '', () => commit(() => saveWaterPoolChange(database(), bundle(), pool.id, {name: name.value, scheduleMode: mode.value, intervalCount: count.value, scheduledTimes: times.value, weekdays: selectedWeekdays(days.boxes)}, actor(), new Date().toISOString(), context()))));
  actions.append(button('Bearbeiten', 'secondary', () => editor.classList.toggle('hidden')));
  actions.append(button(pool.active === false ? 'Reaktivieren' : 'Deaktivieren', 'secondary', () => commit(() => saveWaterPoolActive(database(), bundle(), pool.id, pool.active === false, actor(), new Date().toISOString(), context()))));
  settings.append(actions, editor);
  paintSchedule();
  for (const parameter of parameters) {
   const definition = catalog.find(item => item.code === parameter.parameterCode);
   const block = document.createElement('div');
   block.className = 'water-parameter';
   const title = document.createElement('strong');
   title.textContent = waterParameterName(data, parameter.parameterCode);
   const minimum = input(limitText(parameter.minValue));
   const maximum = input(limitText(parameter.maxValue));
   minimum.inputMode = 'decimal';
   maximum.inputMode = 'decimal';
   minimum.lang = 'de';
   maximum.lang = 'de';
   const required = choice('Erforderlich', parameter.required !== false);
   const active = choice('Aktiv', parameter.active !== false);
   block.append(title, labeled(`Mindestens ${definition?.unit || ''}`.trim(), minimum), labeled(`Höchstens ${definition?.unit || ''}`.trim(), maximum), required.node, active.node);
   block.append(button('Parameter speichern', 'secondary', () => commit(() => saveWaterParameter(database(), bundle(), parameter.id, {minValue: minimum.value, maxValue: maximum.value, required: required.box.checked, active: active.box.checked}, actor(), new Date().toISOString(), context()))));
   settings.append(block);
  }
  const missingCodes = catalog.filter(item => !parameters.some(parameter => parameter.parameterCode === item.code));
  if (missingCodes.length) {
   const code = select(missingCodes.map(item => ({value: item.code, label: item.name})));
   settings.append(labeled('Weiteren Parameter ergänzen', code));
   settings.append(button('Parameter ergänzen', 'secondary', () => commit(() => saveWaterParameterAdd(database(), bundle(), pool.id, code.value, actor(), new Date().toISOString(), context()))));
  }
 }
 if (opsUi.followUpAlertId && !data.waterAlerts.some(item => item.id === opsUi.followUpAlertId && item.poolId === pool.id)) opsUi.followUpAlertId = '';
 if (opsUi.followUpAlertId && pool.active !== false) {
  const activeParameters = parameters.filter(item => item.active !== false);
  const readings = document.createElement('div');
  readings.className = 'water-readings';
  const fields = new Map();
  const banner = document.createElement('p');
  banner.className = 'help';
  banner.textContent = 'Diese Messung wird als Wiederholung dokumentiert. Die bestehende Warnung bleibt davon unberührt.';
  row.append(banner);
  for (const parameter of activeParameters) {
   const definition = catalog.find(item => item.code === parameter.parameterCode);
   const field = input();
   field.inputMode = 'decimal';
   field.lang = 'de';
   fields.set(parameter.parameterCode, field);
   const caption = `${waterParameterName(data, parameter.parameterCode)}${definition?.unit ? ` ${definition.unit}` : ''}${parameter.required === false ? '' : ' · erforderlich'}`;
   readings.append(labeled(caption, field));
   const limit = document.createElement('p');
   limit.className = 'help';
   limit.textContent = rangeText(parameter);
   readings.append(limit);
  }
  row.append(readings);
  const note = input();
  note.placeholder = 'Kommentar, falls nötig';
  row.append(labeled('Kommentar', note));
  row.append(button('Wiederholung speichern', 'secondary', async () => {
   const values = {};
   for (const [code, field] of fields) values[code] = field.value;
   const alertId = opsUi.followUpAlertId;
   opsUi.followUpAlertId = '';
   const result = await commit(() => saveWaterCheck(database(), bundle(), pool.id, {values, note: note.value, followUpAlertId: alertId || null}, actor(), new Date().toISOString(), context()));
   if (!result?.ok) opsUi.followUpAlertId = alertId;
  }));
 } else if (pool.active === false) {
  const paused = document.createElement('p');
  paused.className = 'help';
  paused.textContent = history ? 'Deaktiviert. Die bisherigen Messungen bleiben sichtbar.' : 'Deaktiviert. Die laufende Kontrollrunde bleibt sichtbar.';
  row.append(paused);
 }
 for (const alert of visible.alerts.filter(item => pools.some(entry => entry.id === item.poolId))) {
  const name = waterParameterName(data, alert.parameterCode);
  const unit = alert.unit ? ` ${alert.unit}` : '';
  const line = document.createElement('p');
  line.className = 'help';
  line.textContent = alert.status === 'open'
   ? `Offene Warnung: ${name} ${alert.value}${unit}. Quittierung ist keine Behebung.`
   : `Quittiert ${new Date(alert.acknowledgedAt).toLocaleString('de-DE')} · ${alert.acknowledgedName}: ${alert.acknowledgementNote}. Die Abweichung gilt damit nicht als behoben.`;
  row.append(line);
  const optional = document.createElement('p');
  optional.className = 'help';
  optional.textContent = 'Die Messung ist gespeichert. Die Warnung bleibt sichtbar. Maßnahme und Quittierung sind freiwillig und heben die Abweichung nicht auf.';
  row.append(optional);
  for (const measure of visible.measures.filter(item => item.alertId === alert.id)) {
   const measureLine = document.createElement('p');
   measureLine.className = 'help';
   measureLine.textContent = `Maßnahme ${new Date(measure.recordedAt).toLocaleString('de-DE')} · ${measure.recordedName}: ${measure.measureText}`;
   row.append(measureLine);
  }
  const measure = input();
  measure.placeholder = 'Durchgeführte Maßnahme';
  row.append(labeled('Maßnahme (freiwillig)', measure));
  row.append(button('Maßnahme speichern', 'secondary', () => commit(() => saveWaterMeasure(database(), bundle(), alert.id, measure.value, actor(), new Date().toISOString(), context()))));
  row.append(button('Wiederholungsmessung', 'secondary', () => {
   opsUi.followUpAlertId = alert.id;
   opsUi.selectedWaterPoolId = alert.poolId;
   renderPanel('');
  }));
  if (alert.status !== 'open') continue;
  const acknowledgement = input();
  acknowledgement.placeholder = 'Kenntnisnahme, keine Behebung';
  row.append(labeled('Quittierung (freiwillig)', acknowledgement));
  row.append(button('Warnung quittieren', 'secondary', () => commit(() => saveWaterAcknowledgement(database(), bundle(), alert.id, acknowledgement.value, actor(), new Date().toISOString(), context()))));
 }
 host.append(row);
 if (!opsUi.followUpAlertId) renderWaterRound(host, current, data);
 if (history) renderWaterHistory(host, current, data, visible);
}


