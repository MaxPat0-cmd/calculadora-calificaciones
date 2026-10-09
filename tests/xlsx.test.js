'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildXlsx, columnName } = require('../js/xlsx.js');

const HEADERS = ['Número', 'Alumno', 'Parcial 1', 'Parcial 2', 'Promedio parcial',
  'Calificación 3', 'Resultado exacto', 'Calificación final'];

function sample() {
  return buildXlsx({
    sheetName: 'Calificaciones',
    headers: HEADERS,
    rows: [
      [1, 'Alumno 1', 8.8, 9.3, 9.05, 8.8, 8.925, 9],
      [2, 'José Ñúñez <&> "Q"', 10, 10, 10, 10, 10, 10],
    ],
  });
}

test('nombres de columna', () => {
  assert.equal(columnName(0), 'A');
  assert.equal(columnName(7), 'H');
  assert.equal(columnName(25), 'Z');
  assert.equal(columnName(26), 'AA');
});

test('genera un ZIP con firma válida', () => {
  const bytes = sample();
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
});

function hasPython() {
  try {
    execFileSync('python3', ['-c', 'import openpyxl'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

test('openpyxl lo lee: números reales, encabezado en negritas, anchos', { skip: !hasPython() && 'sin python3/openpyxl' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-test-'));
  const file = path.join(dir, 'Calificaciones.xlsx');
  fs.writeFileSync(file, sample());
  const out = execFileSync('python3', ['-I', '-c', `
import json, sys, openpyxl
wb = openpyxl.load_workbook(sys.argv[1])
ws = wb.active
print(json.dumps({
  "title": ws.title,
  "rows": [[c.value for c in r] for r in ws.iter_rows()],
  "types": [type(c.value).__name__ for c in ws[2]],
  "bold": [c.font.b for c in ws[1]],
  "bodyBold": ws["B2"].font.b,
  "widths": [ws.column_dimensions[l].width for l in "ABCDEFGH"],
  "freeze": ws.freeze_panes,
}))
`, file]).toString();
  const r = JSON.parse(out);
  assert.equal(r.title, 'Calificaciones');
  assert.deepEqual(r.rows[0], HEADERS);
  assert.deepEqual(r.rows[1], [1, 'Alumno 1', 8.8, 9.3, 9.05, 8.8, 8.925, 9]);
  assert.equal(r.rows[2][1], 'José Ñúñez <&> "Q"');
  assert.deepEqual(r.types, ['int', 'str', 'float', 'float', 'float', 'float', 'float', 'int']);
  assert.ok(r.bold.every(Boolean));
  assert.ok(!r.bodyBold);
  assert.ok(r.widths.every((w) => w >= 8));
  assert.ok(r.widths[4] >= 'Promedio parcial'.length);
  assert.equal(r.freeze, 'A2');
});
