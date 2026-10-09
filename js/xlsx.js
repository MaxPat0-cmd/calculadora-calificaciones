/*
 * Generador mínimo de archivos .xlsx (Office Open XML), sin dependencias.
 *
 * buildWorkbook arma libros de una o varias hojas con celdas combinadas, bordes,
 * alineación, tamaños de letra, formatos numéricos y configuración de impresión.
 * buildXlsx es el atajo para una tabla simple (encabezados en negritas, primera
 * fila fija y anchos ajustados). Los números se guardan como valores numéricos reales.
 * El ZIP se arma sin compresión (método "store"), que Excel lee sin problema.
 */
(function (root) {
  'use strict';

  // ---------- ZIP ----------

  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    var crc = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function utf8(text) {
    return new TextEncoder().encode(text);
  }

  function zip(files) {
    var DOS_TIME = 0;
    var DOS_DATE = (1 << 5) | 1; // 1980-01-01
    var chunks = [];
    var central = [];
    var offset = 0;

    files.forEach(function (file) {
      var name = utf8(file.name);
      var data = typeof file.data === 'string' ? utf8(file.data) : file.data;
      var crc = crc32(data);

      var local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true); // versión necesaria
      local.setUint16(6, 0x0800, true); // nombres en UTF-8
      local.setUint16(8, 0, true); // sin compresión
      local.setUint16(10, DOS_TIME, true);
      local.setUint16(12, DOS_DATE, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);
      chunks.push(new Uint8Array(local.buffer), name, data);

      var entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, 0x02014b50, true);
      entry.setUint16(4, 20, true);
      entry.setUint16(6, 20, true);
      entry.setUint16(8, 0x0800, true);
      entry.setUint16(10, 0, true);
      entry.setUint16(12, DOS_TIME, true);
      entry.setUint16(14, DOS_DATE, true);
      entry.setUint32(16, crc, true);
      entry.setUint32(20, data.length, true);
      entry.setUint32(24, data.length, true);
      entry.setUint16(28, name.length, true);
      entry.setUint32(42, offset, true);
      central.push(new Uint8Array(entry.buffer), name);

      offset += 30 + name.length + data.length;
    });

    var centralSize = central.reduce(function (s, c) { return s + c.length; }, 0);
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);

    var parts = chunks.concat(central, [new Uint8Array(end.buffer)]);
    var total = parts.reduce(function (s, p) { return s + p.length; }, 0);
    var out = new Uint8Array(total);
    var pos = 0;
    parts.forEach(function (p) { out.set(p, pos); pos += p.length; });
    return out;
  }

  // ---------- Hoja de cálculo ----------

  function escapeXml(text) {
    return String(text)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function columnName(index) {
    var name = '';
    for (var n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
      name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
    }
    return name;
  }

  function cellRef(col, row) {
    return columnName(col) + row;
  }

  /** "B3" → { col: 1, row: 3 } */
  function parseRef(ref) {
    var m = /^([A-Z]+)(\d+)$/.exec(ref);
    var col = 0;
    for (var i = 0; i < m[1].length; i++) col = col * 26 + (m[1].charCodeAt(i) - 64);
    return { col: col - 1, row: Number(m[2]) };
  }

  /**
   * Registro de estilos. Un estilo es un objeto plano:
   *   { bold, italic, size, font, color, h: 'left'|'center'|'right', v: 'top'|'center'|'bottom',
   *     wrap, border: 'thin' | { top, bottom, left, right } ('thin'|'medium'), fill: 'RRGGBB',
   *     numFmt: '0.0%' }
   * Cada combinación distinta se convierte en un índice de cellXfs.
   */
  function StyleRegistry() {
    this.fonts = ['<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>'];
    this.fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
    this.borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
    this.numFmts = [];
    this.xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
    this.cache = { '{}': 0 };
  }

  StyleRegistry.prototype.index = function (list, xml) {
    var i = list.indexOf(xml);
    if (i === -1) { list.push(xml); i = list.length - 1; }
    return i;
  };

  StyleRegistry.prototype.get = function (style) {
    if (!style) return 0;
    var key = JSON.stringify(style);
    if (key in this.cache) return this.cache[key];

    var font = '<font>' + (style.bold ? '<b/>' : '') + (style.italic ? '<i/>' : '') +
      '<sz val="' + (style.size || 11) + '"/>' +
      (style.color ? '<color rgb="FF' + style.color + '"/>' : '') +
      '<name val="' + escapeXml(style.font || 'Calibri') + '"/><family val="2"/></font>';
    var fontId = this.index(this.fonts, font);

    var fillId = 0;
    if (style.fill) {
      fillId = this.index(this.fills, '<fill><patternFill patternType="solid"><fgColor rgb="FF' + style.fill +
        '"/><bgColor indexed="64"/></patternFill></fill>');
    }

    var borderId = 0;
    if (style.border) {
      var b = style.border === 'thin' || style.border === 'medium'
        ? { top: style.border, bottom: style.border, left: style.border, right: style.border }
        : style.border;
      var side = function (name) {
        return b[name] ? '<' + name + ' style="' + b[name] + '"><color auto="1"/></' + name + '>' : '<' + name + '/>';
      };
      borderId = this.index(this.borders, '<border>' + side('left') + side('right') + side('top') +
        side('bottom') + '<diagonal/></border>');
    }

    var numFmtId = 0;
    if (style.numFmt) {
      var existing = this.numFmts.indexOf(style.numFmt);
      if (existing === -1) { this.numFmts.push(style.numFmt); existing = this.numFmts.length - 1; }
      numFmtId = 164 + existing;
    }

    var align = '';
    if (style.h || style.v || style.wrap) {
      align = '<alignment' + (style.h ? ' horizontal="' + style.h + '"' : '') +
        (style.v ? ' vertical="' + style.v + '"' : '') + (style.wrap ? ' wrapText="1"' : '') + '/>';
    }

    var xf = '<xf numFmtId="' + numFmtId + '" fontId="' + fontId + '" fillId="' + fillId +
      '" borderId="' + borderId + '" xfId="0"' +
      (numFmtId ? ' applyNumberFormat="1"' : '') + (fontId ? ' applyFont="1"' : '') +
      (fillId ? ' applyFill="1"' : '') + (borderId ? ' applyBorder="1"' : '') +
      (align ? ' applyAlignment="1">' + align + '</xf>' : '/>');
    var id = this.index(this.xfs, xf);
    this.cache[key] = id;
    return id;
  };

  StyleRegistry.prototype.xml = function () {
    var numFmts = this.numFmts.length
      ? '<numFmts count="' + this.numFmts.length + '">' + this.numFmts.map(function (f, i) {
        return '<numFmt numFmtId="' + (164 + i) + '" formatCode="' + escapeXml(f) + '"/>';
      }).join('') + '</numFmts>'
      : '';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      numFmts +
      '<fonts count="' + this.fonts.length + '">' + this.fonts.join('') + '</fonts>' +
      '<fills count="' + this.fills.length + '">' + this.fills.join('') + '</fills>' +
      '<borders count="' + this.borders.length + '">' + this.borders.join('') + '</borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="' + this.xfs.length + '">' + this.xfs.join('') + '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>';
  };

  function cellXml(ref, value, styleId) {
    var s = styleId ? ' s="' + styleId + '"' : '';
    if (typeof value === 'number' && isFinite(value)) {
      return '<c r="' + ref + '"' + s + '><v>' + value + '</v></c>';
    }
    if (value == null || value === '') return styleId ? '<c r="' + ref + '"' + s + '/>' : '';
    return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' +
      escapeXml(value) + '</t></is></c>';
  }

  /**
   * Hoja:
   *   name       nombre (máx. 31 caracteres)
   *   cols       anchos de columna (en caracteres)
   *   cells      { 'A1': { v, s } } — v: número o texto; s: objeto de estilo
   *   merges     ['A1:C1', ...]
   *   rowHeights { 9: 30 } — alto en puntos
   *   freeze     'A2' — primera celda que se desplaza
   *   landscape  true para imprimir horizontal; fitToWidth: true ajusta a una página de ancho
   */
  function sheetXml(sheet, styles) {
    var byRow = {};
    var maxCol = Math.max(0, (sheet.cols || []).length - 1);
    var maxRow = 1;
    Object.keys(sheet.cells || {}).forEach(function (ref) {
      var p = parseRef(ref);
      (byRow[p.row] = byRow[p.row] || []).push({ col: p.col, ref: ref, cell: sheet.cells[ref] });
      maxCol = Math.max(maxCol, p.col);
      maxRow = Math.max(maxRow, p.row);
    });
    var heights = sheet.rowHeights || {};
    Object.keys(heights).forEach(function (r) { maxRow = Math.max(maxRow, Number(r)); });

    var rowsXml = [];
    for (var r = 1; r <= maxRow; r++) {
      var cells = (byRow[r] || []).sort(function (a, b) { return a.col - b.col; });
      if (!cells.length && !heights[r]) continue;
      rowsXml.push('<row r="' + r + '"' + (heights[r] ? ' ht="' + heights[r] + '" customHeight="1"' : '') + '>' +
        cells.map(function (c) { return cellXml(c.ref, c.cell.v, styles.get(c.cell.s)); }).join('') + '</row>');
    }

    var cols = sheet.cols && sheet.cols.length
      ? '<cols>' + sheet.cols.map(function (w, i) {
        return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>';
      }).join('') + '</cols>'
      : '';

    var view = '<sheetView workbookViewId="0"' + (sheet.showGridLines === false ? ' showGridLines="0"' : '') + '>';
    if (sheet.freeze) {
      var f = parseRef(sheet.freeze);
      var split = (f.col ? ' xSplit="' + f.col + '"' : '') + (f.row > 1 ? ' ySplit="' + (f.row - 1) + '"' : '');
      view += '<pane' + split + ' topLeftCell="' + sheet.freeze + '" activePane="bottomLeft" state="frozen"/>';
    }
    view += '</sheetView>';

    var merges = sheet.merges && sheet.merges.length
      ? '<mergeCells count="' + sheet.merges.length + '">' + sheet.merges.map(function (m) {
        return '<mergeCell ref="' + m + '"/>';
      }).join('') + '</mergeCells>'
      : '';

    var page = '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>';
    if (sheet.landscape || sheet.fitToWidth) {
      page += '<pageSetup paperSize="1"' + (sheet.landscape ? ' orientation="landscape"' : '') +
        (sheet.fitToWidth ? ' fitToWidth="1" fitToHeight="0"' : '') + '/>';
    }

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      (sheet.fitToWidth ? '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' : '') +
      '<dimension ref="A1:' + cellRef(maxCol, maxRow) + '"/>' +
      '<sheetViews>' + view + '</sheetViews>' +
      '<sheetFormatPr defaultRowHeight="15"/>' +
      cols +
      '<sheetData>' + rowsXml.join('') + '</sheetData>' +
      merges + page +
      '</worksheet>';
  }

  function safeSheetName(name, i) {
    return String(name || 'Hoja' + (i + 1)).replace(/[\\\/?*\[\]:]/g, '').slice(0, 31) || 'Hoja' + (i + 1);
  }

  /** @param {{ sheets: Array }} book @returns {Uint8Array} contenido del archivo .xlsx */
  function buildWorkbook(book) {
    var styles = new StyleRegistry();
    var sheets = book.sheets;
    var worksheets = sheets.map(function (sh) { return sheetXml(sh, styles); });

    var files = [
      {
        name: '[Content_Types].xml',
        data:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          sheets.map(function (_, i) {
            return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
          }).join('') +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          '</Types>',
      },
      {
        name: '_rels/.rels',
        data:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          '</Relationships>',
      },
      {
        name: 'xl/workbook.xml',
        data:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          '<sheets>' + sheets.map(function (sh, i) {
            return '<sheet name="' + escapeXml(safeSheetName(sh.name, i)) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
          }).join('') + '</sheets>' +
          '</workbook>',
      },
      {
        name: 'xl/_rels/workbook.xml.rels',
        data:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          sheets.map(function (_, i) {
            return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
          }).join('') +
          '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
          '</Relationships>',
      },
    ];
    worksheets.forEach(function (xml, i) {
      files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: xml });
    });
    files.push({ name: 'xl/styles.xml', data: styles.xml() });
    return zip(files);
  }

  /** Hoja de tabla simple: encabezados en negritas, primera fila fija y anchos ajustados. */
  function tableSheet(sheet) {
    var headers = sheet.headers;
    var rows = sheet.rows;
    var formats = sheet.formats || [];
    var cells = {};
    var widths = headers.map(function (h, c) {
      var max = String(h).length;
      rows.forEach(function (r) {
        var v = r[c];
        if (v != null) max = Math.max(max, String(v).length);
      });
      return Math.min(Math.max(max + 3, 8), 60);
    });
    headers.forEach(function (h, c) { cells[cellRef(c, 1)] = { v: h, s: { bold: true } }; });
    rows.forEach(function (r, i) {
      r.forEach(function (v, c) {
        cells[cellRef(c, i + 2)] = { v: v, s: formats[c] ? { numFmt: formats[c] } : null };
      });
    });
    return { name: sheet.sheetName || sheet.name, cols: widths, cells: cells, freeze: 'A2' };
  }

  /** @param {{ sheetName: string, headers: string[], rows: Array<Array<string|number>> }} sheet */
  function buildXlsx(sheet) {
    return buildWorkbook({ sheets: [tableSheet(sheet)] });
  }

  var api = {
    buildXlsx: buildXlsx,
    buildWorkbook: buildWorkbook,
    tableSheet: tableSheet,
    columnName: columnName,
    cellRef: cellRef,
  };
  root.Xlsx = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
