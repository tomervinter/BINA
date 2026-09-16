initListPage({
  pageKey: 'sales',
  apiBase: '/api/sales',
  defaultSort: { field: 'date', dir: 'desc' },
  columns: [
    { key: 'customerNumber', label: 'מספר לקוח' },
    { key: 'customerName', label: 'שם לקוח' },
    { key: 'productCode', label: 'קוד פריט' },
    { key: 'productName', label: 'שם פריט' },
    { key: 'year', label: 'שנה', render: (r) => new Date(r.date).getFullYear() },
    { key: 'month', label: 'חודש', render: (r) => new Date(r.date).getMonth() + 1 },
    { key: 'revenue', label: 'מכר כספי' },
    { key: 'quantity', label: 'מכר כמותי' },
    { key: 'weight', label: 'משקל' }
  ]
});
