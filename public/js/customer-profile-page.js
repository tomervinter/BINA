async function initCustomerProfilePage() {
  const data = await Layout.init('customer-profile');
  if (!data) return;

  const select = document.getElementById('customerSelect');
  const content = document.getElementById('cpContent');
  const emptyState = document.getElementById('cpEmptyState');

  const customersRes = await fetch('/api/customers?pageSize=all', { credentials: 'include' });
  const customers = customersRes.ok ? (await customersRes.json()).rows : [];
  const sorted = customers.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'he'));
  select.innerHTML = '<option value="">— בחר לקוח —</option>' + sorted.map((c) =>
    '<option value="' + Layout.escapeHtml(c.customerNumber) + '">' + Layout.escapeHtml(c.name || c.customerNumber) + ' (' + Layout.escapeHtml(c.customerNumber) + ')</option>'
  ).join('');

  const params = new URLSearchParams(window.location.search);
  const initial = params.get('customer');
  if (initial) select.value = initial;

  select.addEventListener('change', () => {
    const url = new URL(window.location.href);
    if (select.value) url.searchParams.set('customer', select.value); else url.searchParams.delete('customer');
    window.history.replaceState({}, '', url);
    render();
  });

  function fmtMoney(n) { return Math.round(n || 0).toLocaleString('he-IL') + '₪'; }
  function fmtDate(t) { if (!t) return '—'; const d = new Date(t); const p = (n) => String(n).padStart(2, '0'); return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear(); }
  function monthInputVal(y, m) { return y + '-' + String(m).padStart(2, '0'); }
  function pctVsAvg(rev, avg) { return avg > 0 ? Math.round((rev / avg) * 100) : null; }

  let monthlyChart = null, periodChart = null;
  let currentCid = null;

  async function render() {
    const cid = select.value;
    currentCid = cid;
    if (!cid) { content.hidden = true; emptyState.hidden = false; emptyState.textContent = 'בחרו לקוח כדי לראות את הפרופיל המלא שלו.'; return; }

    const profileRes = await fetch('/api/customer-profile/' + encodeURIComponent(cid), { credentials: 'include' });
    if (!profileRes.ok) { content.hidden = true; emptyState.hidden = false; emptyState.textContent = 'לא נמצאו נתונים עבור לקוח זה.'; return; }
    const p = await profileRes.json();

    emptyState.hidden = true;
    content.hidden = false;

    document.getElementById('cpIdentity').innerHTML =
      '<h2 style="margin:0 0 6px;">' + Layout.escapeHtml(p.customer.name) + '</h2>' +
      '<div class="cp-identity-grid">' +
      '<span class="chip">מספר לקוח: ' + Layout.escapeHtml(p.customer.customerNumber) + '</span>' +
      (p.customer.city ? '<span class="chip">עיר: ' + Layout.escapeHtml(p.customer.city) + '</span>' : '') +
      (p.customer.primaryClass ? '<span class="chip">סיווג ראשי: ' + Layout.escapeHtml(p.customer.primaryClass) + '</span>' : '') +
      (p.customer.customerType ? '<span class="chip">סוג לקוח: ' + Layout.escapeHtml(p.customer.customerType) + '</span>' : '') +
      (p.customer.centralCustomer ? '<span class="chip">לקוח מרכז: ' + Layout.escapeHtml(p.customer.centralCustomer) + '</span>' : '') +
      '<span class="chip">סטטוס: ' + Layout.escapeHtml(p.customer.status) + '</span>' +
      '</div>';

    const pcPct = pctVsAvg(p.totalRevenue, p.primaryClass.avgRevenue);
    const ctPct = pctVsAvg(p.totalRevenue, p.customerType.avgRevenue);
    document.getElementById('cpKpis').innerHTML = [
      ['blue', 'v-blue', fmtMoney(p.totalRevenue), 'סה"כ מחזור (כל הנתונים)'],
      ['blue', 'v-blue', Math.round(p.totalQty).toLocaleString('he-IL'), 'סה"כ כמות'],
      ['blue', 'v-blue', fmtDate(p.lastPurchase), 'רכישה אחרונה'],
      ['blue', 'v-blue', p.typicalGapDays != null ? Math.round(p.typicalGapDays) + ' ימים' : '—', 'קצב רכישה טיפוסי'],
      [p.curMonthActive ? 'green' : 'red', p.curMonthActive ? 'v-green' : 'v-red', p.curMonthActive ? 'כן' : 'לא', 'רכש החודש הנוכחי'],
      [p.openInsightCount ? 'red' : 'green', p.openInsightCount ? 'v-red' : 'v-green', String(p.openInsightCount), 'תובנות פתוחות'],
      [pcPct == null ? 'blue' : (pcPct >= 100 ? 'green' : 'red'), pcPct == null ? 'v-blue' : (pcPct >= 100 ? 'v-green' : 'v-red'), pcPct == null ? '—' : pcPct + '%', 'מול ממוצע קבוצת סיווג ראשי'],
      [ctPct == null ? 'blue' : (ctPct >= 100 ? 'green' : 'red'), ctPct == null ? 'v-blue' : (ctPct >= 100 ? 'v-green' : 'v-red'), ctPct == null ? '—' : ctPct + '%', 'מול ממוצע קבוצת סוג לקוח']
    ].map(([dot, cls, value, desc]) => (
      '<div class="kpi-card">' +
      '<div class="kpi-blob" style="background:var(--' + dot + '-dot);"></div>' +
      '<div class="kpi-blob b2" style="background:var(--' + dot + ');"></div>' +
      '<div class="kpi-value ' + cls + '">' + Layout.escapeHtml(String(value)) + '</div>' +
      '<div class="kpi-desc">' + Layout.escapeHtml(desc) + '</div>' +
      '</div>'
    )).join('');

    document.getElementById('cpInsights').innerHTML = p.insights.length
      ? p.insights.map((i) => (
        '<div class="rule-card">' +
        '<div class="rule-title" style="display:flex;align-items:center;gap:8px;">' +
        '<span class="pill ' + (SEV_CLASS[i.severity] || 'pill-gray') + '">' + (SEV_LABEL[i.severity] || i.severity) + '</span>' +
        Layout.escapeHtml((TYPE_META[i.type] || {}).label || i.type) +
        '</div><div class="rule-text">' + Layout.escapeHtml(i.message) + '</div>' +
        (i.breakdown ? renderInsightBreakdown(i.breakdown) : '') + '</div>'
      )).join('')
      : '<p style="color:var(--text-faint);font-size:13px;">אין תובנות פתוחות ללקוח זה כרגע.</p>';

    if (monthlyChart) monthlyChart.destroy();
    monthlyChart = new Chart(document.getElementById('cpMonthlyChart'), {
      data: {
        labels: p.monthly.map((m) => m.month),
        datasets: [
          { type: 'bar', label: 'מחזור', data: p.monthly.map((m) => m.revenue), backgroundColor: '#3D5CF5', borderRadius: 5, yAxisID: 'y' },
          { type: 'line', label: 'כמות', data: p.monthly.map((m) => m.qty), borderColor: '#F2A93B', backgroundColor: '#F2A93B', tension: 0.3, yAxisID: 'y1' }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', rtl: true, labels: { font: { family: 'Assistant' } } } },
        scales: {
          y: { position: 'left', ticks: { callback: (v) => v.toLocaleString('he-IL') } },
          y1: { position: 'right', grid: { drawOnChartArea: false } }
        }
      }
    });

    createDataTable(document.getElementById('cpProducts'), [
      { key: 'name', label: 'מוצר' },
      { key: 'active', label: 'סטטוס', render: (r) => r.active ? 'פעיל' : 'לא פעיל' },
      { key: 'qty', label: 'כמות' },
      { key: 'rev', label: 'מחזור', render: (r) => fmtMoney(r.rev) },
      { key: 'lastPurchase', label: 'רכישה אחרונה', render: (r) => fmtDate(r.lastPurchase) },
      { key: 'daysSince', label: 'ימים מאז רכישה אחרונה' }
    ], p.products, { exportFilename: 'customer-products', tableKey: 'customer-profile-products' });

    function renderGaps(containerId, descId, cohort, label) {
      document.getElementById(descId).textContent = cohort.name
        ? 'קבוצה: "' + cohort.name + '" (' + cohort.cohortSize + ' לקוחות פעילים).'
        : 'ללקוח זה אין ' + label + ' מוגדר.';
      if (!cohort.gaps.length) {
        document.getElementById(containerId).innerHTML = '<p style="color:var(--text-faint);font-size:13px;">אין הזדמנויות מזוהות בקבוצה זו כרגע.</p>';
        return;
      }
      createDataTable(document.getElementById(containerId), [
        { key: 'name', label: 'מוצר' },
        { key: 'buyerCount', label: 'קונים בקבוצה', render: (r) => r.buyerCount + ' מתוך ' + r.cohortSize }
      ], cohort.gaps, { exportFilename: containerId, tableKey: containerId });
    }
    renderGaps('cpPrimaryClassGaps', 'cpPrimaryClassDesc', p.primaryClass, 'סיווג ראשי');
    renderGaps('cpCustomerTypeGaps', 'cpCustomerTypeDesc', p.customerType, 'סוג לקוח');

    setupDefaultPeriods();
    await runPeriodCompare();
  }

  function setupDefaultPeriods() {
    const now = new Date();
    const lastCompletedMonth = Math.max(1, now.getMonth());
    document.getElementById('cpFromA').value = monthInputVal(now.getFullYear(), 1);
    document.getElementById('cpToA').value = monthInputVal(now.getFullYear(), lastCompletedMonth);
    document.getElementById('cpFromB').value = monthInputVal(now.getFullYear() - 1, 1);
    document.getElementById('cpToB').value = monthInputVal(now.getFullYear() - 1, lastCompletedMonth);
  }

  async function runPeriodCompare() {
    if (!currentCid) return;
    const fromA = document.getElementById('cpFromA').value;
    const toA = document.getElementById('cpToA').value;
    const fromB = document.getElementById('cpFromB').value;
    const toB = document.getElementById('cpToB').value;
    if (!fromA || !toA || !fromB || !toB) return;

    const url = '/api/customer-profile/' + encodeURIComponent(currentCid) + '/period-compare?' +
      new URLSearchParams({ fromA, toA, fromB, toB }).toString();
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return;
    const cmp = await res.json();

    const deltaTotal = cmp.totalA ? Math.round(((cmp.totalB - cmp.totalA) / cmp.totalA) * 100) : null;
    document.getElementById('cpPeriodSummary').innerHTML =
      '<div class="cp-identity-grid">' +
      '<span class="chip">תקופה נוכחית: ' + fmtMoney(cmp.totalA) + '</span>' +
      '<span class="chip">תקופת השוואה: ' + fmtMoney(cmp.totalB) + '</span>' +
      (deltaTotal != null ? '<span class="pill ' + (deltaTotal >= 0 ? 'pill-green' : 'pill-red') + '">' + (deltaTotal >= 0 ? '+' : '') + deltaTotal + '%</span>' : '') +
      '</div>';

    const top = cmp.rows.slice(0, 10);
    if (periodChart) periodChart.destroy();
    periodChart = new Chart(document.getElementById('cpPeriodChart'), {
      type: 'bar',
      data: {
        labels: top.map((r) => r.name),
        datasets: [
          { label: 'תקופה נוכחית', data: top.map((r) => r.revenueA), backgroundColor: '#3D5CF5', borderRadius: 6 },
          { label: 'תקופת השוואה', data: top.map((r) => r.revenueB), backgroundColor: '#B9C1E4', borderRadius: 6 }
        ]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', rtl: true, labels: { font: { family: 'Assistant' } } } },
        scales: { x: { ticks: { callback: (v) => v.toLocaleString('he-IL') } } }
      }
    });

    createDataTable(document.getElementById('cpPeriodTable'), [
      { key: 'name', label: 'מוצר' },
      { key: 'revenueA', label: 'מחזור — תקופה נוכחית', render: (r) => fmtMoney(r.revenueA) },
      { key: 'qtyA', label: 'כמות — תקופה נוכחית' },
      { key: 'revenueB', label: 'מחזור — תקופת השוואה', render: (r) => fmtMoney(r.revenueB) },
      { key: 'qtyB', label: 'כמות — תקופת השוואה' },
      { key: 'deltaPct', label: 'שינוי', html: true, render: (r) => r.deltaPct == null ? '—' : '<span class="pill ' + (r.deltaPct >= 0 ? 'pill-green' : 'pill-red') + '">' + (r.deltaPct >= 0 ? '+' : '') + r.deltaPct + '%</span>' }
    ], cmp.rows, { exportFilename: 'customer-period-compare', tableKey: 'customer-profile-period' });
  }

  document.getElementById('cpCompareBtn').addEventListener('click', runPeriodCompare);

  if (initial) render();
}
