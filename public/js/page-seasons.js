initInlineEditTable({
  pageKey: 'seasons',
  apiBase: '/api/seasons',
  addLabel: 'הוספת עונה',
  countLabel: 'עונות',
  fields: [
    { key: 'name', label: 'עונה' },
    { key: 'year', label: 'שנה', type: 'number', default: new Date().getFullYear() },
    { key: 'fromDate', label: 'מתאריך', type: 'date' },
    { key: 'toDate', label: 'עד תאריך', type: 'date' }
  ]
});
