// Read-only consolidated view: every sale row plus every customer/product master
// field, joined server-side (a real SQL join — see src/routes/salesFullReport.js —
// so every column here is sortable and filterable, not just Sale's own fields).
// No upload/delete here — this is a report, not a data entry table; the underlying
// data is managed from the sales/customers/products pages.
async function initFullSalesReportPage() {
  const data = await Layout.init('reports-full-sales');
  if (!data) return;

  createServerTable(document.getElementById('tableContainer'), [
    { key: 'customerNumber', label: 'מספר לקוח' },
    { key: 'productCode', label: 'קוד פריט' },
    { key: 'year', label: 'שנה', render: (r) => new Date(r.date).getFullYear() },
    { key: 'month', label: 'חודש', render: (r) => new Date(r.date).getMonth() + 1 },
    { key: 'revenue', label: 'מכר כספי' },
    { key: 'quantity', label: 'מכר כמותי' },
    { key: 'weight', label: 'משקל' },
    { key: 'customerName', label: 'שם לקוח' },
    { key: 'primaryClass', label: 'סיווג ראשי לקוח' },
    { key: 'customerType', label: 'סוג לקוח' },
    { key: 'city', label: 'עיר' },
    { key: 'centralCustomer', label: 'שם לקוח מרכז' },
    { key: 'customerStatus', label: 'סטטוס לקוח' },
    { key: 'productName', label: 'שם פריט' },
    { key: 'type', label: 'טיפוס' },
    { key: 'superType', label: 'טיפוס על' },
    { key: 'department', label: 'מחלקה' },
    { key: 'unit', label: 'יחידת מידה' },
    { key: 'productStatus', label: 'סטטוס מוצר' },
    { key: 'forProcurement', label: 'לעיתוד' },
    { key: 'forMarketing', label: 'לשיווק' }
  ], {
    apiBase: '/api/sales-full-report',
    defaultSort: { field: 'year', dir: 'desc' },
    deletable: false,
    tableKey: 'reports-full-sales'
  });
}
