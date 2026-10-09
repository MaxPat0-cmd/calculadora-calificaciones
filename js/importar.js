/*
 * Lectura de archivos .zip y .xlsx en el navegador, sin dependencias.
 *
 * - readZip: lista las entradas de un ZIP y las descomprime con DecompressionStream
 *   ("deflate-raw"), disponible en navegadores actuales y en Node 18+.
 * - readXlsx: devuelve las hojas de un .xlsx como filas de texto. Los valores se conservan
 *   como texto exactamente como vienen (una matrícula "0123" no pierde su cero).
 */
(function (root) {
  'use strict';

  // ---------- ZIP ----------

  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

  function inflateRaw(data) {
    if (typeof DecompressionStream !== 'function') {
      return Promise.reject(new Error('Este navegador no puede descomprimir archivos ZIP. Actualízalo o importa los .xlsx directamente.'));
    }
    var stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
  }

  /** @returns {Promise<Array<{name: string, data: Uint8Array}>>} solo archivos (no carpetas) */
  function readZip(buffer) {
    var b = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    // Fin del directorio central: firma 0x06054b50 en los últimos 64 KB.
    var eocd = -1;
    for (var i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
      if (u32(b, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return Promise.reject(new Error('El archivo no es un ZIP válido.'));
    var count = u16(b, eocd + 10);
    var offset = u32(b, eocd + 16);
    var entries = [];
    var utf8 = new TextDecoder('utf-8');
    var latin = new TextDecoder('latin1');
    for (var n = 0; n < count; n++) {
      if (u32(b, offset) !== 0x02014b50) break;
      var flags = u16(b, offset + 8);
      var method = u16(b, offset + 10);
      var compSize = u32(b, offset + 20);
      var nameLen = u16(b, offset + 28);
      var extraLen = u16(b, offset + 30);
      var commentLen = u16(b, offset + 32);
      var localOffset = u32(b, offset + 42);
      var nameBytes = b.subarray(offset + 46, offset + 46 + nameLen);
      var name = (flags & 0x800 ? utf8 : latin).decode(nameBytes);
      if (/[^\x00-\x7f]/.test(latin.decode(nameBytes)) && !(flags & 0x800)) {
        try { name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes); } catch (e) { /* se queda latin1 */ }
      }
      var localNameLen = u16(b, localOffset + 26);
      var localExtraLen = u16(b, localOffset + 28);
      var start = localOffset + 30 + localNameLen + localExtraLen;
      entries.push({ name: name, method: method, data: b.subarray(start, start + compSize), encrypted: !!(flags & 1) });
      offset += 46 + nameLen + extraLen + commentLen;
    }
    return Promise.all(entries.filter(function (e) { return !/\/$/.test(e.name); }).map(function (e) {
      if (e.encrypted) return Promise.reject(new Error('El ZIP está protegido con contraseña.'));
      if (e.method === 0) return { name: e.name, data: e.data };
      if (e.method === 8) return inflateRaw(e.data).then(function (d) { return { name: e.name, data: d }; });
      return Promise.reject(new Error('Formato de compresión no compatible en ' + e.name + '.'));
    }));
  }

  // ---------- XLSX ----------

  var ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

  function decodeXml(s) {
    return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, function (_, e) {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return ENTITIES[e];
    });
  }

  /** Texto de todos los <t> dentro de un fragmento (cadenas con formato enriquecido incluidas). */
  function textOf(xml) {
    var out = '';
    var re = /<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>|<(?:\w+:)?t(?:\s[^>]*)?\/>/g;
    var m;
    // Se ignora el texto fonético (<rPh>) que algunos archivos agregan.
    xml = xml.replace(/<(?:\w+:)?rPh[\s\S]*?<\/(?:\w+:)?rPh>/g, '');
    while ((m = re.exec(xml))) out += m[1] ? decodeXml(m[1]) : '';
    return out;
  }

  function colIndex(ref) {
    var letters = /^[A-Z]+/.exec(ref)[0];
    var n = 0;
    for (var i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
    return n - 1;
  }

  function attr(tag, name) {
    var m = new RegExp('\\s' + name + '="([^"]*)"').exec(tag);
    return m ? decodeXml(m[1]) : null;
  }

  function resolvePath(base, target) {
    if (target[0] === '/') return target.slice(1);
    var parts = base.split('/');
    parts.pop();
    target.split('/').forEach(function (p) {
      if (p === '..') parts.pop();
      else if (p !== '.') parts.push(p);
    });
    return parts.join('/');
  }

  /**
   * @param {Uint8Array|ArrayBuffer} bytes contenido del .xlsx
   * @returns {Promise<Array<{name: string, rows: string[][]}>>}
   */
  function readXlsx(bytes) {
    return readZip(bytes).then(function (files) {
      var dec = new TextDecoder('utf-8');
      var byName = {};
      files.forEach(function (f) { byName[f.name] = f.data; });
      var get = function (p) { return byName[p] ? dec.decode(byName[p]) : null; };

      var workbook = get('xl/workbook.xml');
      if (!workbook) throw new Error('No es un libro de Excel (.xlsx) válido.');
      var rels = get('xl/_rels/workbook.xml.rels') || '';
      var relMap = {};
      (rels.match(/<Relationship\b[^>]*>/g) || []).forEach(function (tag) {
        relMap[attr(tag, 'Id')] = resolvePath('xl/workbook.xml', attr(tag, 'Target'));
      });

      var shared = [];
      var sst = get('xl/sharedStrings.xml');
      if (sst) {
        var si = /<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>|<(?:\w+:)?si\/>/g;
        var m;
        while ((m = si.exec(sst))) shared.push(m[1] ? textOf(m[1]) : '');
      }

      var sheets = [];
      (workbook.match(/<(?:\w+:)?sheet\b[^>]*>/g) || []).forEach(function (tag) {
        var rid = attr(tag, 'r:id') || attr(tag, 'id');
        var path = relMap[rid];
        var xml = path && get(path);
        if (!xml) return;
        sheets.push({ name: attr(tag, 'name') || '', state: attr(tag, 'state') || 'visible', rows: parseSheet(xml, shared) });
      });
      return sheets;
    });
  }

  function parseSheet(xml, shared) {
    var rows = [];
    var rowRe = /<(?:\w+:)?row\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?row>/g;
    var cellRe = /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;
    var rm;
    var nextRow = 1;
    while ((rm = rowRe.exec(xml))) {
      var rAttr = attr(rm[1], 'r');
      var r = rAttr ? Number(rAttr) : nextRow;
      nextRow = r + 1;
      var cells = [];
      var cm;
      var nextCol = 0;
      cellRe.lastIndex = 0;
      while ((cm = cellRe.exec(rm[2]))) {
        var ref = attr(cm[1], 'r');
        var c = ref ? colIndex(ref) : nextCol;
        nextCol = c + 1;
        var type = attr(cm[1], 't');
        var inner = cm[2] || '';
        var v = /<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/.exec(inner);
        var value = '';
        if (type === 's') value = v ? shared[Number(v[1])] || '' : '';
        else if (type === 'inlineStr') value = textOf(inner);
        else if (type === 'b') value = v ? (v[1] === '1' ? 'VERDADERO' : 'FALSO') : '';
        else value = v ? decodeXml(v[1]) : '';
        cells[c] = value;
      }
      for (var i = 0; i < cells.length; i++) if (cells[i] == null) cells[i] = '';
      rows[r - 1] = cells;
    }
    for (var j = 0; j < rows.length; j++) if (!rows[j]) rows[j] = [];
    return rows;
  }

  var api = { readZip: readZip, readXlsx: readXlsx };
  root.Importar = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
