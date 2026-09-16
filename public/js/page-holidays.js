initInlineEditTable({
  pageKey: 'holidays',
  apiBase: '/api/holidays',
  addLabel: 'הוספת חג',
  countLabel: 'חגים',
  defaultSortOrder: ['פסח', 'שבועות', 'ראש השנה', 'כיפור', 'סוכות', 'נוביגוד'],
  fields: [
    { key: 'name', label: 'חג' },
    { key: 'year', label: 'שנה', type: 'number', default: new Date().getFullYear() },
    { key: 'fromDate', label: 'מתאריך', type: 'date' },
    { key: 'toDate', label: 'עד תאריך', type: 'date' },
    { key: 'daysBefore', label: 'ימי השפעה לפני', type: 'number', default: 0 },
    { key: 'daysAfter', label: 'ימי השפעה אחרי', type: 'number', default: 0 }
  ]
});
