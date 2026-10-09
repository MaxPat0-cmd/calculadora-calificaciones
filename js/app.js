(function () {
  'use strict';

  var Grades = window.Grades;
  var Acta = window.Acta;
  var Xlsx = window.Xlsx;
  var Catalogo = window.Catalogo;
  var Importar = window.Importar;
  var Combobox = window.Combobox;

  // Captura libre (sin grupo): las mismas llaves de siempre, para no perder datos anteriores.
  var FREE_KEY = 'calificaciones.v1';
  var FREE_ACTA_KEY = 'calificaciones.acta.v1';
  // Grupos importados de las actas y una sesión de calificaciones por grupo.
  var CATALOG_KEY = 'calificaciones.catalogo.v1';
  var SESSION_PREFIX = 'calificaciones.sesion.';
  var ACTIVE_KEY = 'calificaciones.activa'; // 'libre' o id de grupo
  var LAST_KEY = 'calificaciones.ultimo'; // { maestroId, grupoId }

  var FREE_FILE_NAME = 'Calificaciones.xlsx';
  // Campos de captura: calificaciones y una casilla de faltas por mes ("m7" = agosto, …).
  // Los meses dependen del acta (sin diciembre), así que INPUT_KEYS se arma en buildMonthInputs.
  var GRADE_KEYS = ['p1', 'p2', 'pv1', 'pv2'];
  var MONTH_KEYS = [];
  var INPUT_KEYS = GRADE_KEYS.slice();
  var MONTH_KEY_RE = /^m(\d{1,2})$/;
  var STATUS = {};
  Object.keys(Grades.STATUS_LABELS).forEach(function (k) { STATUS[k] = Grades.STATUS_LABELS[k]; });
  STATUS.sincalificar = 'Sin calificar';
  var NP = Grades.NP;

  // ---------- Estado ----------

  var state = {
    mode: null, // 'libre' | 'grupo'
    // { id, cuenta, name, p1, p2, pv1, pv2, m7, m8, …, fijo } — texto canónico ("8.8", "NP", "2");
    // '' en lo que no se ha capturado. "fijo": alumno que viene del acta (nombre y matrícula no se editan).
    records: [],
    sort: 'none', // 'none' | 'name' | 'grade'
    editingId: null, // captura libre: registro en edición
    acta: {}, // datos del encabezado del acta; meses 0–11
    session: null, // modo grupo: { id, grupo, horas, modificado, exportado, pos }
    catalog: null,
  };

  function readJSON(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  // Lectura de lo ya guardado: acepta la precisión de versiones anteriores.
  var stored = {
    grade: function (v) { return Grades.parseGrade(v, Grades.DECIMALS); },
    vuelta: function (v) { return Grades.parseVuelta(v, Grades.DECIMALS); },
    faltas: function (v) { return Grades.parseFaltas(v); },
  };

  // Lectura de lo que se escribe en el formulario.
  function parseInput(key, raw) {
    if (MONTH_KEY_RE.test(key)) return Grades.parseFaltas(raw);
    // Parciales y vueltas aceptan NP (no presentó).
    return Grades.parseVuelta(raw);
  }

  function monthKeysOf(rec) {
    return Object.keys(rec).filter(function (k) { return MONTH_KEY_RE.test(k); });
  }

  function str(v) {
    return v == null ? '' : String(v);
  }

  function emptyOrValid(p) {
    return p.status !== 'invalid';
  }

  /** Normaliza un registro guardado; null si está dañado. allowUngraded: alumnos del acta sin calificar. */
  function normalizeRecord(r, allowUngraded) {
    if (!r || typeof r.id !== 'string') return null;
    var rec = {
      id: r.id,
      cuenta: str(r.cuenta).trim(),
      name: str(r.name),
      p1: str(r.p1),
      p2: str(r.p2),
      // Versión anterior: "Calificación 3" pasa a ser Primera Vuelta.
      pv1: str(r.pv1 != null ? r.pv1 : r.p3),
      pv2: str(r.pv2),
    };
    if (r.fijo) rec.fijo = true;
    // Faltas por parcial de versiones anteriores: se pasan a su mes en migrateFaltas.
    if (r.f1 != null && r.f1 !== '') rec.f1 = str(r.f1);
    if (r.f2 != null && r.f2 !== '') rec.f2 = str(r.f2);
    var faltasOk = true;
    Object.keys(r).forEach(function (k) {
      var m = MONTH_KEY_RE.exec(k);
      if (!m || Number(m[1]) > 11) return;
      rec[k] = str(r[k]);
      if (!emptyOrValid(stored.faltas(rec[k]))) faltasOk = false;
    });
    var p1 = stored.vuelta(rec.p1), p2 = stored.vuelta(rec.p2);
    var parcialOk = function (p) { return p.status === 'valid' || p.status === 'np'; };
    var gradesOk = allowUngraded
      ? emptyOrValid(p1) && emptyOrValid(p2)
      : parcialOk(p1) && parcialOk(p2);
    var ok = gradesOk && faltasOk && emptyOrValid(stored.vuelta(rec.pv1)) && emptyOrValid(stored.vuelta(rec.pv2)) &&
      emptyOrValid(stored.faltas(rec.f1)) && emptyOrValid(stored.faltas(rec.f2));
    return ok ? rec : null;
  }

  /** Faltas guardadas por parcial (versión anterior) → al mes de cada parcial según el acta. */
  function migrateFaltas(records) {
    var mc = Acta.monthColumns(state.acta.mesP1, state.acta.mesP2);
    var changed = false;
    records.forEach(function (r) {
      [['f1', mc.p1], ['f2', mc.p2]].forEach(function (pair) {
        if (r[pair[0]] == null) return;
        var key = 'm' + mc.indexes[pair[1]];
        if (!r[key]) r[key] = r[pair[0]];
        delete r[pair[0]];
        changed = true;
      });
    });
    return changed;
  }

  function sessionKey(id) {
    return SESSION_PREFIX + id;
  }

  /** Guarda los registros. changed=false: solo la posición (no cuenta como cambio sin exportar). */
  function persist(changed) {
    var ok;
    if (state.mode === 'grupo' && state.session) {
      if (changed !== false) state.session.modificado = new Date().toISOString();
      ok = writeJSON(sessionKey(state.session.id), {
        id: state.session.id,
        grupo: state.session.grupo,
        horas: state.session.horas,
        records: state.records,
        sort: state.sort,
        acta: state.acta,
        pos: state.session.pos,
        modificado: state.session.modificado,
        exportado: state.session.exportado,
      });
    } else {
      ok = writeJSON(FREE_KEY, { records: state.records, sort: state.sort });
    }
    if (!ok) showStatus('No se pudo guardar en este navegador. Exporta a Excel para no perder los datos.', true);
  }

  function persistActa() {
    if (state.mode === 'grupo') {
      if (state.session) state.session.horas = str(state.acta.horas);
      persist(false);
    } else {
      writeJSON(FREE_ACTA_KEY, state.acta);
    }
  }

  function newId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  /** Valor de una vuelta para Grades.evaluate: unidades, NP o null. */
  function vueltaArg(parsed) {
    if (parsed.status === 'valid') return parsed.units;
    if (parsed.status === 'np') return NP;
    return null;
  }

  function horasTotales() {
    var t = str(state.acta.horas).trim();
    return /^\d{1,4}$/.test(t) && Number(t) > 0 ? Number(t) : null;
  }

  var UNGRADED = {
    status: 'sincalificar', final: null, partial: null, partialText: '–', partialShort: null, partialShortText: '–',
    needsPv1: false, needsPv2: false, first: null, exact: null, exactText: null, sumUnits: null,
  };

  /** Registro con todos sus valores calculados (nunca se guardan; siempre se derivan). */
  function compute(record) {
    var g = {
      p1: stored.vuelta(record.p1),
      p2: stored.vuelta(record.p2),
      pv1: stored.vuelta(record.pv1),
      pv2: stored.vuelta(record.pv2),
    };
    var faltasMes = {};
    var total = 0;
    monthKeysOf(record).forEach(function (k) {
      var mes = Number(MONTH_KEY_RE.exec(k)[1]);
      var n = stored.faltas(record[k]).value || 0;
      if (mes === Acta.DICIEMBRE || !n) return;
      faltasMes[mes] = n;
      total += n;
    });
    var graded = isGiven(g.p1) && isGiven(g.p2);
    var ev = evaluateGrades(g, total) || UNGRADED;
    return {
      record: record, g: g, ev: ev, graded: graded, faltasMes: faltasMes, faltas: total,
      pct: Grades.absencePercent(total, horasTotales()),
    };
  }

  /** Parcial capturado: calificación o NP. */
  function isGiven(p) {
    return p.status === 'valid' || p.status === 'np';
  }

  /** Calificación con la que se exenta: 8, o 9 en Enfermería (según la licenciatura del acta). */
  function exemptionNow() {
    return Grades.exemptionGrade(carreraNow());
  }

  function carreraNow() {
    return state.acta.carrera || (state.session && state.session.grupo.carrera) || '';
  }

  /** Porcentaje máximo de faltas: 20%, o 10% en Enfermería. */
  function absenceLimitNow() {
    return Grades.absenceLimit(carreraNow());
  }

  /**
   * Aplica todas las reglas a calificaciones ya interpretadas y al total de faltas.
   * null mientras falten parciales (salvo que ya rebase faltas: entonces es 5 de todos modos).
   */
  function evaluateGrades(g, totalFaltas) {
    var excede = Grades.exceedsAbsences(totalFaltas, horasTotales(), absenceLimitNow());
    if (isGiven(g.p1) && isGiven(g.p2)) {
      return Grades.evaluate(vueltaArg(g.p1), vueltaArg(g.p2), vueltaArg(g.pv1), vueltaArg(g.pv2), exemptionNow(), excede);
    }
    if (!excede) return null;
    var ev = Grades.evaluate(isGiven(g.p1) ? vueltaArg(g.p1) : 0, isGiven(g.p2) ? vueltaArg(g.p2) : 0, null, null, exemptionNow(), true);
    ev.partial = null;
    ev.partialShort = null;
    ev.partialText = '–';
    ev.partialShortText = '–';
    return ev;
  }

  /** Texto de la calificación final: número, "NP" (NP en ambos parciales) o null si falta. */
  function finalText(ev) {
    if (ev.final != null) return String(ev.final);
    return ev.finalText || null;
  }

  function isPending(ev) {
    return finalText(ev) == null;
  }

  var collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });

  function orderedRows() {
    var rows = state.records.map(compute);
    if (state.sort === 'name') {
      rows.sort(function (a, b) { return collator.compare(a.record.name, b.record.name); });
    } else if (state.sort === 'grade') {
      rows.sort(function (a, b) {
        var pa = isPending(a.ev), pb = isPending(b.ev);
        if (pa !== pb) return pa ? 1 : -1; // pendientes al final
        var fa = a.ev.final != null ? a.ev.final : -1, fb = b.ev.final != null ? b.ev.final : -1;
        var sa = a.ev.sumUnits != null ? a.ev.sumUnits : -1, sb = b.ev.sumUnits != null ? b.ev.sumUnits : -1;
        return (pa ? 0 : (fb - fa) || (sb - sa)) ||
          collator.compare(a.record.name, b.record.name);
      });
    }
    return rows;
  }

  /** Siguiente nombre automático: "Alumno N", sin repetir números existentes. */
  function nextDefaultName() {
    var max = state.records.length;
    state.records.forEach(function (r) {
      var m = /^Alumno (\d+)$/.exec(r.name);
      if (m) max = Math.max(max, Number(m[1]));
    });
    return 'Alumno ' + (max + 1);
  }

  // ---------- Elementos ----------

  var $ = function (id) { return document.getElementById(id); };
  var setupView = $('setup-view');
  var captureView = $('capture-view');
  var form = $('capture-form');
  var cuentaInput = $('f-cuenta');
  var nameInput = $('f-name');
  var inputs = {};
  GRADE_KEYS.forEach(function (k) { inputs[k] = $('f-' + k); });
  var errorEls = { p1: $('e-p1'), p2: $('e-p2'), pv1: $('e-pv1'), pv2: $('e-pv2'), faltas: $('e-faltas') };
  var errorMsgs = {};
  var npButtons = Array.prototype.slice.call(document.querySelectorAll('[data-np]'));
  var faltasGrid = $('faltas-grid');

  /** Orden de captura con Enter: matrícula, nombre, parciales, faltas por mes, vueltas. */
  function fieldOrder() {
    return [cuentaInput, nameInput, inputs.p1, inputs.p2]
      .concat(MONTH_KEYS.map(function (k) { return inputs[k]; }), [inputs.pv1, inputs.pv2]);
  }

  function errorSlot(key) {
    return MONTH_KEY_RE.test(key) ? 'faltas' : key;
  }

  function currentMonths() {
    return Acta.faltasMonths(state.acta.mesP1, state.acta.mesP2);
  }

  /** Casillas de faltas para los meses del acta (sin diciembre). Conserva lo ya escrito. */
  function buildMonthInputs() {
    var keys = currentMonths().map(function (m) { return 'm' + m; });
    if (keys.join() === MONTH_KEYS.join()) return;
    var typed = {};
    MONTH_KEYS.forEach(function (k) {
      typed[k] = inputs[k].value;
      delete inputs[k];
      delete errorMsgs[k];
    });
    var frag = document.createDocumentFragment();
    keys.forEach(function (k) {
      var mes = Number(k.slice(1));
      var wrap = document.createElement('div');
      wrap.className = 'field fm-field';
      var label = document.createElement('label');
      label.setAttribute('for', 'f-' + k);
      label.textContent = Acta.MESES[mes];
      label.title = Acta.MESES_LARGOS[mes];
      var input = document.createElement('input');
      input.id = 'f-' + k;
      input.type = 'text';
      input.inputMode = 'numeric';
      input.autocomplete = 'off';
      input.placeholder = '0';
      input.setAttribute('enterkeyhint', 'next');
      input.setAttribute('aria-describedby', 'e-faltas');
      input.setAttribute('aria-label', 'Faltas de ' + Acta.MESES_LARGOS[mes].toLowerCase());
      input.value = typed[k] || '';
      wrap.appendChild(label);
      wrap.appendChild(input);
      frag.appendChild(wrap);
      inputs[k] = input;
    });
    faltasGrid.replaceChildren(frag);
    MONTH_KEYS = keys;
    INPUT_KEYS = ['p1', 'p2'].concat(MONTH_KEYS, ['pv1', 'pv2']);
    MONTH_KEYS.forEach(bindInput);
    errorEls.faltas.textContent = '';
  }
  var resultBox = $('result');
  var out = {
    final: $('r-final'),
    status: $('r-status'),
    partial: $('r-partial'),
    exact: $('r-exact'),
    exactLabel: $('r-exact-label'),
  };
  var notice = $('notice');
  var saveBtn = $('save-btn');
  var statusEl = $('status');
  var statusHint = statusEl.innerHTML;
  var editBanner = $('edit-banner');
  var editName = $('edit-name');
  var table = $('table');
  var tbody = $('tbody');
  var emptyEl = $('empty');
  var countText = $('count-text');
  var countEl = $('count');
  var pendingCountEl = $('pending-count');
  var groupAvgEl = $('group-avg');
  var exportBtn = $('export-btn');
  var clearBtn = $('clear-btn');
  var footer = $('results-footer');
  var sortButtons = Array.prototype.slice.call(document.querySelectorAll('[data-sort]'));
  var actaInputs = Array.prototype.slice.call(document.querySelectorAll('[data-acta]'));
  var actaSummary = $('acta-summary');
  var studentHead = $('student-head');
  var identity = $('identity');

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- Captura ----------

  function setError(key, message) {
    errorMsgs[key] = message || '';
    if (message) inputs[key].setAttribute('aria-invalid', 'true');
    else inputs[key].removeAttribute('aria-invalid');
    // Las casillas de faltas comparten una sola línea de error.
    var slot = errorSlot(key);
    var text = slot === 'faltas'
      ? MONTH_KEYS.map(function (k) { return errorMsgs[k]; }).filter(Boolean)[0]
      : errorMsgs[slot];
    errorEls[slot].textContent = text || '';
  }

  /** Muestra errores solo de lo que ya es claramente inválido (no de campos vacíos). */
  function validateLive(key) {
    if (inputs[key].disabled) return setError(key, '');
    var parsed = parseInput(key, inputs[key].value);
    setError(key, parsed.status === 'invalid' ? parsed.error : '');
  }

  /** Lee el formulario y aplica las reglas. ev es null mientras falte algún parcial válido. */
  function readForm() {
    var g = {};
    INPUT_KEYS.forEach(function (k) { g[k] = parseInput(k, inputs[k].value); });
    var total = 0;
    MONTH_KEYS.forEach(function (k) { if (g[k].status === 'valid') total += g[k].value; });
    return { g: g, ev: evaluateGrades(g, total), faltas: total };
  }

  function setFieldEnabled(key, enabled) {
    var input = inputs[key];
    if (input.disabled === !enabled) return;
    input.disabled = !enabled;
    input.placeholder = enabled ? '0 – 10' : 'No aplica';
    input.closest('.field').classList.toggle('is-disabled', !enabled);
    if (!enabled) setError(key, '');
    else validateLive(key);
  }

  function setBadge(el, status) {
    if (!status) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.textContent = STATUS[status];
    el.setAttribute('data-status', status);
  }

  function updateNpButtons() {
    npButtons.forEach(function (b) {
      var input = inputs[b.getAttribute('data-np')];
      b.disabled = input.disabled;
      b.setAttribute('aria-pressed', input.value.trim().toUpperCase() === NP ? 'true' : 'false');
    });
  }

  function updateResult() {
    var f = readForm();
    var ev = f.ev;

    // Los campos de vueltas solo se habilitan cuando hacen falta.
    setFieldEnabled('pv1', !ev || ev.needsPv1);
    setFieldEnabled('pv2', !!(ev && ev.needsPv2));
    updateNpButtons();

    out.partial.textContent = ev ? ev.partialShortText : '–';
    out.partial.title = ev ? 'Exacto: ' + ev.partialText : '';
    out.exactLabel.textContent = 'Resultado exacto';
    out.exact.textContent = '–';
    out.final.textContent = '–';

    var message = '';
    if (ev) {
      if (ev.status === 'exento') {
        message = 'Exento. El promedio de los parciales es ' + ev.exentoCon + ' o más; no necesita Primera Vuelta.';
      } else if (ev.needsPv2 && ev.first) {
        message = 'No alcanzó 6 en Primera Vuelta (' + ev.first.exactText + '). Necesita Segunda Vuelta.';
      } else if (ev.needsPv2) {
        message = 'No presentó Primera Vuelta. Necesita Segunda Vuelta.';
      }
      if (ev.status === 'reprobado') message = 'No alcanzó 6 en Segunda Vuelta (' + ev.exactText + '). Se registra 5.';
      if (ev.status === 'np') message = 'No presentó Segunda Vuelta. Se registra 5.';
      if (ev.parcialesNp) message = 'NP en ambos parciales: el acta dice NP y no tiene derecho a Primera ni Segunda Vuelta.';
      if (ev.excedeFaltas) {
        var pct = Grades.absencePercent(readForm().faltas, horasTotales());
        message = 'Rebasó el límite de faltas (' + (pct ? pct.text + '%' : '') + ', máximo ' + absenceLimitNow() +
          '%). Sin derecho a Primera ni Segunda Vuelta; se registra 5.';
      }
      else if (ev.npParcial) message = ('NP en Parcial ' + ev.npParcial + ' cuenta como 0. ' + message).trim();

      if (finalText(ev) != null) {
        out.exact.textContent = ev.exactText != null ? ev.exactText : '–';
        out.final.textContent = finalText(ev);
      } else if (ev.first) {
        out.exactLabel.textContent = 'Resultado 1ª vuelta';
        out.exact.textContent = ev.first.exactText;
      }
    }

    notice.textContent = message;
    notice.hidden = !message;
    notice.setAttribute('data-kind', ev ? ev.status : '');
    setBadge(out.status, ev && finalText(ev) != null ? ev.status : null);
    resultBox.setAttribute('data-ready', ev && finalText(ev) != null ? 'true' : 'false');
    resultBox.setAttribute('data-status', ev ? ev.status : '');
  }

  function clearForm() {
    cuentaInput.value = '';
    nameInput.value = '';
    INPUT_KEYS.forEach(function (k) {
      inputs[k].value = '';
      setError(k, '');
    });
    updateResult();
  }

  function fillForm(rec) {
    INPUT_KEYS.forEach(function (k) {
      inputs[k].value = rec[k] || '';
      setError(k, '');
    });
    updateResult();
  }

  function updatePlaceholder() {
    if (state.mode !== 'libre') return;
    if (state.editingId) {
      var rec = findRecord(state.editingId);
      nameInput.placeholder = rec ? rec.name : '';
    } else {
      nameInput.placeholder = nextDefaultName();
    }
  }

  function findRecord(id) {
    for (var i = 0; i < state.records.length; i++) if (state.records[i].id === id) return state.records[i];
    return null;
  }

  function indexOfRecord(id) {
    for (var i = 0; i < state.records.length; i++) if (state.records[i].id === id) return i;
    return -1;
  }

  /** Valores del formulario listos para guardar (solo las vueltas que aplican). */
  function formValues(f) {
    var ev = f.ev;
    var keep = function (p) { return p.status === 'valid' || p.status === 'np' ? p.text : ''; };
    var values = {
      p1: keep(f.g.p1),
      p2: keep(f.g.p2),
      pv1: ev ? (ev.needsPv1 ? keep(f.g.pv1) : '') : keep(f.g.pv1),
      pv2: ev && ev.needsPv2 ? keep(f.g.pv2) : '',
    };
    MONTH_KEYS.forEach(function (k) { values[k] = f.g[k].status === 'valid' ? f.g[k].text : ''; });
    return values;
  }

  /** Marca errores. requireGrades: Parcial 1 y 2 obligatorios. Devuelve el primer campo inválido. */
  function validateForm(f, requireGrades) {
    var firstInvalid = null;
    INPUT_KEYS.forEach(function (k) {
      var p = f.g[k];
      var required = requireGrades && (k === 'p1' || k === 'p2');
      var bad = !inputs[k].disabled && (p.status === 'invalid' || (required && p.status === 'empty'));
      setError(k, bad ? p.error : '');
      if (bad && !firstInvalid) firstInvalid = inputs[k];
    });
    return firstInvalid;
  }

  function save() {
    updateResult();
    var f = readForm();
    // Con faltas rebasadas la final ya es 5: los parciales dejan de ser obligatorios.
    var firstInvalid = validateForm(f, !(f.ev && f.ev.excedeFaltas));
    if (firstInvalid) {
      firstInvalid.focus();
      firstInvalid.select();
      return;
    }
    if (state.mode === 'grupo') return saveStudent(f);

    var values = formValues(f);
    values.cuenta = cuentaInput.value.trim();
    var name = nameInput.value.trim().replace(/\s+/g, ' ');
    var savedId;

    if (state.editingId) {
      var rec = findRecord(state.editingId);
      if (rec) {
        rec.name = name || rec.name;
        Object.keys(values).forEach(function (k) { rec[k] = values[k]; });
        savedId = rec.id;
      }
      exitEdit(false);
    } else {
      savedId = newId();
      var record = { id: savedId, name: name || nextDefaultName() };
      Object.keys(values).forEach(function (k) { record[k] = values[k]; });
      state.records.push(record);
    }

    persist();
    clearForm();
    render();
    updatePlaceholder();
    flashRow(savedId);
    announceSaved(findRecord(savedId));
    cuentaInput.focus();
  }

  function announceSaved(rec, extra) {
    if (!rec) return;
    var sev = compute(rec).ev;
    showStatus(rec.name + ' guardado · ' +
      (sev.final != null ? 'Final ' + sev.final + ' · ' + STATUS[sev.status] : STATUS[sev.status]) + (extra || ''));
  }

  var statusTimer = null;
  function showStatus(message, isError) {
    clearTimeout(statusTimer);
    statusEl.textContent = message;
    statusEl.classList.toggle('is-error', !!isError);
    statusEl.classList.add('is-visible');
    statusTimer = setTimeout(function () {
      statusEl.classList.remove('is-visible', 'is-error');
      statusEl.innerHTML = statusHint;
    }, isError ? 6000 : 2600);
  }

  // ---------- Captura por grupo (alumnos del acta) ----------

  function currentStudent() {
    return state.session ? state.records[state.session.pos] || null : null;
  }

  function showStudent(index, focusKey) {
    var n = state.records.length;
    if (!n) return;
    index = Math.max(0, Math.min(n - 1, index));
    state.session.pos = index;
    var rec = state.records[index];
    $('student-pos').textContent = 'Alumno ' + (index + 1) + ' de ' + n;
    $('student-name').textContent = rec.name;
    $('student-id').textContent = rec.cuenta || '—';
    $('prev-btn').disabled = index === 0;
    $('next-btn').disabled = index === n - 1;
    saveBtn.textContent = index === n - 1 ? 'Guardar' : 'Guardar y siguiente';
    fillForm(rec);
    markCurrentRow();
    persist(false);
    var target = inputs[focusKey || 'p1'];
    if (target && !target.disabled) {
      target.focus({ preventScroll: true });
      target.select();
    }
  }

  /** ¿Lo escrito en el formulario difiere de lo guardado para el alumno actual? */
  function formDirty() {
    var rec = state.mode === 'grupo' ? currentStudent() : null;
    if (state.mode === 'grupo' && !rec) return false;
    var canon = function (k, v) {
      var p = parseInput(k, v);
      if (p.status === 'valid' || p.status === 'np') return p.text;
      return p.status === 'empty' ? '' : str(v).trim().toUpperCase();
    };
    return INPUT_KEYS.some(function (k) {
      var typed = inputs[k].disabled ? '' : inputs[k].value;
      return canon(k, typed) !== canon(k, rec ? rec[k] : '');
    });
  }

  /** Antes de cambiar de alumno conserva lo escrito (aunque esté incompleto). false si hay errores. */
  function keepDraft() {
    if (state.mode !== 'grupo' || !formDirty()) return true;
    var f = readForm();
    var firstInvalid = validateForm(f, false);
    if (firstInvalid) {
      firstInvalid.focus();
      firstInvalid.select();
      showStatus('Corrige la calificación marcada antes de cambiar de alumno.', true);
      return false;
    }
    var rec = currentStudent();
    var values = formValues(f);
    Object.keys(values).forEach(function (k) { rec[k] = values[k]; });
    persist();
    render();
    return true;
  }

  function goTo(index, focusKey) {
    if (!keepDraft()) return;
    showStudent(index, focusKey);
  }

  function firstUngraded(from) {
    var n = state.records.length;
    for (var i = 0; i < n; i++) {
      var idx = (from + i) % n;
      if (!compute(state.records[idx]).graded) return idx;
    }
    return -1;
  }

  function saveStudent(f) {
    var rec = currentStudent();
    var values = formValues(f);
    Object.keys(values).forEach(function (k) { rec[k] = values[k]; });
    persist();
    render();
    flashRow(rec.id);

    var pos = state.session.pos;
    var n = state.records.length;
    var next = pos + 1 < n ? pos + 1 : firstUngraded(0);
    if (next === -1) {
      announceSaved(rec, ' · Todos los alumnos tienen calificación');
      showStudent(pos);
      return;
    }
    announceSaved(rec, pos + 1 >= n ? ' · Faltan alumnos por calificar' : '');
    showStudent(next);
  }

  function markCurrentRow() {
    var cur = state.mode === 'grupo' ? currentStudent() : null;
    var editingId = state.mode === 'grupo' ? cur && cur.id : state.editingId;
    Array.prototype.forEach.call(tbody.rows, function (tr) {
      tr.classList.toggle('is-editing', tr.getAttribute('data-id') === editingId);
    });
  }

  // ---------- Edición (captura libre) ----------

  function startEdit(id) {
    var rec = findRecord(id);
    if (!rec) return;
    state.editingId = id;
    cuentaInput.value = rec.cuenta || '';
    nameInput.value = rec.name;
    fillForm(rec);
    editName.textContent = rec.name;
    editBanner.hidden = false;
    saveBtn.textContent = 'Guardar cambios';
    updatePlaceholder();
    render();
    scrollToCapture();
    // Lleva el cursor a lo que falta capturar; si no falta nada, al Parcial 1.
    var ev = compute(rec).ev;
    var target = ev.status === 'pendiente1' ? inputs.pv1 : ev.status === 'pendiente2' ? inputs.pv2 : inputs.p1;
    target.focus({ preventScroll: true });
    target.select();
  }

  function scrollToCapture() {
    var card = form.closest('.card');
    var rect = card.getBoundingClientRect();
    if (rect.top < 0 || rect.top > window.innerHeight * 0.5) {
      card.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    }
  }

  function exitEdit(clear) {
    state.editingId = null;
    editBanner.hidden = true;
    saveBtn.textContent = 'Guardar y siguiente';
    if (clear) {
      clearForm();
      render();
      cuentaInput.focus();
    }
    updatePlaceholder();
  }

  // ---------- Tabla ----------

  function cell(tag, className, text, label) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    if (label) el.setAttribute('data-label', label);
    return el;
  }

  function withSub(td, sub) {
    if (sub) td.appendChild(cell('span', 'sub', sub));
    return td;
  }

  function vueltaText(applies, value) {
    if (!applies) return '–';
    return value || '–';
  }

  function clearGrades(rec) {
    GRADE_KEYS.forEach(function (k) { rec[k] = ''; });
    monthKeysOf(rec).forEach(function (k) { delete rec[k]; });
  }

  function render() {
    var rows = orderedRows();
    var n = rows.length;
    var grupo = state.mode === 'grupo';
    var graded = rows.filter(function (r) { return r.graded || r.ev.excedeFaltas; }).length;
    var pending = rows.filter(function (r) { return r.graded && isPending(r.ev); }).length;

    countText.textContent = grupo ? 'Calificados:' : 'Alumnos capturados:';
    countEl.textContent = grupo ? graded + ' de ' + n : String(n);
    pendingCountEl.hidden = pending === 0;
    pendingCountEl.textContent = pending === 1 ? '1 con vuelta pendiente' : pending + ' con vuelta pendiente';
    table.hidden = n === 0;
    emptyEl.hidden = n !== 0;
    footer.hidden = grupo ? graded === 0 : n === 0;
    clearBtn.textContent = grupo ? 'Borrar calificaciones del grupo' : 'Borrar todos';
    exportBtn.disabled = grupo ? graded === 0 : n === 0;
    sortButtons.forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-sort') === state.sort ? 'true' : 'false');
    });

    var cur = grupo ? currentStudent() : null;
    var frag = document.createDocumentFragment();
    rows.forEach(function (row, i) {
      var r = row.record;
      var ev = row.ev;
      var tr = document.createElement('tr');
      tr.setAttribute('data-id', r.id);
      tr.setAttribute('data-status', ev.status);
      if (r.id === (grupo ? cur && cur.id : state.editingId)) tr.className = 'is-editing';

      tr.appendChild(cell('td', 'c-num', String(i + 1)));
      tr.appendChild(cell('td', 'c-cuenta', r.cuenta || '–'));
      var nameCell = withSub(cell('td', 'c-name', r.name), r.cuenta);
      nameCell.setAttribute('data-num', String(i + 1));
      tr.appendChild(nameCell);
      tr.appendChild(cell('td', 'c-n c-p1', row.g.p1.text || '–', 'P1'));
      tr.appendChild(cell('td', 'c-n c-p2', row.g.p2.text || '–', 'P2'));
      var avg = cell('td', 'c-n c-avg', ev.partialShortText, 'Prom.');
      if (row.graded) avg.title = 'Exacto: ' + ev.partialText;
      tr.appendChild(avg);
      tr.appendChild(cell('td', 'c-n c-pv1' + (ev.needsPv1 ? '' : ' is-na'), vueltaText(ev.needsPv1, r.pv1), '1ª V.'));
      tr.appendChild(cell('td', 'c-n c-pv2' + (ev.needsPv2 ? '' : ' is-na'), vueltaText(ev.needsPv2, r.pv2), '2ª V.'));
      tr.appendChild(cell('td', 'c-n c-exact', ev.exactText != null ? ev.exactText : '–', 'Exacto'));
      tr.appendChild(cell('td', 'c-n c-final', finalText(ev) || '–', 'Final'));
      var faltasCell = withSub(cell('td', 'c-n c-faltas', String(row.faltas), 'Faltas'), row.pct ? row.pct.text + '%' : '');
      var detalleMes = Object.keys(row.faltasMes).map(function (m) { return Acta.MESES[m] + ' ' + row.faltasMes[m]; });
      if (detalleMes.length) faltasCell.title = detalleMes.join(' · ');
      if (ev.excedeFaltas) faltasCell.classList.add('is-over');
      tr.appendChild(faltasCell);

      var statusCell = cell('td', 'c-status');
      var badge = cell('span', 'badge');
      setBadge(badge, ev.status);
      statusCell.appendChild(badge);
      tr.appendChild(statusCell);

      var actions = cell('td', 'c-actions');
      var editLabel = !row.graded ? 'Calificar' : isPending(ev) ? 'Capturar' : 'Editar';
      var edit = cell('button', 'btn-text', editLabel);
      edit.type = 'button';
      edit.setAttribute('data-action', 'edit');
      edit.setAttribute('aria-label', editLabel + ' a ' + r.name);
      actions.appendChild(edit);
      if (!grupo || row.graded || row.faltas || r.p1 || r.p2) {
        var delLabel = grupo ? 'Limpiar' : 'Eliminar';
        var del = cell('button', 'btn-text btn-danger', delLabel);
        del.type = 'button';
        del.setAttribute('data-action', 'delete');
        del.setAttribute('aria-label', (grupo ? 'Borrar calificaciones de ' : 'Eliminar ') + r.name);
        actions.appendChild(del);
      }
      tr.appendChild(actions);

      frag.appendChild(tr);
    });
    tbody.replaceChildren(frag);

    var avgGroup = Grades.groupAverage(rows.filter(function (row) { return row.ev.sumUnits != null; })
      .map(function (row) { return row.ev.sumUnits; }));
    groupAvgEl.textContent = avgGroup == null ? '–' : avgGroup;
  }

  function flashRow(id) {
    if (!id) return;
    var tr = tbody.querySelector('tr[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
    if (!tr) return;
    tr.classList.remove('is-new');
    void tr.offsetWidth; // reinicia la animación
    tr.classList.add('is-new');
  }

  // ---------- Datos del acta ----------

  function initActa() {
    ['a-mesP1', 'a-mesP2'].forEach(function (id) {
      var select = $(id);
      Acta.MESES_LARGOS.forEach(function (m, i) {
        var opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = m;
        select.appendChild(opt);
      });
    });
    actaInputs.forEach(function (input) {
      var key = input.getAttribute('data-acta');
      input.addEventListener('input', function () {
        state.acta[key] = input.value;
        persistActa();
        if (key === 'horas') {
          validateHoras();
          updateResult();
          render();
          renderSessionHeader();
        }
        if (key === 'mesP1' || key === 'mesP2') buildMonthInputs();
        if (key === 'carrera') {
          updateResult();
          render();
          renderSessionHeader();
        }
        updateActaSummary();
      });
    });
  }

  function fillActaInputs() {
    actaInputs.forEach(function (input) {
      var key = input.getAttribute('data-acta');
      input.value = state.acta[key] != null ? state.acta[key] : '';
    });
    validateHoras();
    updateActaSummary();
  }

  function validateHoras() {
    var t = str(state.acta.horas).trim();
    var bad = t !== '' && horasTotales() == null;
    $('e-horas').textContent = bad ? 'Ingresa un número entero de horas.' : '';
    if (bad) $('a-horas').setAttribute('aria-invalid', 'true');
    else $('a-horas').removeAttribute('aria-invalid');
  }

  function updateActaSummary() {
    var a = state.acta;
    var parts = [];
    if (str(a.asignatura).trim()) parts.push(a.asignatura.trim());
    if (str(a.grupo).trim()) parts.push('Grupo ' + a.grupo.trim());
    parts.push('Exenta con ' + exemptionNow() + ' · Máx. ' + absenceLimitNow() + '% de faltas');
    var text = parts.join(' · ');
    if (horasTotales() == null) text = (text ? text + ' · ' : '') + 'Agrega las horas totales para el % de faltas';
    actaSummary.textContent = text;
    actaSummary.classList.toggle('is-warning', horasTotales() == null);
  }

  /** "2026-01-19" → "19/01/2026" */
  function formatDate(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(v));
    return m ? m[3] + '/' + m[2] + '/' + m[1] : str(v);
  }

  /** "10/08/2026" → "2026-08-10" (para el campo de fecha) */
  function isoDate(v) {
    var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(str(v).trim());
    if (!m) return '';
    return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  }

  // ---------- Confirmaciones ----------

  var dialog = $('confirm-dialog');

  function confirmAction(title, message, confirmLabel, safe) {
    if (!dialog || typeof dialog.showModal !== 'function') {
      return Promise.resolve(window.confirm(message ? title + '\n\n' + message : title));
    }
    $('dialog-title').textContent = title;
    $('dialog-message').textContent = message || '';
    $('dialog-message').hidden = !message;
    var confirmBtn = $('dialog-confirm');
    confirmBtn.textContent = confirmLabel;
    confirmBtn.className = 'btn ' + (safe ? 'btn-primary' : 'btn-destructive');
    dialog.returnValue = '';
    var previous = document.activeElement;
    return new Promise(function (resolve) {
      dialog.addEventListener('close', function onClose() {
        dialog.removeEventListener('close', onClose);
        if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
        resolve(dialog.returnValue === 'confirm');
      });
      dialog.showModal();
      $('dialog-cancel').focus();
    });
  }

  // Clic fuera del cuadro de diálogo = cancelar.
  if (dialog) {
    dialog.addEventListener('click', function (e) {
      if (e.target === dialog) dialog.close('cancel');
    });
  }

  // ---------- Exportar ----------

  /** Vuelta para el Excel: número, "NP" o vacío. */
  function vueltaCell(applies, parsed) {
    if (!applies) return '';
    if (parsed.status === 'valid') return parsed.value;
    if (parsed.status === 'np') return NP;
    return '';
  }

  /** Encabezados de la hoja Detalle: una columna de faltas por mes (sin diciembre). */
  function detailHeaders(meses) {
    return ['Número', 'Matrícula', 'Nombre completo', 'Parcial 1', 'Parcial 2']
      .concat(meses.map(function (m) { return 'Faltas ' + Acta.MESES_LARGOS[m]; }), [
        'Promedio parcial (exacto)', 'Prom. (acta)', 'Primera Vuelta', 'Segunda Vuelta', 'Resultado exacto',
        'Calificación final', 'Total de faltas', '% de faltas', 'Estado']);
  }

  function pad(n) {
    return ('0' + n).slice(-2);
  }

  function nowText() {
    var d = new Date();
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /** Nombre de archivo seguro: sin acentos ni caracteres inválidos. */
  function safeFilePart(s) {
    return str(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[ñÑ]/g, function (c) { return c === 'ñ' ? 'n' : 'N'; })
      .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  }

  function exportFileName() {
    if (state.mode !== 'grupo') return FREE_FILE_NAME;
    var g = state.session.grupo;
    var parts = ['Calificaciones', g.grupo, g.asignatura, g.profesor].map(safeFilePart).filter(Boolean);
    var name = parts.join('_');
    if (name.length > 140) name = name.slice(0, 140).replace(/[-_.]+$/, '');
    return name + '.xlsx';
  }

  function infoSheet(rows) {
    var a = state.acta;
    var g = state.mode === 'grupo' ? state.session.grupo : {};
    var data = [
      ['Maestro', g.profesor || a.profesor || ''],
      ['N° de expediente', g.expediente || a.expediente || ''],
      ['Grupo', g.grupo || a.grupo || ''],
      ['Asignatura', g.asignatura || a.asignatura || ''],
      ['Clave de asignatura', g.claveAsignatura || a.claveAsignatura || ''],
      ['Licenciatura', g.carrera || a.carrera || ''],
      ['Ciclo escolar', g.ciclo || a.ciclo || ''],
      ['Total de horas', horasTotales() != null ? horasTotales() : ''],
      ['Fecha de captura', nowText()],
      ['Alumnos', rows.length],
      ['Calificados', rows.filter(function (r) { return r.graded; }).length],
    ];
    if (g.archivo) data.push(['Archivo de origen', g.archivo]);
    return Xlsx.tableSheet({ name: 'Información', headers: ['Dato', 'Valor'], rows: data });
  }

  function buildExcel() {
    var computed = orderedRows();
    var meses = currentMonths();
    var rows = computed.map(function (row, i) {
      var ev = row.ev;
      var r = row.record;
      var pv1 = vueltaCell(ev.needsPv1, row.g.pv1);
      var pv2 = vueltaCell(ev.needsPv2, row.g.pv2);
      var final = ev.final != null ? ev.final : ev.finalText || '';
      var pct = row.pct ? row.pct.fraction : null;
      var prom = ev.partialShort != null ? ev.partialShort : ev.parcialesNp ? NP : '';
      var p1 = vueltaCell(true, row.g.p1);
      var p2 = vueltaCell(true, row.g.p2);
      return {
        numero: i + 1,
        cuenta: r.cuenta,
        nombre: r.name,
        p1: p1,
        p2: p2,
        faltasMes: row.faltasMes,
        prom: prom,
        pv1: pv1,
        pv2: pv2,
        totalFaltas: row.faltas,
        pctFaltas: pct,
        final: final,
        detalle: [i + 1, r.cuenta, r.name, p1, p2]
          .concat(meses.map(function (m) { return row.faltasMes[m] || 0; }), [
            ev.partial != null ? ev.partial : '', prom, pv1, pv2, ev.exact != null ? ev.exact : '', final, row.faltas,
            pct == null ? '' : pct, STATUS[ev.status]]),
      };
    });
    var a = state.acta;
    var info = {};
    Object.keys(a).forEach(function (k) { info[k] = a[k]; });
    info.fechaInicio = formatDate(a.fechaInicio);
    info.fechaTermino = formatDate(a.fechaTermino);
    var headers = detailHeaders(meses);
    var formats = [];
    formats[headers.indexOf('% de faltas')] = '0.0%';
    return Acta.buildActa(info, rows, headers, formats, [infoSheet(computed)]);
  }

  function markExported() {
    if (state.mode === 'grupo' && state.session) {
      state.session.exportado = new Date().toISOString();
      persist(false);
    }
  }

  function exportExcel() {
    if (!state.records.length) return;
    var fileName = exportFileName();
    var blob = new Blob([buildExcel()], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    // Publicada en claude.ai, la descarga pasa por la capacidad "downloads";
    // abierta como archivo local, se descarga directamente.
    if (window.claude && typeof window.claude.use === 'function') {
      exportBtn.disabled = true;
      window.claude.use('downloads').then(function (downloads) {
        if (!downloads) {
          showStatus('La descarga no está disponible en esta vista.', true);
          return;
        }
        return downloads.save({ filename: fileName, data: blob }).then(function () {
          markExported();
          showStatus('Excel descargado: ' + fileName);
        }, function (err) {
          if (err && err.code === 'declined') return;
          showStatus('No se pudo descargar el Excel. Intenta de nuevo.', true);
        });
      }).then(function () {
        render();
      }, function () {
        render();
        showStatus('No se pudo descargar el Excel. Intenta de nuevo.', true);
      });
      return;
    }

    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    markExported();
    showStatus('Excel descargado: ' + fileName);
  }

  // ---------- Modos: captura libre y captura por grupo ----------

  function setView(view) {
    setupView.hidden = view !== 'setup';
    captureView.hidden = view !== 'capture';
    document.title = view === 'setup' ? 'Configurar grupo' : 'Calculadora de calificaciones';
    window.scrollTo(0, 0);
  }

  function applyModeChrome() {
    var grupo = state.mode === 'grupo';
    $('session-header').hidden = !grupo;
    $('free-header').hidden = grupo;
    studentHead.hidden = !grupo;
    identity.hidden = grupo;
    editBanner.hidden = true;
    state.editingId = null;
    $('acta').open = false;
    renderSessionHeader();
  }

  function renderSessionHeader() {
    if (state.mode !== 'grupo' || !state.session) return;
    var g = state.session.grupo;
    $('session-eyebrow').textContent = ['Grupo ' + g.grupo, g.carrera].filter(Boolean).join(' · ');
    $('session-title').textContent = g.asignatura || 'Grupo ' + g.grupo;
    var horas = horasTotales();
    $('session-meta').textContent = [g.profesor, horas ? horas + ' horas' : '', 'Exenta con ' + exemptionNow(), 'Máx. ' + absenceLimitNow() + '% de faltas']
      .filter(Boolean).join(' · ');
  }

  function enterFree() {
    state.mode = 'libre';
    state.session = null;
    var data = readJSON(FREE_KEY);
    state.records = data && Array.isArray(data.records)
      ? data.records.map(function (r) { return normalizeRecord(r, false); }).filter(Boolean)
      : [];
    state.sort = data && ['none', 'name', 'grade'].indexOf(data.sort) !== -1 ? data.sort : 'none';
    var acta = readJSON(FREE_ACTA_KEY);
    state.acta = { mesP1: '1', mesP2: '3' };
    if (acta && typeof acta === 'object') Object.keys(acta).forEach(function (k) { state.acta[k] = str(acta[k]); });
    buildMonthInputs();
    if (migrateFaltas(state.records)) persist(false);
    writeJSON(ACTIVE_KEY, 'libre');
    applyModeChrome();
    fillActaInputs();
    clearForm();
    render();
    updatePlaceholder();
    setView('capture');
    cuentaInput.focus();
  }

  /** Datos del encabezado del acta a partir del grupo importado. */
  function actaFromGroup(g, horas) {
    var meses = g.meses && g.meses.length ? g.meses : [1, 2, 3, 4, 5];
    return {
      institucion: g.institucion || '',
      claveInstitucion: g.claveInstitucion || '',
      carrera: g.carrera || '',
      profesor: g.profesor || '',
      expediente: g.expediente || '',
      horas: str(horas),
      asignatura: g.asignatura || '',
      claveAsignatura: g.claveAsignatura || '',
      grupo: g.grupo || '',
      ciclo: g.ciclo || '',
      semestre: '',
      nivel: '',
      fechaInicio: isoDate(g.fechaInicio),
      fechaTermino: '',
      mesP1: String(meses[0]),
      mesP2: String(meses[Math.min(2, meses.length - 1)]),
    };
  }

  function groupSnapshot(g) {
    return {
      id: g.id, maestroId: g.maestroId, profesor: g.profesor, expediente: g.expediente, carrera: g.carrera,
      grupo: g.grupo, asignatura: g.asignatura, claveAsignatura: g.claveAsignatura, ciclo: g.ciclo, archivo: g.archivo,
    };
  }

  function loadSession(id) {
    var data = readJSON(sessionKey(id));
    if (!data || !Array.isArray(data.records) || !data.grupo) return null;
    data.records = data.records.map(function (r) { return normalizeRecord(r, true); }).filter(Boolean);
    return data;
  }

  /** Abre (o crea) la sesión del grupo. catalogGroup puede faltar al reanudar sin catálogo. */
  function enterGroup(id, catalogGroup, horas) {
    var data = loadSession(id);
    var g = catalogGroup || (data && data.grupo);
    if (!g) return false;

    var records = data ? data.records : [];
    if (catalogGroup) {
      // Sincroniza la lista con el acta: agrega alumnos nuevos y actualiza nombres; no borra calificaciones.
      var byCuenta = {};
      records.forEach(function (r) { if (r.cuenta) byCuenta[r.cuenta] = r; });
      var ordered = [];
      catalogGroup.alumnos.forEach(function (cuenta) {
        var nombre = state.catalog.alumnos[cuenta] || '';
        var rec = byCuenta[cuenta];
        if (rec) {
          rec.name = nombre || rec.name;
          rec.fijo = true;
          delete byCuenta[cuenta];
        } else {
          rec = { id: 'a-' + cuenta, cuenta: cuenta, name: nombre, fijo: true, p1: '', p2: '', pv1: '', pv2: '' };
        }
        ordered.push(rec);
      });
      records.forEach(function (r) { if (!r.cuenta || byCuenta[r.cuenta] === r) ordered.push(r); });
      records = ordered;
    }

    state.mode = 'grupo';
    state.records = records;
    state.sort = data && ['none', 'name', 'grade'].indexOf(data.sort) !== -1 ? data.sort : 'none';
    state.acta = data && data.acta ? data.acta : actaFromGroup(g, horas);
    if (horas != null) state.acta.horas = str(horas);
    state.session = {
      id: id,
      grupo: catalogGroup ? groupSnapshot(catalogGroup) : data.grupo,
      horas: str(state.acta.horas),
      modificado: data ? data.modificado : null,
      exportado: data ? data.exportado : null,
      pos: data && data.pos >= 0 && data.pos < records.length ? data.pos : 0,
    };
    buildMonthInputs();
    migrateFaltas(state.records);
    persist(false);
    writeJSON(ACTIVE_KEY, id);
    writeJSON(LAST_KEY, { maestroId: state.session.grupo.maestroId, grupoId: id });

    applyModeChrome();
    fillActaInputs();
    render();
    setView('capture');
    var start = state.session.pos;
    if (!data || !data.modificado) start = 0;
    showStudent(start);
    return true;
  }

  function hasUnexported() {
    var s = state.session;
    return !!(s && s.modificado && (!s.exportado || s.modificado > s.exportado));
  }

  function leaveToSetup() {
    var proceed = function () {
      writeJSON(ACTIVE_KEY, 'setup');
      showSetup();
    };
    if (state.mode !== 'grupo') {
      if (state.editingId) exitEdit(false);
      return proceed();
    }
    var dirty = formDirty();
    if (!dirty && !hasUnexported()) return proceed();
    var cur = currentStudent();
    var msgs = [];
    if (dirty && cur) msgs.push('Lo que escribiste para ' + cur.name + ' y no guardaste se perderá.');
    if (hasUnexported()) msgs.push('Hay calificaciones sin exportar a Excel. Quedan guardadas en este navegador y las verás al volver a este grupo.');
    confirmAction('¿Cambiar de grupo?', msgs.join(' '), 'Cambiar grupo', true).then(function (ok) {
      if (ok) proceed();
    });
  }

  // ---------- Pantalla inicial: configurar grupo ----------

  var teachers = [];
  var selected = { maestro: null, grupo: null };
  var maestroCB, grupoCB;

  function setCatalog(catalog) {
    state.catalog = catalog;
    teachers = catalog ? Catalogo.teachers(catalog) : [];
  }

  function teacherById(id) {
    for (var i = 0; i < teachers.length; i++) if (teachers[i].id === id) return teachers[i];
    return null;
  }

  function groupById(id) {
    if (!state.catalog) return null;
    for (var i = 0; i < state.catalog.grupos.length; i++) if (state.catalog.grupos[i].id === id) return state.catalog.grupos[i];
    return null;
  }

  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  function initSetup() {
    maestroCB = new Combobox($('s-maestro'), $('s-maestro-list'), {
      empty: 'Ningún maestro coincide',
      onEnter: function () { if (!$('s-grupo').disabled) $('s-grupo').focus(); },
      options: function () {
        return teachers.map(function (t) {
          return {
            id: t.id,
            label: t.nombre,
            detail: plural(t.grupos.length, 'grupo', 'grupos') + (t.expediente ? ' · Exp. ' + t.expediente : ''),
            search: t.nombre + ' ' + t.expediente,
          };
        });
      },
      onSelect: function (o, advance) {
        selected.maestro = o ? teacherById(o.id) : null;
        selected.grupo = null;
        grupoCB.reset();
        var gi = $('s-grupo');
        gi.disabled = !selected.maestro;
        gi.placeholder = selected.maestro ? 'Busca por grupo o materia' : 'Primero elige un maestro';
        if (selected.maestro && selected.maestro.grupos.length === 1) {
          var only = grupoCB.selectId(selected.maestro.grupos[0].id);
          selectGroup(only, advance);
        } else if (selected.maestro && advance) {
          gi.focus();
        }
        updateSetupSummary();
      },
    });
    grupoCB = new Combobox($('s-grupo'), $('s-grupo-list'), {
      empty: 'Ningún grupo coincide',
      onEnter: function () { if (setupHoras() != null) startCapture(); else $('s-horas').focus(); },
      options: function () {
        if (!selected.maestro) return [];
        return selected.maestro.grupos.map(function (g) {
          return {
            id: g.id,
            label: g.grupo + ' · ' + g.asignatura,
            detail: [g.carrera, plural(g.alumnos.length, 'alumno', 'alumnos')].filter(Boolean).join(' · '),
            search: [g.grupo, g.asignatura, g.carrera, g.claveAsignatura].join(' '),
          };
        });
      },
      onSelect: function (o, advance) { selectGroup(o, advance); },
    });

    var horasInput = $('s-horas');
    horasInput.addEventListener('input', function () {
      validateSetupHoras(false);
      updateSetupSummary();
    });
    horasInput.addEventListener('blur', function () { validateSetupHoras(true); });

    $('setup-form').addEventListener('submit', function (e) {
      e.preventDefault();
      startCapture();
    });
    $('start-btn').addEventListener('click', function (e) {
      e.preventDefault();
      startCapture();
    });

    $('import-btn').addEventListener('click', function () { $('import-input').click(); });
    $('reimport-btn').addEventListener('click', function () { $('import-input').click(); });
    $('import-input').addEventListener('change', function () {
      var files = Array.prototype.slice.call(this.files || []);
      this.value = '';
      if (files.length) importFiles(files);
    });
    var card = $('setup-card');
    card.addEventListener('dragover', function (e) {
      e.preventDefault();
      card.classList.add('is-dragging');
    });
    card.addEventListener('dragleave', function (e) {
      if (!card.contains(e.relatedTarget)) card.classList.remove('is-dragging');
    });
    card.addEventListener('drop', function (e) {
      e.preventDefault();
      card.classList.remove('is-dragging');
      var files = Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.files) || []);
      if (files.length) importFiles(files);
    });
    $('free-btn').addEventListener('click', enterFree);
  }

  function selectGroup(o, advance) {
    selected.grupo = o ? groupById(o.id) : null;
    var horasInput = $('s-horas');
    // Cada grupo recuerda sus horas.
    var prev = selected.grupo && loadSession(selected.grupo.id);
    if (prev && prev.horas) horasInput.value = prev.horas;
    validateSetupHoras(false);
    updateSetupSummary();
    if (selected.grupo && advance) {
      if (setupHoras() != null) $('start-btn').focus();
      else horasInput.focus();
    }
  }

  function setupHoras() {
    var t = $('s-horas').value.trim();
    return /^\d{1,4}$/.test(t) && Number(t) > 0 ? Number(t) : null;
  }

  function validateSetupHoras(onBlur) {
    var t = $('s-horas').value.trim();
    var bad = t !== '' && setupHoras() == null;
    var msg = bad ? 'Ingresa un número entero mayor a 0.' : '';
    // Mientras escribe solo se marca lo claramente inválido; al salir, también el cero.
    if (!onBlur && /^0+$/.test(t)) msg = '';
    $('e-s-horas').textContent = msg;
    if (msg) $('s-horas').setAttribute('aria-invalid', 'true');
    else $('s-horas').removeAttribute('aria-invalid');
  }

  function updateSetupSummary() {
    var t = selected.maestro, g = selected.grupo, h = setupHoras();
    var ready = !!(t && g && h);
    $('start-btn').disabled = !ready;
    var box = $('setup-summary');
    box.hidden = !(t && g);
    if (!(t && g)) return;
    $('sum-maestro').textContent = t.nombre;
    $('sum-grupo').textContent = g.grupo;
    $('sum-asignatura').textContent = g.asignatura + (g.claveAsignatura ? ' (' + g.claveAsignatura + ')' : '');
    $('sum-carrera').textContent = g.carrera;
    $('sum-carrera-row').hidden = !g.carrera;
    $('sum-horas').textContent = h ? h + ' horas' : 'Falta indicarlo';
    $('sum-horas').classList.toggle('is-missing', !h);
    $('sum-alumnos').textContent = String(g.alumnos.length);
    var prev = loadSession(g.id);
    var graded = prev ? prev.records.filter(function (r) { return compute(r).graded; }).length : 0;
    $('sum-avance-row').hidden = !graded;
    $('sum-avance').textContent = graded + ' de ' + (prev ? prev.records.length : g.alumnos.length);
  }

  function startCapture() {
    validateSetupHoras(true);
    var g = selected.grupo, h = setupHoras();
    if (!selected.maestro) return $('s-maestro').focus();
    if (!g) return $('s-grupo').focus();
    if (!h) return $('s-horas').focus();
    enterGroup(g.id, g, h);
  }

  function renderCatalogInfo() {
    var has = !!(state.catalog && state.catalog.grupos.length);
    $('import-empty').hidden = has;
    $('setup-form').hidden = !has;
    $('reimport-btn').hidden = !has;
    var info = $('catalog-info');
    info.hidden = !has;
    if (has) {
      var s = Catalogo.summary(state.catalog);
      info.textContent = plural(s.grupos, 'grupo', 'grupos') + ' de ' + plural(s.maestros, 'maestro', 'maestros') + ' · ' +
        plural(s.alumnos, 'alumno', 'alumnos') + ' · ' + plural(s.archivos, 'archivo', 'archivos');
    }
  }

  function showSetup() {
    state.mode = null;
    renderCatalogInfo();
    setView('setup');
    selected.maestro = null;
    selected.grupo = null;
    if (!maestroCB) return;
    maestroCB.reset();
    grupoCB.reset();
    $('s-grupo').disabled = true;
    $('s-grupo').placeholder = 'Primero elige un maestro';
    $('s-horas').value = '';
    validateSetupHoras(false);

    // Restaura la última elección para continuar en un paso.
    var last = readJSON(LAST_KEY);
    if (last && state.catalog) {
      var t = teacherById(last.maestroId);
      if (t && maestroCB.selectId(t.id)) {
        selected.maestro = t;
        $('s-grupo').disabled = false;
        $('s-grupo').placeholder = 'Busca por grupo o materia';
        var g = grupoCB.selectId(last.grupoId);
        if (g) selectGroup(g, false);
      }
    }
    updateSetupSummary();
    var focusEl = !selected.maestro ? $('s-maestro') : !selected.grupo ? $('s-grupo') : setupHoras() ? $('start-btn') : $('s-horas');
    if (!$('setup-form').hidden) focusEl.focus({ preventScroll: true });
    else $('import-btn').focus({ preventScroll: true });
  }

  function importFiles(fileList) {
    var status = $('import-status');
    status.className = 'import-status is-busy';
    status.textContent = 'Leyendo archivos…';
    Promise.all(fileList.map(function (f) {
      return f.arrayBuffer().then(function (buf) { return { name: f.name, data: new Uint8Array(buf) }; });
    })).then(function (files) {
      return Catalogo.importFiles(files, Importar);
    }).then(function (res) {
      var cat = res.catalog;
      if (!cat.grupos.length) {
        status.className = 'import-status is-error';
        status.textContent = 'No encontré actas económicas con alumnos en esos archivos.';
        appendIgnored(status, res.ignorados);
        return;
      }
      var saved = writeJSON(CATALOG_KEY, cat);
      setCatalog(cat);
      var s = Catalogo.summary(cat);
      showSetup();
      status.className = 'import-status is-done';
      status.textContent = 'Listo: ' + plural(s.grupos, 'grupo', 'grupos') + ' de ' + plural(s.maestros, 'maestro', 'maestros') +
        ' y ' + plural(s.alumnos, 'alumno', 'alumnos') + '.' +
        (saved ? '' : ' No se pudieron guardar en este navegador; tendrás que importarlos de nuevo al recargar.');
      appendIgnored(status, res.ignorados, cat.avisos);
    }).catch(function (err) {
      status.className = 'import-status is-error';
      status.textContent = 'No se pudieron leer los archivos. ' + (err && err.message ? err.message : '');
    });
  }

  function appendIgnored(el, ignorados, avisos) {
    var items = (ignorados || []).map(function (i) { return i.archivo + ': ' + i.motivo; }).concat(avisos || []);
    if (!items.length) return;
    var d = document.createElement('details');
    var sm = document.createElement('summary');
    sm.textContent = plural(items.length, 'detalle', 'detalles') + ' de la importación';
    d.appendChild(sm);
    var ul = document.createElement('ul');
    items.forEach(function (t) {
      var li = document.createElement('li');
      li.textContent = t;
      ul.appendChild(li);
    });
    d.appendChild(ul);
    el.appendChild(d);
  }

  // ---------- Eventos ----------

  function bindInput(k) {
    inputs[k].addEventListener('input', function () {
      validateLive(k);
      updateResult();
    });
    inputs[k].addEventListener('blur', function () { validateLive(k); });
  }

  GRADE_KEYS.forEach(bindInput);

  npButtons.forEach(function (b) {
    b.addEventListener('click', function () {
      var key = b.getAttribute('data-np');
      var input = inputs[key];
      if (input.disabled) return;
      var isNp = input.value.trim().toUpperCase() === NP;
      input.value = isNp ? '' : NP;
      validateLive(key);
      updateResult();
      // Al marcar NP se continúa en el siguiente campo disponible.
      var next = isNp ? input : nextField(input) || input;
      next.focus();
      next.select();
    });
  });

  function isAvailable(el) {
    return !el.disabled && !el.closest('[hidden]');
  }

  function nextField(input) {
    var order = fieldOrder();
    for (var j = order.indexOf(input) + 1; j > 0 && j < order.length; j++) {
      if (isAvailable(order[j])) return order[j];
    }
    return null;
  }

  // Enter avanza al siguiente campo habilitado; si ya no hay más, guarda.
  form.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.isComposing || fieldOrder().indexOf(e.target) < 0) return;
    e.preventDefault();
    updateResult();
    var next = nextField(e.target);
    if (next) {
      next.focus();
      next.select();
    } else {
      save();
    }
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    save();
  });

  form.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.mode === 'libre' && state.editingId) {
      e.preventDefault();
      exitEdit(true);
    }
    if (state.mode === 'grupo' && (e.key === 'PageUp' || e.key === 'PageDown')) {
      e.preventDefault();
      goTo(state.session.pos + (e.key === 'PageUp' ? -1 : 1));
    }
  });

  $('prev-btn').addEventListener('click', function () { goTo(state.session.pos - 1); });
  $('next-btn').addEventListener('click', function () { goTo(state.session.pos + 1); });
  $('change-group').addEventListener('click', leaveToSetup);
  $('choose-group').addEventListener('click', leaveToSetup);

  $('acta-form').addEventListener('submit', function (e) { e.preventDefault(); });

  $('cancel-edit').addEventListener('click', function () { exitEdit(true); });

  tbody.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-action]');
    if (!btn) return;
    var id = btn.closest('tr').getAttribute('data-id');
    var rec = findRecord(id);
    if (!rec) return;
    var action = btn.getAttribute('data-action');

    if (action === 'edit') {
      if (state.mode === 'grupo') {
        var ev = compute(rec).ev;
        goTo(indexOfRecord(id), ev.status === 'pendiente1' ? 'pv1' : ev.status === 'pendiente2' ? 'pv2' : 'p1');
        scrollToCapture();
      } else {
        startEdit(id);
      }
      return;
    }

    if (state.mode === 'grupo') {
      confirmAction('¿Borrar las calificaciones de este alumno?', rec.name, 'Borrar').then(function (ok) {
        if (!ok) return;
        clearGrades(rec);
        persist();
        render();
        if (currentStudent() === rec) fillForm(rec);
        showStatus('Calificaciones de ' + rec.name + ' borradas');
      });
      return;
    }

    confirmAction('¿Eliminar este alumno?', rec.name, 'Eliminar').then(function (ok) {
      if (!ok) return;
      state.records = state.records.filter(function (r) { return r.id !== id; });
      if (state.editingId === id) exitEdit(true);
      persist();
      render();
      updatePlaceholder();
      showStatus(rec.name + ' eliminado');
    });
  });

  sortButtons.forEach(function (b) {
    b.addEventListener('click', function () {
      state.sort = b.getAttribute('data-sort');
      persist(false);
      render();
    });
  });

  exportBtn.addEventListener('click', exportExcel);

  clearBtn.addEventListener('click', function () {
    var grupo = state.mode === 'grupo';
    confirmAction(
      grupo ? '¿Borrar todas las calificaciones de este grupo?' : '¿Seguro que quieres eliminar todas las calificaciones?',
      grupo ? 'La lista de alumnos se conserva. Esta acción no se puede deshacer.' : 'Esta acción no se puede deshacer.',
      grupo ? 'Borrar calificaciones' : 'Borrar todos'
    ).then(function (ok) {
      if (!ok) return;
      if (grupo) {
        state.records.forEach(function (r) {
          clearGrades(r);
        });
        persist();
        render();
        showStudent(0);
        return;
      }
      state.records = [];
      if (state.editingId) exitEdit(false);
      clearForm();
      persist();
      render();
      updatePlaceholder();
      cuentaInput.focus();
    });
  });

  // Si otra pestaña modifica los datos de lo que está abierto, mantener esta sincronizada.
  window.addEventListener('storage', function (e) {
    if (state.mode === 'libre' && e.key === FREE_KEY) {
      var data = readJSON(FREE_KEY);
      state.records = data && Array.isArray(data.records)
        ? data.records.map(function (r) { return normalizeRecord(r, false); }).filter(Boolean)
        : [];
      if (state.editingId && !findRecord(state.editingId)) exitEdit(true);
      render();
      updatePlaceholder();
    } else if (state.mode === 'grupo' && state.session && e.key === sessionKey(state.session.id)) {
      var s = loadSession(state.session.id);
      if (!s) return;
      state.records = s.records;
      render();
      if (!formDirty()) fillForm(currentStudent() || {});
    } else if (e.key === CATALOG_KEY && state.mode === null) {
      setCatalog(readJSON(CATALOG_KEY));
      showSetup();
    }
  });

  // ---------- Inicio ----------

  initActa();
  setCatalog(readJSON(CATALOG_KEY) || window.CATALOGO_INCLUIDO || null);
  initSetup();

  (function boot() {
    var active = readJSON(ACTIVE_KEY);
    if (active === 'libre') return enterFree();
    if (active === 'setup') return showSetup();
    if (active && enterGroup(active, groupById(active), null)) return;
    // Quien ya capturaba sin grupo (versiones anteriores) sigue viendo sus datos.
    if (!active) {
      var free = readJSON(FREE_KEY);
      if (free && Array.isArray(free.records) && free.records.length) return enterFree();
    }
    showSetup();
  })();
})();
