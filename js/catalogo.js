/*
 * Catálogo de maestros, grupos y alumnos a partir de actas económicas en Excel.
 *
 * Estructura de los archivos (analizada en los Excel reales de las licenciaturas):
 * cada hoja apila muchas actas, una debajo de otra. Cada acta es:
 *
 *   Acta Económica
 *   INSTITUCIÓN: … CLAVE: … CARRERA: …
 *   PROFESOR(A): … N° EXPEDIENTE: … HORAS TOTALES DE CLASE: …
 *   ASIGNATURA: … CLAVE: … GRUPO: … CICLO ESCOLAR: … FECHA DE INICIO: …
 *   N° | N° Cuenta | Nombre Alumno | Agt | | Sep | … (meses)
 *      |           |               | C   | F | C | …
 *   1  | 900000001 | ROBLES PAZ IAN JAVIER
 *
 * Un maestro se relaciona con un grupo a través de la asignatura: el mismo maestro puede
 * tener el mismo grupo en dos materias, y el mismo número de grupo existe en varias
 * licenciaturas. Por eso cada "grupo" del catálogo es un acta: licenciatura + grupo +
 * asignatura + maestro.
 */
(function (root) {
  'use strict';

  var MESES = {
    ENE: 0, FEB: 1, MAR: 2, ABR: 3, MAY: 4, JUN: 5, JUL: 6, AGO: 7, AGT: 7, SEP: 8, SET: 8, OCT: 9, NOV: 10, DIC: 11,
  };

  function clean(s) {
    return String(s == null ? '' : s).replace(/[\s ]+/g, ' ').trim();
  }

  /** Para comparar y buscar: sin acentos, mayúsculas, espacios simples. */
  function fold(s) {
    return clean(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  }

  // Etiquetas de los renglones de encabezado (toleran acentos, "No." en vez de "N°", etc.).
  var LABELS = [
    { key: 'institucion', re: 'INSTITUCI[OÓ]N' },
    { key: 'carrera', re: 'CARRERA|LICENCIATURA' },
    { key: 'profesor', re: 'PROFESOR(?:\\s*\\(A\\)|A)?|MAESTRO(?:\\s*\\(A\\))?|DOCENTE' },
    { key: 'expediente', re: 'N(?:[°ºo.]|O\\.)?\\s*(?:DE\\s+)?EXPEDIENTE|EXPEDIENTE' },
    { key: 'horas', re: 'HORAS\\s+TOTALES(?:\\s+DE\\s+CLASE)?' },
    { key: 'asignatura', re: 'ASIGNATURA|MATERIA' },
    { key: 'clave', re: 'CLAVE' },
    { key: 'grupo', re: 'GRUPO' },
    { key: 'ciclo', re: 'CICLO\\s+ESCOLAR|CICLO' },
    { key: 'fechaInicio', re: 'FECHA\\s+DE\\s+INICIO' },
  ];
  var LABEL_RE = new RegExp('(' + LABELS.map(function (l) { return l.re; }).join('|') + ')\\s*:', 'gi');

  function labelKey(text) {
    for (var i = 0; i < LABELS.length; i++) {
      if (new RegExp('^(?:' + LABELS[i].re + ')$', 'i').test(clean(text))) return LABELS[i].key;
    }
    return null;
  }

  /** "PROFESOR(A): X  N° EXPEDIENTE: Y" → [['profesor','X'], ['expediente','Y']] */
  function headerFields(text) {
    var out = [];
    var parts = [];
    var m;
    LABEL_RE.lastIndex = 0;
    while ((m = LABEL_RE.exec(text))) parts.push({ label: m[1], start: m.index, end: LABEL_RE.lastIndex });
    parts.forEach(function (p, i) {
      var value = clean(text.slice(p.end, i + 1 < parts.length ? parts[i + 1].start : undefined));
      if (/^_+$/.test(value)) value = '';
      out.push([labelKey(p.label), value]);
    });
    return out;
  }

  function rowText(row) {
    return clean((row || []).filter(function (v) { return clean(v) !== ''; }).join(' '));
  }

  function isActaTitle(row) {
    return /^acta\s+econ[oó]mica$/i.test(clean(row && row[0]));
  }

  /** Columnas de la tabla: N°, cuenta/matrícula y nombre, según el texto del encabezado. */
  function tableColumns(row) {
    var cols = { num: -1, cuenta: -1, nombre: -1, meses: [], mesCols: [] };
    (row || []).forEach(function (v, i) {
      var t = fold(v);
      if (!t) return;
      if (cols.cuenta < 0 && /CUENTA|MATRICULA/.test(t)) cols.cuenta = i;
      else if (cols.nombre < 0 && /NOMBRE|ALUMNO/.test(t)) cols.nombre = i;
      else if (cols.num < 0 && /^(N|NO|N°|Nº|NUM|#)\.?$/.test(t)) cols.num = i;
      else if (MESES[t.slice(0, 3)] != null && t.length <= 10) {
        cols.meses.push(MESES[t.slice(0, 3)]);
        cols.mesCols.push({ mes: MESES[t.slice(0, 3)], col: i });
      }
    });
    return cols.cuenta >= 0 && cols.nombre >= 0 ? cols : null;
  }

  /**
   * Extrae las actas de las filas de una hoja.
   * @returns {{ actas: Array, avisos: string[] }}
   */
  function parseSheet(rows, origen) {
    var actas = [];
    var avisos = [];
    var acta = null;
    var cols = null;

    function finish() {
      if (acta && !cols) avisos.push(origen + ': acta en la fila ' + acta.fila + ' sin tabla de alumnos.');
      acta = null;
      cols = null;
    }

    for (var r = 0; r < rows.length; r++) {
      var row = rows[r] || [];
      if (isActaTitle(row)) {
        finish();
        acta = { origen: origen, fila: r + 1, datos: {}, alumnos: [], duplicados: 0, meses: [] };
        actas.push(acta);
        continue;
      }
      if (!acta) continue;
      var text = rowText(row);
      if (!text) continue;

      if (!cols) {
        var tc = tableColumns(row);
        if (tc) {
          cols = tc;
          acta.meses = tc.meses;
          continue;
        }
        headerFields(text).forEach(function (f) {
          var key = f[0];
          // "CLAVE" aparece dos veces: la primera con la institución, la segunda con la asignatura.
          if (key === 'clave') key = acta.datos.asignatura != null ? 'claveAsignatura' : 'claveInstitucion';
          if (key && acta.datos[key] == null) acta.datos[key] = f[1];
        });
        continue;
      }

      var cuenta = clean(row[cols.cuenta]);
      var nombre = clean(row[cols.nombre]);
      if (!cuenta && !nombre) continue;
      // Renglón "C | F" bajo los meses o encabezado repetido.
      if (tableColumns(row) || (!cuenta && !nombre.replace(/[CF\s]/g, ''))) continue;
      if (!cuenta || !nombre) {
        avisos.push(origen + ', fila ' + (r + 1) + ': alumno sin ' + (cuenta ? 'nombre' : 'matrícula') + ', se omitió.');
        continue;
      }
      if (acta.alumnos.some(function (a) { return a.cuenta === cuenta; })) {
        acta.duplicados++;
        continue;
      }
      var al = { cuenta: cuenta, nombre: nombre };
      var notas = monthNotes(row, cols.mesCols);
      if (notas) al.notas = notas;
      acta.alumnos.push(al);
    }
    finish();
    return { actas: actas.filter(function (a) { return a.datos.profesor && a.datos.grupo; }), avisos: avisos };
  }

  function cellValue(v) {
    var t = clean(v);
    return t === '-' || t === '–' ? '' : t;
  }

  /**
   * Calificaciones y faltas ya escritas en las columnas de meses (C y F) de un acta.
   * Parcial 1 = C del primer mes; Parcial 2 = C del tercero (la misma convención de la app).
   */
  function monthNotes(row, mesCols) {
    var notas = {};
    var any = false;
    mesCols.forEach(function (mc, i) {
      var c = cellValue(row[mc.col]);
      var f = cellValue(row[mc.col + 1]);
      if (i === 0 && c) { notas.p1 = c; any = true; }
      if (i === 2 && c) { notas.p2 = c; any = true; }
      if (f && mc.mes !== 11) { notas['m' + mc.mes] = f; any = true; }
    });
    return any ? notas : null;
  }

  /** Hojas "Información" + "Detalle" (+ "Acta"): un Excel exportado por esta app. */
  function isAppExport(hojas) {
    var names = hojas.map(function (h) { return fold(h.name); });
    return names.indexOf('DETALLE') >= 0 && names.indexOf('INFORMACION') >= 0;
  }

  function sheetNamed(hojas, name) {
    for (var i = 0; i < hojas.length; i++) if (fold(hojas[i].name) === name) return hojas[i];
    return null;
  }

  /** Lee un Excel exportado por la app como un acta con calificaciones. null si no indica maestro y grupo. */
  function parseExport(hojas) {
    var info = {};
    (sheetNamed(hojas, 'INFORMACION').rows || []).forEach(function (r) {
      if (r && clean(r[0])) info[fold(r[0])] = clean(r[1]);
    });
    var datos = {
      profesor: info['MAESTRO'] || '',
      expediente: info['N° DE EXPEDIENTE'] || info['NO. DE EXPEDIENTE'] || '',
      grupo: info['GRUPO'] || '',
      asignatura: info['ASIGNATURA'] || '',
      claveAsignatura: info['CLAVE DE ASIGNATURA'] || '',
      carrera: info['LICENCIATURA'] || '',
      ciclo: info['CICLO ESCOLAR'] || '',
    };
    // Institución, su clave y la fecha de inicio vienen en el encabezado de la hoja Acta.
    var acta = sheetNamed(hojas, 'ACTA');
    if (acta) {
      var claves = [];
      acta.rows.slice(0, 9).forEach(function (row) {
        headerFields(rowText(row)).forEach(function (f) {
          if (f[0] === 'clave') claves.push(f[1]);
          else if (f[0] === 'institucion' || f[0] === 'fechaInicio') datos[f[0]] = datos[f[0]] || f[1];
        });
      });
      datos.claveInstitucion = claves[0] || '';
      if (!datos.claveAsignatura) datos.claveAsignatura = claves[1] || '';
    }
    if (!datos.profesor || !datos.grupo) return null;

    var rows = sheetNamed(hojas, 'DETALLE').rows;
    var head = (rows[0] || []).map(fold);
    var col = function (re) {
      for (var i = 0; i < head.length; i++) if (re.test(head[i])) return i;
      return -1;
    };
    var cCuenta = col(/^(MATRICULA|N° DE CUENTA|CUENTA)$/);
    var cNombre = col(/^(NOMBRE COMPLETO|ALUMNO)$/);
    var cols = { p1: col(/^PARCIAL 1$/), p2: col(/^PARCIAL 2$/), pv1: col(/^PRIMERA VUELTA$/), pv2: col(/^SEGUNDA VUELTA$/) };
    var meses = [];
    head.forEach(function (h, i) {
      var m = /^FALTAS (\S+)$/.exec(h);
      var mes = m && MESES[m[1].slice(0, 3)];
      if (mes != null) {
        cols['m' + mes] = i;
        meses.push(mes);
      }
    });
    if (cCuenta < 0 || cNombre < 0) return null;
    var alumnos = [];
    var vistos = {};
    rows.slice(1).forEach(function (r) {
      var cuenta = clean(r && r[cCuenta]);
      var nombre = clean(r && r[cNombre]);
      if (!cuenta || !nombre || vistos[cuenta]) return;
      vistos[cuenta] = true;
      var notas = {};
      var any = false;
      Object.keys(cols).forEach(function (k) {
        var v = cols[k] >= 0 ? cellValue(r[cols[k]]) : '';
        if (v && !(k[0] === 'm' && v === '0')) { notas[k] = v; any = true; }
      });
      var al = { cuenta: cuenta, nombre: nombre };
      if (any) al.notas = notas;
      alumnos.push(al);
    });
    var horas = /^\d{1,4}$/.test(info['TOTAL DE HORAS'] || '') ? info['TOTAL DE HORAS'] : '';
    return { datos: datos, alumnos: alumnos, duplicados: 0, meses: meses, horas: horas };
  }

  function hash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  /**
   * Arma el catálogo normalizado a partir de varias hojas.
   * @param {Array<{archivo: string, hojas: Array<{name, rows}>}>} libros
   */
  function buildCatalog(libros) {
    var grupos = {};
    var alumnos = {};
    var archivos = [];
    var avisos = [];

    var stamp = new Date().toISOString();
    libros.forEach(function (libro) {
      var total = 0;
      var ignoradas = [];
      var exportado = isAppExport(libro.hojas);
      var lotes = [];
      if (exportado) {
        var ex = parseExport(libro.hojas);
        if (ex) lotes.push({ actas: [ex], avisos: [] });
        else avisos.push(libro.archivo + ': es un Excel de esta app sin maestro y grupo (captura sin grupo); no se puede asociar a un grupo.');
      } else {
        libro.hojas.forEach(function (hoja) {
          var res = parseSheet(hoja.rows, libro.archivo + ' › ' + hoja.name);
          if (!res.actas.length && hoja.rows.some(function (r) { return rowText(r); })) ignoradas.push(hoja.name);
          lotes.push(res);
        });
      }
      lotes.forEach(function (res) {
        avisos = avisos.concat(res.avisos);
        res.actas.forEach(function (a) {
          var d = a.datos;
          var profesor = clean(d.profesor);
          var expediente = clean(d.expediente);
          var maestroId = hash(fold(profesor) + '|' + expediente);
          var id = hash([maestroId, fold(d.carrera), fold(d.grupo), fold(d.claveAsignatura), fold(d.asignatura), fold(d.ciclo)].join('|'));
          if (grupos[id]) {
            // La misma acta en dos archivos: se unen sus alumnos sin repetir matrículas.
            a.alumnos.forEach(function (al) {
              if (grupos[id].alumnos.indexOf(al.cuenta) < 0) grupos[id].alumnos.push(al.cuenta);
            });
            if (a.horas && !grupos[id].horas) grupos[id].horas = a.horas;
          } else {
            grupos[id] = {
              id: id,
              maestroId: maestroId,
              profesor: profesor,
              expediente: expediente,
              carrera: clean(d.carrera),
              grupo: clean(d.grupo),
              asignatura: clean(d.asignatura),
              claveAsignatura: clean(d.claveAsignatura),
              institucion: clean(d.institucion),
              claveInstitucion: clean(d.claveInstitucion),
              ciclo: clean(d.ciclo),
              fechaInicio: clean(d.fechaInicio),
              meses: a.meses,
              archivo: libro.archivo,
              alumnos: a.alumnos.map(function (al) { return al.cuenta; }),
            };
            if (a.horas) grupos[id].horas = a.horas;
          }
          // Calificaciones que ya traía el archivo (Parcial 1, faltas…), para no capturarlas de nuevo.
          a.alumnos.forEach(function (al) {
            if (!al.notas) return;
            var g = grupos[id];
            g.calificaciones = g.calificaciones || {};
            g.calificaciones[al.cuenta] = Object.assign({}, g.calificaciones[al.cuenta] || {}, al.notas);
            g.calificacionesFecha = stamp;
            g.calificacionesArchivo = libro.archivo;
          });
          if (a.duplicados) avisos.push(libro.archivo + ': ' + a.duplicados + ' alumno(s) repetido(s) en el grupo ' + d.grupo + ' (' + d.asignatura + ') se contaron una sola vez.');
          a.alumnos.forEach(function (al) {
            if (alumnos[al.cuenta] && alumnos[al.cuenta] !== al.nombre) {
              avisos.push('La matrícula ' + al.cuenta + ' aparece como "' + alumnos[al.cuenta] + '" y como "' + al.nombre + '". Se usa el primero.');
            } else {
              alumnos[al.cuenta] = al.nombre;
            }
          });
          total++;
        });
      });
      archivos.push({ archivo: libro.archivo, actas: total, hojasIgnoradas: ignoradas, exportado: exportado });
    });

    var lista = Object.keys(grupos).map(function (k) { return grupos[k]; });
    return {
      version: 1,
      importado: stamp,
      archivos: archivos,
      avisos: avisos,
      grupos: lista,
      alumnos: alumnos,
    };
  }

  /**
   * Une un catálogo recién importado con el que ya había: los grupos nuevos se agregan, los que ya
   * existían se actualizan (alumnos sin repetir, calificaciones del archivo más reciente) y nada se pierde.
   */
  function mergeCatalogs(base, nuevo) {
    if (!base || !base.grupos) return nuevo;
    var byId = {};
    var lista = base.grupos.map(function (g) {
      var copy = Object.assign({}, g, { alumnos: g.alumnos.slice() });
      byId[g.id] = copy;
      return copy;
    });
    nuevo.grupos.forEach(function (g) {
      var old = byId[g.id];
      if (!old) {
        lista.push(g);
        return;
      }
      g.alumnos.forEach(function (c) { if (old.alumnos.indexOf(c) < 0) old.alumnos.push(c); });
      ['institucion', 'claveInstitucion', 'fechaInicio', 'horas'].forEach(function (k) { if (g[k]) old[k] = g[k]; });
      if (g.meses && g.meses.length && !(old.meses && old.meses.length)) old.meses = g.meses;
      if (g.calificaciones) {
        old.calificaciones = Object.assign({}, old.calificaciones || {}, g.calificaciones);
        old.calificacionesFecha = g.calificacionesFecha;
        old.calificacionesArchivo = g.calificacionesArchivo;
      }
    });
    var archivos = base.archivos.filter(function (a) {
      return !nuevo.archivos.some(function (n) { return n.archivo === a.archivo; });
    }).concat(nuevo.archivos);
    return {
      version: 1,
      importado: nuevo.importado,
      archivos: archivos,
      avisos: nuevo.avisos,
      grupos: lista,
      alumnos: Object.assign({}, base.alumnos, nuevo.alumnos),
    };
  }

  /** Maestros del catálogo con sus grupos, ordenados por nombre. */
  function teachers(catalog) {
    var map = {};
    catalog.grupos.forEach(function (g) {
      var t = map[g.maestroId] || (map[g.maestroId] = { id: g.maestroId, nombre: g.profesor, expediente: g.expediente, grupos: [] });
      t.grupos.push(g);
    });
    var coll = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
    return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return coll.compare(a.nombre, b.nombre); })
      .map(function (t) {
        t.grupos.sort(function (a, b) {
          return coll.compare(a.grupo, b.grupo) || coll.compare(a.carrera, b.carrera) || coll.compare(a.asignatura, b.asignatura);
        });
        return t;
      });
  }

  function summary(catalog) {
    return {
      archivos: catalog.archivos.filter(function (a) { return a.actas > 0; }).length,
      grupos: catalog.grupos.length,
      maestros: teachers(catalog).length,
      alumnos: Object.keys(catalog.alumnos).length,
    };
  }

  /**
   * Importa archivos (.zip o .xlsx). files: [{ name, data: Uint8Array }]
   * Devuelve { catalog, ignorados: [{ archivo, motivo }] }.
   */
  function importFiles(files, Importar) {
    var ignorados = [];
    var pendientes = [];
    files.forEach(function (f) {
      if (/\.zip$/i.test(f.name)) {
        pendientes.push(Importar.readZip(f.data).then(function (entries) {
          return entries.map(function (e) { return { name: e.name, data: e.data }; });
        }));
      } else {
        pendientes.push(Promise.resolve([f]));
      }
    });
    return Promise.all(pendientes).then(function (groups) {
      var all = [].concat.apply([], groups);
      var lectura = [];
      all.forEach(function (f) {
        var base = f.name.split('/').pop();
        if (/^__MACOSX\//.test(f.name) || /^\._/.test(base) || /^\./.test(base)) return;
        if (/\.xlsx$/i.test(base)) {
          lectura.push(Importar.readXlsx(f.data).then(function (hojas) {
            return { archivo: base, hojas: hojas };
          }, function () {
            ignorados.push({ archivo: base, motivo: 'no se pudo leer como Excel (.xlsx)' });
            return null;
          }));
        } else if (/\.xls$/i.test(base)) {
          ignorados.push({ archivo: base, motivo: 'formato .xls antiguo: ábrelo en Excel y guárdalo como .xlsx' });
        } else {
          ignorados.push({ archivo: base, motivo: 'no es un archivo de Excel' });
        }
      });
      return Promise.all(lectura).then(function (libros) {
        libros = libros.filter(Boolean);
        var catalog = buildCatalog(libros);
        catalog.archivos.forEach(function (a) {
          if (!a.actas) {
            ignorados.push({
              archivo: a.archivo,
              motivo: a.exportado ? 'Excel de esta app sin maestro ni grupo' : 'no contiene actas económicas con alumnos',
            });
          }
          else if (a.hojasIgnoradas.length) {
            ignorados.push({ archivo: a.archivo + ' › ' + a.hojasIgnoradas.join(', '), motivo: 'hoja sin maestro ni grupo' });
          }
        });
        return { catalog: catalog, ignorados: ignorados };
      });
    });
  }

  var api = {
    parseSheet: parseSheet,
    buildCatalog: buildCatalog,
    mergeCatalogs: mergeCatalogs,
    importFiles: importFiles,
    teachers: teachers,
    summary: summary,
    headerFields: headerFields,
    fold: fold,
  };
  root.Catalogo = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
