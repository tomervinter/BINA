async function initInsightsPage() {
  const data = await Layout.init('insights');
  if (!data) return;

  const [insightsRes, productsRes, customersRes] = await Promise.all([
    fetch('/api/insights', { credentials: 'include' }),
    fetch('/api/products?pageSize=all', { credentials: 'include' }),
    fetch('/api/customers?pageSize=all', { credentials: 'include' })
  ]);
  const insights = insightsRes.ok ? await insightsRes.json() : [];
  const products = productsRes.ok ? (await productsRes.json()).rows : [];
  const customers = customersRes.ok ? (await customersRes.json()).rows : [];
  const prodName = {};
  products.forEach((p) => { prodName[p.itemCode] = p.name; });
  const prodMap = {};
  products.forEach((p) => { prodMap[p.itemCode] = p; });
  const custMap = {};
  customers.forEach((c) => { custMap[c.customerNumber] = c; });

  // Every insight's own customer/product carries the same segment attributes the
  // dashboard's filter table can narrow by (see dashboard.html/dashboard-filters.js)
  // — surfaced here as their own sortable/filterable columns so a filter applied on
  // the dashboard (then carried over via the URL params below) can land on an
  // already-matching view, and so the journal can be sliced by them directly too,
  // independent of the dashboard.
  // Pixel widths, not percentages: under table-layout:fixed a <col>'s declared width
  // strictly wins over any CSS min-width on its th/td, so with this many columns a
  // percentage split would squeeze several of them narrow enough to wrap their own
  // header one letter per line — worse than the ellipsis truncation it replaced. Fixed
  // px widths sized for a readable 2-line header, plus the table's existing horizontal
  // scroll for whatever doesn't fit, is what actually keeps every header legible.
  const columns = [
    { key: 'category', label: 'קטגוריה', width: '90px', render: (r) => (TYPE_META[r.type] || {}).category || r.type },
    { key: 'type', label: 'סוג', width: '150px', wrap: true, render: (r) => (TYPE_META[r.type] || {}).label || r.type },
    { key: 'customerId', label: 'מספר לקוח', width: '80px', render: (r) => r.customerId || '' },
    { key: 'customerName', label: 'לקוח', width: '110px', wrap: true, render: (r) => r.customerName || '' },
    { key: 'city', label: 'עיר', width: '80px', wrap: true, render: (r) => (custMap[r.customerId] && custMap[r.customerId].city) || '' },
    { key: 'centralCustomer', label: 'לקוח מרכז', width: '100px', wrap: true, render: (r) => (custMap[r.customerId] && custMap[r.customerId].centralCustomer) || '' },
    { key: 'salesAgent', label: 'סוכן מכירות', width: '100px', wrap: true, render: (r) => (custMap[r.customerId] && custMap[r.customerId].salesAgent) || '' },
    { key: 'primaryClass', label: 'סיווג ראשי', width: '90px', wrap: true, render: (r) => (custMap[r.customerId] && custMap[r.customerId].primaryClass) || '' },
    { key: 'customerType', label: 'סוג לקוח', width: '90px', wrap: true, render: (r) => (custMap[r.customerId] && custMap[r.customerId].customerType) || '' },
    { key: 'entity', label: 'מוצר', width: '110px', wrap: true, render: (r) => r.productCode ? (prodName[r.productCode] || r.productCode) : '' },
    { key: 'superType', label: 'טיפוס על', width: '90px', wrap: true, render: (r) => (r.productCode && prodMap[r.productCode] && prodMap[r.productCode].superType) || '' },
    { key: 'department', label: 'מחלקת מוצר', width: '100px', wrap: true, render: (r) => (r.productCode && prodMap[r.productCode] && prodMap[r.productCode].department) || '' },
    { key: 'message', label: 'פירוט', width: '260px', wrap: true },
    { key: 'breakdown', label: 'הנתונים מאחורי התובנה', width: '190px', html: true, wrap: true, sortable: false, filterable: false, render: (r) => renderInsightBreakdown(r.breakdown) },
    { key: 'severity', label: 'חומרה', width: '100px', html: true, render: (r) => '<span class="pill ' + (SEV_CLASS[r.severity] || 'pill-gray') + '">' + (SEV_LABEL[r.severity] || r.severity) + '</span>', filterValue: (r) => SEV_LABEL[r.severity] || r.severity,
      // Composite score so this one column can serve as the table's default sort and
      // reproduce the exact same "most important first" order the API itself already
      // computes (see sortInsights in src/routes/insights.js): needsReview always
      // last regardless of severity, then high/medium/low severity, then — within the
      // same severity — the larger |metric| (bigger deviation) first. Kept well clear
      // of collision: metric values seen in practice are small (percentages, day/
      // month counts), nowhere near the 1e3/1e6 tier gaps between review and severity.
      sortValue: (r) => ((r.breakdown && r.breakdown.needsReview) ? 1e6 : 0) + ({ high: 0, medium: 1, low: 2 }[r.severity] ?? 3) * 1e3 - Math.abs(r.metric || 0) },
    { key: 'metric', label: 'מדד', width: '80px' },
    // General policy 8: a decline that overlaps a holiday/season is never hidden —
    // it's shown normally (with a caveat in the message itself) and just flagged here
    // for the user's own judgment, purely informational, not a severity level.
    { key: 'needsReview', label: 'לבדיקה נוספת', width: '100px', html: true, sortable: false,
      render: (r) => (r.breakdown && r.breakdown.needsReview) ? '<span class="pill pill-review">חג/עונה — לבדיקה</span>' : '',
      filterValue: (r) => (r.breakdown && r.breakdown.needsReview) ? 'כן' : '' }
  ];

  // Dashboard charts deep-link here as insights.html?type=<label> so a click lands
  // already filtered to that rule's insights; the dashboard's insight-count summary
  // tile deep-links the same way with a single explicit customer AND every active
  // customer-identity filter (city/centralCustomer/primaryClass/customerType) it
  // resolved — see resolveInsightCustomerIds in dashboard-top-insights.js — so
  // clicking through from a filtered dashboard lands on an already-matching view
  // here too, not just an unfiltered journal.
  const urlParams = new URLSearchParams(window.location.search);
  const paramFilter = (param, col) => { const v = urlParams.get(param); return v ? { [col]: v } : null; };
  const initialFilters = Object.assign({},
    paramFilter('type', 'type'),
    paramFilter('customer', 'customerId'),
    paramFilter('city', 'city'),
    paramFilter('centralCustomer', 'centralCustomer'),
    paramFilter('salesAgent', 'salesAgent'),
    paramFilter('primaryClass', 'primaryClass'),
    paramFilter('customerType', 'customerType')
  );

  const table = createDataTable(document.getElementById('tableContainer'), columns, insights, {
    exportUrl: '/api/insights/export',
    onRowClick: (r) => { if (r.customerId) window.location.href = 'reports-full-sales.html?customerNumber=' + encodeURIComponent(r.customerId); },
    tableKey: 'insights',
    initialFilters: Object.keys(initialFilters).length ? initialFilters : undefined,
    // Most important first by default (see the severity column's composite
    // sortValue above) — the API already returns rows in this exact order, but
    // without an active sortCol no column showed the sort indicator, and any
    // subsequent filtering/interaction had nothing keeping it visibly in this order.
    defaultSortCol: 'severity',
    defaultSortDir: 'asc'
  });

  const statusLine = document.getElementById('insightsGenStatus');
  function setStatus(text) { statusLine.textContent = text; }
  setStatus(insights.length ? 'מציג את התובנות שנוצרו לאחרונה.' : 'לא נוצרו תובנות עדיין — לחצו על "יצירת תובנות" כדי לחשב אותן.');

  document.getElementById('generateInsightsBtn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    setStatus('יוצר תובנות...');
    try {
      const res = await fetch('/api/insights/generate', { method: 'POST', credentials: 'include' });
      const result = await res.json();
      if (!res.ok) { setStatus('שגיאה ביצירת התובנות'); return; }
      const refreshed = await (await fetch('/api/insights', { credentials: 'include' })).json();
      table.refresh(refreshed);
      setStatus('נוצרו ' + result.count.toLocaleString('he-IL') + ' תובנות.');
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('deleteAllInsightsBtn').addEventListener('click', () => {
    confirmDangerousDelete('פעולה זו תמחק את כל התובנות הקיימות לצמיתות. ניתן ליצור אותן מחדש בכל עת בלחיצה על "יצירת תובנות".', async () => {
      await fetch('/api/insights', { method: 'DELETE', credentials: 'include' });
      table.refresh([]);
      setStatus('כל התובנות נמחקו — לחצו על "יצירת תובנות" כדי לחשב אותן מחדש.');
    });
  });

  document.getElementById('insightsInfoBtn').addEventListener('click', () => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML =
      '<div class="modal-box" style="max-width:440px;text-align:start;">' +
      '<div class="modal-title">איך נקבעים החומרה והמדד?</div>' +
      '<div class="modal-body">' +
      'כל תובנה מחושבת לפי כלל קבוע מראש עם ספים מספריים — ניתן לצפות בכל הכללים ולשנות את הספים במסך <b>מנוע התובנות</b>.<br><br>' +
      '<b>חומרה</b> (גבוהה / בינונית / נמוכה) נקבעת לפי מרחק החריגה מהסף שהוגדר לכלל: ככל שהחריגה גדולה יותר ביחס לסף, כך החומרה עולה.<br><br>' +
      '<b>מדד</b> הוא הערך המספרי שעליו מבוסס החישוב — המשמעות המדויקת (אחוז שינוי, ימים ללא רכישה, מספר חודשים וכו׳) משתנה לפי סוג התובנה, ומפורטת בתוך עמודת "פירוט" של אותה תובנה.' +
      '</div>' +
      '<div class="modal-actions"><button type="button" class="btn btn-primary js-infoClose">הבנתי</button></div>' +
      '</div>';
    document.body.appendChild(overlay);
    function close() { overlay.remove(); }
    overlay.querySelector('.js-infoClose').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  });
}

initInsightsPage();
