const XLSX = require('xlsx');

// A header-only workbook (for the "download sample template" button).
function headerOnlyXlsxBuffer(headers) {
  const ws = XLSX.utils.aoa_to_sheet([headers]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// Real .xlsx export: `columns` is [{key, label}], `rows` plain objects.
function rowsToXlsxBuffer(columns, rows) {
  const aoa = [columns.map((c) => c.label)].concat(
    rows.map((row) => columns.map((c) => (c.value ? c.value(row) : row[c.key])))
  );
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { headerOnlyXlsxBuffer, rowsToXlsxBuffer };
