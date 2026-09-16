initListPage({
  pageKey: 'products',
  apiBase: '/api/products',
  defaultSort: { field: 'name', dir: 'asc' },
  columns: [
    { key: 'itemCode', label: 'קוד פריט' },
    { key: 'name', label: 'שם פריט' },
    { key: 'type', label: 'טיפוס' },
    { key: 'superType', label: 'טיפוס על' },
    { key: 'department', label: 'מחלקה' },
    { key: 'unit', label: 'יחידת מידה' },
    { key: 'status', label: 'סטטוס' },
    { key: 'forProcurement', label: 'לעיתוד' },
    { key: 'forMarketing', label: 'לשיווק' }
  ]
});
