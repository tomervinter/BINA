initListPage({
  pageKey: 'customers',
  apiBase: '/api/customers',
  defaultSort: { field: 'name', dir: 'asc' },
  columns: [
    { key: 'customerNumber', label: 'מספר לקוח' },
    { key: 'name', label: 'שם לקוח' },
    { key: 'primaryClass', label: 'סיווג ראשי' },
    { key: 'customerType', label: 'סוג לקוח' },
    { key: 'city', label: 'עיר' },
    { key: 'centralCustomer', label: 'לקוח מרכז' },
    { key: 'salesAgent', label: 'סוכן מכירות' },
    { key: 'status', label: 'סטטוס' }
  ]
});
