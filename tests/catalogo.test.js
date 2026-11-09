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

test('acta con calificaciones ya escritas: Parcial 1 en septiembre y Parcial 2 en noviembre (no Enfermería)', () => {
  const rows = acta({}, [['900000001', 'ROBLES PAZ IAN JAVIER'], ['900000002', 'CASTRO GARCÍA VANIA']]);
  // N° | Cuenta | Nombre | Agt C F | Sep C F | Oct C F | Nov C F | Dic C F
  rows[10] = ['1', '900000001', 'ROBLES PAZ IAN JAVIER', '', '2', '8.5', '1', '', '', '9', '', '', '3'];
  const { actas } = C.parseSheet(rows, 'prueba');
  assert.deepEqual(actas[0].alumnos[0].notas, { p1: '8.5', p2: '9', m7: '2', m8: '1' }); // diciembre no cuenta
  assert.equal(actas[0].alumnos[1].notas, undefined);
  const cat = C.buildCatalog([{ archivo: 'A.xlsx', hojas: [{ name: 'ActaEco', rows }] }]);
  assert.deepEqual(cat.grupos[0].calificaciones, { '900000001': { p1: '8.5', p2: '9', m7: '2', m8: '1' } });
});

test('acta de Enfermería con calificaciones: Parcial 1 en el 1er mes y Parcial 2 en el 3ro', () => {
  const rows = acta({ carrera: 'LICENCIATURA EN ENFERMERÍA' }, [['900000001', 'ROBLES PAZ IAN JAVIER']]);
  rows[10] = ['1', '900000001', 'ROBLES PAZ IAN JAVIER', '8.5', '', '7', '', '9', '', '6', '', '', ''];
  const { actas } = C.parseSheet(rows, 'prueba');
  assert.deepEqual(actas[0].alumnos[0].notas, { p1: '8.5', p2: '9' });
});

test('meses de los parciales por licenciatura', () => {
  const ago = [7, 8, 9, 10, 11];
  assert.deepEqual(C.partialMonths('LICENCIADO EN DERECHO (CU)', ago), { p1: 8, p2: 10 }); // Sep y Nov
  assert.deepEqual(C.partialMonths('CCH', ago), { p1: 8, p2: 10 });
  assert.deepEqual(C.partialMonths('LICENCIATURA EN ENFERMERÍA', ago), { p1: 7, p2: 9 }); // Ago y Oct
  assert.deepEqual(C.partialMonths('Lic. Enfermeria', [1, 2, 3, 4, 5]), { p1: 1, p2: 3 }); // Feb y Abr
  // Semestre sin septiembre/noviembre: segundo y cuarto mes del acta
  assert.deepEqual(C.partialMonths('LICENCIADO EN PSICOLOGÍA', [1, 2, 3, 4, 5]), { p1: 2, p2: 4 });
});

test('Excel exportado por la app: mismo grupo que el acta original, con sus calificaciones y horas', () => {
  const original = C.buildCatalog([{ archivo: 'A.xlsx', hojas: [{ name: 'ActaEco', rows: acta({}, [['900000001', 'UNO'], ['900000002', 'DOS']]) }] }]);
  const info = [['Dato', 'Valor'], ['Maestro', 'PÉREZ GARCÍA JUAN'], ['N° de expediente', '05054332'], ['Grupo', '1510'],
    ['Asignatura', 'ÉTICA'], ['Clave de asignatura', '0266'], ['Licenciatura', 'LICENCIADO EN PRUEBAS'],
    ['Ciclo escolar', '2026/2027-1'], ['Total de horas', '48']];
  const detalle = [
    ['Número', 'Matrícula', 'Nombre completo', 'Parcial 1', 'Parcial 2', 'Faltas Agosto', 'Faltas Septiembre', 'Primera Vuelta', 'Estado'],
    ['1', '900000001', 'UNO', '8.8', '', '2', '0', '', 'Falta Parcial 2'],
    ['2', '900000002', 'DOS', 'NP', '', '0', '0', '', 'Falta Parcial 2'],
  ];
  const actaRows = [[], [], [], [], ['INSTITUCIÓN:', '', 'UNIV DE PRUEBA', 'CLAVE:', '', '', '8898']];
  const exp = C.buildCatalog([{ archivo: 'Calificaciones_1510.xlsx', hojas: [
    { name: 'Acta', rows: actaRows }, { name: 'Detalle', rows: detalle }, { name: 'Información', rows: info }] }]);
  assert.equal(exp.grupos.length, 1);
  assert.equal(exp.grupos[0].id, original.grupos[0].id); // se reconoce como el mismo grupo
  assert.equal(exp.grupos[0].horas, '48');
  assert.deepEqual(exp.grupos[0].calificaciones, { '900000001': { p1: '8.8', m7: '2' }, '900000002': { p1: 'NP' } });
  // Al unirlo con lo ya importado no se pierden grupos y se agregan las calificaciones.
  const otro = C.buildCatalog([{ archivo: 'B.xlsx', hojas: [{ name: 'ActaEco', rows: acta({ grupo: '3510' }, [['900000003', 'TRES']]) }] }]);
  const base = C.mergeCatalogs(original, otro);
  assert.equal(base.grupos.length, 2);
  const merged = C.mergeCatalogs(base, exp);
  assert.equal(merged.grupos.length, 2);
  const g = merged.grupos.find((x) => x.id === original.grupos[0].id);
  assert.equal(g.calificaciones['900000001'].p1, '8.8');
  assert.equal(g.horas, '48');
  assert.equal(g.institucion, 'UNIV DE PRUEBA');
});

test('Excel exportado sin maestro ni grupo (captura sin grupo) no se asocia', () => {
  const cat = C.buildCatalog([{ archivo: 'Calificaciones.xlsx', hojas: [
    { name: 'Detalle', rows: [['Matrícula', 'Nombre completo'], ['1', 'X']] }, { name: 'Información', rows: [['Dato', 'Valor'], ['Maestro', '']] }] }]);
  assert.equal(cat.grupos.length, 0);
  assert.equal(cat.archivos[0].exportado, true);
});
