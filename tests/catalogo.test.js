'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/catalogo.js');
const I = require('../js/importar.js');
const X = require('../js/xlsx.js');

const NB = '    ';
function acta({ carrera = 'LICENCIADO EN PRUEBAS', profesor = 'PÉREZ GARCÍA JUAN', exp = '05054332', asignatura = 'ÉTICA', clave = '0266', grupo = '1510' }, alumnos) {
  return [
    ['Acta Económica'], [],
    [`INSTITUCIÓN: UNIV DE PRUEBA ${NB} CLAVE: 8898 ${NB} CARRERA: ${carrera}`], [],
    [`PROFESOR(A): ${profesor} ${NB} N° EXPEDIENTE: ${exp} ${NB} HORAS TOTALES DE CLASE: ___________ `], [],
    [`ASIGNATURA: ${asignatura} ${NB} CLAVE: ${clave} ${NB} GRUPO: ${grupo} ${NB} CICLO ESCOLAR: 2026/2027-1 ${NB} FECHA DE INICIO: 10/08/2026`], [],
    ['N°', 'N° Cuenta', 'Nombre Alumno', 'Agt', '', 'Sep', '', 'Oct', '', 'Nov', '', 'Dic'],
    ['', '', '', 'C', 'F', 'C', 'F', 'C', 'F', 'C', 'F', 'C', 'F'],
    ...alumnos.map((a, i) => [String(i + 1), a[0], a[1]]),
    [],
  ];
}

test('encabezado: separa etiquetas y valores; "____" cuenta como vacío', () => {
  const f = C.headerFields(`PROFESOR(A): IBAÑEZ MORALES RENATO ${NB} N° EXPEDIENTE: 05054332 ${NB} HORAS TOTALES DE CLASE: ___________ `);
  assert.deepEqual(f, [['profesor', 'IBAÑEZ MORALES RENATO'], ['expediente', '05054332'], ['horas', '']]);
  const g = C.headerFields('ASIGNATURA: DISEÑO-ELABORACION D RECURSOS  CLAVE: 0105   GRUPO: 5010   CICLO ESCOLAR: 2026/2027-1   FECHA DE INICIO: 10/08/2026');
  assert.deepEqual(g.map((x) => x[0]), ['asignatura', 'clave', 'grupo', 'ciclo', 'fechaInicio']);
  assert.equal(g[0][1], 'DISEÑO-ELABORACION D RECURSOS');
});

test('varias actas apiladas en una hoja, con datos y meses', () => {
  const rows = [
    ...acta({}, [['900000001', 'ROBLES PAZ IAN JAVIER'], ['900000002', 'CASTRO GARCÍA VANIA']]),
    ...acta({ asignatura: 'LA CALIDAD Y LA ORGANIZACIÓN', clave: '0317' }, [['900000001', 'ROBLES PAZ IAN JAVIER']]),
  ];
  const { actas, avisos } = C.parseSheet(rows, 'prueba');
  assert.equal(actas.length, 2);
  assert.deepEqual(avisos, []);
  assert.equal(actas[0].datos.profesor, 'PÉREZ GARCÍA JUAN');
  assert.equal(actas[0].datos.expediente, '05054332');
  assert.equal(actas[0].datos.claveInstitucion, '8898');
  assert.equal(actas[0].datos.claveAsignatura, '0266');
  assert.equal(actas[0].datos.grupo, '1510');
  assert.equal(actas[0].datos.horas, '');
  assert.deepEqual(actas[0].meses, [7, 8, 9, 10, 11]);
  assert.equal(actas[0].alumnos.length, 2);
  assert.equal(actas[1].datos.claveAsignatura, '0317');
});

test('filas vacías, encabezado repetido, duplicados, ceros iniciales y matrículas alfanuméricas', () => {
  const rows = acta({}, [['0012345', 'NÚÑEZ OÑATE MARÍA'], ['', ''], ['A12-34B', 'LÓPEZ ÑANDÚ JOSÉ'], ['0012345', 'NÚÑEZ OÑATE MARÍA']]);
  rows.splice(12, 0, ['N°', 'N° Cuenta', 'Nombre Alumno']); // encabezado repetido
  rows.push(['', 'Firma del profesor', '']); // nota sin matrícula
  const { actas, avisos } = C.parseSheet(rows, 'prueba');
  assert.deepEqual(actas[0].alumnos, [
    { cuenta: '0012345', nombre: 'NÚÑEZ OÑATE MARÍA' },
    { cuenta: 'A12-34B', nombre: 'LÓPEZ ÑANDÚ JOSÉ' },
  ]);
  assert.equal(actas[0].duplicados, 1);
  assert.equal(avisos.length, 1); // la nota sin matrícula
});

test('variaciones de encabezado: "Matrícula", "Nombre del alumno", "No."', () => {
  const rows = acta({}, [['900000003', 'JUAN PÉREZ GARCÍA']]);
  rows[8] = ['No.', 'Matrícula', 'Nombre del alumno', 'Feb', '', 'Mar'];
  const { actas } = C.parseSheet(rows, 'prueba');
  assert.equal(actas[0].alumnos[0].cuenta, '900000003');
  assert.deepEqual(actas[0].meses, [1, 2]);
});

test('catálogo: mismo número de grupo en varias licenciaturas y mismo maestro en dos materias', () => {
  const libro = (archivo, rows) => ({ archivo, hojas: [{ name: 'ActaEco', rows }] });
  const cat = C.buildCatalog([
    libro('A.xlsx', [
      ...acta({ carrera: 'ARQUITECTO' }, [['1', 'UNO']]),
      ...acta({ carrera: 'ARQUITECTO', asignatura: 'OTRA', clave: '9999' }, [['1', 'UNO'], ['2', 'DOS']]),
    ]),
    libro('B.xlsx', acta({ carrera: 'PSICOLOGÍA' }, [['3', 'TRES']])),
    { archivo: 'C.xlsx', hojas: [{ name: 'Hoja1', rows: [['900000005', 'AGUIRRE CONDE LEÓN']] }] },
  ]);
  assert.equal(cat.grupos.length, 3);
  const ts = C.teachers(cat);
  assert.equal(ts.length, 1);
  assert.equal(ts[0].grupos.length, 3);
  assert.deepEqual(C.summary(cat), { archivos: 2, grupos: 3, maestros: 1, alumnos: 3 });
  assert.equal(cat.archivos.find((a) => a.archivo === 'C.xlsx').actas, 0);
  // La misma acta en dos archivos se une sin repetir alumnos.
  const dup = C.buildCatalog([libro('A.xlsx', acta({}, [['1', 'UNO']])), libro('A2.xlsx', acta({}, [['1', 'UNO'], ['2', 'DOS']]))]);
  assert.equal(dup.grupos.length, 1);
  assert.deepEqual(dup.grupos[0].alumnos, ['1', '2']);
});

test('lee un .xlsx real (generado) con texto, números y acentos', async () => {
  const cells = {
    A1: { v: 'Acta Económica' },
    A3: { v: 'INSTITUCIÓN: UNIV  CLAVE: 8898  CARRERA: LIC EN DERECHO (ARAGÓN) SUA' },
    A5: { v: 'PROFESOR(A): ESPINO RUIZ DULCE  N° EXPEDIENTE: 20011187  HORAS TOTALES DE CLASE: ___ ' },
    A7: { v: 'ASIGNATURA: INTRODUCCIÓN  CLAVE: 1100  GRUPO: 1510  CICLO ESCOLAR: 2026/2027-1' },
    A9: { v: 'N°' }, B9: { v: 'N° Cuenta' }, C9: { v: 'Nombre Alumno' },
    A11: { v: 1 }, B11: { v: 900000004 }, C11: { v: 'GALVÁN RÍOS YENI' },
    A12: { v: 2 }, B12: { v: '0042' }, C12: { v: 'MUÑOZ & <ÑÚÑEZ>' },
  };
  const bytes = X.buildWorkbook({ sheets: [{ name: 'ActaEco (23)', cells }] });
  const { catalog } = await C.importFiles([{ name: 'DERECHO SUA.xlsx', data: bytes }], I);
  assert.equal(catalog.grupos.length, 1);
  const g = catalog.grupos[0];
  assert.equal(g.carrera, 'LIC EN DERECHO (ARAGÓN) SUA');
  assert.deepEqual(g.alumnos, ['900000004', '0042']);
  assert.equal(catalog.alumnos['0042'], 'MUÑOZ & <ÑÚÑEZ>');
});

test('ZIP: ignora __MACOSX, .xls y archivos que no son Excel', async () => {
  // ZIP sin compresión armado con el escritor propio (vía un libro de una hoja).
  const sheet = X.buildWorkbook({ sheets: [{ name: 'Hoja', cells: { A1: { v: 'nada' } } }] });
  const { catalog, ignorados } = await C.importFiles([
    { name: 'notas.txt', data: new Uint8Array([1]) },
    { name: 'viejo.xls', data: new Uint8Array([1]) },
    { name: 'Vacio.xlsx', data: sheet },
  ], I);
  assert.equal(catalog.grupos.length, 0);
  assert.deepEqual(ignorados.map((i) => i.archivo).sort(), ['Vacio.xlsx', 'notas.txt', 'viejo.xls']);
});
