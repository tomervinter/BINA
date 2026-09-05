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

  async function render() {
    const cid = select.value;
    if (!cid) { content.hidden = true; emptyState.hidden = false; return; }

    const [profileRes, insightsRes] = await Promise.all([
      fetch('/api/customers/' + encodeURIComponent(cid) + '/profile', { credentials: 'include' }),
      fetch('/api/insights', { credentials: 'include' })
    ]);
    if (!profileRes.ok) { content.hidden = true; emptyState.hidden = false; emptyState.textContent = 'לא נמצאו נתונים עבור לקוח זה'; return; }
    const p = await profileRes.json();
    const insights = insightsRes.ok ? await insightsRes.json() : [];
    const myInsights = insights.filter((i) => i.customerId === cid);

    emptyState.hidden = true;
    content.hidden = false;

    document.getElementById('cpIdentity').innerHTML =
      '<h2 style="margin:0 0 6px;">' + Layout.escapeHtml(p.customer.name) + '</h2>' +
      '<span class="chip">מספר לקוח: ' + Layout.escapeHtml(p.customer.customerNumber) + '</span>' +
      (p.customer.city ? '<span class="chip">עיר: ' + Layout.escapeHtml(p.customer.city) + '</span>' : '') +
      (p.segmentName ? '<span class="chip">סיווג: ' + Layout.escapeHtml(p.segmentName) + '</span>' : '') +
      (p.typeName ? '<span class="chip">סוג לקוח: ' + Layout.escapeHtml(p.typeName) + '</span>' : '');

    document.getElementById('cpKpis').innerHTML = [
      ['סה"כ מחזור', fmtMoney(p.totalRevenue)],
      ['סה"כ כמות', Math.round(p.totalQty).toLocaleString('he-IL')],
      ['רכישה אחרונה', fmtDate(p.lastPurchase)],
      ['קצב רכישה טיפוסי', p.typicalGapDays != null ? Math.round(p.typicalGapDays) + ' ימים' : '—'],
      ['דרופים (30 יום)', p.curDrops30 + ' (קודם: ' + p.prevDrops30 + ')'],
      ['תובנות פתוחות', String(myInsights.length)]
    ].map(([label, value]) => '<div class="kpi-tile"><div class="kpi-label">' + label + '</div><div class="kpi-value">' + value + '</div></div>').join('');

    document.getElementById('cpInsights').innerHTML = myInsights.length
      ? myInsights.map((i) => '<div class="rule-card"><div class="rule-title">' + Layout.escapeHtml((TYPE_META[i.type] || {}).label || i.type) + '</div><div class="rule-text">' + Layout.escapeHtml(i.message) + '</div></div>').join('')
      : '<p style="color:var(--text-faint);font-size:13px;">אין תובנות פתוחות ללקוח זה כרגע.</p>';

    const maxRev = Math.max(1, ...p.monthly.map((m) => m.revenue));
    document.getElementById('cpMonthly').innerHTML = p.monthly.length
      ? '<div style="display:flex;align-items:flex-end;gap:10px;height:120px;">' + p.monthly.map((m) =>
        '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;">' +
        '<div style="width:100%;background:var(--accent);border-radius:6px 6px 0 0;height:' + Math.max(4, Math.round((m.revenue / maxRev) * 100)) + 'px;" title="' + fmtMoney(m.revenue) + '"></div>' +
        '<span style="font-size:11px;color:var(--text-faint);">' + m.month + '</span></div>'
      ).join('') + '</div>'
      : '<p style="color:var(--text-faint);font-size:13px;">אין מספיק היסטוריה חודשית.</p>';

    createDataTable(document.getElementById('cpProducts'), [
      { key: 'name', label: 'מוצר' },
      { key: 'active', label: 'סטטוס', render: (r) => r.active ? 'פעיל' : 'לא פעיל' },
      { key: 'qty', label: 'כמות' },
      { key: 'rev', label: 'מחזור', render: (r) => fmtMoney(r.rev) },
      { key: 'daysSince', label: 'ימים מאז רכישה אחרונה' }
    ], p.products, { exportFilename: 'customer-products' });

    document.getElementById('cpSegment').innerHTML = p.segmentName
      ? '<p style="font-size:13px;color:var(--text-muted);">מחזור הלקוח: <b>' + fmtMoney(p.totalRevenue) + '</b> — ממוצע בקבוצת "' + Layout.escapeHtml(p.segmentName) + '" (' + p.segmentSize + ' לקוחות פעילים): <b>' + fmtMoney(p.segmentAvg) + '</b>.</p>'
      : '<p style="font-size:13px;color:var(--text-faint);">אין ללקוח סיווג ראשי מוגדר.</p>';

    document.getElementById('cpVarietyGaps').innerHTML = p.varietyGaps.length
      ? '<ul style="margin:0;padding-inline-start:20px;font-size:13px;color:var(--text-muted);">' + p.varietyGaps.map((g) => '<li>' + Layout.escapeHtml(g.name) + ' — נרכש ע"י ' + g.count + ' לקוחות דומים מסוג "' + Layout.escapeHtml(p.typeName) + '"</li>').join('') + '</ul>'
      : '<p style="font-size:13px;color:var(--text-faint);">אין פערי מגוון מוצרים ביחס ללקוחות דומים.</p>';
  }

  if (initial) render();
}
