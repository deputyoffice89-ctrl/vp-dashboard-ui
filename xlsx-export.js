/* Local, dependency-free XLSX writer for the office dashboard.
   Produces a standard Office Open XML workbook using ZIP "store" entries.
   No external services, downloads, CDN scripts, or sensitive data uploads. */
(function () {
  "use strict";
  const TE = new TextEncoder();
  const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const PKGREL = "http://schemas.openxmlformats.org/package/2006/relationships";
  const BOOKTYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
  const SHEETTYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml";
  const STYLETYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml";
  const xmlHead = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const byte = text => TE.encode(text);
  const xmlEscape = value => String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "")
    .replace(/[&<>"']/g, char => ({
      "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&apos;"
    })[char]);
  const cellCol = n => {
    let result = "";
    for (n++; n > 0; n = Math.floor((n - 1) / 26)) {
      result = String.fromCharCode(65 + ((n - 1) % 26)) + result;
    }
    return result;
  };
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[n] = c >>> 0;
  }
  function crc32(bytes) {
    let value = 0xFFFFFFFF;
    for (const b of bytes) value = crcTable[(value ^ b) & 255] ^ (value >>> 8);
    return (value ^ 0xFFFFFFFF) >>> 0;
  }
  function zip(files) {
    const chunks = [], directory = [];
    let offset = 0;
    for (const [filename, content] of files) {
      const name = byte(filename), data = byte(content), crc = crc32(data);
      const local = new Uint8Array(30 + name.length), view = new DataView(local.buffer);
      view.setUint32(0, 0x04034B50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 0x0800, true);
      view.setUint16(8, 0, true);
      view.setUint16(12, 33, true); // Valid DOS ZIP date: 1980-01-01
      view.setUint32(14, crc, true);
      view.setUint32(18, data.length, true);
      view.setUint32(22, data.length, true);
      view.setUint16(26, name.length, true);
      local.set(name, 30);
      chunks.push(local, data);

      const central = new Uint8Array(46 + name.length), cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014B50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(14, 33, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      central.set(name, 46);
      directory.push(central);
      offset += local.length + data.length;
    }
    let dirSize = 0;
    for (const part of directory) dirSize += part.length;
    const end = new Uint8Array(22), v = new DataView(end.buffer);
    v.setUint32(0, 0x06054B50, true);
    v.setUint16(8, files.length, true);
    v.setUint16(10, files.length, true);
    v.setUint32(12, dirSize, true);
    v.setUint32(16, offset, true);
    return new Blob([...chunks, ...directory, end], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
  }
  function cell(value, address, header = false) {
    if (!header && typeof value === "number" && Number.isFinite(value)) {
      return '<c r="' + address + '" s="2" t="n"><v>' + value + '</v></c>';
    }
    // Excel text cells use inlineStr, never formula interpretation.
    return '<c r="' + address + '" s="' + (header ? 1 : 2) +
      '" t="inlineStr"><is><t xml:space="preserve">' +
      xmlEscape(value) + '</t></is></c>';
  }
  function columnWidth(header) {
    const name = String(header || "");
    if (/اسم الموضوع|تفاصيل الموضوع|ملاحظات|التحديثات|التوجيه/.test(name)) return 42;
    if (/رابط السجل/.test(name)) return 46;
    if (/تذكير المتابعة|المديرية المختصة/.test(name)) return 24;
    if (/الموظف|الموعد|التاريخ|تاريخ|الحالة/.test(name)) return 20;
    if (/عدد الأيام/.test(name)) return 13;
    return 18;
  }
  function worksheet(headers, rows) {
    const numCols = headers.length;
    const maxRow = rows.length + 1;
    const columns = headers.map((h, index) =>
      '<col min="' + (index + 1) + '" max="' + (index + 1) +
      '" width="' + columnWidth(h) + '" customWidth="1"/>').join("");
    const rowXml = '<row r="1" ht="32" customHeight="1">' +
      headers.map((h, j) => cell(h, cellCol(j) + "1", true)).join("") + '</row>' +
      rows.map((line, i) => {
        const rowNum = i + 2;
        return '<row r="' + rowNum + '">' +
          headers.map((_, j) => cell(line[j], cellCol(j) + rowNum)).join("") + '</row>';
      }).join("");
    const ref = "A1:" + cellCol(numCols - 1) + maxRow;
    return xmlHead + '<worksheet xmlns="' + MAIN + '">' +
      '<sheetViews><sheetView workbookViewId="0" rightToLeft="1">' +
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
      '</sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="22"/><cols>' + columns + '</cols>' +
      '<sheetData>' + rowXml + '</sheetData><autoFilter ref="' + ref +
      '"/><pageMargins left="0.3" right="0.3" top="0.6" bottom="0.6" header="0.2" footer="0.2"/>' +
      '</worksheet>';
  }
  function styles() {
    return xmlHead + '<styleSheet xmlns="' + MAIN + '">' +
      '<fonts count="2"><font><sz val="11"/><name val="Arial"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts>' +
      '<fills count="3"><fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF12473E"/>' +
      '<bgColor indexed="64"/></patternFill></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1">' +
      '<alignment horizontal="right" vertical="center" readingOrder="2"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1">' +
      '<alignment horizontal="right" vertical="top" readingOrder="2" wrapText="1"/></xf></cellXfs>' +
      '</styleSheet>';
  }
  function createWorkbook(sheets) {
    if (!Array.isArray(sheets) || !sheets.length) throw new Error("لا توجد بيانات لتصديرها");
    if (sheets.length > 20) throw new Error("عدد صفحات Excel كبير جداً");
    const names = new Set();
    const files = [];
    let types = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="' + BOOKTYPE + '"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="' + STYLETYPE + '"/>';
    let bookSheets = "", bookRels = "";
    for (let i = 0; i < sheets.length; i++) {
      const sh = sheets[i];
      const name = String(sh.name || "صفحة " + (i + 1)).slice(0, 31);
      if (names.has(name)) throw new Error("أسماء صفحات Excel مكررة");
      names.add(name);
      const id = i + 1;
      bookSheets += '<sheet name="' + xmlEscape(name) + '" sheetId="' + id + '" r:id="rId' + id + '"/>';
      bookRels += '<Relationship Id="rId' + id + '" Type="' + REL +
        '/worksheet" Target="worksheets/sheet' + id + '.xml"/>';
      types += '<Override PartName="/xl/worksheets/sheet' + id + '.xml" ContentType="' +
        SHEETTYPE + '"/>';
      files.push(["xl/worksheets/sheet" + id + ".xml", worksheet(sh.headers, sh.rows)]);
    }
    types += "</Types>";
    bookRels += '<Relationship Id="rId' + (sheets.length + 1) + '" Type="' +
      REL + '/styles" Target="styles.xml"/>';
    const book = xmlHead + '<workbook xmlns="' + MAIN + '" xmlns:r="' + REL +
      '"><bookViews><workbookView/></bookViews><sheets>' + bookSheets + '</sheets></workbook>';
    files.push(["[Content_Types].xml", xmlHead + types]);
    files.push(["_rels/.rels", xmlHead + '<Relationships xmlns="' + PKGREL +
      '"><Relationship Id="rId1" Type="' + REL +
      '/officeDocument" Target="xl/workbook.xml"/></Relationships>']);
    files.push(["xl/workbook.xml", book]);
    files.push(["xl/_rels/workbook.xml.rels", xmlHead + '<Relationships xmlns="' +
      PKGREL + '">' + bookRels + '</Relationships>']);
    files.push(["xl/styles.xml", styles()]);
    return zip(files);
  }
  window.OfficeXLSX = Object.freeze({ createWorkbook });
})();
