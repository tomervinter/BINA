const { parse } = require('csv-parse/sync');
const XLSX = require('xlsx');

// Parses an uploaded CSV buffer into an array of plain objects keyed by the header row.
function parseCsvBuffer(buffer) {
  const text = buffer.toString('utf8').replace(/^﻿/, '');
  const records = parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  });
  return records;
}

// SheetJS resolves Excel date cells to Date objects anchored at UTC midnight for the
// intended calendar day — read them back with UTC getters, not local ones, or the
// day can shift depending on the server's timezone.
function formatExcelDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getUTCDate()) + '/' + p(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear();
}

function parseXlsxBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  return rows.map((row) => {
    const out = {};
    Object.keys(row).forEach((key) => {
      const v = row[key];
      out[key] = v instanceof Date ? formatExcelDate(v) : v;
    });
    return out;
  });
}

// Dispatches to the CSV or Excel parser by file extension, so every upload route
// accepts both formats through the same call.
function parseFileBuffer(buffer, filename) {
  const ext = String(filename || '').toLowerCase().split('.').pop();
  if (ext === 'xlsx' || ext === 'xls') return parseXlsxBuffer(buffer);
  return parseCsvBuffer(buffer);
}

// Parses dd/mm/yyyy (and a couple of common fallbacks) into a JS Date at local midnight.
function parseDMY(value) {
  if (!value) return null;
  const s = String(value).trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function parseNumber(value) {
  const n = parseFloat(String(value == null ? '' : value).replace(/[^\d.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}

module.exports = { parseCsvBuffer, parseFileBuffer, parseDMY, parseNumber };
