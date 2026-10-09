/*
 * Cálculo de calificaciones con aritmética entera exacta.
 *
 * Cada calificación se convierte a "unidades" de 1/10 000 (hasta 4 decimales),
 * así ninguna operación intermedia sufre errores de punto flotante
 * (p. ej. un 8.5 exacto que en flotante quedaría como 8.4999999).
 *
 *   promedioParcial = (p1 + p2) / 2                       → nunca se redondea para calcular
 *   · NP en un parcial cuenta como 0; NP en los dos → "NP", sin derecho a vueltas
 *   · faltas > 20% de las horas (Enfermería: > 10%) → final 5, sin exención ni vueltas
 *     (salvo NP en los dos parciales, que sigue siendo "NP")
 *   · promedioParcial ≥ 8 (Enfermería: ≥ 9) → exento; final = promedioParcial redondeado
 *   · si no: resultado = (promedioParcial + primeraVuelta) / 2
 *       resultado ≥ 6 (exacto) → aprobado; final = resultado redondeado
 *   · si no (o NP): resultado = (promedioParcial + segundaVuelta) / 2
 *       resultado ≥ 6 → aprobado en 2ª vuelta; final = resultado redondeado
 *       resultado < 6 o NP → reprobado / no presentó; final = 5
 *
 * Redondeo: .5 o más sube. En pantalla y en el acta el promedio parcial se muestra
 * con un decimal, cortando el resto (7.75 → 7.7), como se registra en el acta.
 */
(function (root) {
  'use strict';

  var DECIMALS = 4; // precisión interna
  var SCALE = 10000; // 10^DECIMALS
  var INPUT_DECIMALS = 1; // las calificaciones se registran con un decimal como máximo
  var MAX_UNITS = 10 * SCALE;

  var MESSAGES = {
    empty: 'Ingresa una calificación entre 0 y 10.',
    range: 'Ingresa una calificación entre 0 y 10.',
    notNumber: 'Solo se permiten números, por ejemplo 8.5.',
    decimals: 'Usa solo un decimal, por ejemplo 5.6.',
  };

  /** Convierte un entero n que representa n / 10^decimals en texto, sin ceros sobrantes. */
  function formatScaled(n, decimals) {
    var s = String(n);
    while (s.length < decimals + 1) s = '0' + s;
    var intPart = s.slice(0, s.length - decimals);
    var frac = s.slice(s.length - decimals).replace(/0+$/, '');
    return frac ? intPart + '.' + frac : intPart;
  }

  /**
   * Interpreta lo que el usuario escribió. Acepta punto o coma decimal y, por omisión,
   * un decimal como máximo (los ceros finales no cuentan: 9.50 = 9.5).
   * maxDecimals permite leer datos guardados con más precisión.
   * Devuelve { status: 'empty' | 'invalid' | 'valid', ... }.
   */
  function parseGrade(raw, maxDecimals) {
    var limit = maxDecimals == null ? INPUT_DECIMALS : Math.min(maxDecimals, DECIMALS);
    var text = String(raw == null ? '' : raw).trim().replace(',', '.');
    if (text === '') return { status: 'empty', error: MESSAGES.empty };
    if (/^-\s*\d/.test(text)) return { status: 'invalid', error: MESSAGES.range };

    var m = /^(\d*)(?:\.(\d*))?$/.exec(text);
    if (!m || (m[1] === '' && !m[2])) return { status: 'invalid', error: MESSAGES.notNumber };

    var intPart = m[1].replace(/^0+(?=\d)/, '') || '0';
    var frac = (m[2] || '').replace(/0+$/, '');
    if (intPart.length > 2) return { status: 'invalid', error: MESSAGES.range };
    if (frac.length > limit) {
      return { status: 'invalid', error: MESSAGES.decimals };
    }
    while (frac.length < DECIMALS) frac += '0';

    var units = Number(intPart) * SCALE + Number(frac);
    if (units > MAX_UNITS) return { status: 'invalid', error: MESSAGES.range };

    var canonical = formatScaled(units, DECIMALS);
    return { status: 'valid', units: units, text: canonical, value: Number(canonical) };
  }

  /**
   * Promedio parcial a partir de unidades. text/value son exactos; shortText/shortValue
   * lo muestran con un decimal, cortando el resto (como en el acta).
   */
  function partialAverage(u1, u2) {
    // (u1 + u2) / 2 / SCALE  =  (u1 + u2) * 5 / 10^(DECIMALS + 1)
    var text = formatScaled((u1 + u2) * 5, DECIMALS + 1);
    // décimas truncadas = floor((u1 + u2) / 2 / (SCALE / 10))
    var shortText = formatScaled(Math.floor((u1 + u2) / (SCALE / 5)), 1);
    return { text: text, value: Number(text), shortText: shortText, shortValue: Number(shortText) };
  }

  var NP = 'NP'; // "No presentó", válido solo en las vueltas

  /** Como parseGrade, pero acepta también "NP" (no presentó). */
  function parseVuelta(raw, maxDecimals) {
    if (String(raw == null ? '' : raw).trim().toUpperCase() === NP) {
      return { status: 'np', text: NP, value: NP };
    }
    return parseGrade(raw, maxDecimals);
  }

  /** Faltas: entero de 0 a 999; vacío cuenta como 0. */
  function parseFaltas(raw) {
    var text = String(raw == null ? '' : raw).trim();
    if (text === '') return { status: 'empty', value: 0, text: '' };
    if (!/^\d{1,3}$/.test(text)) return { status: 'invalid', error: 'Ingresa un número entero de faltas.' };
    var n = Number(text);
    return { status: 'valid', value: n, text: String(n) };
  }

  /**
   * Porcentaje de faltas = faltas / horas totales, redondeado a una décima de punto porcentual.
   * Devuelve { fraction, text } (fraction 0.0625 → text "6.3") o null si no hay horas.
   */
  function absencePercent(faltas, horas) {
    if (!horas || horas <= 0) return null;
    // décimas de % = faltas·1000 / horas, redondeo .5 hacia arriba en enteros
    var tenths = Math.floor((2 * faltas * 1000 + horas) / (2 * horas));
    return { fraction: tenths / 1000, text: formatScaled(tenths, 1) };
  }

  /** Calcula todo a partir de las unidades de las tres calificaciones. */
  function calculate(u1, u2, u3) {
    var partial = partialAverage(u1, u2);
    // resultadoExacto = (u1 + u2 + 2·u3) / (4·SCALE)
    var sum = u1 + u2 + 2 * u3;
    var exactText = formatScaled(sum * 25, DECIMALS + 2); // sum / (4·10^4) = sum·25 / 10^6
    // Redondeo .5 hacia arriba: floor(x + 0.5) = floor((sum + 2·SCALE) / (4·SCALE)), en enteros.
    var final = Math.floor((sum + 2 * SCALE) / (4 * SCALE));
    return {
      partial: partial.value,
      partialText: partial.text,
      exact: Number(exactText),
      exactText: exactText,
      final: final,
      sumUnits: sum,
    };
  }

  // Promedio parcial mínimo para exentar: 8 en todas las licenciaturas (y CCH); 9 en Enfermería.
  var EXEMPT_DEFAULT = 9;

  /** Calificación con la que se exenta según la licenciatura. */
  function exemptionGrade(carrera) {
    var t = String(carrera || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    return /ENFERMER/.test(t) ? 9 : 8;
  }

  /** Porcentaje máximo de faltas: 20% en todas las licenciaturas; 10% en Enfermería. */
  function absenceLimit(carrera) {
    var t = String(carrera || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    return /ENFERMER/.test(t) ? 10 : 20;
  }

  /** ¿Rebasa el límite? Compara en enteros: faltas / horas > límite %  ⇔  faltas·100 > límite·horas. */
  function exceedsAbsences(faltas, horas, limite) {
    if (!horas || horas <= 0) return false;
    return faltas * 100 > limite * horas;
  }
  var PASS_UNITS = 6 * SCALE; // resultado mínimo para aprobar
  var FAIL_GRADE = 5; // calificación que se registra al reprobar o no presentarse

  var STATUS_LABELS = {
    exento: 'Exento',
    faltas: 'Rebasó faltas',
    sinderecho: 'NP · sin derecho a vueltas',
    aprobado: 'Aprobado',
    aprobado2: 'Aprobado en 2ª vuelta',
    reprobado: 'Reprobado',
    np: 'No presentó',
    pendiente1: 'Falta Primera Vuelta',
    pendiente2: 'Falta Segunda Vuelta',
  };

  /**
   * Aplica las reglas de exención y vueltas.
   * u1 / u2: unidades o NP. pv1 / pv2: unidades, NP ("no presentó") o null si no se capturaron.
   *
   * Devuelve:
   *   status       exento | aprobado | aprobado2 | reprobado | np | pendiente1 | pendiente2
   *   final        calificación final, o null si está pendiente
   *   exactText    valor exacto que se redondea (null si pendiente o si se registra 5 por NP)
   *   sumUnits     4 × valor usado para el promedio del grupo, en unidades (null si pendiente)
   *   needsPv1     se requiere Primera Vuelta
   *   needsPv2     se requiere Segunda Vuelta
   *   first        cálculo de Primera Vuelta, si se capturó una calificación
   */
  function evaluate(u1, u2, pv1, pv2, exento, excedeFaltas) {
    var exemptUnits = (exento || EXEMPT_DEFAULT) * SCALE;
    // NP en los dos parciales: el acta dice NP y no tiene derecho a Primera ni Segunda Vuelta.
    if (u1 === NP && u2 === NP) {
      return {
        status: 'sinderecho', parcialesNp: true, partial: null, partialText: 'NP', partialShort: null, partialShortText: 'NP',
        needsPv1: false, needsPv2: false, first: null, exact: null, exactText: null,
        sumUnits: null, final: null, finalText: NP,
      };
    }
    // NP en un parcial cuenta como 0 (con eso ya no puede exentar).
    var npParcial = u1 === NP ? 1 : u2 === NP ? 2 : 0;
    if (u1 === NP) u1 = 0;
    if (u2 === NP) u2 = 0;
    var partial = partialAverage(u1, u2);
    // Rebasó el límite de faltas: sin exención ni vueltas; se registra 5.
    if (excedeFaltas) {
      return {
        status: 'faltas', excedeFaltas: true, npParcial: npParcial,
        partial: partial.value, partialText: partial.text, partialShort: partial.shortValue, partialShortText: partial.shortText,
        needsPv1: false, needsPv2: false, first: null, exact: null, exactText: null,
        sumUnits: 4 * FAIL_GRADE * SCALE, final: FAIL_GRADE,
      };
    }
    var base = {
      npParcial: npParcial,
      partial: partial.value,
      partialText: partial.text,
      partialShort: partial.shortValue,
      partialShortText: partial.shortText,
      needsPv1: false,
      needsPv2: false,
      first: null,
      exact: null,
      exactText: null,
      sumUnits: null,
      final: null,
    };

    base.exentoCon = exento || EXEMPT_DEFAULT;
    // promedioParcial ≥ exento  ⇔  u1 + u2 ≥ 2·exento·SCALE
    if (u1 + u2 >= 2 * exemptUnits) {
      base.status = 'exento';
      base.exact = partial.value;
      base.exactText = partial.text;
      base.sumUnits = 2 * (u1 + u2);
      base.final = Math.floor((u1 + u2 + SCALE) / (2 * SCALE));
      return base;
    }

    base.needsPv1 = true;
    if (pv1 == null) {
      base.status = 'pendiente1';
      return base;
    }

    if (pv1 !== NP) {
      var first = calculate(u1, u2, pv1);
      base.first = first;
      // resultado ≥ 6  ⇔  sum ≥ 24·SCALE
      if (first.sumUnits >= 4 * PASS_UNITS) {
        base.status = 'aprobado';
        return fill(base, first);
      }
    }

    base.needsPv2 = true;
    if (pv2 == null) {
      base.status = 'pendiente2';
      return base;
    }

    if (pv2 === NP) {
      base.status = 'np';
      return failed(base, null);
    }

    var second = calculate(u1, u2, pv2);
    if (second.sumUnits >= 4 * PASS_UNITS) {
      base.status = 'aprobado2';
      return fill(base, second);
    }
    base.status = 'reprobado';
    return failed(base, second);
  }

  function fill(base, calc) {
    base.exact = calc.exact;
    base.exactText = calc.exactText;
    base.sumUnits = calc.sumUnits;
    base.final = calc.final;
    return base;
  }

  /** Reprobado o NP: se registra 5. El promedio del grupo usa ese 5. */
  function failed(base, calc) {
    if (calc) {
      base.exact = calc.exact;
      base.exactText = calc.exactText;
    }
    base.final = FAIL_GRADE;
    base.sumUnits = 4 * FAIL_GRADE * SCALE;
    return base;
  }

  /**
   * Promedio del grupo usando los resultados exactos (antes del redondeo individual;
   * para reprobados y NP, el 5 registrado),
   * redondeado a máximo dos decimales. Devuelve texto o null si no hay registros.
   */
  function groupAverage(sumUnitsList) {
    var n = sumUnitsList.length;
    if (!n) return null;
    var total = 0;
    for (var i = 0; i < n; i++) total += sumUnitsList[i];
    // promedio·100 = total / (n · 4·SCALE / 100) = total / (n·400); redondeo .5 hacia arriba.
    var denom = n * 4 * SCALE / 100;
    var hundredths = Math.floor((2 * total + denom) / (2 * denom));
    return formatScaled(hundredths, 2);
  }

  var api = {
    DECIMALS: DECIMALS,
    INPUT_DECIMALS: INPUT_DECIMALS,
    MESSAGES: MESSAGES,
    parseGrade: parseGrade,
    partialAverage: partialAverage,
    calculate: calculate,
    evaluate: evaluate,
    parseVuelta: parseVuelta,
    parseFaltas: parseFaltas,
    absencePercent: absencePercent,
    NP: NP,
    FAIL_GRADE: FAIL_GRADE,
    exemptionGrade: exemptionGrade,
    absenceLimit: absenceLimit,
    exceedsAbsences: exceedsAbsences,
    STATUS_LABELS: STATUS_LABELS,
    groupAverage: groupAverage,
    formatScaled: formatScaled,
  };

  root.Grades = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
