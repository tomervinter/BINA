const { parse } = require('csv-parse/sync');

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

module.exports = { parseCsvBuffer, parseDMY, parseNumber };
