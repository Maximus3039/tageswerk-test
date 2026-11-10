import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {convertTageszeitZweizeilig, notable} from '../../js/meter-import-profiles.js';

const sandbox = {console};
sandbox.window = sandbox;
sandbox.self = sandbox;
vm.runInNewContext(fs.readFileSync(new URL('../../vendor/xlsx.full.min.js', import.meta.url), 'utf8'), sandbox, {filename: 'xlsx.full.min.js'});
const XLSX = sandbox.XLSX;

function workbook(sheetName) {
 const rows = [
  ['Prignitzer Badewelt', '', ''],
  ['', 'Strom', 'Strom'],
  ['', 'Testimport', 'Reserve'],
  [1, 100, ''],
  ['', 110, ''],
  [2, 120, ''],
  ['', 130, '']
 ];
 const sheet = XLSX.utils.aoa_to_sheet(rows);
 const book = XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(book, sheet, sheetName);
 return book;
}

function reading(overrides = {}) {
 return {
  wert_art: 'zaehlerstand',
  pruefstatus: 'pruefung',
  pruefhinweis: 'uhrzeit_unbekannt',
  ...overrides
 };
}

test('Eine unbekannte Uhrzeit allein ist keine Auffälligkeit', () => {
 assert.equal(notable(reading()), false);
 assert.equal(notable(reading({pruefhinweis: 'uhrzeit_unbekannt;ruecklaeufig'})), true);
});

test('Der Excel-Konverter liest lokale Testdaten und erfindet keine Uhrzeit', () => {
 const result = convertTageszeitZweizeilig(workbook('Jan 2020'), 'vorschau.xlsx', XLSX);
 assert.equal(result.summary.readings, 4);
 assert.equal(result.readings.every(row => row.ableseuhrzeit === ''), true);
 assert.equal(result.readings[0].ablesedatum, '2020-01-01');
 assert.equal(result.readings[0].zaehlerstand, '100');
});

test('Ein zweistelliges Blattjahr bleibt bei der bestehenden Lesart', () => {
 const result = convertTageszeitZweizeilig(workbook('Jan 90'), 'vorschau.xlsx', XLSX);
 assert.equal(result.readings[0].ablesedatum, '2090-01-01');
});
