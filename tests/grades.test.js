'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../js/grades.js');

function calc(a, b, c) {
  const [p1, p2, p3] = [a, b, c].map((v) => G.parseGrade(v, G.DECIMALS));
  return G.calculate(p1.units, p2.units, p3.units);
}

test('ejemplo del enunciado: 8.8, 9.3, 8.8 (solo el primer decimal)', () => {
  const r = calc('8.8', '9.3', '8.8');
  assert.equal(r.partialText, '9'); // 9.05 → 9.0
  assert.equal(r.partial, 9);
  assert.equal(r.exactText, '8.9'); // (9.0 + 8.8) / 2
  assert.equal(r.exact, 8.9);
  assert.equal(r.final, 9);
});

test('el promedio parcial se corta a un decimal, no se redondea a entero', () => {
  // 7.4 + 7.5 → 7.45 → 7.4; con 5.5: (7.4 + 5.5) / 2 = 6.45 → 6.4 → 6.
  const r = calc('7.4', '7.5', '5.5');
  assert.equal(r.partialText, '7.4');
  assert.equal(r.exactText, '6.4');
  assert.equal(r.final, 6);
  // 7 + 8.5 → 7.75 → 7.7; con 6.2: (7.7 + 6.2) / 2 = 6.95 → 6.9 → 7.
  const s = calc('7', '8.5', '6.2');
  assert.equal(s.partialText, '7.7');
  assert.equal(s.exactText, '6.9');
  assert.equal(s.final, 7);
});

test('.5 exacto redondea hacia arriba, aun con valores que fallan en flotante', () => {
  // En flotante ((0.1 + 0.2) / 2 + x) puede quedar en x.4999…; aquí no.
  assert.equal(calc('8', '9', '8.5').exactText, '8.5');
  assert.equal(calc('8', '9', '8.5').final, 9);
  assert.equal(calc('0.1', '0.9', '0.5').exactText, '0.5'); // (0.5 + 0.5) / 2
  assert.equal(calc('0.1', '0.9', '0.5').final, 1);
  assert.equal(calc('6.3', '6.7', '5.5').exactText, '6');
  assert.equal(calc('6', '6', '4.9').final, 5); // 5.45 → 5.4 → 5
});

test('menos de .5 redondea hacia abajo', () => {
  assert.equal(calc('7', '7', '7.9').exactText, '7.4'); // 7.45 → 7.4
  assert.equal(calc('7', '7', '7.9').final, 7);
});

test('límites 0 y 10', () => {
  assert.equal(calc('0', '0', '0').final, 0);
  assert.equal(calc('10', '10', '10').final, 10);
  assert.equal(calc('10', '10', '10').exactText, '10');
});

test('cortar a un decimal no cambia la calificación final (todas las combinaciones de 0.1)', () => {
  // Con calificaciones de un decimal, el resultado sin cortar redondea igual: exacto·40 = p1 + p2 + 2·p3 (en décimas)
  for (let a = 0; a <= 100; a += 1) {
    for (let b = 0; b <= 100; b += 7) {
      for (let c = 0; c <= 100; c += 1) {
        const s = a + b + 2 * c; // exacto = s / 40
        const expectedFinal = Math.floor((s + 20) / 40);
        const r = calc(String(a / 10), String(b / 10), String(c / 10));
        assert.equal(r.final, expectedFinal, `${a / 100}, ${b / 100}, ${c / 100}`);
      }
    }
  }
});

test('parseGrade acepta formatos válidos (un decimal)', () => {
  for (const [input, text] of [['7', '7'], ['7.5', '7.5'], ['8.8', '8.8'], ['5.6', '5.6'], ['6', '6'], ['10', '10'],
    ['8,5', '8.5'], ['.5', '0.5'], ['8.', '8'], [' 9.50 ', '9.5'], ['007', '7'], ['10.0000', '10'], ['6.0', '6']]) {
    const p = G.parseGrade(input);
    assert.equal(p.status, 'valid', input);
    assert.equal(p.text, text, input);
  }
});

test('parseGrade rechaza valores inválidos', () => {
  assert.equal(G.parseGrade('').status, 'empty');
  assert.equal(G.parseGrade('   ').status, 'empty');
  for (const bad of ['abc', '8a', '.', '1.2.3', '-1', '-0.5', '10.01', '11', '100', '1e1', '8.12345', '9.25', '5.65']) {
    assert.equal(G.parseGrade(bad).status, 'invalid', bad);
  }
  assert.equal(G.parseGrade('11').error, 'Ingresa una calificación entre 0 y 10.');
  assert.equal(G.parseGrade('-1').error, 'Ingresa una calificación entre 0 y 10.');
  assert.equal(G.parseGrade('9.25').error, 'Usa solo un decimal, por ejemplo 5.6.');
});

test('datos guardados con más decimales se siguen leyendo', () => {
  assert.equal(G.parseGrade('9.25', G.DECIMALS).status, 'valid');
  assert.equal(G.parseGrade('9.25', G.DECIMALS).text, '9.25');
  assert.equal(G.parseGrade('8.12345', G.DECIMALS).status, 'invalid');
});

test('promedio del grupo: resultados con un decimal y promedio cortado a un decimal', () => {
  const sums = [calc('8.8', '9.3', '8.8'), calc('7', '8', '6')].map((r) => r.sumUnits);
  // 8.9 y 6.7 (6.75 cortado) → 7.8
  assert.equal(G.groupAverage(sums), '7.8');
  assert.equal(G.groupAverage([calc('10', '10', '10').sumUnits]), '10');
  assert.equal(G.groupAverage([]), null);
  // 8.9 y 6.6 → 7.75 → 7.7 (se corta, no se redondea)
  assert.equal(G.groupAverage([calc('8.8', '9.3', '8.8'), calc('7', '8', '5.8')].map((r) => r.sumUnits)), '7.7');
});

test('valores guardados o importados con más decimales se cortan al primero', () => {
  assert.equal(G.oneDecimal(G.parseGrade('7.75', G.DECIMALS)).text, '7.7');
  assert.equal(G.oneDecimal(G.parseGrade('8.25', G.DECIMALS)).text, '8.2');
  assert.equal(G.oneDecimal(G.parseGrade('9', G.DECIMALS)).text, '9');
  assert.equal(G.oneDecimal(G.parseVuelta('NP', G.DECIMALS)).text, 'NP');
});

function evaluate(a, b, v1, v2) {
  const u = (v) => (v == null ? null : v === 'NP' ? G.NP : G.parseGrade(v, G.DECIMALS).units);
  return G.evaluate(u(a), u(b), u(v1), u(v2));
}

test('exento: promedio parcial ≥ 9 no requiere Primera Vuelta', () => {
  let r = evaluate('9', '9');
  assert.equal(r.status, 'exento');
  assert.equal(r.final, 9);
  assert.equal(r.needsPv1, false);
  r = evaluate('9.5', '10'); // 9.75 → 9.7 → 10
  assert.equal(r.status, 'exento');
  assert.equal(r.final, 10);
  assert.equal(r.exactText, '9.7');
  assert.equal(evaluate('9', '9.9').final, 9); // 9.45 → 9
  assert.equal(evaluate('9', '10').final, 10); // 9.5 → 10
  // Ignora lo que se haya escrito en las vueltas.
  assert.equal(evaluate('9', '9', '2', '2').final, 9);
});

test('exención usa el promedio con un decimal: 8.95 → 8.9 no exenta', () => {
  const r = evaluate('8.9', '9');
  assert.equal(r.partialText, '8.9');
  assert.equal(r.status, 'pendiente1');
  assert.equal(r.final, null);
  assert.equal(evaluate('8.9', '9', '8').status, 'aprobado');
});

test('Primera Vuelta aprueba con resultado exacto ≥ 6', () => {
  const r = evaluate('8.8', '8.8', '8.8');
  assert.equal(r.status, 'aprobado');
  assert.equal(r.final, 9);
  assert.equal(r.needsPv2, false);
  assert.equal(evaluate('6', '6', '6').status, 'aprobado'); // 6 exacto
  assert.equal(evaluate('6', '6', '6').final, 6);
});

test('Primera Vuelta < 6 (aunque redondee a 6) requiere Segunda Vuelta', () => {
  const r = evaluate('6', '6', '5'); // 5.5
  assert.equal(r.status, 'pendiente2');
  assert.equal(r.needsPv2, true);
  assert.equal(r.final, null);
  assert.equal(r.first.exactText, '5.5');
  assert.equal(evaluate('6', '6', '5.9998').status, 'pendiente2'); // 5.9999
});

test('Segunda Vuelta: (promedio parcial + 2ª vuelta) / 2', () => {
  let r = evaluate('5', '6', '4', '8'); // prom 5.5; 1ª: 4.75 → 4.7; 2ª: 6.75 → 6.7 → 7
  assert.equal(r.status, 'aprobado2');
  assert.equal(r.exactText, '6.7');
  assert.equal(r.final, 7);
  r = evaluate('5', '6', '4', '6.5'); // 6 exacto → aprobado
  assert.equal(r.status, 'aprobado2');
  assert.equal(r.final, 6);
});

test('Segunda Vuelta < 6: reprobado con 5', () => {
  let r = evaluate('4', '5', '3', '4'); // 4.5 / 2ª: 4.25 → 4.2
  assert.equal(r.status, 'reprobado');
  assert.equal(r.exactText, '4.2');
  assert.equal(r.final, 5);
  r = evaluate('5', '6', '4', '6'); // 5.75: redondearía a 6, pero no alcanza 6 → 5
  assert.equal(r.status, 'reprobado');
  assert.equal(r.final, 5);
  r = evaluate('1', '1', '0', '0'); // 0.5 → también 5
  assert.equal(r.final, 5);
});

test('NP: en Primera Vuelta pasa a Segunda; en Segunda registra 5', () => {
  let r = evaluate('7.4', '5.4', 'NP');
  assert.equal(r.status, 'pendiente2');
  assert.equal(r.needsPv2, true);
  r = evaluate('7.4', '5.4', 'NP', 'NP');
  assert.equal(r.status, 'np');
  assert.equal(r.final, 5);
  r = evaluate('7.4', '5.4', 'NP', '8'); // (6.4 + 8) / 2 = 7.2
  assert.equal(r.status, 'aprobado2');
  assert.equal(r.final, 7);
  r = evaluate('6', '6', '3', 'NP');
  assert.equal(r.status, 'np');
  assert.equal(r.final, 5);
  assert.equal(G.parseVuelta('np').status, 'np');
  assert.equal(G.parseVuelta(' NP ').text, 'NP');
  assert.equal(G.parseGrade('NP').status, 'invalid'); // los parciales no aceptan NP
});

test('promedio parcial en pantalla: un decimal, cortando el resto', () => {
  const short = (a, b) => G.partialAverage(G.parseGrade(a).units, G.parseGrade(b).units).shortText;
  assert.equal(short('7', '8.5'), '7.7'); // 7.75
  assert.equal(short('7.5', '9'), '8.2'); // 8.25
  assert.equal(short('6.6', '8.3'), '7.4'); // 7.45
  assert.equal(short('9.1', '9'), '9'); // 9.05
  assert.equal(short('8.9', '9'), '8.9'); // 8.95 (no exenta)
  assert.equal(short('10', '10'), '10');
  assert.equal(short('0', '0.1'), '0'); // 0.05
});

test('acta de ejemplo: reproduce las calificaciones finales registradas', () => {
  // [P1, P2, 1ª vuelta, 2ª vuelta, Prom. del acta, final del acta]
  const acta = [
    ['6.4', '5', '3.2', 'NP', '5.7', 5], ['7', '8.5', '2.8', '7.6', '7.7', 8], ['9.4', '9', null, null, '9.2', 9],
    ['7', '9', '6.4', null, '8', 7], ['8.9', '9.5', null, null, '9.2', 9], ['7.4', '5.4', 'NP', 'NP', '6.4', 5],
    ['9.7', '9.3', null, null, '9.5', 10], ['5', '8', '3.6', '6', '6.5', 6], ['8.2', '9.8', null, null, '9', 9],
    ['8', '8', '2.4', '4', '8', 6], ['8', '9', '2.4', '6', '8.5', 7], ['9.1', '9', null, null, '9', 9],
    ['7.5', '9', '8', null, '8.2', 8], ['6.6', '8.3', '6.8', null, '7.4', 7], ['7', '9', '6', null, '8', 7],
    ['8.7', '9.3', null, null, '9', 9], ['7.6', '5', '3.6', '6.8', '6.3', 7], ['8.3', '7.7', '2.8', '5.6', '8', 7],
    ['7.7', '8.3', '2.8', '6.4', '8', 7], ['7.8', '10', '6', null, '8.9', 7],
  ];
  for (const [a, b, v1, v2, prom, final] of acta) {
    const r = evaluate(a, b, v1, v2);
    assert.equal(r.partialShortText, prom, `${a}, ${b}`);
    assert.equal(r.final, final, `${a}, ${b}, ${v1}, ${v2}`);
  }
});

test('faltas y porcentaje', () => {
  assert.deepEqual(G.parseFaltas(''), { status: 'empty', value: 0, text: '' });
  assert.equal(G.parseFaltas('3').value, 3);
  assert.equal(G.parseFaltas('03').text, '3');
  for (const bad of ['-1', '1.5', 'a', '1000']) assert.equal(G.parseFaltas(bad).status, 'invalid', bad);
  assert.deepEqual(G.absencePercent(3, 48), { fraction: 0.063, text: '6.3' }); // 6.25 → 6.3
  assert.deepEqual(G.absencePercent(0, 48), { fraction: 0, text: '0' });
  assert.deepEqual(G.absencePercent(48, 48), { fraction: 1, text: '100' });
  assert.equal(G.absencePercent(3, 0), null);
});

test('NP en parciales: uno cuenta como 0; los dos dan 5 sin vueltas', () => {
  let r = evaluate('8', 'NP');
  assert.equal(r.partialText, '4');
  assert.equal(r.status, 'pendiente1');
  assert.equal(r.npParcial, 2);
  r = evaluate('8', 'NP', '9'); // (4 + 9) / 2 = 6.5
  assert.equal(r.exactText, '6.5');
  assert.equal(r.status, 'aprobado');
  assert.equal(r.final, 7);
  r = evaluate('NP', '10', '7'); // (5 + 7) / 2 = 6
  assert.equal(r.final, 6);
  r = evaluate('10', 'NP'); // 5: no exenta
  assert.equal(r.status, 'pendiente1');
  // Regla: calificación en un parcial, NP en el otro y NP en ambas vueltas → 5
  r = evaluate('8', 'NP', 'NP', 'NP');
  assert.equal(r.status, 'np');
  assert.equal(r.final, 5);
  r = evaluate('NP', 'NP');
  assert.equal(r.status, 'sinderecho');
  assert.equal(r.final, null);
  assert.equal(r.finalText, 'NP');
  assert.equal(r.needsPv1, false);
  assert.equal(r.needsPv2, false);
  assert.equal(r.partialShortText, 'NP');
});

test('exención: 8 en todas las licenciaturas, 9 en Enfermería', () => {
  const u = (v) => (v === 'NP' ? G.NP : G.parseGrade(v).units);
  const ev = (a, b, ex, v1) => G.evaluate(u(a), u(b), v1 == null ? null : u(v1), null, ex);
  assert.equal(G.exemptionGrade('LICENCIATURA EN ENFERMERÍA'), 9);
  assert.equal(G.exemptionGrade('Lic. Enfermeria'), 9);
  assert.equal(G.exemptionGrade('LICENCIADO EN DERECHO (CU)'), 8);
  assert.equal(G.exemptionGrade('CCH'), 8);
  assert.equal(G.exemptionGrade(''), 8);
  let r = ev('8', '8', 8);
  assert.equal(r.status, 'exento');
  assert.equal(r.final, 8);
  r = ev('7.9', '8', 8); // 7.95 no exenta (sin redondear)
  assert.equal(r.status, 'pendiente1');
  r = ev('8.4', '8.7', 8); // 8.55 → 9
  assert.equal(r.final, 9);
  r = ev('8', '8', 9); // Enfermería: 8 no exenta
  assert.equal(r.status, 'pendiente1');
  assert.equal(ev('8', '8', 9, '8').final, 8);
  // NP en un parcial: con 8 tampoco exenta (máximo 5)
  assert.equal(ev('10', 'NP', 8).status, 'pendiente1');
});

test('límite de faltas: 20% (Enfermería 10%); rebasarlo da 5 sin vueltas ni exención', () => {
  const u = (v) => (v === 'NP' ? G.NP : G.parseGrade(v).units);
  assert.equal(G.absenceLimit('LICENCIADO EN DERECHO (CU)'), 20);
  assert.equal(G.absenceLimit('CCH'), 20);
  assert.equal(G.absenceLimit('LICENCIATURA EN ENFERMERÍA'), 10);
  // 48 horas: 20% = 9.6 faltas → 9 está bien, 10 rebasa; exactamente el límite no rebasa
  assert.equal(G.exceedsAbsences(9, 48, 20), false);
  assert.equal(G.exceedsAbsences(10, 48, 20), true);
  assert.equal(G.exceedsAbsences(10, 50, 20), false); // 20% exacto
  assert.equal(G.exceedsAbsences(11, 50, 20), true);
  assert.equal(G.exceedsAbsences(6, 50, 10), true); // Enfermería
  assert.equal(G.exceedsAbsences(99, null, 20), false); // sin horas no se aplica
  let r = G.evaluate(u('9'), u('9'), null, null, 8, true); // tenía para exentar
  assert.equal(r.status, 'faltas');
  assert.equal(r.final, 5);
  assert.equal(r.needsPv1, false);
  assert.equal(r.needsPv2, false);
  assert.equal(r.partialText, '9');
  r = G.evaluate(u('5'), u('6'), u('9'), u('9'), 8, true); // vueltas capturadas se ignoran
  assert.equal(r.final, 5);
  r = G.evaluate(G.NP, G.NP, null, null, 8, true); // NP en ambos sigue siendo NP
  assert.equal(r.status, 'sinderecho');
  assert.equal(r.finalText, 'NP');
});
