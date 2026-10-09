/*
 * Libro de Excel con formato de Acta Económica.
 *
 * Hoja "Acta": encabezado de la institución, tabla con N°, N° de cuenta, nombre,
 * calificación (C) y faltas (F) por mes, Prom., 1ª y 2ª vuelta, total y % de faltas
 * y calificación final; firmas y leyendas al pie.
 * Hoja "Detalle": todos los valores, incluidos resultados exactos y estado.
 */
(function (root) {
  'use strict';

  var Xlsx = root.Xlsx || (typeof require === 'function' ? require('./xlsx.js') : null);

  var MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  var MESES_LARGOS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto',
    'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  var FONT = 'Arial';
  var base = { font: FONT, size: 9 };

  function style(extra) {
    var s = {};
    var k;
    for (k in base) s[k] = base[k];
    for (k in extra) s[k] = extra[k];
    return s;
  }

  var S = {
    corner: style({ bold: true, size: 10, h: 'right' }),
    title: style({ bold: true, size: 13, h: 'center' }),
    subtitle: style({ size: 9, h: 'center' }),
    label: style({ bold: true, size: 8, v: 'bottom' }),
    value: style({ size: 9, v: 'bottom', border: { bottom: 'thin' } }),
    head: style({ bold: true, size: 8, h: 'center', v: 'center', wrap: true, border: 'thin', fill: 'F2F2F2' }),
    cell: style({ h: 'center', v: 'center', border: 'thin' }),
    name: style({ h: 'left', v: 'center', border: 'thin' }),
    pct: style({ h: 'center', v: 'center', border: 'thin', numFmt: '0.0%' }),
    final: style({ bold: true, size: 10, h: 'center', v: 'center', border: 'thin' }),
    sign: style({ size: 8, h: 'center', border: { top: 'thin' } }),
    signLabel: style({ bold: true, size: 9, h: 'right' }),
    note: style({ size: 8 }),
  };

  /** Columnas de meses: desde el mes del Parcial 1, al menos cinco, hasta incluir el del Parcial 2. */
  function monthColumns(mesP1, mesP2) {
    var p1 = Number(mesP1);
    var p2 = Number(mesP2);
    if (!(p1 >= 0 && p1 < 12)) p1 = 1;
    if (!(p2 >= 0 && p2 < 12)) p2 = (p1 + 2) % 12;
    var off2 = (p2 - p1 + 12) % 12;
    if (off2 === 0) off2 = 2;
    var count = Math.max(5, off2 + 1);
    var months = [];
    var indexes = [];
    for (var i = 0; i < count; i++) {
      months.push(MESES[(p1 + i) % 12]);
      indexes.push((p1 + i) % 12);
    }
    return { months: months, indexes: indexes, p1: 0, p2: off2 };
  }

  var DICIEMBRE = 11;

  /** Meses en los que se registran faltas: los del acta, menos diciembre (no hay clases). */
  function faltasMonths(mesP1, mesP2) {
    return monthColumns(mesP1, mesP2).indexes.filter(function (m) { return m !== DICIEMBRE; });
  }

  function dash(v) {
    return v === '' || v == null ? '-' : v;
  }

  /**
   * @param info  datos del acta (textos; horas como texto o número; mesP1/mesP2 0–11)
   * @param rows  [{ numero, cuenta, nombre, p1, p2 (número, "NP" o vacío), faltasMes ({ mes: n }) o f1/f2,
   *                 prom, pv1, pv2, totalFaltas,
   *                 pctFaltas (fracción o null), final, detalle: [...] }]
   * @param detailHeaders encabezados de la hoja "Detalle" (las filas vienen en row.detalle)
   * @param extraSheets   hojas adicionales (formato de Xlsx.buildWorkbook), p. ej. "Información"
   */
  function buildActa(info, rows, detailHeaders, detailFormats, extraSheets) {
    info = info || {};
    var mc = monthColumns(info.mesP1, info.mesP2);
    var n = mc.months.length;
    var M0 = 3; // primera columna de meses (D)
    var k = M0 + 2 * n; // columna "Prom."
    var last = k + 5;
    var ref = Xlsx.cellRef;
    var cells = {};
    var merges = [];

    function put(col, row, v, s) {
      cells[ref(col, row)] = { v: v, s: s };
    }
    function merge(c1, r1, c2, r2, v, s) {
      for (var r = r1; r <= r2; r++) for (var c = c1; c <= c2; c++) put(c, r, c === c1 && r === r1 ? v : '', s);
      if (c1 !== c2 || r1 !== r2) merges.push(ref(c1, r1) + ':' + ref(c2, r2));
    }
    function text(v) {
      return v == null ? '' : String(v).trim();
    }
    function field(row, c1, c2, label, v1, v2, value) {
      merge(c1, row, c2, row, label, S.label);
      merge(v1, row, v2, row, text(value), S.value);
    }

    // Encabezado
    merge(last - 4, 1, last, 1, 'SUBDIRECCIÓN DE CERTIFICACIÓN', S.corner);
    merge(2, 2, k - 1, 2, 'ACTA ECONÓMICA', S.title);
    merge(last - 4, 2, last, 2, 'ANEXO 8', S.corner);
    var nivel = text(info.nivel) || 'Licenciatura';
    var semestre = text(info.semestre);
    merge(2, 3, k - 1, 3, nivel + (semestre ? ' (SEMESTRE ' + semestre + ')' : ''), S.subtitle);
    merge(last - 4, 3, last, 3, 'FORMA RCE-3', S.corner);

    // Datos (tres renglones, cuatro zonas)
    var z2 = M0, z3 = M0 + 6;
    field(5, 0, 1, 'INSTITUCIÓN:', 2, 2, info.institucion);
    field(5, z2, z2 + 2, 'CLAVE:', z2 + 3, z2 + 5, info.claveInstitucion);
    field(5, z3, k - 1, 'CARRERA:', k, last, info.carrera);
    field(6, 0, 1, 'PROFESOR(A):', 2, 2, info.profesor);
    field(6, z2, z2 + 2, 'N° EXPEDIENTE:', z2 + 3, z2 + 5, info.expediente);
    field(6, z3, k, 'HORAS TOTALES DE CLASE:', k + 1, k + 1, info.horas);
    field(6, k + 2, k + 3, 'FECHA DE INICIO:', k + 4, last, info.fechaInicio);
    field(7, 0, 1, 'ASIGNATURA:', 2, 2, info.asignatura);
    field(7, z2, z2 + 2, 'CLAVE:', z2 + 3, z2 + 5, info.claveAsignatura);
    field(7, z3, k - 1, 'GRUPO:', k, k + 1, info.grupo);
    field(7, k + 2, k + 3, 'CICLO ESCOLAR:', k + 4, last, info.ciclo);

    // Encabezado de la tabla (dos renglones)
    var H1 = 9, H2 = 10;
    merge(0, H1, 0, H2, 'N°', S.head);
    merge(1, H1, 1, H2, 'N° de Cuenta', S.head);
    merge(2, H1, 2, H2, 'Nombre del Alumno', S.head);
    mc.months.forEach(function (m, i) {
      merge(M0 + 2 * i, H1, M0 + 2 * i + 1, H1, m, S.head);
      put(M0 + 2 * i, H2, 'C', S.head);
      put(M0 + 2 * i + 1, H2, 'F', S.head);
    });
    ['Prom.', '1° vuelta', '2° vuelta', 'Total Faltas', '% Faltas', 'Calif. Final'].forEach(function (h, i) {
      merge(k + i, H1, k + i, H2, h, S.head);
    });

    // Alumnos
    var r = H2 + 1;
    rows.forEach(function (row) {
      put(0, r, row.numero, S.cell);
      put(1, r, text(row.cuenta), S.cell);
      put(2, r, text(row.nombre), S.name);
      for (var i = 0; i < n; i++) {
        var c = M0 + 2 * i;
        var mes = mc.indexes[i];
        put(c, r, i === mc.p1 ? dash(row.p1) : i === mc.p2 ? dash(row.p2) : '-', S.cell);
        // Faltas del mes; diciembre siempre "-". Sin datos por mes, las faltas van con su parcial.
        var f = '-';
        if (mes !== DICIEMBRE) {
          if (row.faltasMes) f = row.faltasMes[mes] || 0;
          else if (i === mc.p1) f = row.f1;
          else if (i === mc.p2) f = row.f2;
        }
        put(c + 1, r, f, S.cell);
      }
      put(k, r, row.prom, S.cell);
      put(k + 1, r, dash(row.pv1), S.cell);
      put(k + 2, r, dash(row.pv2), S.cell);
      put(k + 3, r, row.totalFaltas, S.cell);
      if (row.pctFaltas == null) put(k + 4, r, '-', S.cell);
      else put(k + 4, r, row.pctFaltas, S.pct);
      put(k + 5, r, row.final === '' || row.final == null ? '' : row.final, S.final);
      r++;
    });

    // Firmas y leyendas
    var sig = r + 4;
    merge(0, sig, 2, sig, 'FIRMA DIRECTOR(A) TÉCNICO(A)', S.sign);
    merge(M0 + 1, sig, M0 + 4, sig, 'FIRMA PROFESOR(A)', S.sign);
    merge(M0 + 6, sig, k, sig, 'SELLO DE LA INSTITUCIÓN', S.sign);
    merge(k + 1, sig, k + 3, sig, 'FECHA DE TERMINO:', S.signLabel);
    merge(k + 4, sig, last, sig, text(info.fechaTermino), S.value);
    put(0, sig + 2, 'NP: No presentó.', S.note);
    put(0, sig + 3, 'Este documento carece de validez si presenta tachaduras o enmendaduras.', S.note);
    put(0, sig + 4, 'La columna de las calificaciones finales deberá protegerse con cinta adhesiva transparente.', S.note);

    var cols = [4, 12, 44];
    for (var i = 0; i < 2 * n; i++) cols.push(5);
    cols.push(7, 7, 7, 7, 7, 7);

    var heights = { 2: 20, 4: 6, 8: 8 };
    heights[H1] = 26;
    heights[H2] = 13;
    heights[sig - 1] = 30;

    var acta = {
      name: 'Acta',
      cols: cols,
      cells: cells,
      merges: merges,
      rowHeights: heights,
      freeze: ref(0, H2 + 1),
      landscape: true,
      fitToWidth: true,
      showGridLines: false,
    };

    var detalle = Xlsx.tableSheet({
      name: 'Detalle',
      headers: detailHeaders,
      rows: rows.map(function (row) { return row.detalle; }),
      formats: detailFormats,
    });

    return Xlsx.buildWorkbook({ sheets: [acta, detalle].concat(extraSheets || []) });
  }

  var api = { buildActa: buildActa, monthColumns: monthColumns, faltasMonths: faltasMonths, DICIEMBRE: DICIEMBRE, MESES: MESES, MESES_LARGOS: MESES_LARGOS };
  root.Acta = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
