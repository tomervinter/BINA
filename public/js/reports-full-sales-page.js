// Read-only consolidated view: every sale row plus every customer/product master
// field, joined server-side. No upload/delete here — this is a report, not a data
// entry table; the underlying data is managed from the sales/customers/products pages.
async function initFullSalesReportPage() {
  const data = await Layout.init('reports-full-sales');
  if (!data) return;

  createServerTable(document.getElementById('tableContainer'), [
    { key: 'customerNumber', label: 'מספר לקוח' },
    { key: 'customerName', label: 'שם לקוח', sortable: false, filterable: false },
    { key: 'primaryClass', label: 'סיווג ראשי לקוח', sortable: false, filterable: false },
    { key: 'customerType', label: 'סוג לקוח', sortable: false, filterable: false },
    { key: 'city', label: 'עיר', sortable: false, filterable: false },
    { key: 'centralCustomer', label: 'שם לקוח מרכז', sortable: false, filterable: false },
    { key: 'customerStatus', label: 'סטטוס לקוח', sortable: false, filterable: false },
    { key: 'productCode', label: 'קוד פריט' },
    { key: 'productName', label: 'שם פריט', sortable: false, filterable: false },
    { key: 'type', label: 'טיפוס', sortable: false, filterable: false },
    { key: 'superType', label: 'טיפוס על', sortable: false, filterable: false },
    { key: 'department', label: 'מחלקה', sortable: false, filterable: false },
    { key: 'unit', label: 'יחידת מידה', sortable: false, filterable: false },
    { key: 'productStatus', label: 'סטטוס מוצר', sortable: false, filterable: false },
    { key: 'forProcurement', label: 'לעיתוד', sortable: false, filterable: false },
    { key: 'forMarketing', label: 'לשיווק', sortable: false, filterable: false },
    { key: 'year', label: 'שנה', sortKey: 'date', render: (r) => new Date(r.date).getFullYear(), filterable: false },
    { key: 'month', label: 'חודש', sortKey: 'date', render: (r) => new Date(r.date).getMonth() + 1, filterable: false },
    { key: 'revenue', label: 'מכר כספי', filterable: false },
    { key: 'quantity', label: 'מכר כמותי', filterable: false },
    { key: 'weight', label: 'משקל', filterable: false }
  ], {
    apiBase: '/api/sales-full-report',
    defaultSort: { field: 'date', dir: 'desc' },
    deletable: false
  });
}
