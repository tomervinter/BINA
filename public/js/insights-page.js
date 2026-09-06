async function initInsightsPage() {
  const data = await Layout.init('insights');
  if (!data) return;

  const [insightsRes, productsRes] = await Promise.all([
    fetch('/api/insights', { credentials: 'include' }),
    fetch('/api/products?pageSize=all', { credentials: 'include' })
  ]);
  const insights = insightsRes.ok ? await insightsRes.json() : [];
  const products = productsRes.ok ? (await productsRes.json()).rows : [];
  const prodName = {};
  products.forEach((p) => { prodName[p.itemCode] = p.name; });

  const columns = [
    { key: 'category', label: 'קטגוריה', render: (r) => (TYPE_META[r.type] || {}).category || r.type },
    { key: 'type', label: 'סוג', render: (r) => (TYPE_META[r.type] || {}).label || r.type },
    { key: 'customerId', label: 'מספר לקוח', render: (r) => r.customerId || '' },
    { key: 'customerName', label: 'לקוח', render: (r) => r.customerName || '' },
    { key: 'entity', label: 'מוצר', render: (r) => r.productCode ? (prodName[r.productCode] || r.productCode) : '' },
    { key: 'message', label: 'פירוט' },
    { key: 'severity', label: 'חומרה', html: true, render: (r) => '<span class="pill ' + (SEV_CLASS[r.severity] || 'pill-gray') + '">' + (SEV_LABEL[r.severity] || r.severity) + '</span>', filterValue: (r) => SEV_LABEL[r.severity] || r.severity, sortValue: (r) => ({ high: 0, medium: 1, low: 2 }[r.severity] ?? 3) },
    { key: 'metric', label: 'מדד' }
  ];

  createDataTable(document.getElementById('tableContainer'), columns, insights, {
    exportUrl: '/api/insights/export',
    onRowClick: (r) => { if (r.customerId) window.location.href = 'customer-profile.html?customer=' + encodeURIComponent(r.customerId); },
    tableKey: 'insights'
  });
}
