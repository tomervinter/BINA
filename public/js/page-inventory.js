function fmtDate(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
}
initListPage({
  pageKey: 'inventory',
  apiBase: '/api/inventory',
  defaultSort: { field: 'date', dir: 'desc' },
  columns: [
    { key: 'sku', label: 'מק"ט' },
    { key: 'productName', label: 'שם מוצר' },
    { key: 'date', label: 'תאריך', render: (r) => fmtDate(r.date) },
    { key: 'stock', label: 'מלאי' }
  ]
});
