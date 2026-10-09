'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
global.Xlsx = require('../js/xlsx.js');
const { buildActa, monthColumns } = require('../js/acta.js');

test('meses del acta: desde el Parcial 1, al menos cinco', () => {
  assert.deepEqual(monthColumns(1, 3), { months: ['Feb', 'Mar', 'Abr', 'May', 'Jun'], indexes: [1, 2, 3, 4, 5], p1: 0, p2: 2 });
  assert.deepEqual(monthColumns(7, 9).months, ['Ago', 'Sep', 'Oct', 'Nov', 'Dic']);
  assert.deepEqual(monthColumns(10, 0).months, ['Nov', 'Dic', 'Ene', 'Feb', 'Mar']); // cruza el año
  assert.equal(monthColumns(1, 7).months.length, 7); // incluye hasta Agosto
});

function hasPython() {
  try { execFileSync('python3', ['-c', 'import openpyxl'], { stdio: 'ignore' }); return true; } catch { return false; }
}

test('acta: encabezado, celdas combinadas y valores numéricos', { skip: !hasPython() && 'sin python3/openpyxl' }, () => {
  const rows = [{ numero: 1, cuenta: '900000006', nombre: 'ALVAREZ SOTO ANA FERNANDA', p1: 6.4, f1: 0, p2: 5, f2: 2,
    prom: 5.7, pv1: 3.2, pv2: 'NP', totalFaltas: 2, pctFaltas: 0.042, final: 5, detalle: [1, 'ALVAREZ', 5] }];
  const bytes = buildActa({ institucion: 'UNIV', horas: '48', mesP1: 1, mesP2: 3, semestre: '2' }, rows, ['N', 'Alumno', 'Final'], []);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acta-test-'));
  const file = path.join(dir, 'acta.xlsx');
  fs.writeFileSync(file, bytes);
  const out = JSON.parse(execFileSync('python3', ['-I', '-c', `
import json, sys, openpyxl
wb = openpyxl.load_workbook(sys.argv[1])
ws = wb['Acta']
print(json.dumps({
  "sheets": wb.sheetnames,
  "title": ws['C2'].value, "sub": ws['C3'].value,
  "head": [ws.cell(9, c).value for c in range(1, 20)],
  "cf": [ws.cell(10, c).value for c in range(4, 14)],
  "row": [ws.cell(11, c).value for c in range(1, 20)],
  "pctFmt": ws['R11'].number_format,
  "merged": sorted(str(m) for m in ws.merged_cells.ranges if str(m).startswith(('D9', 'A9', 'S9'))),
  "landscape": ws.page_setup.orientation,
}))
`, file]).toString());
  assert.deepEqual(out.sheets, ['Acta', 'Detalle']);
  assert.equal(out.title, 'ACTA ECONÓMICA');
  assert.equal(out.sub, 'Licenciatura (SEMESTRE 2)');
  assert.deepEqual(out.head, ['N°', 'N° de Cuenta', 'Nombre del Alumno', 'Feb', null, 'Mar', null, 'Abr', null, 'May', null,
    'Jun', null, 'Prom.', '1° vuelta', '2° vuelta', 'Total Faltas', '% Faltas', 'Calif. Final']);
  assert.deepEqual(out.cf, ['C', 'F', 'C', 'F', 'C', 'F', 'C', 'F', 'C', 'F']);
  assert.deepEqual(out.row, [1, '900000006', 'ALVAREZ SOTO ANA FERNANDA', 6.4, 0, '-', '-', 5, 2, '-', '-', '-', '-',
    5.7, 3.2, 'NP', 2, 0.042, 5]);
  assert.equal(out.pctFmt, '0.0%');
  assert.deepEqual(out.merged, ['A9:A10', 'D9:E9', 'S9:S10']);
  assert.equal(out.landscape, 'landscape');
});

test('faltas por mes: diciembre no se registra', () => {
  const { faltasMonths } = require('../js/acta.js');
  assert.deepEqual(faltasMonths(7, 9), [7, 8, 9, 10]); // Ago–Nov
  assert.deepEqual(faltasMonths(1, 3), [1, 2, 3, 4, 5]); // Feb–Jun
});
