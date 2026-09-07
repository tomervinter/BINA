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

  const table = createDataTable(document.getElementById('tableContainer'), columns, insights, {
    exportUrl: '/api/insights/export',
    onRowClick: (r) => { if (r.customerId) window.location.href = 'customer-profile.html?customer=' + encodeURIComponent(r.customerId); },
    tableKey: 'insights'
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
      'כל תובנה מחושבת לפי כלל קבוע מראש עם ספים מספריים — ניתן לצפות בכל הכללים ולשנות את הספים במסך <b>כללי מנוע התובנות</b>.<br><br>' +
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
